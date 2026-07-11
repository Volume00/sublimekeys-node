import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SublimeKeysClient } from "../src/client.js";
import { saveLease } from "../src/storage.js";
import { makeKeypair, makeLease, type TestKeypair } from "./helpers.js";

class FakeTransport {
  calls: string[] = [];
  private queue: Array<{ data: unknown; status: number }> = [];
  private offline = false;

  queueResponse(data: unknown, status = 200) {
    this.queue.push({ data, status });
  }

  goOffline() {
    this.offline = true;
  }

  fetchImpl = async (url: string | URL): Promise<Response> => {
    this.calls.push(String(url));
    if (this.offline) {
      throw new TypeError("simulated offline");
    }
    const next = this.queue.shift();
    if (!next) {
      throw new Error("FakeTransport called with no queued response");
    }
    return new Response(JSON.stringify(next.data), { status: next.status });
  };
}

function b64u(buf: Buffer): string {
  return buf.toString("base64url");
}

let cacheDir: string;
let keypair: TestKeypair;
let transport: FakeTransport;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "sublimekeys-test-"));
  keypair = makeKeypair();
  transport = new FakeTransport();
  vi.stubGlobal("fetch", transport.fetchImpl);
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(cacheDir, { recursive: true, force: true });
});

function makeClient(): SublimeKeysClient {
  return new SublimeKeysClient("test-product", {
    cacheDir,
    publicKeyB64u: b64u(keypair.pubBytes),
  });
}

describe("SublimeKeysClient", () => {
  it("writes the cache on a successful activate", async () => {
    const client = makeClient();
    const lease = makeLease(keypair.privateKey, { licenseKey: "LIC-1", machineId: client.getMachineId() });
    transport.queueResponse({ valid: true, message: "Activated", email: "buyer@example.com", expires_at: null, lease });

    const result = await client.activate("LIC-1");

    expect(result.valid).toBe(true);
    expect(result.source).toBe("online");
    expect(existsSync(join(cacheDir, "lease.json"))).toBe(true);
  });

  it("verifies from cache with zero network calls once activated", async () => {
    const client = makeClient();
    const machineId = client.getMachineId();
    const lease = makeLease(keypair.privateKey, { licenseKey: "LIC-1", machineId });
    transport.queueResponse({ valid: true, message: "Activated", email: "buyer@example.com", expires_at: null, lease });
    await client.activate("LIC-1");
    const callsBefore = transport.calls.length;

    const result = await client.verify("LIC-1");

    expect(result.valid).toBe(true);
    expect(result.source).toBe("offline_cache");
    expect(transport.calls.length).toBe(callsBefore);
  });

  it("falls back online once the trust window has lapsed", async () => {
    const client = makeClient();
    const machineId = client.getMachineId();
    const past = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    const lease = makeLease(keypair.privateKey, {
      licenseKey: "LIC-1",
      machineId,
      issuedAt: past,
      leaseExpiresAt: new Date(past.getTime() + 7 * 24 * 3600 * 1000),
    });
    transport.queueResponse({ valid: true, message: "Activated", email: "buyer@example.com", expires_at: null, lease });
    await client.activate("LIC-1");

    const freshLease = makeLease(keypair.privateKey, { licenseKey: "LIC-1", machineId });
    transport.queueResponse({ valid: true, message: "Valid", email: "buyer@example.com", expires_at: null, lease: freshLease });
    const callsBefore = transport.calls.length;

    const result = await client.verify("LIC-1");

    expect(result.source).toBe("online");
    expect(transport.calls.length).toBe(callsBefore + 1);
  });

  it("clears the cache on revocation and stays invalid fully offline", async () => {
    const client = makeClient();
    const machineId = client.getMachineId();
    const lease = makeLease(keypair.privateKey, { licenseKey: "LIC-1", machineId });
    transport.queueResponse({ valid: true, message: "Activated", email: "buyer@example.com", expires_at: null, lease });
    await client.activate("LIC-1");

    // Force an online check by seeding an already-lapsed cached lease, then
    // simulate a server-side revocation on that forced online call.
    const past = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    const expiredLease = makeLease(keypair.privateKey, {
      licenseKey: "LIC-1",
      machineId,
      issuedAt: past,
      leaseExpiresAt: new Date(past.getTime() + 7 * 24 * 3600 * 1000),
    });
    saveLease("test-product", "LIC-1", expiredLease, cacheDir);
    transport.queueResponse({ valid: false, message: "Revoked", email: null, expires_at: null, lease: null });

    const result = await client.verify("LIC-1");
    expect(result.valid).toBe(false);
    expect(existsSync(join(cacheDir, "lease.json"))).toBe(false);

    // Now fully offline — must NOT resurrect a stale valid=true.
    transport.goOffline();
    const result2 = await client.verify("LIC-1");
    expect(result2.valid).toBe(false);
    expect(result2.source).toBe("offline_cache_miss");
  });

  it("clears the cache on deactivate", async () => {
    const client = makeClient();
    const machineId = client.getMachineId();
    const lease = makeLease(keypair.privateKey, { licenseKey: "LIC-1", machineId });
    transport.queueResponse({ valid: true, message: "Activated", email: "buyer@example.com", expires_at: null, lease });
    await client.activate("LIC-1");
    expect(existsSync(join(cacheDir, "lease.json"))).toBe(true);

    transport.queueResponse({ valid: true, message: "Deactivated", email: null, expires_at: null, lease: null });
    await client.deactivate("LIC-1");

    expect(existsSync(join(cacheDir, "lease.json"))).toBe(false);
  });

  it("reports network_error, not online, when activate can't reach the server", async () => {
    const client = makeClient();
    transport.goOffline();

    const result = await client.activate("LIC-1");

    expect(result.valid).toBe(false);
    expect(result.source).toBe("network_error");
  });

  it("reports network_error, not online, when deactivate can't reach the server", async () => {
    const client = makeClient();
    transport.goOffline();

    const result = await client.deactivate("LIC-1");

    expect(result.valid).toBe(false);
    expect(result.source).toBe("network_error");
  });

  it("reports network_error on a trial check with no cached snapshot yet", async () => {
    const client = makeClient();
    transport.goOffline();

    const result = await client.trialStatus();

    expect(result.status).toBe("network_error");
    expect(result.source).toBe("network_error");
  });

  it("falls back to the cached trial snapshot when offline", async () => {
    const client = makeClient();
    transport.queueResponse({ status: "active", days_left: 5, expires_at: null, message: "Trial active" });
    const online = await client.trialStatus();
    expect(online.source).toBe("online");

    transport.goOffline();
    const result = await client.trialStatus();

    expect(result.status).toBe("active");
    expect(result.daysLeft).toBe(5);
    expect(result.source).toBe("offline_cache");
  });

  it("never locally recomputes the cached trial snapshot", async () => {
    const client = makeClient();
    transport.queueResponse({ status: "active", days_left: 5, expires_at: null, message: "Trial active" });
    await client.trialStatus();

    transport.goOffline();
    const first = await client.trialStatus();
    const second = await client.trialStatus();

    expect(first.daysLeft).toBe(5);
    expect(second.daysLeft).toBe(5);
  });
});
