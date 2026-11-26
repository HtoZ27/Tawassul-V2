import "./proof-log-isolate.ts";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PackClaimError,
  assertPackFresh,
  isPackExpired,
  mintPackClaim,
  verifyPackClaim,
} from "../src/services/context-pack/claim.ts";
import type { PackClaimFields } from "../src/services/context-pack/types.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

const work = mkdtempSync(join(tmpdir(), "tawassul-context-claim-"));
const keyDir = join(work, "keys");
mkdirSync(keyDir, { recursive: true });
const keyBytes = randomBytes(32);
writeFileSync(join(keyDir, ".tawassul-hmac-key"), keyBytes, { mode: 0o600 });
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
delete process.env.TAWASSUL_ISOLATED;

function fields(): PackClaimFields {
  return {
    digest: "a".repeat(64),
    sessionID: "ses-claim",
    agent: "dev",
    handoffId: "H-001",
    parentID: "ses-parent",
    worktree: "/tmp/worktree",
    issuedAt: "2026-10-30T00:00:00.000Z",
    expiresAt: "2026-11-13T00:00:00.000Z",
    nonce: "0123456789abcdef",
  };
}

function canonical(input: PackClaimFields): string {
  return JSON.stringify([
    "tawassul-context-pack-v1",
    input.digest,
    input.sessionID,
    input.agent,
    input.handoffId,
    input.parentID,
    input.worktree,
    input.issuedAt,
    input.expiresAt,
    input.nonce,
  ]);
}

function main(): void {
  const base = fields();
  const claim = mintPackClaim(base);
  assert(/^[0-9a-f]{64}$/.test(claim), "the claim is a 64 character hex signature");
  assert(verifyPackClaim(base, claim), "the minted claim verifies");

  const stored = readFileSync(join(keyDir, ".tawassul-hmac-key"));
  const independent = createHmac("sha256", stored).update(canonical(base), "utf-8").digest("hex");
  if (independent !== claim) fail("the claim is not an HMAC of the canonical fields with the existing key file");

  const keys: Array<keyof PackClaimFields> = [
    "digest",
    "sessionID",
    "agent",
    "handoffId",
    "parentID",
    "worktree",
    "issuedAt",
    "expiresAt",
    "nonce",
  ];
  for (const key of keys) {
    const mutated = { ...base, [key]: `${base[key]}-x` };
    assert(!verifyPackClaim(mutated, claim), `a mutated ${key} is rejected`);
  }

  assert(!verifyPackClaim(base, "0".repeat(64)), "a wrong signature is rejected");
  assert(!verifyPackClaim(base, claim.toUpperCase()), "an uppercase signature is rejected");
  assert(!verifyPackClaim(base, claim.slice(0, 63)), "a truncated signature is rejected");
  assert(!verifyPackClaim(base, "not-a-signature"), "a non-hex signature is rejected");

  const expired = { expiresAt: "2020-01-01T00:00:00.000Z" };
  const future = { expiresAt: "2099-01-01T00:00:00.000Z" };
  assert(isPackExpired(expired), "a past expiresAt is expired");
  assert(!isPackExpired(future), "a future expiresAt is fresh");
  assert(isPackExpired({ expiresAt: "not-a-date" }), "an unparsable expiresAt fails closed");
  let threw = false;
  try {
    assertPackFresh({ digest: "d", expiresAt: expired.expiresAt } as never);
  } catch (error) {
    threw = error instanceof PackClaimError;
  }
  assert(threw, "assertPackFresh rejects an expired pack");
  assertPackFresh({ digest: "d", expiresAt: future.expiresAt } as never);
  assertPackFresh({ digest: "d", expiresAt: future.expiresAt } as never, new Date("2026-01-01T00:00:00.000Z"));

  process.env.TAWASSUL_ISOLATED = "1";
  threw = false;
  try {
    mintPackClaim(base);
  } catch (error) {
    threw = error instanceof PackClaimError;
  }
  assert(threw, "minting refuses the isolation sentinel key");
  delete process.env.TAWASSUL_ISOLATED;

  const again = mintPackClaim(base);
  assert(again === claim, "the same fields mint deterministically from the reused key");
  console.log("PROOF PASS: the claim binds every field, reuses the key, and fails closed on isolation and expiry");
}

try {
  main();
} finally {
  delete process.env.TAWASSUL_ISOLATED;
  rmSync(work, { recursive: true, force: true });
}
