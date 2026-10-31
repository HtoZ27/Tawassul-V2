import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPEAT_RESULT_BLOCK_AT,
  REPEAT_RESULT_WARN_AT,
  REPEAT_RESULT_WINDOW,
  isRepeatResultBlocked,
  isToolLoopBlocked,
  recordToolFailure,
  recordToolResult,
  repeatResultCount,
  resetToolLoopState,
  resetToolResultRun,
  resultSignature,
} from "../src/hooks/guards/tool-loop-guard.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
  console.log(`ok ${message}`);
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

resetToolLoopState();

const one = resultSignature("alpha\nbeta");
assert(one === resultSignature("alpha\nbeta"), "the same output keeps the same signature");
assert(one !== resultSignature("alpha\ngamma"), "a changed output changes the signature");
const long = "x".repeat(20_000);
const longSignature = resultSignature(long);
assert(longSignature.length < 5_000, "a long output is truncated for the signature");
assert(longSignature.startsWith("20000:"), "the signature keeps the output length");
assert(
  resultSignature(`${"x".repeat(20_000)}tail`) !== longSignature,
  "a changed tail changes the long signature",
);
assert(resultSignature(undefined) === "", "a missing output has no signature");

const sig = "read-core";
const args = "{\"file\":\"src/a.ts\"}";
const S = "session-one";
assert(recordToolResult(S, "dev", "read", args, sig) === 1, "the first result starts the run");
assert(recordToolResult(S, "dev", "read", args, sig) === 2, "an identical repeat advances the run");
assert(recordToolResult(S, "dev", "read", args, sig) === 3, "the run keeps counting");
assert(repeatResultCount(S, "dev", "read", args) === 3, "the run is readable before the block");
assert(
  isRepeatResultBlocked(S, "dev", "read", args) === null,
  "the warn threshold alone does not block",
);
assert(
  recordToolResult(S, "dev", "read", args, sig) === REPEAT_RESULT_BLOCK_AT,
  "the block threshold is reached",
);
const blocked = isRepeatResultBlocked(S, "dev", "read", args);
assert(blocked !== null, "the read tool is blocked at the threshold");
assert(blocked?.includes("identical result"), "the block names the reason");
assert(isToolLoopBlocked(S, "dev", "read", args) !== null, "the before hook refuses the same call");
assert(isToolLoopBlocked(S, "dev", "read", "different-args") === null, "a different call is not refused");
assert(isToolLoopBlocked(S, "dev", "bash", args) === null, "a non read tool is never repeat-blocked");

assert(recordToolResult(S, "dev", "read", "different-args", sig) === 1, "a new input starts its own run");
assert(
  repeatResultCount(S, "dev", "read", args) === REPEAT_RESULT_BLOCK_AT,
  "a new input does not erase the earlier run",
);
assert(recordToolResult(S, "dev", "read", args, "other-output") === 1, "a new result starts a new run");
assert(repeatResultCount(S, "dev", "read", args) === 1, "the changed result resets the count for that input");

assert(recordToolResult("session-two", "dev", "read", args, sig) === 1, "another session starts clean");
assert(
  isRepeatResultBlocked("session-two", "dev", "read", args) === null,
  "one session cannot be blocked by another session's repeats",
);
assert(
  repeatResultCount("session-two", "dev", "read", args) === 1,
  "the repeat table is scoped by session",
);

resetToolLoopState();
assert(isRepeatResultBlocked(S, "dev", "read", args) === null, "a reset clears every run");

recordToolFailure("solo", "read");
recordToolFailure("solo", "read");
recordToolFailure("solo", "read");
const failureBlock = isToolLoopBlocked(S, "solo", "read");
assert(failureBlock !== null, "the existing failure block still fires");
assert(failureBlock?.includes("failed 3 consecutive times"), "the failure block keeps its wording");

resetToolLoopState();
const readonly = ["read", "grep", "glob"];
for (const tool of readonly) {
  for (let i = 0; i < REPEAT_RESULT_BLOCK_AT; i += 1) recordToolResult(S, "loop", tool, "sig", "out");
  assert(isRepeatResultBlocked(S, "loop", tool, "sig") !== null, `${tool} blocks on an identical run`);
}
resetToolLoopState();
for (let i = 0; i < REPEAT_RESULT_BLOCK_AT; i += 1) recordToolResult(S, "loop", "bash", "sig", "out");
assert(isRepeatResultBlocked(S, "loop", "bash", "sig") === null, "bash never blocks on repeated output");
for (const tool of ["edit", "write", "task", "task_status"]) {
  for (let i = 0; i < REPEAT_RESULT_BLOCK_AT; i += 1) recordToolResult(S, "loop", tool, "sig", "out");
  assert(isRepeatResultBlocked(S, "loop", tool, "sig") === null, `${tool} stays out of the hard block`);
}

resetToolLoopState();
for (let i = 0; i < REPEAT_RESULT_WARN_AT; i += 1) recordToolResult(S, "warn", "grep", "sig", "out");
assert(
  isRepeatResultBlocked(S, "warn", "grep", "sig") === null,
  "the warn threshold is below the block threshold",
);
assert(REPEAT_RESULT_WARN_AT < REPEAT_RESULT_BLOCK_AT, "the warn threshold precedes the block threshold");
assert(
  repeatResultCount(S, "other-agent", "grep", "sig") === 0,
  "the run is scoped to one agent",
);

resetToolLoopState();
for (let i = 0; i < REPEAT_RESULT_WINDOW; i += 1) {
  recordToolResult(S, "loop", "read", i % 2 === 0 ? "args-a" : "args-b", i % 2 === 0 ? "out-a" : "out-b");
  recordToolResult(S, "loop", "read", i % 2 === 0 ? "args-b" : "args-a", i % 2 === 0 ? "out-b" : "out-a");
}
assert(
  isRepeatResultBlocked(S, "loop", "read", "args-a") !== null,
  "an A/B oscillation still reaches the block threshold",
);
assert(
  isRepeatResultBlocked(S, "loop", "read", "args-b") !== null,
  "both alternating inputs are blocked",
);

resetToolLoopState();
for (let i = 0; i < REPEAT_RESULT_BLOCK_AT; i += 1) recordToolResult(S, "loop", "read", "stale", "out");
assert(isRepeatResultBlocked(S, "loop", "read", "stale") !== null, "a filled window blocks the stale input");
for (let i = 0; i < REPEAT_RESULT_WINDOW; i += 1) {
  recordToolResult(S, "loop", "read", `fresh-${i}`, `out-${i}`);
}
assert(
  repeatResultCount(S, "loop", "read", "stale") === 0,
  "the signature window forgets results that fall out of it",
);
assert(isRepeatResultBlocked(S, "loop", "read", "stale") === null, "the old input is allowed after eviction");

resetToolLoopState();
for (let i = 0; i < 1_000; i += 1) recordToolResult(S, "many", `tool-${i % 50}`, `sig-${i}`, `out-${i}`);
assert(repeatResultCount(S, "many", "tool-0", "sig-950") > 0, "a long run keeps the newest entries");

resetToolLoopState();
recordToolResult(S, "fail", "read", "sig", "out");
recordToolResult(S, "fail", "read", "sig", "out");
resetToolResultRun(S, "fail", "read");
assert(repeatResultCount(S, "fail", "read", "sig") === 0, "a failed call clears the run");

const toolExecute = readFileSync(join(repo, "src", "hooks", "tool-execute.ts"), "utf-8");
assert(toolExecute.includes("recordToolResult("), "the after hook records the result run");
assert(toolExecute.includes("resultSignature(output.output)"), "the after hook signs the real output");
assert(toolExecute.includes("repeatResultWarning("), "the after hook appends the warning");
assert(
  toolExecute.includes("isToolLoopBlocked(\n          input.sessionID,\n          normalizedAgent,"),
  "the before hook passes the session and the call signature",
);
assert(
  toolExecute.includes("recordToolResult(\n            input.sessionID,"),
  "the after hook scopes the run by session",
);

const guard = readFileSync(join(repo, "src", "hooks", "guards", "tool-loop-guard.ts"), "utf-8");
assert(guard.includes("REPEAT_BLOCK_TOOLS"), "the guard declares the read-only block list");
assert(guard.includes("MAX_REPEAT_ENTRIES"), "the guard bounds its repeat table");
assert(guard.includes("REPEAT_RESULT_WINDOW"), "the guard declares a bounded signature window");

console.log("PROOF PASS: an identical tool result warns then blocks the read-only loop");
