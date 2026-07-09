// A stable per-install machine identifier.
//
// Deliberately a persisted random UUID, not a hardware fingerprint. Real
// hardware IDs (MAC addresses, disk serials, ...) are spoofable, change on
// VMs/cloud desktops/Apple Silicon Rosetta in ways that generate false
// mismatches and support tickets, and buy little real security over a
// persisted UUID for this use case. Trivially resettable by deleting one
// file — that's a known, accepted tradeoff (a soft deterrent, not DRM),
// not an oversight.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultCacheDir } from "./storage.js";

export function getOrCreateMachineId(productId: string, base?: string): string {
  const dir = base ?? defaultCacheDir(productId);
  const path = join(dir, "machine_id");

  if (existsSync(path)) {
    const existing = readFileSync(path, "utf-8").trim();
    if (existing) return existing;
  }

  const machineId = randomUUID();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, machineId, "utf-8");
  return machineId;
}
