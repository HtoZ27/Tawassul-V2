import "./proof-log-isolate.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TawassulContext } from "../src/context.ts";
import type { ToolContext } from "../src/tool.ts";
import { ProjectIndexService } from "../src/services/project-index/index.ts";
import { TaskContextService } from "../src/services/task-context/index.ts";
import { TaskOrchestrator, extractDeclaredFiles } from "../src/services/task-orchestrator.ts";
import { StrategyDispatcher } from "../src/services/strategy-dispatcher.ts";
import { ParallelDispatcher } from "../src/services/parallel-dispatcher.ts";
import type { DispatchPlan, DispatchTask } from "../src/services/parallel-dispatcher.ts";
import { buildTaskOrchestrateTool } from "../src/tools/tawa/task-orchestrate.ts";
import { FeatureIndex } from "../src/services/feature-index.ts";
import { isComplexTask } from "../src/services/effort-analyzer.ts";
import type { SubTask } from "../src/types/plan.types.ts";

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

function deepEq(actual: unknown, expected: unknown, name: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${name} (${JSON.stringify(actual)}/${JSON.stringify(expected)})`);
}

function toolContext(directory: string): ToolContext {
  return {
    sessionID: "ses_task_context_bundle",
    messageID: "msg_task_context_bundle",
    agent: "dev",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {},
  };
}

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

class CapturingDispatcher extends ParallelDispatcher {
  plans: DispatchPlan[] = [];

  buildPlan(tasks: DispatchTask[]): DispatchPlan {
    const plan = super.buildPlan(tasks);
    this.plans.push(plan);
    return plan;
  }
}

const work = mkdtempSync(join(tmpdir(), "tawassul-task-context-bundle-"));

async function main(): Promise<void> {
  const project = join(work, "project");
  mkdirSync(join(project, "src"), { recursive: true });
  const imports = Array.from({ length: 10 }, (_, i) => `import { f${i} } from "./f${i}";`).join("\n");
  writeFileSync(
    join(project, "src", "a.ts"),
    `${imports}\nexport function alpha() {\n  return 1;\n}\nexport const alphaSecret = "PROOF_BODY_SECRET";\n`,
  );
  writeFileSync(join(project, "src", "b.ts"), 'import { alpha } from "./a";\nexport const beta = alpha();\n');
  writeFileSync(join(project, "src", "c.ts"), "export function gamma() {\n  return 3;\n}\n");
  for (let i = 0; i < 10; i += 1) {
    writeFileSync(join(project, "src", `f${i}.ts`), `export const f${i} = ${i};\n`);
  }

  const index = new ProjectIndexService({ baseDir: project, projectKey: "bundle-key", projectRoot: project, enabled: true });
  for (const file of ["a.ts", "b.ts", "c.ts", ...Array.from({ length: 10 }, (_, i) => `f${i}.ts`)]) {
    await index.recordFile(join(project, "src", file));
  }
  const features = new FeatureIndex();
  features.register({
    name: "Alpha pipeline",
    description: "alpha processing flow",
    files: ["src/c.ts"],
    tags: ["alpha"],
  });
  const taskContext = new TaskContextService({ projectIndex: index, featureIndex: features, projectRoot: project });
  eq(taskContext.enabled, true, "the bundle builder is enabled by default");

  const handoffs: Array<{ to: string; task: string; context: string; files: string[] }> = [];
  const dispatcher = new CapturingDispatcher(
    (params) => {
      handoffs.push({ to: params.to, task: params.task, context: params.context, files: params.files });
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

  const singleTask = "Update src/a.ts and keep alpha working";
  const subtasks = orchestrator.decompose(singleTask);
  eq(subtasks.length, 1, "a single task yields one subtask");
  deepEq(subtasks[0]!.declaredFiles, ["src/a.ts"], "the subtask records the declared file before the bundle");
  assert(subtasks[0]!.context?.startsWith("## Task Context Bundle") === true, "the subtask carries the bundle header");
  assert((subtasks[0]!.files?.length ?? 0) >= 10, "the bundle carries the declared file and its import neighbours");

  const bundle = taskContext.build({
    taskId: subtasks[0]!.id,
    task: subtasks[0]!.description,
    declaredFiles: subtasks[0]!.declaredFiles,
  });
  assert(bundle !== null, "the planner returns a bundle");
  if (!bundle) return;
  assert(bundle.items.length > 0, "the bundle carries at least one item");
  assert(bundle.items.every((item) => item.reason.trim().length > 0), "every bundle item carries a non-empty reason");
  assert(
    bundle.items.every((item) => !Object.prototype.hasOwnProperty.call(item, "content")),
    "no bundle item carries file content",
  );
  assert(
    bundle.items.some((item) => item.kind === "file" && item.path === "src/a.ts"),
    "the declared file is a file item",
  );
  assert(bundle.items.some((item) => item.kind === "symbol" && item.name === "alpha"), "the task symbol becomes a symbol item");
  assert(bundle.items.some((item) => item.kind === "edge" && item.from === "src/a.ts"), "the imported file becomes an edge item");
  assert(!subtasks[0]!.context!.includes("PROOF_BODY_SECRET"), "the rendered bundle never leaks file content");
  assert(taskContext.render(bundle) === subtasks[0]!.context, "the rendered bundle matches the subtask context");
  eq(
    JSON.stringify(subtasks[0]!.files),
    JSON.stringify(bundle.items.filter((item) => item.kind === "file").map((item) => item.path)),
    "the subtask files are the bundle file items",
  );

  await tool.execute({ task: singleTask, mode: "auto" } as never, cctx);
  eq(handoffs.length, 1, "task_orchestrate creates one handoff for a single task");
  const handoffId = /^task-id: (.+)$/m.exec(handoffs[0]!.context)?.[1] ?? "";
  const handoffBundle = taskContext.build({ taskId: handoffId, task: singleTask, declaredFiles: ["src/a.ts"] });
  assert(handoffBundle !== null, "the handoff task id rebuilds the same bundle");
  assert(handoffs[0]!.context.includes("reason:"), "the handoff context carries the item reasons");
  assert(handoffs[0]!.context.includes(`task-id: ${handoffId}`), "the handoff context carries its own bundle task id");
  assert(handoffs[0]!.context === taskContext.render(handoffBundle!), "the handoff context is the rendered bundle");
  eq(
    JSON.stringify(handoffs[0]!.files),
    JSON.stringify(handoffBundle!.items.filter((item) => item.kind === "file").map((item) => item.path)),
    "the handoff files match the bundle files",
  );

  const commaTask = "Update src/a.ts and keep alpha working, Update src/b.ts and keep beta working";
  const parts = orchestrator.decompose(commaTask);
  eq(parts.length, 2, "a comma-separated task yields one subtask per part");
  deepEq(parts[0]!.declaredFiles, ["src/a.ts"], "the first part declares its own file");
  deepEq(parts[1]!.declaredFiles, ["src/b.ts"], "the second part declares its own file");
  assert(parts.every((part) => part.context?.startsWith("## Task Context Bundle") === true), "every part carries its own bundle header");
  assert(parts[0]!.context !== parts[1]!.context, "the two parts carry different bundle text");
  assert(parts[0]!.id !== parts[1]!.id, "the two parts carry different bundle task ids");
  eq(parts[1]!.dependencies.length, 1, "the split keeps the sequential dependency");

  const beforeComma = handoffs.length;
  await tool.execute({ task: commaTask, mode: "auto" } as never, cctx);
  eq(handoffs.length - beforeComma, 2, "task_orchestrate dispatches one handoff per part");
  const commaHandoffs = handoffs.slice(beforeComma);
  const commaBundles = commaHandoffs.map((handoff, i) => {
    const id = /^task-id: (.+)$/m.exec(handoff.context)?.[1] ?? "";
    return taskContext.build({ taskId: id, task: parts[i]!.description, declaredFiles: parts[i]!.declaredFiles });
  });
  eq(commaBundles.every((entry) => entry !== null), true, "every part rebuilds its own bundle");
  assert(commaHandoffs[0]!.context === taskContext.render(commaBundles[0]!), "the first handoff carries its own bundle");
  assert(commaHandoffs[1]!.context === taskContext.render(commaBundles[1]!), "the second handoff carries its own bundle");
  assert(commaHandoffs[0]!.context !== commaHandoffs[1]!.context, "no bundle is shared across the split parts");
  eq(
    commaBundles.every((entry) => entry !== null && entry.items.every((item) => item.reason.trim().length > 0)),
    true,
    "every split bundle carries reasons",
  );

  const complexTask =
    "Implement a distributed cache with consistent hashing then add invalidation then wire metrics then benchmark src/c.ts under heavy load and tune the eviction policy carefully";
  eq(isComplexTask(complexTask), true, "the complex fixture crosses the complexity gate");
  const complexParts = orchestrator.decompose(complexTask);
  eq(complexParts.length, 1, "a complex task without separators stays one subtask");
  eq(complexParts[0]!.agent, "@dev", "the complex subtask keeps the preferred role @dev");
  deepEq(complexParts[0]!.declaredFiles, ["src/c.ts"], "the complex subtask declares its file");
  assert(complexParts[0]!.context?.startsWith("## Task Context Bundle") === true, "the complex subtask keeps its own bundle");
  const beforeComplex = handoffs.length;
  await tool.execute({ task: complexTask, mode: "auto" } as never, cctx);
  eq(handoffs.length - beforeComplex, 1, "the complex task still produces one handoff");
  const complexHandoff = handoffs[beforeComplex]!;
  const complexId = /^task-id: (.+)$/m.exec(complexHandoff.context)?.[1] ?? "";
  const complexBundle = taskContext.build({
    taskId: complexId,
    task: complexTask,
    declaredFiles: ["src/c.ts"],
  });
  assert(complexBundle !== null, "the complex handoff rebuilds its bundle");
  assert(complexHandoff.context === taskContext.render(complexBundle!), "the complex handoff carries the complex bundle");
  eq(complexHandoff.to, "dev", "the complex handoff keeps the dev role");

  const tenFiles = subtasks[0]!.files!;
  const bundleTask: SubTask = {
    id: "mode-task",
    description: singleTask,
    files: tenFiles,
    agent: "dev",
    dependencies: [],
    successCriteria: [],
    status: "pending",
    declaredFiles: ["src/a.ts"],
    context: subtasks[0]!.context,
  };
  eq(tenFiles.length > 5, true, "the fixture bundle lists more than five files");
  eq(strategy.selectMode(bundleTask), "parallel", "a ten-file bundle with one declared file stays parallel");
  eq(
    strategy.selectMode({ ...bundleTask, declaredFiles: [] }),
    "parallel",
    "an empty declared list never falls back to the bundle files",
  );
  eq(
    strategy.selectMode({ ...bundleTask, declaredFiles: undefined }),
    "swarm",
    "the bundle files would select swarm without the declared list",
  );

  const swarmTask: SubTask = {
    ...bundleTask,
    id: "swarm-task",
    dependencies: ["d1", "d2", "d3", "d4"],
  };
  eq(strategy.selectMode(swarmTask), "swarm", "four dependencies select swarm");
  const beforeSwarm = dispatcher.plans.length;
  const beforeSwarmHandoffs = handoffs.length;
  await strategy.dispatch(swarmTask, "auto");
  eq(handoffs.length - beforeSwarmHandoffs, 3, "the swarm dispatches three role copies");
  const swarmPlan = dispatcher.plans[beforeSwarm];
  assert(swarmPlan !== undefined, "the swarm exposes its dispatch plan");
  if (!swarmPlan) return;
  eq(swarmPlan.batches.length, 1, "the swarm produces one batch");
  eq(swarmPlan.batches[0]!.parallel, true, "the swarm batch stays parallel with ten shared bundle files");
  eq(swarmPlan.batches[0]!.tasks.length, 3, "the parallel batch carries all three role copies");
  eq(swarmPlan.fileConflicts.size, 0, "the role copies are not self-conflicting");
  eq(
    swarmPlan.batches[0]!.tasks.every((task) => task.copyOf === swarmTask.id),
    true,
    "every role copy points at its source subtask",
  );
  eq(
    handoffs.slice(beforeSwarmHandoffs).every((handoff) => handoff.context === subtasks[0]!.context),
    true,
    "the swarm copies carry the same bundle context",
  );
  eq(
    handoffs.slice(beforeSwarmHandoffs).every((handoff) => JSON.stringify(handoff.files) === JSON.stringify(tenFiles)),
    true,
    "the swarm copies carry the bundle files",
  );

  const copyTask = (id: string, copyOf: string, declaredFiles: string[]): DispatchTask => ({
    id,
    description: "two disjoint declared groups",
    context: "bundle",
    files: tenFiles,
    declaredFiles,
    copyOf,
    dependencies: [],
    preferredRole: "dev",
    specializations: [],
    estimatedComplexity: "medium",
  });
  const grouped = dispatcher.buildPlan([
    copyTask("a1", "a", ["src/a.ts"]),
    copyTask("a2", "a", ["src/a.ts"]),
    copyTask("b1", "b", ["src/b.ts"]),
    copyTask("b2", "b", ["src/b.ts"]),
  ]);
  eq(grouped.fileConflicts.size, 0, "disjoint declared groups with ten shared bundle files do not conflict");
  eq(grouped.batches.length, 1, "the two groups share one batch");
  eq(grouped.batches[0]!.parallel, true, "the shared batch is parallel");
  eq(grouped.batches[0]!.tasks.length, 4, "the shared batch carries both groups");

  const ungrouped = dispatcher.buildPlan([
    copyTask("a1", "a", ["src/a.ts"]),
    copyTask("a2", "b", ["src/a.ts"]),
  ]);
  eq(ungrouped.fileConflicts.size, 1, "different copy groups that declare the same file conflict");
  eq(ungrouped.batches[0]!.parallel, false, "a real conflict serialises the batch");

  deepEq(extractDeclaredFiles("touch ./src/a.ts and src/b.ts, then read https://example.com/readme.md"), ["src/a.ts", "src/b.ts"], "the extractor keeps relative paths and ignores URLs");
  deepEq(extractDeclaredFiles("update README.md"), ["README.md"], "the extractor keeps a bare file name");
  deepEq(extractDeclaredFiles("no file tokens here"), [], "the extractor returns an empty list without a token");
  const manyPaths = Array.from({ length: 60 }, (_, i) => `src/many${i}.ts`).join(" ");
  eq(extractDeclaredFiles(manyPaths).length, 50, "the extractor caps the declared list at 50");

  const handoffSource = readSource("src/tools/handoff.ts");
  assert(handoffSource.includes("buildAccumulatedContext"), "handoff create still injects the accumulated context");
  assert(!handoffSource.includes("TaskContextService") && !handoffSource.includes("TASK_CONTEXT"), "handoff create never receives the bundle");
  const toolExecuteSource = readSource("src/hooks/tool-execute.ts");
  assert(!toolExecuteSource.includes("TaskContext") && !toolExecuteSource.includes("TASK_CONTEXT"), "the tool hook never receives the bundle");
  const taskContextSources = [
    readSource("src/services/task-context/types.ts"),
    readSource("src/services/task-context/planner.ts"),
    readSource("src/services/task-context/render.ts"),
    readSource("src/services/task-context/index.ts"),
  ];
  assert(
    taskContextSources.every((source) => !source.includes("tool.execute.before")),
    "the bundle adds no tool.execute.before hook",
  );

  console.log(`PROOF PASS: task_orchestrate delivers one bundle per subtask with reasons, files and no content (${passed} assertions)`);
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
