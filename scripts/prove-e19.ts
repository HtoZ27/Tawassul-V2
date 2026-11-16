import { createToolExecuteAfterHook } from "../src/hooks/tool-execute.ts";
import { PipelineState } from "../src/hooks/PipelineState.ts";
import type { ToolExecuteAfterContext } from "../src/hooks/tool-execute-types.ts";
import { PrivacyGuard } from "../src/services/privacy-guard.ts";

const CAP = 50_000;
const HEAD = "BEGIN-HEAD-MARKER";
const TAIL = "END-TAIL-MARKER";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

function filler(size: number): string {
  const lines: string[] = [];
  let used = 0;
  let index = 0;
  while (used < size) {
    const line = `line ${String(index).padStart(5, "0")}: lorem ipsum dolor sit amet consectetur adipiscing elit\n`;
    lines.push(line);
    used += line.length;
    index++;
  }
  return lines.join("");
}

function makeCtx(privacyGuard?: PrivacyGuard): ToolExecuteAfterContext {
  const ctx: Record<string, unknown> = {
    sessionId: "sess-e19",
    pipelineState: new PipelineState(),
    chainActive: false,
    chainStepsRemaining: 0,
  };
  if (privacyGuard) ctx.privacyGuard = privacyGuard;
  return ctx as unknown as ToolExecuteAfterContext;
}

async function run(ctx: ToolExecuteAfterContext, text: string): Promise<string> {
  const hook = createToolExecuteAfterHook(ctx);
  const output = { title: "bash", output: text, metadata: {} as Record<string, unknown> };
  await hook({ tool: "bash", sessionID: "sess-e19", args: {} }, output);
  return output.output;
}

async function main(): Promise<void> {
  const full = `${HEAD}\n${filler(120_000)}\n${TAIL}`;
  assert(full.length > 120_000, "the fixture is larger than the cap");

  const delivered = await run(makeCtx(), full);
  assert(delivered.length < full.length, "an oversized output is shortened");
  assert(delivered.includes("chars truncated"), "the delivered output carries a truncation marker");
  assert(delivered.includes(HEAD), "the head of the output is kept");
  assert(delivered.includes(TAIL), "the tail of the output is kept");
  const removed = full.length - Math.floor(CAP * 0.6) - Math.floor(CAP * 0.4);
  assert(delivered.includes(`[${removed} chars truncated]`), "the marker reports the exact character count");
  assert(delivered.length <= CAP + 200, "the delivered output stays near the configured cap");

  const secret = `sk-${"A".repeat(30)}`;
  const privateText = `${HEAD}\n${secret}\n${filler(120_000)}\n${TAIL}`;
  const redacted = await run(makeCtx(new PrivacyGuard()), privateText);
  assert(!redacted.includes(secret), "a secret outside the scan slice is still redacted");
  assert(redacted.includes("[REDACTED:"), "the delivered output carries the redaction marker");
  assert(redacted.includes(TAIL), "the tail survives after redaction");
  assert(redacted.includes("chars truncated"), "a redacted oversized output is still marked as truncated");
}

try {
  await main();
  console.log(`PROOF PASS: oversized tool output keeps its head and tail under a marker (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
