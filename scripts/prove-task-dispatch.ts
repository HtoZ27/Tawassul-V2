import "./proof-log-isolate.ts";
import { createToolExecuteAfterHook } from "../src/hooks/tool-execute.ts";
import { PipelineState } from "../src/hooks/PipelineState.ts";
import type { ToolExecuteAfterContext } from "../src/hooks/tool-execute-types.ts";
import {
  isToolLoopBlocked,
  recordNoProgress,
  recordToolFailure,
} from "../src/hooks/guards/tool-loop-guard.ts";
import { consume, remaining, resetBudgets, setBudget } from "../src/services/iteration-budget.ts";
import {
  finalizeDispatchFailure,
  finalizeDispatchOnIdle,
  pendingDispatchCount,
  resetDispatchLedger,
} from "../src/services/dispatch-ledger.ts";
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

type Event = { type: string; payload: Record<string, unknown> };

function makeCtx(runLog: Captured[], events: Event[]): ToolExecuteAfterContext {
  const ctx: Record<string, unknown> = {
    sessionId: "sess-dispatch",
    pipelineState: new PipelineState(),
    chainActive: false,
    chainStepsRemaining: 0,
    recordToolCall: () => undefined,
    incrementError: () => undefined,
    toolRunLog: {
      record: (input: ToolRunRecordInput) => {
        runLog.push({ status: input.status, error: input.error });
        return input;
      },
    },
    emitWithChain: (type: string, payload: Record<string, unknown>) => {
      events.push({ type, payload });
    },
  };
  return ctx as unknown as ToolExecuteAfterContext;
}

async function run(
  ctx: ToolExecuteAfterContext,
  tool: string,
  agent: string,
  sessionID: string,
  args: Record<string, unknown>,
  output: { title: string; output: string; metadata: Record<string, unknown> },
): Promise<void> {
  await createToolExecuteAfterHook(ctx)({ tool, agent, sessionID, callID: "call", args }, output);
}

async function main(): Promise<void> {
  resetDispatchLedger();
  const events1: Event[] = [];
  const log1: Captured[] = [];
  await run(makeCtx(log1, events1), "task", "@disp", "ses_parent_1", { agent: "@disp-child" }, {
    title: "",
    output: "dispatched",
    metadata: { sessionID: "ses_child_1", status: "completed" },
  });
  assert(pendingDispatchCount() === 1, "a completed dispatch returns one pending ledger entry");
  assert(
    !events1.some((event) => event.type === "TASK_COMPLETED"),
    "a dispatch emits no completion when the tool returns",
  );
  assert(log1.length === 1 && log1[0]!.status === "success", "a dispatch keeps its tool-level success row");
  assert(log1[0]!.error === undefined, "a dispatch row carries no error field");

  const events2: Event[] = [];
  const log2: Captured[] = [];
  await run(makeCtx(log2, events2), "task", "@fg", "ses_parent_2", { agent: "@fg-child" }, {
    title: "",
    output: "done",
    metadata: { status: "completed" },
  });
  assert(
    events2.filter((event) => event.type === "TASK_COMPLETED").length === 1,
    "a foreground task still emits exactly one completion",
  );

  resetBudgets();
  setBudget("@budget", 5);
  const budgetStart = remaining("@budget", "ses_parent_3");
  assert(consume("@budget", "ses_parent_3"), "the budget accepts the first consume");
  const events3: Event[] = [];
  const log3: Captured[] = [];
  await run(makeCtx(log3, events3), "task", "@budget", "ses_parent_3", { agent: "@budget-child" }, {
    title: "",
    output: "",
    metadata: { sessionID: "ses_child_3" },
  });
  assert(
    remaining("@budget", "ses_parent_3") === budgetStart,
    "an empty dispatch refunds the iteration it charged",
  );
  assert(
    log3[0]!.status === "success" && log3[0]!.error === undefined,
    "an empty dispatch records a success row instead of an error row",
  );

  const noProgressAgent = "@noprog";
  for (let i = 0; i < 4; i++) recordNoProgress(noProgressAgent);
  await run(makeCtx([], []), "task", noProgressAgent, "ses_parent_4", { agent: "@noprog-child" }, {
    title: "",
    output: "",
    metadata: { sessionID: "ses_child_4" },
  });
  assert(
    isToolLoopBlocked("ses_parent_4", noProgressAgent, "task") === null,
    "an empty dispatch adds no no-progress point",
  );

  const loopAgent = "@loop";
  const loopTarget = "@loop-child";
  const bystander = "@bystander";
  for (let i = 0; i < 3; i++) recordToolFailure(loopAgent, "task");
  for (let i = 0; i < 3; i++) recordToolFailure(bystander, "task");
  assert(isToolLoopBlocked("ses_parent_5", loopAgent, "task") !== null, "the seeded failure blocks the task");
  await run(makeCtx([], []), "task", loopAgent, "ses_parent_5", { agent: loopTarget }, {
    title: "",
    output: "dispatched",
    metadata: { sessionID: "ses_child_5", status: "completed" },
  });
  assert(
    isToolLoopBlocked("ses_parent_5", loopAgent, "task") !== null,
    "a dispatch does not clear the loop-guard failure counters",
  );
  finalizeDispatchOnIdle("ses_child_5");
  assert(
    isToolLoopBlocked("ses_parent_5", loopAgent, "task") === null,
    "the terminal signal clears the dispatching agent's failure counters",
  );
  assert(
    isToolLoopBlocked("ses_parent_5", bystander, "task") !== null,
    "the terminal signal leaves the target agent's counters untouched",
  );

  const failedAgent = "@loop-failed";
  const failedTarget = "@loop-failed-child";
  for (let i = 0; i < 3; i++) recordToolFailure(failedAgent, "task");
  await run(makeCtx([], []), "task", failedAgent, "ses_parent_5f", { agent: failedTarget }, {
    title: "",
    output: "dispatched",
    metadata: { sessionID: "ses_child_5f", status: "completed" },
  });
  assert(
    isToolLoopBlocked("ses_parent_5f", failedAgent, "task") !== null,
    "a pending dispatch keeps the failure counters",
  );
  finalizeDispatchFailure("ses_child_5f", "failed");
  assert(
    isToolLoopBlocked("ses_parent_5f", failedAgent, "task") !== null,
    "a failed terminal does not record tool success",
  );

  const targetlessAgent = "@no-target";
  for (let i = 0; i < 3; i++) recordToolFailure(targetlessAgent, "task");
  const pendingBeforeTargetless = pendingDispatchCount();
  const events5t: Event[] = [];
  const log5t: Captured[] = [];
  await run(makeCtx(log5t, events5t), "task", targetlessAgent, "ses_parent_5t", { desc: "two words here" }, {
    title: "",
    output: "dispatched",
    metadata: { sessionID: "ses_child_5t" },
  });
  assert(
    pendingDispatchCount() === pendingBeforeTargetless + 1,
    "a dispatch without a parsed target still registers one ledger entry",
  );
  assert(
    isToolLoopBlocked("ses_parent_5t", targetlessAgent, "task") !== null,
    "a targetless dispatch keeps the failure counters while it is pending",
  );
  assert(
    !events5t.some((event) => event.type === "TASK_COMPLETED"),
    "a targetless dispatch names no agent, so the return emits no completion",
  );
  finalizeDispatchOnIdle("ses_child_5t");
  assert(
    pendingDispatchCount() === pendingBeforeTargetless,
    "the targetless idle finalizes the entry it registered",
  );
  assert(
    isToolLoopBlocked("ses_parent_5t", targetlessAgent, "task") === null,
    "the targetless terminal clears the dispatching agent's failure counters",
  );

  const events6: Event[] = [];
  const log6: Captured[] = [];
  await run(makeCtx(log6, events6), "thread", "@thread", "ses_parent_6", {}, {
    title: "",
    output: "packed",
    metadata: { sessionID: "ses_pack_target" },
  });
  assert(log6[0]!.status === "success", "a thread result with a session id stays a normal success");
  assert(
    !events6.some((event) => event.type === "TASK_COMPLETED"),
    "a thread result with a session id never emits a task completion",
  );

  const log7: Captured[] = [];
  await run(makeCtx(log7, []), "read", "@read", "ses_parent_7", {}, {
    title: "",
    output: "",
    metadata: { status: "failed" },
  });
  assert(log7[0]!.status === "error", "a non-task failed status keeps the existing failure path");

  const beforeFailed = pendingDispatchCount();
  const events8: Event[] = [];
  const log8: Captured[] = [];
  await run(makeCtx(log8, events8), "task", "@failed", "ses_parent_8", { agent: "@failed-child" }, {
    title: "",
    output: "partial",
    metadata: { status: "failed", sessionID: "ses_child_8" },
  });
  assert(log8[0]!.status === "error", "a failed task result is a failure, not a dispatch");
  assert(
    !events8.some((event) => event.type === "TASK_COMPLETED"),
    "a failed task result emits no completion",
  );
  assert(pendingDispatchCount() === beforeFailed, "a failed task result is not tracked as a dispatch");

  const events9: Event[] = [];
  await run(makeCtx([], events9), "task", "@status", "ses_parent_9", { agent: "@status-child" }, {
    title: "",
    output: "working",
    metadata: { status: "running" },
  });
  assert(
    !events9.some((event) => event.type === "TASK_COMPLETED"),
    "a non-terminal task status suppresses the completion",
  );
}

try {
  await main();
  console.log(`PROOF PASS: a task dispatch is recognised, tracked and denied its false completion (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
