import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearInjectionCache,
  createPack,
  handleContextEvent,
  injectionCacheSize,
  messagesContainDigest,
  revokeInjection,
  warmInjection,
} from "../src/services/context-pack/index.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

const work = mkdtempSync(join(tmpdir(), "tawassul-context-idempotent-"));
const keyDir = join(work, "keys");
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
process.env.XDG_DATA_HOME = join(work, "data");
delete process.env.TAWASSUL_ISOLATED;
delete process.env.TAWASSUL_CONTEXT_HANDOFF;
const worktree = join(work, "workspace");
mkdirSync(worktree, { recursive: true });

function countBody(messages: Array<Record<string, unknown>>, body: string): number {
  let count = 0;
  for (const message of messages) {
    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && (part as { text?: unknown }).text === body) count += 1;
    }
  }
  return count;
}

async function main(): Promise<void> {
  clearInjectionCache();
  const first = await createPack({ worktree, sessionID: "ses-idem", agent: "dev", selection: "PACK-ALPHA" });
  const second = await createPack({ worktree, sessionID: "ses-idem", agent: "dev", selection: "PACK-BETA" });
  warmInjection({ sessionID: "ses-idem", digest: first.digest, message: first.message, alreadyPresent: false });
  warmInjection({ sessionID: "ses-idem", digest: second.digest, message: second.message, alreadyPresent: false });
  eq(injectionCacheSize(), 2, "both digests are cached once");

  warmInjection({ sessionID: "ses-idem", digest: first.digest, message: first.message, alreadyPresent: false });
  eq(injectionCacheSize(), 2, "re-warming a digest does not duplicate the cache entry");

  const request: Array<Record<string, unknown>> = [{ role: "user", content: "go" }];
  eq(handleContextEvent({ sessionID: "ses-idem", messages: request }), 2, "the first request receives both packs");
  eq(countBody(request, first.text), 1, "the first digest appears once");
  eq(countBody(request, second.text), 1, "the second digest appears once");

  eq(handleContextEvent({ sessionID: "ses-idem", messages: request }), 0, "a repeated call on the same request appends nothing");
  eq(countBody(request, first.text), 1, "the first digest is still not duplicated");
  eq(countBody(request, second.text), 1, "the second digest is still not duplicated");

  const next: Array<Record<string, unknown>> = [{ role: "user", content: "again" }];
  eq(handleContextEvent({ sessionID: "ses-idem", messages: next }), 2, "the next host request re-applies both packs once");

  const compacted: Array<Record<string, unknown>> = [
    { role: "user", content: "summary" },
    { role: "user", content: [{ type: "text", text: first.text }] },
    { role: "user", content: [{ type: "text", text: second.text }] },
  ];
  assert(messagesContainDigest(compacted, first.digest), "the post-compaction history still carries the first digest");
  assert(messagesContainDigest(compacted, second.digest), "the post-compaction history still carries the second digest");
  warmInjection({ sessionID: "ses-idem", digest: first.digest, message: first.message, alreadyPresent: true });
  warmInjection({ sessionID: "ses-idem", digest: second.digest, message: second.message, alreadyPresent: true });
  eq(handleContextEvent({ sessionID: "ses-idem", messages: compacted }), 0, "a surviving pack is not re-injected after compaction");
  eq(countBody(compacted, first.text), 1, "compaction leaves exactly one copy of the first pack");
  eq(countBody(compacted, second.text), 1, "compaction leaves exactly one copy of the second pack");

  const vanished: Array<Record<string, unknown>> = [{ role: "user", content: "summary only" }];
  warmInjection({ sessionID: "ses-idem", digest: first.digest, message: first.message, alreadyPresent: false });
  warmInjection({ sessionID: "ses-idem", digest: second.digest, message: second.message, alreadyPresent: false });
  eq(handleContextEvent({ sessionID: "ses-idem", messages: vanished }), 2, "a vanished pack returns exactly once per request");
  eq(countBody(vanished, first.text), 1, "the vanished first digest returns once");
  eq(countBody(vanished, second.text), 1, "the vanished second digest returns once");

  revokeInjection("ses-idem", first.digest);
  const tombstoned: Array<Record<string, unknown>> = [{ role: "user", content: "after revoke" }];
  eq(handleContextEvent({ sessionID: "ses-idem", messages: tombstoned }), 1, "a tombstoned digest is skipped");
  eq(countBody(tombstoned, first.text), 0, "the tombstoned digest never returns");
  eq(countBody(tombstoned, second.text), 1, "the live digest still returns once");

  console.log("PROOF PASS: one append per digest per request, no cache duplication, and compaction never re-injects");
}

function eq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) fail(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

try {
  await main();
} finally {
  clearInjectionCache();
  rmSync(work, { recursive: true, force: true });
}
