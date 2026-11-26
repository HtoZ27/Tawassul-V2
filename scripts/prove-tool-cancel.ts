import "./proof-log-isolate.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TawassulContext } from "../src/context.ts";
import type { ToolContext } from "../src/tool.ts";
import { buildProjectMapTool } from "../src/tools/project-map.ts";
import { buildDependencyMapTool } from "../src/tools/dependency-map.ts";
import { buildAstQueryTool, buildReadSymbolTool } from "../src/tools/ast-tools.ts";
import { buildHandoffTool } from "../src/tools/handoff.ts";
import { ReadCacheService } from "../src/services/read-cache/index.ts";
import type { ComputeInput, ComputeResult } from "../src/services/read-cache/index.ts";

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

type Counters = { trees: number; imports: number; batches: number; files: number; saves: number };

function makeCounters(): Counters {
  return { trees: 0, imports: 0, batches: 0, files: 0, saves: 0 };
}

function makeContext(counters: Counters, handoffs: Map<string, unknown>): TawassulContext {
  return {
    projectIndex: {
      recordTree: async () => {
        counters.trees += 1;
        return true;
      },
      recordImports: () => {
        counters.imports += 1;
        return true;
      },
      recordImportBatch: () => {
        counters.batches += 1;
        return true;
      },
      recordFile: async () => {
        counters.files += 1;
        return null;
      },
    },
    handoffs,
    saveState: () => {
      counters.saves += 1;
    },
  } as unknown as TawassulContext;
}

function toolContext(directory: string, signal: AbortSignal): ToolContext {
  return {
    sessionID: "ses_cancel_proof",
    messageID: "msg_cancel_proof",
    agent: "dev",
    directory,
    worktree: directory,
    abort: signal,
    metadata() {},
  };
}

function cancelled(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const result = value as { title?: string; output?: string; metadata?: { status?: string } };
  return (
    result.title === "Cancelled" &&
    result.output === "Cancelled" &&
    result.metadata?.status === "cancelled"
  );
}

type HandoffCounters = { handoffs: Map<string, unknown>; saves: number; ids: number };

function makeHandoffContext(
  state: HandoffCounters,
  validate: () => Promise<{ approved: boolean; reason?: string }>,
): TawassulContext {
  return {
    config: {},
    handoffs: state.handoffs,
    agentErrors: {},
    getSuggestedHandoffs: () => ({}),
    readAgentMd: () => null,
    strictness: () => "relaxed",
    buildRuleInput: async () => ({}),
    capabilityTracker: {},
    modelManager: { agentModelMap: {} },
    nextHandoffId: () => {
      state.ids += 1;
      return `H-PROOF-${state.ids}`;
    },
    getMaxHandoffs: () => 100,
    incrementError: () => undefined,
    recordValidationError: () => undefined,
    recordHandoffInitiated: () => undefined,
    updateLastActive: () => undefined,
    saveState: () => {
      state.saves += 1;
    },
    gamification: { recordAction: () => undefined },
    statsCollector: { recordHandoff: () => undefined },
    sharedMemory: { addDecision: () => undefined, updateAgentContext: () => undefined },
    fileLocks: { acquireLock: () => undefined },
    agentValidator: { validate },
  } as unknown as TawassulContext;
}

class AbortOnComputeCache extends ReadCacheService {
  private readonly controller: AbortController;

  constructor(controller: AbortController) {
    super({ projectKey: "proof-tool-cancel", enabled: true, maxBytes: 8 * 1024 * 1024 });
    this.controller = controller;
  }

  override async getOrCompute<T>(input: ComputeInput<T>): Promise<ComputeResult<T>> {
    this.controller.abort();
    return super.getOrCompute(input);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), ms);
      timer.unref?.();
    }),
  ]);
}

process.env.TAWASSUL_CONTEXT_HANDOFF = "0";

const work = mkdtempSync(join(tmpdir(), "tawassul-tool-cancel-"));

async function main(): Promise<void> {
  const project = join(work, "project");
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "src", "a.ts"), "export function alpha() {\n  return 1;\n}\n");
  writeFileSync(join(project, "src", "b.ts"), 'import { alpha } from "./a";\n\nexport const beta = alpha();\n');

  const controller = new AbortController();
  controller.abort();

  const cancelledCounters = makeCounters();
  const cancelledHandoffs = new Map<string, unknown>();
  const cancelledCtx = makeContext(cancelledCounters, cancelledHandoffs);
  const cancelledTool = toolContext(project, controller.signal);

  assert(
    cancelled(await buildProjectMapTool(cancelledCtx).execute({ depth: 5 } as never, cancelledTool)),
    "projectmap returns a cancelled result",
  );
  assert(cancelledCounters.trees === 0, "projectmap does not record a tree after cancellation");

  assert(
    cancelled(await buildDependencyMapTool(cancelledCtx).execute({ depth: 5 } as never, cancelledTool)),
    "dependencymap batch returns a cancelled result",
  );
  assert(cancelledCounters.batches === 0, "dependencymap does not record an import batch after cancellation");
  assert(
    cancelled(
      await buildDependencyMapTool(cancelledCtx).execute({ file: "src/a.ts" } as never, cancelledTool),
    ),
    "dependencymap single file returns a cancelled result",
  );
  assert(cancelledCounters.imports === 0, "dependencymap does not record imports after cancellation");

  assert(
    cancelled(await buildAstQueryTool(cancelledCtx).execute({ file: "src/a.ts" } as never, cancelledTool)),
    "astquery returns a cancelled result",
  );
  assert(
    cancelled(
      await buildReadSymbolTool(cancelledCtx).execute(
        { file: "src/a.ts", symbol: "alpha" } as never,
        cancelledTool,
      ),
    ),
    "readsymbol returns a cancelled result",
  );
  assert(cancelledCounters.files === 0, "ast tools do not record a file after cancellation");

  assert(
    cancelled(
      await buildHandoffTool(cancelledCtx).execute(
        {
          to: "tester",
          task: "check build",
          context: "inspect the build output and report",
        } as never,
        cancelledTool,
      ),
    ),
    "handoff returns a cancelled result",
  );
  assert(cancelledHandoffs.size === 0, "handoff writes no entry after cancellation");
  assert(cancelledCounters.saves === 0, "handoff saves no state after cancellation");

  const liveCounters = makeCounters();
  const liveCtx = makeContext(liveCounters, new Map<string, unknown>());
  const liveTool = toolContext(project, new AbortController().signal);

  const map = await buildProjectMapTool(liveCtx).execute({ depth: 5 } as never, liveTool);
  assert(
    typeof map === "object" && "output" in map && String(map.output).includes("src"),
    "projectmap still renders a live tree",
  );
  assert(liveCounters.trees === 1, "projectmap records the live tree once");

  const deps = await buildDependencyMapTool(liveCtx).execute({ depth: 5 } as never, liveTool);
  assert(
    typeof deps === "object" && "output" in deps && String(deps.output).length > 0,
    "dependencymap still renders a live report",
  );
  assert(liveCounters.batches === 1, "dependencymap records the live batch once");

  const files = await buildAstQueryTool(liveCtx).execute({ file: "src/a.ts" } as never, liveTool);
  assert(
    typeof files === "object" && "output" in files && String(files.output).includes("alpha"),
    "astquery still renders a live file",
  );
  assert(liveCounters.files === 1, "astquery records the live file once");

  const abortDuringCompute = new AbortController();
  const computeCache = new AbortOnComputeCache(abortDuringCompute);
  const computeCounters = makeCounters();
  const computeCtx = {
    ...makeContext(computeCounters, new Map<string, unknown>()),
    readCache: computeCache,
  } as unknown as TawassulContext;
  const computeResult = await buildDependencyMapTool(computeCtx).execute(
    { depth: 5 } as never,
    toolContext(project, abortDuringCompute.signal),
  );
  assert(cancelled(computeResult), "dependencymap returns Cancelled when the abort fires during compute");
  assert(computeCounters.batches === 0, "dependencymap records no batch when the abort fires during compute");
  assert(computeCache.stats().entries === 0, "dependencymap caches no graph when the abort fires during compute");

  const liveCacheCounters = makeCounters();
  const liveCacheCtx = {
    ...makeContext(liveCacheCounters, new Map<string, unknown>()),
    readCache: computeCache,
  } as unknown as TawassulContext;
  const liveCacheResult = await buildDependencyMapTool(liveCacheCtx).execute(
    { depth: 5 } as never,
    toolContext(project, new AbortController().signal),
  );
  assert(!cancelled(liveCacheResult), "dependencymap still renders after a cancelled compute");
  assert(liveCacheCounters.batches === 1, "dependencymap records the live batch after a cancelled compute");
  assert(computeCache.stats().entries === 1, "dependencymap caches the live graph after a cancelled compute");

  const abortOnHit = new AbortController();
  const hitCounters = makeCounters();
  const hitCache = {
    getOrCompute: async <T,>(_input: ComputeInput<T>): Promise<ComputeResult<T>> => {
      abortOnHit.abort();
      return { value: { nodes: [], cycles: [], fileCount: 0 } as T, cached: true };
    },
  } as unknown as ReadCacheService;
  const hitCtx = {
    ...makeContext(hitCounters, new Map<string, unknown>()),
    readCache: hitCache,
  } as unknown as TawassulContext;
  const hitResult = await buildDependencyMapTool(hitCtx).execute(
    { depth: 5 } as never,
    toolContext(project, abortOnHit.signal),
  );
  assert(cancelled(hitResult), "dependencymap returns Cancelled when the abort fires on a cache hit");
  assert(hitCounters.batches === 0, "dependencymap records no batch when the abort fires on a cache hit");

  let releaseValidation!: () => void;
  const validationGate = new Promise<void>((resolve) => {
    releaseValidation = resolve;
  });
  let enterValidation!: () => void;
  const validationEntered = new Promise<void>((resolve) => {
    enterValidation = resolve;
  });
  const abortHandoff = new AbortController();
  const abortedHandoffState: HandoffCounters = { handoffs: new Map(), saves: 0, ids: 0 };
  const abortedHandoffRun = buildHandoffTool(
    makeHandoffContext(abortedHandoffState, async () => {
      enterValidation();
      await validationGate;
      return { approved: true };
    }),
  ).execute(
    {
      to: "tester",
      task: "inspect the build output and report",
      context: "please inspect the build output and report any problem you find",
    } as never,
    toolContext(project, abortHandoff.signal),
  );
  const reached = await withTimeout(
    Promise.race([
      validationEntered.then(() => "validator" as const),
      abortedHandoffRun.then(() => "finished" as const),
    ]),
    10000,
  );
  assert(reached === "validator", "handoff reaches the validator before the state write");
  abortHandoff.abort();
  releaseValidation();
  const abortedHandoff = await abortedHandoffRun;
  assert(cancelled(abortedHandoff), "handoff returns Cancelled when the abort fires during validation");
  assert(
    abortedHandoffState.handoffs.size === 0,
    "handoff writes no entry when the abort fires during validation",
  );
  assert(abortedHandoffState.saves === 0, "handoff saves no state when the abort fires during validation");

  const liveHandoffState: HandoffCounters = { handoffs: new Map(), saves: 0, ids: 0 };
  const liveHandoff = await buildHandoffTool(
    makeHandoffContext(liveHandoffState, async () => ({ approved: true })),
  ).execute(
    {
      to: "tester",
      task: "inspect the build output and report",
      context: "please inspect the build output and report any problem you find",
    } as never,
    toolContext(project, new AbortController().signal),
  );
  assert(
    typeof liveHandoff === "object" && "output" in liveHandoff && !cancelled(liveHandoff),
    "handoff still creates a live handoff",
  );
  assert(liveHandoffState.handoffs.size === 1, "handoff writes one entry on the live path");
  assert(liveHandoffState.saves === 1, "handoff saves the state once on the live path");

  console.log(
    `PROOF PASS: cancelled tool calls stop before writes, a cancelled compute is never cached, and live calls are unchanged (${passed} assertions)`,
  );
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
