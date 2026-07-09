// SublimeKeysClient — the main SDK entry point.
//
// Cache-first, not online-first-with-fallback: after one successful
// activate()/verify(), subsequent verify() calls make zero network requests
// for as long as the cached lease's trust window is valid (currently 7 days,
// set server-side) — that's the actual point of offline leases. A network
// call only happens again once the cache is missing, invalid, or its trust
// window has lapsed.

import { PUBLIC_KEY_B64U } from "./pubkey.js";
import { NetworkError, LeaseError } from "./errors.js";
import { DEFAULT_BASE_URL, HttpClient } from "./http.js";
import { verifyLease } from "./lease.js";
import { getOrCreateMachineId } from "./machine.js";
import { loadLease, saveLease, clearLease } from "./storage.js";

export type LicenseSource = "online" | "offline_cache" | "offline_cache_miss";

export interface LicenseResult {
  valid: boolean;
  message: string;
  email?: string | null;
  expiresAt?: string | null;
  source: LicenseSource;
}

export interface TrialResult {
  status: "active" | "expired" | "none";
  daysLeft: number;
  expiresAt?: string | null;
  message: string;
}

export interface SublimeKeysClientOptions {
  baseUrl?: string;
  cacheDir?: string;
  publicKeyB64u?: string;
  timeoutMs?: number;
}

export interface VerifyOptions {
  allowOffline?: boolean;
  /** Internal test hook — overrides "now" when checking lease expiry. */
  _now?: Date;
}

export class SublimeKeysClient {
  readonly productId: string;
  private readonly http: HttpClient;
  private readonly cacheBase?: string;
  private readonly publicKeyBytes: Buffer;

  constructor(productId: string, options: SublimeKeysClientOptions = {}) {
    this.productId = productId;
    this.http = new HttpClient(options.baseUrl ?? DEFAULT_BASE_URL, options.timeoutMs ?? 10_000);
    this.cacheBase = options.cacheDir;
    this.publicKeyBytes = Buffer.from(options.publicKeyB64u ?? PUBLIC_KEY_B64U, "base64url");
  }

  /** A stable, locally-persisted machine identifier — generated once on
   * first call, reused after that. */
  getMachineId(): string {
    return getOrCreateMachineId(this.productId, this.cacheBase);
  }

  /** First run for this license on this machine. Always goes online —
   * activation is inherently server-side state. Safe to call again on a
   * machine that's already activated (the server treats it as a no-op
   * that doesn't consume another activation slot). */
  async activate(licenseKey: string, machineId?: string): Promise<LicenseResult> {
    const resolvedMachineId = machineId ?? this.getMachineId();
    let data;
    try {
      data = await this.http.postJson("/activate", {
        license_key: licenseKey,
        machine_id: resolvedMachineId,
        product_id: this.productId,
      });
    } catch (err) {
      const reason = err instanceof NetworkError ? err.message : String(err);
      return { valid: false, message: `Network error: ${reason}`, source: "online" };
    }

    const result: LicenseResult = {
      valid: data.valid,
      message: data.message,
      email: data.email ?? null,
      expiresAt: data.expires_at ?? null,
      source: "online",
    };
    if (result.valid && data.lease) {
      saveLease(this.productId, licenseKey, data.lease, this.cacheBase);
    }
    return result;
  }

  /** Every launch after the first. Checks the local cached lease first
   * (instant, no network) if allowOffline is true; falls back to an online
   * /verify call when there's no usable cached lease. Refreshes the cache
   * on every successful online check, and clears it on a revoked/invalid
   * result so a stale cache never outlives the license it was issued for. */
  async verify(licenseKey: string, machineId?: string, options: VerifyOptions = {}): Promise<LicenseResult> {
    const resolvedMachineId = machineId ?? this.getMachineId();
    const allowOffline = options.allowOffline ?? true;

    if (allowOffline) {
      const cached = loadLease(this.productId, this.cacheBase);
      if (cached && cached.license_key === licenseKey) {
        try {
          const payload = verifyLease(cached.token, this.publicKeyBytes, {
            expectedLicenseKey: licenseKey,
            expectedMachineId: resolvedMachineId,
            expectedProductId: this.productId,
            now: options._now,
          });
          return {
            valid: true,
            message: "Valid (offline)",
            email: payload.email ?? null,
            expiresAt: payload.license_expires_at ?? null,
            source: "offline_cache",
          };
        } catch (err) {
          if (!(err instanceof LeaseError)) throw err;
          // cache unusable — fall through to an online check
        }
      }
    }

    let data;
    try {
      data = await this.http.postJson("/verify", {
        license_key: licenseKey,
        machine_id: resolvedMachineId,
        product_id: this.productId,
      });
    } catch {
      return { valid: false, message: "Offline and no valid cached lease", source: "offline_cache_miss" };
    }

    const result: LicenseResult = {
      valid: data.valid,
      message: data.message,
      email: data.email ?? null,
      expiresAt: data.expires_at ?? null,
      source: "online",
    };
    if (result.valid && data.lease) {
      saveLease(this.productId, licenseKey, data.lease, this.cacheBase);
    } else if (!result.valid) {
      // Don't leave a stale cache behind — a license revoked server-side
      // must not keep offline-verifying as valid for days afterward.
      clearLease(this.productId, this.cacheBase);
    }
    return result;
  }

  /** User signs out / uninstalls. Clears the local cache immediately —
   * otherwise a deliberately-deactivated license would keep
   * offline-verifying as valid until its trust window lapsed. */
  async deactivate(licenseKey: string, machineId?: string): Promise<LicenseResult> {
    const resolvedMachineId = machineId ?? this.getMachineId();
    let data;
    try {
      data = await this.http.postJson("/deactivate", {
        license_key: licenseKey,
        machine_id: resolvedMachineId,
        product_id: this.productId,
      });
    } catch (err) {
      const reason = err instanceof NetworkError ? err.message : String(err);
      return { valid: false, message: `Network error: ${reason}`, source: "online" };
    }

    clearLease(this.productId, this.cacheBase);
    return { valid: data.valid, message: data.message, source: "online" };
  }

  /** Get-or-create a trial for this machine. Idempotent server-side —
   * reinstalling never resets the clock. */
  async startTrial(machineId?: string): Promise<TrialResult> {
    return this.trialCall("/trial/start", machineId);
  }

  /** Read-only trial check — never starts one. */
  async trialStatus(machineId?: string): Promise<TrialResult> {
    return this.trialCall("/trial/status", machineId);
  }

  private async trialCall(path: string, machineId?: string): Promise<TrialResult> {
    const resolvedMachineId = machineId ?? this.getMachineId();
    let data;
    try {
      data = await this.http.postJson(path, {
        machine_id: resolvedMachineId,
        product_id: this.productId,
      });
    } catch (err) {
      const reason = err instanceof NetworkError ? err.message : String(err);
      return { status: "none", daysLeft: 0, message: `Network error: ${reason}` };
    }
    return {
      status: data.status as TrialResult["status"],
      daysLeft: (data.days_left as number) ?? 0,
      expiresAt: (data.expires_at as string) ?? null,
      message: (data.message as string) ?? "",
    };
  }
}
