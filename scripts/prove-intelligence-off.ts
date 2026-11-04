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

  console.log(`PROOF PASS: continuity off keeps zero reads, writes and probes (${passed} assertions)`);
} finally {
  delete process.env.TAWASSUL_CONTINUITY;
  resetContinuity();
  rmSync(dir, { recursive: true, force: true });
}
