import { hmacSign, hmacVerify, isHmacIsolationActive } from "../../utils/crypto.ts";
import type { PackClaimFields, PackRecord } from "./types.ts";

export class PackClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackClaimError";
  }
}

function canonicalClaim(fields: PackClaimFields): string {
  return JSON.stringify([
    "tawassul-context-pack-v1",
    fields.digest,
    fields.sessionID,
    fields.agent,
    fields.handoffId,
    fields.parentID,
    fields.worktree,
    fields.issuedAt,
    fields.expiresAt,
    fields.nonce,
  ]);
}

export function mintPackClaim(fields: PackClaimFields): string {
  if (isHmacIsolationActive()) {
    throw new PackClaimError("refusing to mint a pack claim while the HMAC key is isolated");
  }
  return hmacSign(canonicalClaim(fields));
}

export function verifyPackClaim(fields: PackClaimFields, claim: string): boolean {
  if (typeof claim !== "string" || !/^[0-9a-f]{64}$/.test(claim)) return false;
  return hmacVerify(canonicalClaim(fields), claim);
}

export function isPackExpired(record: Pick<PackRecord, "expiresAt">, now: Date = new Date()): boolean {
  const expires = Date.parse(record.expiresAt);
  if (!Number.isFinite(expires)) return true;
  return expires <= now.getTime();
}

export function assertPackFresh(record: PackRecord, now: Date = new Date()): void {
  if (isPackExpired(record, now)) {
    throw new PackClaimError(`pack ${record.digest} expired at ${record.expiresAt}`);
  }
}
