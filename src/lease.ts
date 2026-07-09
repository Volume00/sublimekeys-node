// Offline verification of SublimeKeys signed leases.
//
// A lease is a compact token: base64url(json_payload) + "." + base64url(signature),
// signed with Ed25519 by the SublimeKeys license server. Verifying it locally
// requires no network call, which is the entire point of this module.

import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { LeaseError } from "./errors.js";

export interface LeasePayload {
  kid?: string;
  license_key: string;
  machine_id: string;
  product_id: string;
  email?: string | null;
  issued_at?: string;
  lease_expires_at: string;
  license_expires_at?: string | null;
  [key: string]: unknown;
}

export interface VerifyLeaseOptions {
  expectedLicenseKey: string;
  expectedMachineId: string;
  expectedProductId: string;
  now?: Date;
}

function loadEd25519PublicKey(rawBytes: Buffer) {
  return createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: rawBytes.toString("base64url") },
    format: "jwk",
  });
}

/**
 * Verify a lease token and return its payload if valid.
 *
 * Throws LeaseError for any failure — malformed token, bad signature,
 * wrong license/machine/product, or an expired trust window/license.
 * A valid signature only proves "SublimeKeys signed this," not "this is
 * for the product/machine/license you expect" — the three equality
 * checks below are not optional and cannot be skipped by a caller.
 */
export function verifyLease(token: string, publicKeyBytes: Buffer, opts: VerifyLeaseOptions): LeasePayload {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new LeaseError("malformed lease token: expected exactly one '.' separator");
  }
  const [payloadB64, sigB64] = parts;

  let payloadBytes: Buffer;
  let sigBytes: Buffer;
  try {
    payloadBytes = Buffer.from(payloadB64, "base64url");
    sigBytes = Buffer.from(sigB64, "base64url");
  } catch (err) {
    throw new LeaseError(`malformed lease token: ${err instanceof Error ? err.message : String(err)}`);
  }

  const publicKey = loadEd25519PublicKey(publicKeyBytes);

  // Verify the signature BEFORE parsing the payload as JSON — never hand
  // unauthenticated bytes to a parser first, even a safe one.
  let signatureValid: boolean;
  try {
    signatureValid = cryptoVerify(null, payloadBytes, publicKey, sigBytes);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    throw new LeaseError("invalid lease signature");
  }

  let payload: LeasePayload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf-8")) as LeasePayload;
  } catch (err) {
    throw new LeaseError(`malformed lease payload: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (payload.license_key !== opts.expectedLicenseKey) {
    throw new LeaseError("lease license_key does not match");
  }
  if (payload.machine_id !== opts.expectedMachineId) {
    throw new LeaseError("lease machine_id does not match");
  }
  if (payload.product_id !== opts.expectedProductId) {
    throw new LeaseError("lease product_id does not match");
  }

  const now = opts.now ?? new Date();

  if (!payload.lease_expires_at || now >= new Date(payload.lease_expires_at)) {
    throw new LeaseError("lease trust window has lapsed");
  }

  if (payload.license_expires_at && now >= new Date(payload.license_expires_at)) {
    throw new LeaseError("license has expired");
  }

  return payload;
}
