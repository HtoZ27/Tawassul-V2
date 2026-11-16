import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TawassulContext } from "../src/context-class.ts";
import { TOOL_COUNT } from "../src/generated/tool-tripwire.ts";
import { TAWASSUL_TOOL_NAMES } from "../src/tool-names.ts";
import { detectInterrupted, noteIdle, resetContinuity } from "../src/services/continuity/detect.ts";
import {
  clearOwner,
  configureContinuity,
  continuityEnabled,
  continuityIoStats,
  heartbeatActive,
  resetContinuityIoStats,
  stampOwner,
  touch,
} from "../src/services/continuity/owner.ts";
import type { HandoffEntry } from "../src/context/types.ts";
import { ProjectIndexService } from "../src/services/project-index/index.ts";
import { snapshotPath } from "../src/services/project-index/store.ts";
import { ReadCacheService } from "../src/services/read-cache/index.ts";
import { readCacheEnabled } from "../src/services/read-cache/policy.ts";
import { TaskContextService, taskContextEnabled } from "../src/services/task-context/index.ts";
import { TaskOrchestrator } from "../src/services/task-orchestrator.ts";
import { buildHandoffTool } from "../src/tools/handoff.ts";
import { HandoffService } from "../src/services/handoff-service.ts";
import { HealthTracker } from "../src/services/agent-health.ts";
import { CircuitBreaker } from "../src/services/circuit-breaker.ts";
import { registerMemoryEventIntegrations } from "../src/bootstrap/memory-integrations.ts";
import { buildHealthTool } from "../src/tools/tawa/health.ts";
import { buildDashboardTool } from "../src/tools/tawa/dashboard.ts";
import { buildReportTool } from "../src/tools/diagnostics.ts";
import { ServiceIndex } from "../src/services/service-index.ts";
import { t } from "../src/translations.ts";
import type { ToolContext } from "../src/tool.ts";

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

function handoff(): HandoffEntry {
  return {
    id: "H-OFF",
    from: "@dev",
    to: "@tester",
    task: "disabled continuity probe",
    context: "the kill switch keeps every continuity write off",
    files: [],
    timestamp: new Date().toISOString(),
    status: "accepted",
  };
}

function outputText(result: unknown): string {
  return typeof result === "string" ? result : String((result as { output?: unknown })?.output ?? "");
}

async function waitFor(predicate: () => boolean, name: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  fail(name);
}

const dir = mkdtempSync(join(tmpdir(), "tawassul-intelligence-off-"));
const repo = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  process.env.TAWASSUL_CONTINUITY = "0";
  process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT = "0";
  const ownersDir = join(dir, ".opencode", "continuity");
  mkdirSync(ownersDir, { recursive: true });
  const ownersFile = join(ownersDir, "owners.json");
  const sentinel = JSON.stringify({ "H-OLD": { pid: 1, startedAt: 1, bootId: "old", heartbeatAt: "2026-01-01T00:00:00.000Z", sessionId: "ses_old" } });
  writeFileSync(ownersFile, sentinel);

  configureContinuity({ baseDir: dir, configEnabled: true });
  resetContinuityIoStats();

  assert(!continuityEnabled(), "the kill switch disables continuity even when the config enables it");
  const entry = handoff();
  assert(!(await stampOwner(entry, "ses_off")), "stampOwner refuses while continuity is disabled");
  assert(!(await touch(entry)), "touch refuses while continuity is disabled");
  assert(!(await clearOwner(entry.id)), "clearOwner refuses while continuity is disabled");
  const detected = await detectInterrupted([entry], { force: true });
  assert(!detected.ran, "detectInterrupted does not run while continuity is disabled");
  assert(detected.interrupted.length === 0 && detected.stale.length === 0, "the disabled probe reports no lifecycle change");
  assert((await noteIdle()) === null, "the idle trigger does not run while continuity is disabled");
  assert(!heartbeatActive(), "the disabled probe starts no heartbeat");
  assert(readFileSync(ownersFile, "utf8") === sentinel, "the disabled probe leaves owners.json untouched");
  assert(readdirSync(ownersDir).length === 1, "the disabled probe writes no temporary owner file");
  const stats = continuityIoStats();
  assert(stats.reads === 0 && stats.writes === 0 && stats.probes === 0, "the disabled probe performs zero reads, writes and probes");
  assert(entry.ownerPid === undefined && entry.runState === undefined, "the disabled probe leaves the handoff untouched");
  assert(TAWASSUL_TOOL_NAMES.length === TOOL_COUNT, "the advertised tool surface still matches the tripwire");
  assert(TAWASSUL_TOOL_NAMES.length === 44, "the disabled probe keeps 44 tools registered");
  assert(!existsSync(join(ownersDir, "owners.json.tmp")), "no temporary owner file survives the disabled probe");

  process.env.TAWASSUL_PROJECT_INDEX = "0";
  const indexProject = join(dir, "index-off");
  const indexFile = join(indexProject, "src", "a.ts");
  mkdirSync(join(indexProject, "src"), { recursive: true });
  writeFileSync(indexFile, "export const off = 1;\n");
  const indexOff = new ProjectIndexService({ baseDir: indexProject, projectKey: "off-key" });
  assert(!indexOff.enabled, "the project-index kill switch disables the index");
  assert(!existsSync(snapshotPath(indexProject)), "no snapshot exists before the disabled run");
  assert((await indexOff.recordFile(indexFile)) === null, "a disabled index records no file");
  assert(!indexOff.recordImports(indexFile, [{ from: indexFile, specifier: "./a", to: null }]), "a disabled index records no import");
  await indexOff.recordTree([{ path: indexFile, mtimeMs: 1, size: 10 }], [{ path: join(indexProject, "src"), mtimeMs: 2 }]);
  assert(!indexOff.recordStamps([indexFile]), "a disabled index records no stamp");
  assert(indexOff.snapshot().stats.files === 0, "a disabled index stays empty");
  assert(indexOff.stats().parses === 0 && indexOff.stats().writes === 0, "a disabled index performs no parse and no write");
  assert(!existsSync(snapshotPath(indexProject)), "a disabled index writes no snapshot and reads none");
  assert(readdirSync(indexProject).length === 1, "a disabled index creates no state directory");

  process.env.TAWASSUL_READ_CACHE = "0";
  const cacheProject = join(dir, "cache-off");
  const cacheFile = join(cacheProject, "a.ts");
  mkdirSync(cacheProject, { recursive: true });
  writeFileSync(cacheFile, "export const off = 1;\n");
  const readCache = new ReadCacheService({ projectKey: "off-key" });
  assert(!readCacheEnabled(), "the read-cache kill switch reports the cache disabled");
  assert(!readCache.enabled, "the read-cache kill switch disables the cache");
  let computed = 0;
  const compute = (): { output: string } => {
    computed += 1;
    return { output: "recomputed" };
  };
  const files = [{ path: cacheFile, mtimeMs: 1, size: 10 }];
  await readCache.getOrCompute({ tool: "depmap", args: { paths: ["a.ts"] }, files, dirs: [], compute });
  await readCache.getOrCompute({ tool: "depmap", args: { paths: ["a.ts"] }, files, dirs: [], compute });
  assert(computed === 2, "a disabled cache recomputes depmap on every call");
  assert(readCache.stats().entries === 0 && readCache.bytes === 0, "a disabled cache stores no entry and no byte");
  assert(readCache.stats().hits === 0, "a disabled cache records no hit");
  assert(readdirSync(cacheProject).length === 1, "a disabled cache writes no state file");

  process.env.TAWASSUL_TASK_CONTEXT = "0";
  const taskProject = join(dir, "task-context-off");
  const taskFile = join(taskProject, "src", "a.ts");
  mkdirSync(join(taskProject, "src"), { recursive: true });
  writeFileSync(taskFile, "export const off = 1;\n");
  const taskIndex = new ProjectIndexService({ baseDir: taskProject, projectKey: "off-key" });
  const taskContext = new TaskContextService({ projectIndex: taskIndex, projectRoot: taskProject });
  assert(!taskContextEnabled(), "the task-context kill switch reports the bundle disabled");
  assert(!taskContext.enabled, "the task-context kill switch disables the bundle builder");
  assert(
    taskContext.build({ taskId: "T-OFF", task: "update src/a.ts", declaredFiles: ["src/a.ts"] }) === null,
    "a disabled builder produces no bundle",
  );
  const taskOrchestrator = new TaskOrchestrator(undefined, undefined, undefined, taskContext);
  const taskOff = taskOrchestrator.decompose("update src/a.ts")[0]!;
  assert(taskOff.context === "" && taskOff.files.length === 0, "a disabled bundle leaves the path C context empty");
  assert(
    JSON.stringify(taskOff.declaredFiles) === JSON.stringify(["src/a.ts"]),
    "the disabled builder still records the declared file",
  );
  assert(readdirSync(taskProject).length === 1, "a disabled builder writes no bundle file");

  process.env.TAWASSUL_CONTEXT_HANDOFF = "0";
  process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT = "0";
  const handoffProject = join(dir, "handoff-off");
  mkdirSync(join(handoffProject, ".opencode", "agents"), { recursive: true });
  for (const agent of ["dev", "tester"]) {
    copyFileSync(join(repo, ".opencode", "agents", "dev.md"), join(handoffProject, ".opencode", "agents", `${agent}.md`));
  }
  const handoffCtx = new TawassulContext(handoffProject);
  handoffCtx.ensureConfig();
  const handoffIndex = new ProjectIndexService({ baseDir: handoffProject, projectKey: "off-key", enabled: false });
  const handoffCache = new ReadCacheService({ projectKey: "off-key", enabled: false });
  handoffCtx.projectIndex = handoffIndex;
  handoffCtx.readCache = handoffCache;
  handoffCtx.taskContext = new TaskContextService({
    projectIndex: handoffIndex,
    projectRoot: handoffProject,
    enabled: false,
  });
  assert(handoffCtx.intelligence === undefined, "all five flags off leave intelligence undefined");
  handoffCtx.handoffService = new HandoffService(handoffCtx, new HealthTracker(), new CircuitBreaker());
  const handoffTool = buildHandoffTool(handoffCtx);
  const callerText = "the caller text stays exact with the accumulated context off";
  const callerTask = "a task that the off flag must not prefix";
  const toolContext: ToolContext = {
    sessionID: "ses-off",
    messageID: "msg-off",
    agent: "@tawa",
    directory: handoffProject,
    worktree: handoffProject,
    abort: new AbortController().signal,
    metadata() {},
  };
  const offHealth = outputText(
    await buildHealthTool(handoffCtx, {
      measureLag: async () => 0,
      rssMb: () => 0,
      pendingFlushes: () => 0,
    }).execute({}, toolContext),
  );
  assert(!offHealth.includes("## Intelligence"), "health omits the intelligence block when every service is disabled");
  try {
    const created = (await handoffTool.execute(
      { to: "@dev", task: callerTask, context: callerText },
      toolContext,
    )) as { metadata?: { handoff?: HandoffEntry } };
    const stored = created.metadata?.handoff;
    assert(stored !== undefined, "the off flag still creates a handoff");
    assert(stored?.context === callerText, "the off flag stores the caller text verbatim");
    assert(stored?.task === callerTask, "the off flag leaves the task unpadded");

    const interrupted = handoff();
    interrupted.id = "H-OFF-INTERRUPTED";
    interrupted.runState = "interrupted";
    interrupted.interruptedReason = "gone";
    handoffCtx.handoffs.set(interrupted.id, interrupted);
    const resumed = outputText(
      await handoffTool.execute({ resumeInterrupted: interrupted.id }, toolContext),
    );
    assert(resumed === t("continuityDisabled"), "resumeInterrupted refuses while continuity is off");
    assert(
      interrupted.status === "accepted" && interrupted.runState === "interrupted",
      "the refused resume leaves the interrupted handoff untouched",
    );
  } finally {
    await handoffCtx.lifecycleManager.destroy();
  }

  const memoryProject = join(dir, "memory-on");
  mkdirSync(join(memoryProject, "src"), { recursive: true });
  const memoryFile = join(memoryProject, "src", "a.ts");
  writeFileSync(memoryFile, "export const a = 1;\n");
  const memoryCtx = new TawassulContext(memoryProject);
  memoryCtx.ensureConfig();
  const memoryIndex = new ProjectIndexService({
    baseDir: memoryProject,
    projectKey: "mem-key",
    projectRoot: memoryProject,
    enabled: true,
  });
  await memoryIndex.recordFile(memoryFile);
  const memoryCache = new ReadCacheService({ projectKey: "mem-key", enabled: true });
  await memoryCache.getOrCompute({
    tool: "depmap",
    args: { dir: memoryProject },
    files: [],
    dirs: [],
    compute: () => ({ nodes: [], cycles: [], fileCount: 1 }),
  });
  memoryCtx.projectIndex = memoryIndex;
  memoryCtx.readCache = memoryCache;
  memoryCtx.taskContext = new TaskContextService({
    projectIndex: memoryIndex,
    projectRoot: memoryProject,
    enabled: true,
  });
  assert(memoryCtx.intelligence !== undefined, "the enabled services expose an intelligence snapshot");
  assert((memoryCtx.intelligence?.cacheBytes ?? 0) > 0, "the intelligence snapshot counts cached bytes");
  assert(memoryIndex.loaded, "the index is loaded in memory before the cleanup event");
  const memoryToolContext: ToolContext = {
    ...toolContext,
    sessionID: "ses-memory",
    messageID: "msg-memory",
    directory: memoryProject,
    worktree: memoryProject,
  };
  const healthOutput = outputText(
    await buildHealthTool(memoryCtx, {
      measureLag: async () => 0,
      rssMb: () => 0,
      pendingFlushes: () => 0,
    }).execute({}, memoryToolContext),
  );
  assert(
    healthOutput.includes("## Intelligence") && healthOutput.includes("- Cache:"),
    "health prints the intelligence block when a service is enabled",
  );
  const dashboardOutput = outputText(
    await buildDashboardTool(
      new ServiceIndex(memoryCtx.eventHub, { storageDir: memoryCtx.persistDir }),
      memoryCtx,
    ).execute({ section: "status" }, memoryToolContext),
  );
  assert(dashboardOutput.includes("**Intelligence:**"), "dashboard prints the intelligence line");
  const reportOutput = outputText(await buildReportTool(memoryCtx).execute({}, memoryToolContext));
  assert(reportOutput.includes("## Intelligence"), "report prints the intelligence block");
  const stopMemory = registerMemoryEventIntegrations({
    tawaCtx: memoryCtx,
    eventHub: memoryCtx.eventHub,
    cacheClear: async () => 0,
    codeState: { reset: () => {} },
  });
  try {
    memoryCtx.eventHub.emit({ type: "CACHE_CLEANUP_REQUESTED", agent: "proof", metric: "rss", value: 1 });
    await waitFor(() => memoryCache.bytes === 0, "the cleanup event never clears the cache");
    assert(memoryCache.bytes === 0, "the cleanup event drops cacheBytes to zero");
    assert(memoryIndex.loaded, "the cleanup event leaves the index in memory");
    assert(memoryIndex.snapshot().stats.files > 0, "the cleanup event leaves the index readable");

    memoryCtx.eventHub.emit({
      type: "MEMORY_EMERGENCY",
      agent: "proof",
      metric: "rss",
      value: 2,
      thresholdMB: 1,
    });
    await waitFor(() => !memoryIndex.loaded, "the emergency event never evicts the index memory");
    assert(!memoryIndex.loaded, "the emergency event evicts the in-memory index");
    assert(memoryIndex.snapshot().stats.files > 0, "the evicted index is still readable from disk");
  } finally {
    stopMemory.stop();
    await memoryCtx.lifecycleManager.destroy();
  }

  console.log(`PROOF PASS: the five intelligence flags off leave the surface inert and the memory events split (${passed} assertions)`);
} finally {
  delete process.env.TAWASSUL_CONTINUITY;
  delete process.env.TAWASSUL_PROJECT_INDEX;
  delete process.env.TAWASSUL_READ_CACHE;
  delete process.env.TAWASSUL_TASK_CONTEXT;
  delete process.env.TAWASSUL_CONTEXT_HANDOFF;
  delete process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT;
  resetContinuity();
  rmSync(dir, { recursive: true, force: true });
}
