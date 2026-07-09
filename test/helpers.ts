import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";

export interface TestKeypair {
  privateKey: KeyObject;
  pubBytes: Buffer;
}

/** An ephemeral test keypair — never the real production key. */
export function makeKeypair(): TestKeypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubJwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { privateKey, pubBytes: Buffer.from(pubJwk.x, "base64url") };
}

export interface MakeLeaseOptions {
  licenseKey?: string;
  machineId?: string;
  productId?: string;
  email?: string | null;
  licenseExpiresAt?: string | null;
  issuedAt?: Date;
  leaseExpiresAt?: Date | string;
  kid?: string;
}

export function makeLease(privateKey: KeyObject, opts: MakeLeaseOptions = {}): string {
  const now = opts.issuedAt ?? new Date();
  const leaseExpiresAt =
    typeof opts.leaseExpiresAt === "string"
      ? opts.leaseExpiresAt
      : (opts.leaseExpiresAt ?? new Date(now.getTime() + 7 * 24 * 3600 * 1000)).toISOString();

  const payload = {
    kid: opts.kid ?? "v1",
    license_key: opts.licenseKey ?? "TEST-KEY",
    machine_id: opts.machineId ?? "test-machine",
    product_id: opts.productId ?? "test-product",
    email: opts.email === undefined ? "buyer@example.com" : opts.email,
    license_expires_at: opts.licenseExpiresAt ?? null,
    issued_at: now.toISOString(),
    lease_expires_at: leaseExpiresAt,
  };

  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf-8");
  const sig = cryptoSign(null, payloadBytes, privateKey);
  return `${payloadBytes.toString("base64url")}.${sig.toString("base64url")}`;
}

/** Flips a bit in the first DECODED byte, then re-encodes. Manipulating raw
 * bytes (not the base64 characters) sidesteps a real edge case: base64's
 * last character in a partial group can have padding bits that don't affect
 * the decoded value, making a naive character flip an unreliable way to
 * guarantee a changed payload/signature. */
export function flipFirstByte(b64uSegment: string): string {
  const raw = Buffer.from(b64uSegment, "base64url");
  raw[0] = raw[0] ^ 0xff;
  return raw.toString("base64url");
}
