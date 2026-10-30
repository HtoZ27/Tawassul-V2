import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMessageUpdatedHook } from "../src/hooks/message-updated.ts";
import type { MessageUpdatedContext } from "../src/hooks/message-updated-types.ts";
import type { HandoffEntry } from "../src/context/types.ts";
import {
  clearInjectionCache,
  clearSessionInjection,
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

const work = mkdtempSync(join(tmpdir(), "tawassul-context-inject-"));
const keyDir = join(work, "keys");
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
process.env.XDG_DATA_HOME = join(work, "data");
delete process.env.TAWASSUL_ISOLATED;
delete process.env.TAWASSUL_CONTEXT_HANDOFF;
const worktree = join(work, "workspace");
mkdirSync(worktree, { recursive: true });

const TEXT = "PACK-BODY-0123456789";

function message(): { role: "user"; content: Array<{ type: "text"; text: string }> } {
  return { role: "user", content: [{ type: "text", text: TEXT }] };
}

function handoff(id: string, digest: string, checkpoint: HandoffEntry["checkpoint"]): HandoffEntry {
  return {
    id,
    from: "analyst",
    to: "dev",
    task: "Continue the portable context work",
    context: "The pack carries the full continuation",
    files: [],
    timestamp: new Date().toISOString(),
    status: "pending",
    checkpoint,
    contextPackDigest: digest,
    contextPackId: `pck_${id}`,
    contextPackActivatedAt: new Date().toISOString(),
  };
}

async function checkpointCase(handoffs: Map<string, HandoffEntry>, sessionID: string, digest: string, id: string): Promise<string[]> {
  const ctx = {
    directory: worktree,
    handoffs,
    records: [],
    seenAgents: new Map<string, Set<string>>(),
    onboardedAgents: new Set<string>(),
    agentModelMap: {} as Record<string, string>,
    config: {},
    saveState: async () => undefined,
    recordHandoffAccepted: () => undefined,
    updateLastActive: () => undefined,
  } as unknown as MessageUpdatedContext;
  const hook = createMessageUpdatedHook(ctx);
  const output: { message: { role: string; text?: string }; parts: Array<{ type: string; text?: string }> } = {
    message: { role: "assistant" },
    parts: [{ type: "text", text: "work complete" }],
  };
  await hook({ sessionID, agent: "dev", messageID: "msg_proof" }, output);
  void digest;
  void id;
  return output.parts.map((part) => part.text ?? "");
}

async function main(): Promise<void> {
  clearInjectionCache();
  assert(injectionCacheSize() === 0, "the injection cache starts empty");

  warmInjection({ sessionID: "ses-one", digest: "d-one", message: message(), alreadyPresent: false });
  assert(isInjectionWarm("ses-one", "d-one"), "warming registers the digest");
  assert(cachedDigests("ses-one").includes("d-one"), "the session lists its warmed digest");
  eq(injectionCacheSize(), 1, "one cache entry exists");

  const request: Array<Record<string, unknown>> = [{ role: "user", content: "hello" }];
  eq(handleContextEvent({ sessionID: "ses-one", messages: request }), 1, "the pack is appended once");
  eq(request.length, 2, "exactly one message is appended");
  const appended = request[1] as { role?: string; content?: Array<{ type?: string; text?: string }> };
  eq(appended.role, "user", "the pack arrives as a user message");
  eq(appended.content?.[0]?.type, "text", "the pack arrives as a text part");
  eq(appended.content?.[0]?.text, TEXT, "the pack body is intact");
  assert(!("synthetic" in appended), "the pack is a normal message, not synthetic");

  eq(handleContextEvent({ sessionID: "ses-one", messages: request }), 0, "the same request never receives the pack twice");

  const nextRequest: Array<Record<string, unknown>> = [{ role: "user", content: "next" }];
  eq(handleContextEvent({ sessionID: "ses-one", messages: nextRequest }), 1, "each host request is re-applied exactly once");
  eq(nextRequest.length, 2, "the next request carries the pack once");

  warmInjection({ sessionID: "ses-present", digest: "d-present", message: message(), alreadyPresent: true });
  eq(handleContextEvent({ sessionID: "ses-present", messages: [{ role: "user" }] }), 0, "alreadyPresent blocks a duplicate");

  warmInjection({ sessionID: "ses-tomb", digest: "d-tomb", message: message(), alreadyPresent: false });
  revokeInjection("ses-tomb", "d-tomb");
  eq(handleContextEvent({ sessionID: "ses-tomb", messages: [{ role: "user" }] }), 0, "a tombstoned digest is never injected");

  warmInjection({ sessionID: "ses-tool", digest: "d-tool", message: message(), alreadyPresent: false });
  eq(
    handleContextEvent({ sessionID: "ses-tool", messages: [{ role: "user" }, { role: "tool" }] }),
    0,
    "the hook never appends after a tool result",
  );
  eq(
    handleContextEvent({
      sessionID: "ses-tool",
      messages: [{ role: "user" }, { role: "assistant", content: [{ type: "tool-result", output: "x" }] }],
    }),
    0,
    "a tool-result part also defers the injection",
  );

  assert(handleContextEvent({ sessionID: "unknown", messages: [{ role: "user" }] }) === 0, "unknown sessions are ignored");
  assert(handleContextEvent({ sessionID: "ses-one", messages: [] }) === 0, "empty histories are ignored");
  assert(handleContextEvent({ messages: [{ role: "user" }] }) === 0, "missing session ids are ignored");

  warmInjection({ sessionID: "ses-many", digest: "d-a", message: message(), alreadyPresent: false });
  warmInjection({ sessionID: "ses-many", digest: "d-b", message: message(), alreadyPresent: false });
  const many: Array<Record<string, unknown>> = [{ role: "user" }];
  eq(handleContextEvent({ sessionID: "ses-many", messages: many }), 2, "each warmed digest is appended once");
  eq(many.length, 3, "two digests produce two messages");

  assert(messagesContainDigest([{ content: TEXT }], "0123456789"), "digest detection finds a pack in history");
  assert(!messagesContainDigest([{ content: "nothing" }], "0123456789"), "digest detection ignores unrelated history");

  clearSessionInjection("ses-many");
  assert(!isInjectionWarm("ses-many", "d-a"), "clearing a session forgets its digests");

  const pack = await createPack({
    worktree,
    sessionID: "ses-checkpoint",
    agent: "analyst",
    handoffId: "H-001",
    source: { task: "checkpoint task", context: "checkpoint context" },
  });
  const checkpoint = {
    completed: ["did the first part"],
    remaining: ["do the second part"],
    filesChanged: ["src/one.ts"],
    decisions: [{ title: "choice", detail: "detail" }],
  };
  const activeHandoffs = new Map<string, HandoffEntry>();
  activeHandoffs.set("H-001", handoff("H-001", pack.digest, checkpoint));
  const activeParts = await checkpointCase(activeHandoffs, "ses-checkpoint", pack.digest, "H-001");
  const joinedActive = activeParts.join("\n");
  assert(!joinedActive.includes("Continuation — Handoff"), "an active pack suppresses the checkpoint continuation");
  assert(activeHandoffs.get("H-001")?.status === "accepted", "the handoff is accepted");
  assert(isInjectionWarm("ses-checkpoint", pack.digest), "acceptance warms the pack");

  const missingHandoffs = new Map<string, HandoffEntry>();
  missingHandoffs.set("H-002", handoff("H-002", "0".repeat(64), checkpoint));
  const missingParts = await checkpointCase(missingHandoffs, "ses-missing", "0".repeat(64), "H-002");
  const joinedMissing = missingParts.join("\n");
  assert(joinedMissing.includes("is unavailable"), "a missing pack reports an explicit fallback notice");
  assert(joinedMissing.includes("Continuation — Handoff H-002"), "the checkpoint stays as the fallback");
  assert(joinedMissing.includes("did the first part"), "the fallback checkpoint keeps its completed items");

  console.log("PROOF PASS: injection is one user message per digest per request, tombstoned, and never doubles the checkpoint");
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
