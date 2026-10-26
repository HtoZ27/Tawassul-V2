import { createToolExecuteAfterHook } from "../src/hooks/tool-execute.ts";
import { PipelineState } from "../src/hooks/PipelineState.ts";
import type { ToolExecuteAfterContext } from "../src/hooks/tool-execute-types.ts";
import { isToolLoopBlocked } from "../src/hooks/guards/tool-loop-guard.ts";
import { normalizeName } from "../src/utils/name-utils.ts";
import type { ToolRunRecordInput } from "../src/services/tool-run-log.ts";

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

type Captured = { status: string; error?: string };

function makeCtx(captured: Captured[]): ToolExecuteAfterContext {
  const ctx: Record<string, unknown> = {
    sessionId: "sess-e14",
    pipelineState: new PipelineState(),
    chainActive: false,
    chainStepsRemaining: 0,
    toolRunLog: {
      record: (input: ToolRunRecordInput) => {
        captured.push({ status: input.status, error: input.error });
        return input;
      },
    },
  };
  return ctx as unknown as ToolExecuteAfterContext;
}

async function run(
  ctx: ToolExecuteAfterContext,
  tool: string,
  agent: string,
  output: { title: string; output: string; metadata: Record<string, unknown> },
): Promise<void> {
  const hook = createToolExecuteAfterHook(ctx);
  await hook({ tool, agent, sessionID: "sess-e14", args: {} }, output);
}

async function main(): Promise<void> {
  const errored: Captured[] = [];
  const errorCtx = makeCtx(errored);
  const errorText = "Error: ENOENT: no such file or directory, open '/tmp/missing'";
  await run(errorCtx, "read", "@dev", {
    title: "",
    output: errorText,
    metadata: { status: "error", error: errorText },
  });
  assert(errored.length === 1, "a v2 error result reaches the tool run log");
  assert(errored[0]!.status === "error", "a v2 error result is recorded as an error despite non-empty output");

  for (let i = 0; i < 2; i++) {
    await run(errorCtx, "read", "@dev", {
      title: "",
      output: `${errorText} (attempt ${i + 2})`,
      metadata: { status: "error", error: errorText },
    });
  }
  assert(
    errored.filter((e) => e.status === "error").length === 3,
    "every repeated v2 error is recorded as an error",
  );
  assert(
    isToolLoopBlocked(normalizeName("@dev"), "read") !== null,
    "three consecutive v2 errors trip the tool-loop guard",
  );

  const recovered: Captured[] = [];
  const recoveredCtx = makeCtx(recovered);
  await run(recoveredCtx, "read", "@dev", {
    title: "",
    output: "",
    metadata: { status: "completed" },
  });
  assert(recovered.length === 1 && recovered[0]!.status === "success", "a completed result with empty text is a success");
  assert(
    isToolLoopBlocked(normalizeName("@dev"), "read") === null,
    "a recorded success clears the tool-loop failure count",
  );

  const legacyOk: Captured[] = [];
  await run(makeCtx(legacyOk), "grep", "@tester", {
    title: "",
    output: "two matches",
    metadata: {},
  });
  assert(legacyOk[0]!.status === "success", "an untagged non-empty result keeps the string fallback as success");

  const legacyBad: Captured[] = [];
  await run(makeCtx(legacyBad), "grep", "@tester", {
    title: "",
    output: "",
    metadata: {},
  });
  assert(legacyBad[0]!.status === "error", "an untagged empty result keeps the string fallback as a failure");

  const titleOnly: Captured[] = [];
  await run(makeCtx(titleOnly), "write", "@tester", {
    title: "Wrote 3 files",
    output: "",
    metadata: { status: "error" },
  });
  assert(
    titleOnly[0]!.status === "error",
    "a tagged error stays an error even when the result carries a title",
  );

  const bodyOnly: Captured[] = [];
  await run(makeCtx(bodyOnly), "write", "@tester", {
    title: "",
    output: "",
    metadata: { status: "completed" },
  });
  assert(bodyOnly[0]!.status === "success", "a tagged completion stays a success with no text at all");

  const staleStatus: Captured[] = [];
  await run(makeCtx(staleStatus), "bash", "@tester", {
    title: "",
    output: "",
    metadata: { status: "failed" },
  });
  assert(
    staleStatus[0]!.status === "error",
    "an unrecognised status falls back to the string heuristic instead of guessing success",
  );
}

try {
  await main();
  console.log(`PROOF PASS: the v2 execute status decides success, not the presence of output (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
