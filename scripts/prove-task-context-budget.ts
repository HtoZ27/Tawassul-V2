import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TawassulContext } from "../src/context.ts";
import type { ToolContext } from "../src/tool.ts";
import { ProjectIndexService } from "../src/services/project-index/index.ts";
import { TaskContextService } from "../src/services/task-context/index.ts";
import { TaskOrchestrator } from "../src/services/task-orchestrator.ts";
import { StrategyDispatcher } from "../src/services/strategy-dispatcher.ts";
import { ParallelDispatcher } from "../src/services/parallel-dispatcher.ts";
import { buildTaskOrchestrateTool } from "../src/tools/tawa/task-orchestrate.ts";
import { MAX_BUNDLE_BYTES, renderBundle } from "../src/services/task-context/render.ts";
import type { ContextItem, TaskContextBundle } from "../src/services/task-context/types.ts";

let passed = 0;

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, name: string): void {
  if (!condition) fail(name);
  passed += 1;
  console.log(`ok ${name}`);
}

function eq(actual: unknown, expected: unknown, name: string): void {
  assert(Object.is(actual, expected), `${name} (${String(actual)}/${String(expected)})`);
}

function toolContext(directory: string): ToolContext {
  return {
    sessionID: "ses_task_context_budget",
    messageID: "msg_task_context_budget",
    agent: "dev",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {},
  };
}

const work = mkdtempSync(join(tmpdir(), "tawassul-task-context-budget-"));

async function main(): Promise<void> {
  const project = join(work, "project");
  mkdirSync(join(project, "src"), { recursive: true });
  const paths = ["src/gone.ts"];
  for (let i = 1; i <= 59; i += 1) {
    const relative = `src/f${i}.ts`;
    writeFileSync(join(project, relative), `export const f${i} = ${i};\n`);
    paths.push(relative);
  }

  const index = new ProjectIndexService({ baseDir: project, projectKey: "budget-key", projectRoot: project, enabled: true });
  const taskContext = new TaskContextService({ projectIndex: index, projectRoot: project });
  const handoffs: Array<{ context: string; files: string[] }> = [];
  const dispatcher = new ParallelDispatcher(
    (params) => {
      handoffs.push({ context: params.context, files: params.files });
      return `H-${handoffs.length}`;
    },
    () => ({
      agent: "dev",
      score: 1,
      breakdown: { roleMatch: 1, specializationMatch: 0, performanceScore: 1, availabilityScore: 1, errorPenalty: 0 },
      reason: "proof",
    }),
  );
  const orchestrator = new TaskOrchestrator(undefined, dispatcher, undefined, taskContext);
  const strategy = new StrategyDispatcher(dispatcher);
  const ctx = { updateLastActive() {}, saveState: async () => {} } as unknown as TawassulContext;
  const tool = buildTaskOrchestrateTool(ctx, orchestrator, strategy);
  const cctx = toolContext(project);

  const filler = "x".repeat(20000);
  const task = `Update ${paths.join(" ")} ${filler}`;
  const subtasks = orchestrator.decompose(task);
  eq(subtasks.length, 1, "the large task stays one subtask");
  eq(subtasks[0]!.declaredFiles?.length, 50, "the declared list is capped at 50");
  eq(subtasks[0]!.declaredFiles?.includes("src/gone.ts"), true, "the missing declared file is captured");

  const bundle = taskContext.build({
    taskId: subtasks[0]!.id,
    task: subtasks[0]!.description,
    declaredFiles: subtasks[0]!.declaredFiles,
  });
  assert(bundle !== null, "the large task still produces a bundle");
  if (!bundle) return;
  eq(bundle.truncated, true, "the large bundle reports truncation");
  eq(bundle.missing.length > 0, true, "the large bundle reports a non-empty missing list");
  eq(bundle.missing.includes("src/gone.ts"), true, "the deleted declared file is missing");
  eq(bundle.items.length <= 40, true, "the bundle never exceeds 40 items");
  eq(bundle.items.filter((item) => item.kind === "file").length <= 24, true, "the bundle never exceeds 24 file items");
  eq(bundle.items.every((item) => item.reason.trim().length > 0), true, "every retained item still carries a reason");
  eq(bundle.bytes <= MAX_BUNDLE_BYTES, true, "the bundle byte count stays inside the 16 KB budget");
  eq(Buffer.byteLength(subtasks[0]!.context ?? "", "utf8") <= MAX_BUNDLE_BYTES, true, "the subtask context stays inside the budget");
  assert((subtasks[0]!.context ?? "").includes("truncated: true"), "the rendered bundle announces truncation");
  assert((subtasks[0]!.context ?? "").includes("…"), "the oversized task header is clipped");
  eq(bundle.task.length > 20000, true, "the structured bundle keeps the full task text");
  eq(MAX_BUNDLE_BYTES, 16384, "the bundle budget is 16 KB");

  await tool.execute({ task, mode: "parallel" } as never, cctx);
  eq(handoffs.length, 1, "the large task dispatches one handoff");
  eq(Buffer.byteLength(handoffs[0]!.context, "utf8") <= MAX_BUNDLE_BYTES, true, "no handoff context exceeds 16 KB");
  eq(handoffs[0]!.context.includes("missing: src/gone.ts"), true, "the handoff context carries the missing list");
  eq(
    JSON.stringify(handoffs[0]!.files),
    JSON.stringify(bundle.items.filter((item) => item.kind === "file").map((item) => item.path)),
    "the handoff files stay inside the bounded bundle",
  );

  const syntheticItems: ContextItem[] = Array.from({ length: 40 }, (_, i) => ({
    kind: "file" as const,
    path: `src/synthetic${i}.ts`,
    stamp: { path: `src/synthetic${i}.ts`, mtimeMs: 1, size: 1 },
    reason: "overflow".repeat(90),
    score: 40 - i,
  }));
  const synthetic: TaskContextBundle = {
    schemaVersion: 1,
    taskId: "synthetic-budget",
    task: "synthetic overflow",
    projectKey: "budget-key",
    revision: "synthetic",
    items: syntheticItems,
    missing: ["src/gone.ts"],
    bytes: 0,
    truncated: false,
  };
  const rendered = renderBundle(synthetic);
  eq(rendered.bytes <= MAX_BUNDLE_BYTES, true, "the renderer caps a 40-item overflow at 16 KB");
  eq(rendered.truncated, true, "the renderer reports the overflow");
  eq(rendered.items.length < syntheticItems.length, true, "the renderer drops items to fit the budget");
  eq(rendered.items.every((item) => item.reason.trim().length > 0), true, "the renderer keeps reasons on every retained item");
  eq(rendered.missing.includes("src/gone.ts"), true, "the renderer keeps the missing list");

  console.log(`PROOF PASS: the task context bundle stays inside 16 KB and reports truncation and missing files (${passed} assertions)`);
}

try {
  await main();
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
