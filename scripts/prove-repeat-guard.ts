import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPEAT_RESULT_BLOCK_AT,
  REPEAT_RESULT_WARN_AT,
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
assert(recordToolResult("dev", "read", args, sig) === 1, "the first result starts the run");
assert(recordToolResult("dev", "read", args, sig) === 2, "an identical repeat advances the run");
assert(recordToolResult("dev", "read", args, sig) === 3, "the run keeps counting");
assert(repeatResultCount("dev", "read", args) === 3, "the run is readable before the block");
assert(
  isRepeatResultBlocked("dev", "read", args) === null,
  "the warn threshold alone does not block",
);
assert(recordToolResult("dev", "read", args, sig) === REPEAT_RESULT_BLOCK_AT, "the block threshold is reached");
const blocked = isRepeatResultBlocked("dev", "read", args);
assert(blocked !== null, "the read tool is blocked at the threshold");
assert(blocked?.includes("identical result"), "the block names the reason");
assert(isToolLoopBlocked("dev", "read", args) !== null, "the before hook refuses the same call");
assert(isToolLoopBlocked("dev", "read", "different-args") === null, "a different call is not refused");
assert(isToolLoopBlocked("dev", "bash", args) === null, "a non read tool is never repeat-blocked");

assert(recordToolResult("dev", "read", "different-args", sig) === 1, "a new input resets the run");
assert(recordToolResult("dev", "read", args, "other-output") === 1, "a new result resets the run");
assert(repeatResultCount("dev", "read", "different-args") === 0, "a replaced run reports zero for the old input");
assert(repeatResultCount("dev", "read", args) === 1, "the new run starts at one");

resetToolLoopState();
assert(isRepeatResultBlocked("dev", "read", args) === null, "a reset clears every run");

recordToolFailure("solo", "read");
recordToolFailure("solo", "read");
recordToolFailure("solo", "read");
const failureBlock = isToolLoopBlocked("solo", "read");
assert(failureBlock !== null, "the existing failure block still fires");
assert(failureBlock?.includes("failed 3 consecutive times"), "the failure block keeps its wording");

resetToolLoopState();
const readonly = ["read", "grep", "glob"];
for (const tool of readonly) {
  for (let i = 0; i < REPEAT_RESULT_BLOCK_AT; i += 1) recordToolResult("loop", tool, "sig", "out");
  assert(isRepeatResultBlocked("loop", tool, "sig") !== null, `${tool} blocks on an identical run`);
}
resetToolLoopState();
for (let i = 0; i < REPEAT_RESULT_BLOCK_AT; i += 1) recordToolResult("loop", "bash", "sig", "out");
assert(isRepeatResultBlocked("loop", "bash", "sig") === null, "bash never blocks on repeated output");
for (const tool of ["edit", "write", "task", "task_status"]) {
  for (let i = 0; i < REPEAT_RESULT_BLOCK_AT; i += 1) recordToolResult("loop", tool, "sig", "out");
  assert(isRepeatResultBlocked("loop", tool, "sig") === null, `${tool} stays out of the hard block`);
}

resetToolLoopState();
for (let i = 0; i < REPEAT_RESULT_WARN_AT; i += 1) recordToolResult("warn", "grep", "sig", "out");
assert(
  isRepeatResultBlocked("warn", "grep", "sig") === null,
  "the warn threshold is below the block threshold",
);
assert(REPEAT_RESULT_WARN_AT < REPEAT_RESULT_BLOCK_AT, "the warn threshold precedes the block threshold");
assert(
  repeatResultCount("other-agent", "grep", "sig") === 0,
  "the run is scoped to one agent",
);

resetToolLoopState();
for (let i = 0; i < 1_000; i += 1) recordToolResult("many", `tool-${i % 50}`, `sig-${i}`, `out-${i}`);
assert(repeatResultCount("many", "tool-0", "sig-950") > 0, "a long run keeps the newest entries");

resetToolLoopState();
recordToolResult("fail", "read", "sig", "out");
recordToolResult("fail", "read", "sig", "out");
resetToolResultRun("fail", "read");
assert(repeatResultCount("fail", "read", "sig") === 0, "a failed call clears the run");

const toolExecute = readFileSync(join(repo, "src", "hooks", "tool-execute.ts"), "utf-8");
assert(toolExecute.includes("recordToolResult("), "the after hook records the result run");
assert(toolExecute.includes("resultSignature(output.output)"), "the after hook signs the real output");
assert(toolExecute.includes("repeatResultWarning("), "the after hook appends the warning");
assert(
  toolExecute.includes("isToolLoopBlocked(\n          normalizedAgent,\n          input.tool,\n          canonicalStringify(output.args ?? {}),"),
  "the before hook passes the call signature",
);

const guard = readFileSync(join(repo, "src", "hooks", "guards", "tool-loop-guard.ts"), "utf-8");
assert(guard.includes("REPEAT_BLOCK_TOOLS"), "the guard declares the read-only block list");
assert(guard.includes("MAX_REPEAT_ENTRIES"), "the guard bounds its repeat table");

console.log("PROOF PASS: an identical tool result warns then blocks the read-only loop");
