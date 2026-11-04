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

  console.log(`PROOF PASS: continuity off keeps zero reads, writes and probes, and the project index off keeps zero reads, parses and writes (${passed} assertions)`);
} finally {
  delete process.env.TAWASSUL_CONTINUITY;
  delete process.env.TAWASSUL_PROJECT_INDEX;
  resetContinuity();
  rmSync(dir, { recursive: true, force: true });
}
