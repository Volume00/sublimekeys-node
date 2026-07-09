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
  const path = leasePath(productId, base);
  mkdirSync(join(path, ".."), { recursive: true });
  const data = JSON.stringify({ license_key: licenseKey, token });

  const tmpPath = join(path, "..", `.lease-${randomBytes(6).toString("hex")}.tmp`);
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

export function clearLease(productId: string, base?: string): void {
  const path = leasePath(productId, base);
  try {
    unlinkSync(path);
  } catch {
    // already gone — fine
  }
}
