import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectGarbage,
  createPack,
  isPackDigest,
  listPackStatuses,
  readIndex,
  readPackRecord,
  revokePack,
  setIndexEntry,
  writePackRecord,
} from "../src/services/context-pack/index.ts";
import {
  PACK_ENVELOPE_BYTES,
  PACK_MAX_BYTES,
  PACK_TEXT_BYTES,
} from "../src/services/context-pack/types.ts";
import { PackRenderError } from "../src/services/context-pack/render.ts";
import { readLedger } from "../src/services/context-pack/store.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

function eq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) fail(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

const work = mkdtempSync(join(tmpdir(), "tawassul-context-store-"));
const keyDir = join(work, "keys");
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
process.env.XDG_DATA_HOME = join(work, "data");
delete process.env.TAWASSUL_ISOLATED;
delete process.env.TAWASSUL_CONTEXT_HANDOFF;
const worktree = join(work, "workspace");
mkdirSync(worktree, { recursive: true });

async function main(): Promise<void> {
  const record = await createPack({
    worktree,
    sessionID: "ses-store",
    agent: "dev",
    handoffId: "H-001",
    source: {
      task: "Port the store",
      context: "Atomic writes and digest verification",
      files: ["src/services/context-pack/store.ts"],
    },
  });
  assert(existsSync(join(work, "data")), "the data home is isolated under the proof workspace");

  const listed = await listPackStatuses(worktree);
  eq(listed.length, 1, "one pack is stored");
  const status = listed[0];
  assert(status !== undefined, "the stored pack is listed");
  if (!status) return;
  eq(status.digest, record.digest, "the listed digest matches the created pack");
  eq(status.sessionID, "ses-store", "the pack remembers its session");
  eq(status.handoffId, "H-001", "the pack remembers its handoff");
  assert(!status.revoked && !status.expired, "a fresh pack is live");

  const root = join(work, "data", "tawassul", "context-packs");
  const workspaces = readdirSync(root);
  eq(workspaces.length, 1, "one workspace bucket exists");
  const bucket = join(root, workspaces[0] ?? "missing");
  const freshIndex = await readIndex(bucket);
  eq(Object.keys(freshIndex).length, 0, "createPack does not write the session index");
  const packFile = join(bucket, "packs", `${record.digest}.json`);
  assert(existsSync(packFile), "the pack file exists at its digest path");
  eq(statSync(packFile).mode & 0o777, 0o600, "the pack file is 0600");
  eq(statSync(join(bucket, "packs")).mode & 0o777, 0o700, "the packs directory is 0700");
  eq(readdirSync(join(bucket, "packs")).filter((name) => name.endsWith(".tmp")).length, 0, "no temp files remain");

  const loaded = await readPackRecord(bucket, record.digest);
  eq(loaded.digest, record.digest, "the read digest matches");
  eq(loaded.message.role, "user", "the injection message is a user message");
  eq(loaded.message.content[0]?.type, "text", "the injection message carries one text part");
  eq(loaded.message.content[0]?.text, loaded.text, "the message text equals the stored text");
  eq(loaded.bytes, Buffer.byteLength(loaded.text, "utf8"), "bytes are utf-8 bytes");
  assert(loaded.bytes <= PACK_MAX_BYTES, "the pack never exceeds 64000 bytes");
  assert(loaded.text.includes(record.digest), "the rendered text carries its digest");
  eq(PACK_ENVELOPE_BYTES + PACK_TEXT_BYTES, PACK_MAX_BYTES, "the 2048/61952 split sums to 64000");

  const big = "a".repeat(PACK_TEXT_BYTES - 1024);
  const sized = await createPack({ worktree, sessionID: "ses-big", agent: "dev", selection: big });
  assert(sized.bytes > PACK_TEXT_BYTES - 2048, "a near-limit pack uses the large text budget");
  assert(sized.bytes <= PACK_MAX_BYTES, "a near-limit pack stays under the cap");

  let threw = false;
  try {
    await createPack({ worktree, sessionID: "ses-over", agent: "dev", selection: "a".repeat(PACK_MAX_BYTES) });
  } catch (error) {
    threw = error instanceof PackRenderError;
  }
  assert(threw, "an oversized pack is rejected with PackRenderError");

  const original = readFileSync(packFile, "utf8");
  const parsed = JSON.parse(original) as { message: { content: Array<{ text: string }> } };
  parsed.message.content[0] = { type: "text", text: "tampered body" } as never;
  writeFileSync(packFile, JSON.stringify(parsed), "utf-8");
  let rejected = false;
  try {
    await readPackRecord(bucket, record.digest);
  } catch {
    rejected = true;
  }
  assert(rejected, "a tampered message body is rejected on read");

  const digestTampered = JSON.parse(original) as { digest: string };
  digestTampered.digest = "0".repeat(64);
  writeFileSync(packFile, JSON.stringify(digestTampered), "utf-8");
  rejected = false;
  try {
    await readPackRecord(bucket, record.digest);
  } catch {
    rejected = true;
  }
  assert(rejected, "a tampered digest field is rejected on read");

  writeFileSync(packFile, "{", "utf-8");
  rejected = false;
  try {
    await readPackRecord(bucket, record.digest);
  } catch {
    rejected = true;
  }
  assert(rejected, "malformed json is rejected on read");

  await writePackRecord(bucket, record);
  const restored = await readPackRecord(bucket, record.digest);
  eq(restored.digest, record.digest, "rewriting the record restores a valid pack");

  const now = new Date();
  const old = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const stale = await createPack({ worktree, sessionID: "ses-gc", agent: "dev", selection: "stale", now: old });
  const fresh = await createPack({ worktree, sessionID: "ses-gc", agent: "dev", selection: "fresh", now });
  assert(stale.digest !== fresh.digest, "the replacement pack has a new digest");
  assert(!existsSync(join(bucket, "packs", `${stale.digest}.json`)), "the expired unreferenced pack is collected");
  assert(existsSync(join(bucket, "packs", `${fresh.digest}.json`)), "the live replacement pack survives");
  const afterGc = await readLedger(bucket);
  assert(
    afterGc.some((entry) => entry.type === "tombstone" && entry.digest === stale.digest && entry.reason === "age"),
    "collection records an age tombstone in the ledger",
  );

  const liveExpired = await createPack({ worktree, sessionID: "ses-live", agent: "dev", selection: "live", now: old });
  const unreferenced = await collectGarbage(bucket, [], now);
  eq(unreferenced.removed, 1, "an expired pack with no index entry is collected");
  assert(!existsSync(join(bucket, "packs", `${liveExpired.digest}.json`)), "the unreferenced expired pack is gone");

  const protectedPack = await createPack({
    worktree,
    sessionID: "ses-protected",
    agent: "dev",
    selection: "protected",
    now: old,
  });
  await setIndexEntry(bucket, {
    digest: protectedPack.digest,
    sessionID: "ses-protected",
    agent: "dev",
    activatedAt: new Date().toISOString(),
    warmed: true,
    revoked: false,
  });
  const protectedGc = await collectGarbage(bucket, [], now);
  eq(protectedGc.removed, 0, "collection protects an expired pack referenced by the index");
  assert(existsSync(join(bucket, "packs", `${protectedPack.digest}.json`)), "the protected expired pack survives");

  const cold = await createPack({ worktree, sessionID: "ses-cold", agent: "dev", selection: "cold" });
  const unconfirmed = await revokePack({ worktree, digest: cold.digest });
  eq(unconfirmed.confirmationRequired, true, "a destructive revoke requires confirmation");
  eq(unconfirmed.removed, false, "an unconfirmed revoke removes nothing");
  assert(existsSync(join(bucket, "packs", `${cold.digest}.json`)), "the unconfirmed pack file survives");

  const revoked = await revokePack({ worktree, digest: cold.digest, confirm: true });
  assert(revoked.removed && revoked.revoked, "revoking before injection removes and revokes");
  assert(!existsSync(join(bucket, "packs", `${cold.digest}.json`)), "the pre-injection revoke unlinks the pack file");

  const stuck = await createPack({ worktree, sessionID: "ses-stuck", agent: "dev", selection: "stuck" });
  const stuckPath = join(bucket, "packs", `${stuck.digest}.json`);
  unlinkSync(stuckPath);
  mkdirSync(stuckPath);
  const failed = await revokePack({ worktree, digest: stuck.digest, confirm: true });
  eq(failed.removed, false, "a failed unlink reports removed false");
  eq(failed.revoked, true, "a failed unlink still tombstones the digest");
  assert(typeof failed.error === "string" && failed.error.length > 0, "a failed unlink reports the error");

  const indexAfter = await readIndex(bucket);
  const coldEntry = indexAfter["ses-cold"];
  assert(coldEntry === undefined, "an unindexed revoked pack gains no synthetic index entry");
  const protectedEntry = indexAfter["ses-protected"];
  eq(protectedEntry?.digest, protectedPack.digest, "an indexed pack keeps its session key");

  const marked = await createPack({ worktree, sessionID: "ses-marked", agent: "dev", selection: "marked" });
  await setIndexEntry(bucket, {
    digest: marked.digest,
    sessionID: "ses-marked",
    agent: "dev",
    activatedAt: new Date().toISOString(),
    warmed: true,
    revoked: false,
  });
  const additive = await revokePack({ worktree, digest: marked.digest });
  assert(!additive.removed && additive.revoked, "an injected revoke stays additive");
  const markedRecord = await readPackRecord(bucket, marked.digest, { allowRevoked: true });
  assert(typeof markedRecord.revokedAt === "string" && markedRecord.revokedAt.length > 0, "an additive revoke marks the record");
  let markedRefused = false;
  try {
    await readPackRecord(bucket, marked.digest);
  } catch {
    markedRefused = true;
  }
  assert(markedRefused, "a marked record is refused without allowRevoked");

  const replacement = await createPack({ worktree, sessionID: "ses-marked", agent: "dev", selection: "replacement" });
  await setIndexEntry(bucket, {
    digest: replacement.digest,
    sessionID: "ses-marked",
    agent: "dev",
    activatedAt: new Date().toISOString(),
    warmed: true,
    revoked: false,
  });
  markedRefused = false;
  try {
    await readPackRecord(bucket, marked.digest);
  } catch {
    markedRefused = true;
  }
  assert(markedRefused, "the record tombstone survives an index entry replacement");

  let traversalRejected = false;
  try {
    await revokePack({ worktree, digest: "../victim", confirm: true });
  } catch {
    traversalRejected = true;
  }
  assert(traversalRejected, "a traversal digest is rejected before any unlink");
  assert(!isPackDigest("../victim"), "the traversal digest is not a valid digest");
  assert(isPackDigest(record.digest), "a real digest passes validation");

  const ledger = await readLedger(bucket);
  assert(ledger.some((entry) => entry.type === "write"), "writes are recorded in the ledger");
  assert(ledger.some((entry) => entry.type === "revoke"), "revokes are recorded in the ledger");
  console.log("PROOF PASS: storage is atomic, 0600, digest verified, capped at 64000, and GC keeps live packs");
}

try {
  await main();
} finally {
  rmSync(work, { recursive: true, force: true });
}
