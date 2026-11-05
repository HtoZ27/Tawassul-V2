import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const dir = mkdtempSync(join(tmpdir(), "tawassul-intelligence-off-"));

try {
  process.env.TAWASSUL_CONTINUITY = "0";
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
  await readCache.getOrCompute({ tool: "batchread", args: { paths: ["a.ts"] }, files, dirs: [], compute });
  await readCache.getOrCompute({ tool: "batchread", args: { paths: ["a.ts"] }, files, dirs: [], compute });
  assert(computed === 2, "a disabled cache recomputes on every call");
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

  console.log(`PROOF PASS: continuity, project index, read cache and task context off keep zero reads, writes and computations (${passed} assertions)`);
} finally {
  delete process.env.TAWASSUL_CONTINUITY;
  delete process.env.TAWASSUL_PROJECT_INDEX;
  delete process.env.TAWASSUL_READ_CACHE;
  delete process.env.TAWASSUL_TASK_CONTEXT;
  resetContinuity();
  rmSync(dir, { recursive: true, force: true });
}
