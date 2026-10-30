import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearInjectionCache,
  createPack,
  handleContextEvent,
  injectionCacheSize,
  isInjectionWarm,
  messagesContainDigest,
  revokeInjection,
  warmInjection,
} from "../src/services/context-pack/index.ts";
import { cachedDigests } from "../src/services/context-pack/hook.ts";

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
  eq(injectionCacheSize(), 1, "the session starts with one active digest");
  eq(cachedDigests("ses-idem").join(","), first.digest, "the first digest is active");

  const firstRequest: Array<Record<string, unknown>> = [{ role: "user", content: "go" }];
  eq(handleContextEvent({ sessionID: "ses-idem", messages: firstRequest }), 1, "the first request receives one pack");
  eq(countBody(firstRequest, first.text), 1, "the active digest appears once");
  eq(handleContextEvent({ sessionID: "ses-idem", messages: firstRequest }), 0, "a repeated call on the same request appends nothing");
  eq(countBody(firstRequest, first.text), 1, "the digest is still not duplicated");

  warmInjection({ sessionID: "ses-idem", digest: second.digest, message: second.message, alreadyPresent: false });
  eq(injectionCacheSize(), 1, "the replacement digest is the only cached entry");
  eq(cachedDigests("ses-idem").join(","), second.digest, "the second digest replaces the first");
  assert(!isInjectionWarm("ses-idem", first.digest), "the replaced digest is no longer warm");

  const secondRequest: Array<Record<string, unknown>> = [{ role: "user", content: "again" }];
  eq(handleContextEvent({ sessionID: "ses-idem", messages: secondRequest }), 1, "the next request receives the replacement only");
  eq(countBody(secondRequest, first.text), 0, "the replaced digest is not injected");
  eq(countBody(secondRequest, second.text), 1, "the replacement appears once");

  warmInjection({ sessionID: "ses-idem", digest: second.digest, message: second.message, alreadyPresent: false });
  eq(injectionCacheSize(), 1, "re-warming the active digest does not duplicate the cache entry");

  const compacted: Array<Record<string, unknown>> = [
    { role: "user", content: "summary" },
    { role: "user", content: [{ type: "text", text: second.text }] },
  ];
  assert(messagesContainDigest(compacted, second.digest), "the post-compaction history still carries the active digest");
  warmInjection({ sessionID: "ses-idem", digest: second.digest, message: second.message, alreadyPresent: true });
  eq(handleContextEvent({ sessionID: "ses-idem", messages: compacted }), 0, "a surviving pack is not re-injected after compaction");
  eq(countBody(compacted, second.text), 1, "compaction leaves exactly one copy of the pack");

  const vanished: Array<Record<string, unknown>> = [{ role: "user", content: "summary only" }];
  warmInjection({ sessionID: "ses-idem", digest: second.digest, message: second.message, alreadyPresent: false });
  eq(handleContextEvent({ sessionID: "ses-idem", messages: vanished }), 1, "a vanished pack returns exactly once per request");
  eq(countBody(vanished, second.text), 1, "the vanished digest returns once");

  revokeInjection("ses-idem", second.digest);
  const tombstoned: Array<Record<string, unknown>> = [{ role: "user", content: "after revoke" }];
  eq(handleContextEvent({ sessionID: "ses-idem", messages: tombstoned }), 0, "a tombstoned digest is skipped");
  eq(countBody(tombstoned, second.text), 0, "the tombstoned digest never returns");

  warmInjection({ sessionID: "ses-idem", digest: first.digest, message: first.message, alreadyPresent: false });
  eq(injectionCacheSize(), 1, "another live digest can replace a tombstoned one");
  const recovered: Array<Record<string, unknown>> = [{ role: "user", content: "recovered" }];
  eq(handleContextEvent({ sessionID: "ses-idem", messages: recovered }), 1, "the other live digest is injected");
  eq(countBody(recovered, first.text), 1, "the other live digest appears once");
  eq(countBody(recovered, second.text), 0, "the tombstoned digest stays out");

  console.log("PROOF PASS: one active digest per session, one append per request, and compaction never re-injects");
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
