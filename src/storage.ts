// Local cache for signed leases — one JSON file per product, written
// atomically (temp file + rename) so a crash mid-write never leaves a
// half-written file behind.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CachedLease {
  license_key: string;
  token: string;
}

export function defaultCacheDir(productId: string): string {
  return join(homedir(), ".sublimekeys", productId);
}

function leasePath(productId: string, base?: string): string {
  return join(base ?? defaultCacheDir(productId), "lease.json");
}

function trialPath(productId: string, base?: string): string {
  return join(base ?? defaultCacheDir(productId), "trial.json");
}

function atomicWriteJson(path: string, payload: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const data = JSON.stringify(payload);

  const tmpPath = join(path, "..", `.sk-${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmpPath, data, "utf-8");
    renameSync(tmpPath, path);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }

  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort — no-op on native Windows ACLs, real on POSIX/WSL
  }
}

export function loadLease(productId: string, base?: string): CachedLease | null {
  const path = leasePath(productId, base);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CachedLease;
  } catch {
    return null;
  }
}

export function saveLease(productId: string, licenseKey: string, token: string, base?: string): void {
  atomicWriteJson(leasePath(productId, base), { license_key: licenseKey, token });
}

export function clearLease(productId: string, base?: string): void {
  const path = leasePath(productId, base);
  try {
    unlinkSync(path);
  } catch {
    // already gone — fine
  }
}

export interface CachedTrial {
  status: string;
  days_left: number;
  expires_at: string | null;
  message: string;
}

export function loadTrial(productId: string, base?: string): CachedTrial | null {
  const path = trialPath(productId, base);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CachedTrial;
  } catch {
    return null;
  }
}

/** Caches the last server-confirmed trial snapshot verbatim — never locally
 * recomputed or decremented. The client's clock is never trusted for trial
 * state; a stale-but-honest snapshot is safer than a locally-ticking
 * countdown an offline user could manipulate. */
export function saveTrial(productId: string, data: CachedTrial, base?: string): void {
  atomicWriteJson(trialPath(productId, base), data);
}
