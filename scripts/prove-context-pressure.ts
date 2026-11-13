import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { injectContextEngine } from "../src/hooks/message-updated.ts";
import type { MessageUpdatedContext } from "../src/hooks/message-updated-types.ts";
import {
  ContextNudgeManager,
  DEFERRED_TOOL_OUTPUT_CHARS,
  NUDGE_RESET_BELOW,
  NUDGE_THRESHOLDS,
} from "../src/services/context-nudges.ts";
import {
  buildContextSnapshotRecord,
  contextSnapshotDetail,
  contextSnapshotTitle,
  readHostTokenUsage,
  usageFromHost,
  type ContextSnapshot,
} from "../src/services/context-pressure.ts";
import { truncateToolOutput } from "../src/services/context-compressor.ts";
import { capDispatchOutput, DISPATCH_OUTPUT_CHARS } from "../src/services/dispatch-output.ts";

let passed = 0;

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
  passed++;
  console.log(`ok ${message}`);
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (${String(actual)} === ${String(expected)})`);
}

function source(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
}

const host = readHostTokenUsage({
  tokens: { input: 1_000, output: 200, reasoning: 50, cache: { read: 400, write: 30 } },
});
assert(host !== null, "an assistant message with tokens is read");
equal(host?.input, 1_000, "the input count is read");
equal(host?.output, 200, "the output count is read");
equal(host?.reasoning, 50, "the reasoning count is read");
equal(host?.cacheRead, 400, "the cache read count is read");
equal(host?.cacheWrite, 30, "the cache write count is read");
equal(host?.total, 1_680, "the measured total sums every field");
equal(host?.contextTokens, 1_680, "the context tokens never fall below the total");

const contextSized = readHostTokenUsage({ input: 10, output: 5, cache_read: 2, cache_write: 1, contextSize: 100 });
equal(contextSized?.cacheRead, 2, "the snake_case cache read alias is accepted");
equal(contextSized?.cacheWrite, 1, "the snake_case cache write alias is accepted");
equal(contextSized?.contextTokens, 100, "an explicit context size wins over the measured total");

assert(readHostTokenUsage(null) === null, "a null message has no host usage");
assert(readHostTokenUsage("text") === null, "a non-object message has no host usage");
assert(readHostTokenUsage({ role: "assistant" }) === null, "a message without token fields has no host usage");
const clamped = readHostTokenUsage({ tokens: { input: -5, output: 10, reasoning: 0, cache: { read: 0, write: 0 } } });
equal(clamped?.input, 0, "a negative host count clamps to zero");
equal(clamped?.output, 10, "a valid host count survives next to a negative one");

const halfUsage = usageFromHost({ tokens: { input: 50_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, 100_000);
assert(halfUsage !== null, "host usage converts to a context usage");
assert(Math.abs((halfUsage?.percentage ?? 0) - 0.5) < 1e-9, "host usage keeps the exact percentage");
equal(usageFromHost({ tokens: { input: 100 } }, 0)?.percentage, 0, "a zero window never divides by zero");
assert(usageFromHost({ role: "user" }, 100_000) === null, "a message without tokens falls back to the estimate");

const actions = NUDGE_THRESHOLDS.map((entry) => entry.action);
equal(actions.join(","), "defer,summarize,save", "the three nudges carry defer, summarize, and save");
assert(!actions.includes("compact"), "no nudge action forces compaction");
assert(NUDGE_RESET_BELOW === 0.65, "the hysteresis reset sits at 65%");
assert(DEFERRED_TOOL_OUTPUT_CHARS === 12_000, "the deferral cap is 12000 chars");

const manager = new ContextNudgeManager();
const usage = (percentage: number) => ({
  usedTokens: Math.round(percentage * 100_000),
  maxTokens: 100_000,
  percentage,
  breakdown: { systemPrompt: 0, conversationHistory: 0, toolOutputs: 0, agentMemory: 0 },
});
assert(manager.evaluate(usage(0.5), "ses-a") === null, "below the reset there is no nudge");
assert(!manager.isDeferralActive("ses-a"), "below the reset deferral stays off");
const defer = manager.evaluate(usage(0.7), "ses-a");
equal(defer?.action, "defer", "the 70% tier defers large tool output");
assert(defer?.message.includes("deferred") === true, "the defer nudge names the deferral");
equal(manager.deferredOutputCap("ses-a"), 12_000, "the deferred session caps tool output");
for (let index = 0; index < 40; index += 1) manager.evaluate(usage(0.72 + index * 0.002), "ses-a");
equal(manager.metrics.totalNudgesFired, 1, "an echo loop at the same tier fires no second nudge");
equal(manager.evaluate(usage(0.86), "ses-a")?.action, "summarize", "the 85% tier asks for a summary");
equal(manager.evaluate(usage(0.96), "ses-a")?.action, "save", "the 95% tier asks for a durable save");
assert(manager.evaluate(usage(0.99), "ses-a") === null, "the top tier still fires only once");
assert(manager.evaluate(usage(0.5), "ses-a") === null, "dropping under the reset clears the fired tiers");
assert(!manager.isDeferralActive("ses-a"), "dropping under the reset clears the deferral");
equal(manager.evaluate(usage(0.71), "ses-a")?.action, "defer", "a new crossing fires the deferral again");

assert(!manager.isDeferralActive("ses-b"), "an unseen session has no deferral");
assert(manager.deferredOutputCap("ses-b") === undefined, "an unseen session has no cap");
equal(manager.evaluate(usage(0.7), "ses-b")?.action, "defer", "a second session nudges independently");
equal(manager.deferredOutputCap("ses-b"), 12_000, "the second session gets its own cap");
assert(manager.evaluate(usage(0.5), "ses-b") === null, "the second session resets below the threshold");
assert(!manager.isDeferralActive("ses-b"), "the second session falls back to the default cap");
equal(manager.deferredOutputCap("ses-a"), 12_000, "resetting one session never resets another");
assert(manager.deferredOutputCap("ses-c") === undefined, "a third session never inherits a cap");
assert(typeof (manager as unknown as Record<string, unknown>).compact === "undefined", "the manager exposes no compaction call");

process.env.TAWASSUL_MAX_CONTEXT_TOKENS = "100000";
const snapshots: ContextSnapshot[] = [];
const engineManager = new ContextNudgeManager();
const engineCtx = {
  config: {},
  agentModelMap: {} as Record<string, string>,
  contextNudgeManager: engineManager,
  recordContextSnapshot: (snapshot: ContextSnapshot) => snapshots.push(snapshot),
} as unknown as MessageUpdatedContext;

const hostMessage = (input: number) => ({
  role: "assistant",
  tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
});
const assistantOutput = (input: number) => ({
  message: hostMessage(input),
  parts: [] as { type: string; text?: string }[],
});

injectContextEngine(engineCtx, { sessionID: "ses-host" }, assistantOutput(86_000), "assistant");
equal(snapshots.length, 1, "an assistant message over 85% records one snapshot");
equal(snapshots[0]?.action, "summarize", "the assistant snapshot carries the summarize action");
equal(snapshots[0]?.source, "host", "the snapshot prefers the host token fields");
equal(snapshots[0]?.sessionID, "ses-host", "the snapshot keeps the session id");
assert(Math.abs((snapshots[0]?.percentage ?? 0) - 0.86) < 1e-9, "the snapshot keeps the host percentage");

injectContextEngine(engineCtx, { sessionID: "ses-host" }, assistantOutput(86_000), "assistant");
equal(snapshots.length, 1, "a repeated host reading records no second snapshot");

const estimateCtx = {
  ...engineCtx,
  serviceClients: { estimateTokens: () => 80_000 },
} as unknown as MessageUpdatedContext;
injectContextEngine(
  estimateCtx,
  { sessionID: "ses-user" },
  { message: { role: "user", text: "continue" }, parts: [{ type: "text", text: "continue" }] },
  "user",
);
equal(snapshots.length, 1, "a defer nudge records no snapshot");
assert(engineManager.isDeferralActive("ses-user"), "the estimated user role still arms the deferral");
equal(engineManager.deferredOutputCap("ses-user"), 12_000, "the user role reaches the deferral cap");

injectContextEngine(engineCtx, { sessionID: "ses-save" }, assistantOutput(97_000), "assistant");
equal(snapshots.length, 2, "a host reading over 95% records a save snapshot");
equal(snapshots[1]?.action, "save", "the save snapshot carries the save action");
equal(Math.round((snapshots[1]?.percentage ?? 0) * 100), 97, "the save snapshot keeps the percentage");

equal(engineManager.getHistory().length, 3, "the engine fires one nudge per tier per session");
assert(!source("src/hooks/message-updated.ts").includes("session.compact"), "the hook never calls the host compaction");
assert(!source("src/services/context-nudges.ts").includes("session.compact"), "the nudge manager never calls the host compaction");
assert(
  source("src/hooks/message-updated.ts").includes("ctx.recordContextSnapshot?.("),
  "the hook routes summarize and save into the durable snapshot",
);
assert(
  source("src/hooks/tool-execute.ts").includes("deferredOutputCap(input.sessionID)"),
  "the tool hook applies the per-session deferral cap",
);

const record = buildContextSnapshotRecord(snapshots[0]!, "R-042");
equal(record.id, "R-042", "the snapshot record takes the allocated id");
equal(record.type, "note", "the snapshot record is a note");
equal(record.agent, "@tawa", "the snapshot record is owned by the coordinator");
equal(record.provenance, "tool_observed", "the snapshot record marks its provenance");
assert(!Number.isNaN(Date.parse(record.timestamp)), "the snapshot record carries a valid timestamp");
assert(record.title.includes("summarize") && record.title.includes("86%"), "the snapshot title names the action and percent");
assert(record.title === contextSnapshotTitle(snapshots[0]!), "the snapshot title comes from the shared formatter");
assert(record.detail === contextSnapshotDetail(snapshots[0]!), "the snapshot detail comes from the shared formatter");
assert(record.detail.includes("ses-host"), "the snapshot detail names the session");
assert(record.detail.includes("compaction is not forced"), "the snapshot detail records the no-compaction policy");

const longOutput = "x".repeat(30_000);
const capped = truncateToolOutput(longOutput, DEFERRED_TOOL_OUTPUT_CHARS);
assert(capped.length < longOutput.length, "a deferred tool output is truncated");
assert(capped.includes("chars truncated"), "the deferred tool output marks the removed span");
assert(capped.length <= DEFERRED_TOOL_OUTPUT_CHARS + 200, "the deferred tool output stays near its cap");

const dispatchState = mkdtempSync(join(tmpdir(), "tawassul-dispatch-"));
const previousStateDir = process.env.TAWASSUL_V2_STATE_DIR;
try {
  process.env.TAWASSUL_V2_STATE_DIR = dispatchState;
  const fullDispatch = "d".repeat(DISPATCH_OUTPUT_CHARS + 4_000);
  const dispatchCapped = capDispatchOutput({
    text: fullDispatch,
    sessionID: "ses_dispatch",
    callID: "call_1",
    tool: "task",
    now: 1_760_000_000_000,
  });
  assert(dispatchCapped !== undefined, "a large dispatch result is capped");
  assert(dispatchCapped.text.length <= DISPATCH_OUTPUT_CHARS, "the dispatch summary stays within its cap");
  assert(dispatchCapped.text.includes("saved to"), "the dispatch summary names the durable pointer");
  assert(existsSync(dispatchCapped.path), "the dispatch pointer file exists");
  equal(readFileSync(dispatchCapped.path, "utf8"), fullDispatch, "the dispatch pointer preserves the full result");
  equal(
    capDispatchOutput({ text: "short", sessionID: "ses_dispatch", callID: "call_2", tool: "task" }),
    undefined,
    "a short dispatch result is not capped",
  );

  const blocker = join(dispatchState, "blocker");
  writeFileSync(blocker, "x");
  process.env.TAWASSUL_V2_STATE_DIR = blocker;
  equal(
    capDispatchOutput({ text: fullDispatch, sessionID: "ses_dispatch", callID: "call_3", tool: "task" }),
    undefined,
    "a failed durable write keeps the full result",
  );
} finally {
  if (previousStateDir === undefined) delete process.env.TAWASSUL_V2_STATE_DIR;
  else process.env.TAWASSUL_V2_STATE_DIR = previousStateDir;
  rmSync(dispatchState, { recursive: true, force: true });
}

console.log(`PROOF PASS: context pressure reads host tokens, nudges with hysteresis, defers output, and records snapshots (${passed} assertions)`);
