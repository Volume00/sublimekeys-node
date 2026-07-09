import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LeaseError } from "../src/errors.js";
import { verifyLease } from "../src/lease.js";
import { flipFirstByte, makeKeypair, makeLease } from "./helpers.js";

const EXPECTED = {
  expectedLicenseKey: "TEST-KEY",
  expectedMachineId: "test-machine",
  expectedProductId: "test-product",
};

describe("verifyLease", () => {
  it("accepts a fresh valid token", () => {
    const { privateKey, pubBytes } = makeKeypair();
    const token = makeLease(privateKey);
    const payload = verifyLease(token, pubBytes, EXPECTED);
    expect(payload.license_key).toBe("TEST-KEY");
  });

  it("rejects a tampered payload", () => {
    const { privateKey, pubBytes } = makeKeypair();
    const token = makeLease(privateKey);
    const [payloadB64, sigB64] = token.split(".");
    const tampered = `${flipFirstByte(payloadB64)}.${sigB64}`;
    expect(() => verifyLease(tampered, pubBytes, EXPECTED)).toThrow(LeaseError);
  });

  it("rejects a tampered signature", () => {
    const { privateKey, pubBytes } = makeKeypair();
    const token = makeLease(privateKey);
    const [payloadB64, sigB64] = token.split(".");
    const tampered = `${payloadB64}.${flipFirstByte(sigB64)}`;
    expect(() => verifyLease(tampered, pubBytes, EXPECTED)).toThrow(LeaseError);
  });

  it("rejects a lapsed trust window", () => {
    const { privateKey, pubBytes } = makeKeypair();
    const past = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    const token = makeLease(privateKey, {
      issuedAt: past,
      leaseExpiresAt: new Date(past.getTime() + 7 * 24 * 3600 * 1000),
    });
    expect(() => verifyLease(token, pubBytes, EXPECTED)).toThrow(/trust window/);
  });

  it("rejects an expired license", () => {
    const { privateKey, pubBytes } = makeKeypair();
    const pastExpiry = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const token = makeLease(privateKey, { licenseExpiresAt: pastExpiry });
    expect(() => verifyLease(token, pubBytes, EXPECTED)).toThrow(/expired/);
  });

  it.each([
    ["expectedLicenseKey", "WRONG-KEY"],
    ["expectedMachineId", "wrong-machine"],
    ["expectedProductId", "wrong-product"],
  ] as const)("rejects a mismatched %s", (field, value) => {
    const { privateKey, pubBytes } = makeKeypair();
    const token = makeLease(privateKey);
    const opts = { ...EXPECTED, [field]: value };
    expect(() => verifyLease(token, pubBytes, opts)).toThrow(LeaseError);
  });

  it.each(["not-a-valid-token", "only.one.dot.too.many", "!!!invalid-base64!!!.also-invalid"])(
    "rejects malformed token %s",
    (malformed) => {
      const { pubBytes } = makeKeypair();
      expect(() => verifyLease(malformed, pubBytes, EXPECTED)).toThrow(LeaseError);
    },
  );

  it("rejects a lease signed by a different key", () => {
    const { privateKey, pubBytes } = makeKeypair();
    void pubBytes;
    const token = makeLease(privateKey);

    const other = generateKeyPairSync("ed25519");
    const otherJwk = other.publicKey.export({ format: "jwk" }) as { x: string };
    const otherPubBytes = Buffer.from(otherJwk.x, "base64url");

    expect(() => verifyLease(token, otherPubBytes, EXPECTED)).toThrow(LeaseError);
  });
});
