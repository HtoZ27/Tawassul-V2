import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RatingManager } from "../src/context/managers/RatingManager.ts";
import { StateManager } from "../src/context/managers/StateManager.ts";
import type { TawaOrchestratorContext } from "../src/core/service-context.ts";
import { LifecycleController } from "../src/services/lifecycle-controller.ts";
import { StatePersistence } from "../src/services/state-persistence.ts";
import { unwrapWithHmacReadOnly } from "../src/utils/crypto.ts";

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

const envKeys = [
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "TAWASSUL_STATE_DIR",
  "TAWASSUL_V2_STATE_DIR",
  "TAWASSUL_HMAC_KEY_DIR",
  "TAWASSUL_LOG_FILE",
] as const;

const savedEnv = new Map<string, string | undefined>();
for (const key of envKeys) savedEnv.set(key, process.env[key]);

const work = mkdtempSync(join(tmpdir(), "tawassul-dropped-"));
const home = join(work, "home");
const hmacDir = join(work, "hmac");
mkdirSync(hmacDir, { recursive: true, mode: 0o700 });
writeFileSync(join(hmacDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = join(home, ".config");
process.env.XDG_DATA_HOME = join(home, ".local", "share");
process.env.XDG_STATE_HOME = join(home, ".local", "state");
process.env.XDG_CACHE_HOME = join(home, ".cache");
process.env.TAWASSUL_HMAC_KEY_DIR = hmacDir;
process.env.TAWASSUL_LOG_FILE = join(work, "tawassul.log");
delete process.env.TAWASSUL_STATE_DIR;
delete process.env.TAWASSUL_V2_STATE_DIR;

function acceptedHandoff() {
  return {
    id: "h1",
    to: "dev",
    from: "tester",
    status: "accepted",
    context: "ship the counter",
    task: "ship the counter",
    files: [],
    timestamp: new Date(0).toISOString(),
  };
}

async function controllerMarker(): Promise<void> {
  const ratingManager = new RatingManager();
  let markDirtyCalls = 0;
  const persistence = {
    saveTimeout: null,
    markDirty() {
      markDirtyCalls += 1;
    },
    markDisposing() {},
    getSaveCount() {
      return 0;
    },
    async flushSaves() {},
  } as unknown as StatePersistence;
  const ctx = {
    handoffs: new Map([["h1", acceptedHandoff()]]),
    ratingManager,
    sessionManager: { getSessionId: () => "s1", cleanup: async () => undefined },
    timerManager: { dispose: () => undefined, clear: () => undefined },
  } as unknown as TawaOrchestratorContext;
  const controller = new LifecycleController(ctx, persistence);
  await controller.destroy();
  assert(markDirtyCalls === 1, "destroy marks the state dirty once when it counts a new drop");
  assert(
    ratingManager.agentRatings.dev?.handoffsDropped === 1,
    "destroy records the dropped handoff on the rating",
  );
  await controller.destroy();
  assert(markDirtyCalls === 1, "a second destroy does not mark the state dirty again");
}

async function detectReturn(): Promise<void> {
  const ratingManager = new RatingManager();
  const first = ratingManager.detectDroppedHandoffs([{ to: "dev", status: "accepted" }]);
  assert(first === 1, "detectDroppedHandoffs reports the newly counted drop");
  const second = ratingManager.detectDroppedHandoffs([{ to: "dev", status: "accepted" }]);
  assert(second === 0, "detectDroppedHandoffs reports no new count for the same handoff");
}

async function persistedCounter(): Promise<void> {
  const stateDir = join(work, "state");
  mkdirSync(stateDir, { recursive: true });
  const statePath = join(stateDir, "state.json");
  const stateManager = new StateManager(stateDir, () => statePath);
  const ratingManager = new RatingManager();
  const handoff = acceptedHandoff();
  const ctx = {
    persistDir: stateDir,
    stateReadOnly: false,
    statePath: () => statePath,
    stateManager,
    records: [],
    handoffs: new Map([["h1", handoff]]),
    recSeq: 0,
    hoffSeq: 0,
    seenAgents: new Map(),
    pauseState: null,
    errorManager: { agentErrors: {} },
    ratingManager,
    capabilityTracker: { toJSON: () => [] },
    agentManager: {
      dynamicAgents: [],
      getMaxHandoffs: () => 100,
      getMaxRecords: () => 100,
    },
    modelManager: { agentModelMap: {} },
    discussionManager: {
      getEvidenceManager: () => undefined,
      getFullState: () => ({ discussions: [], evidencedDiscussions: [] }),
      getSequence: () => 0,
    },
    trainingEvaluator: { toJSON: () => ({}) },
    sharedMemory: { get: () => undefined, compact: () => undefined },
    eventHub: { emit: () => undefined },
    featureIndex: { toJSON: () => ({}) },
    sessionManager: { getSessionId: () => "s1" },
  } as unknown as TawaOrchestratorContext;
  const persistence = new StatePersistence(ctx);
  const detected = ratingManager.detectDroppedHandoffs([...ctx.handoffs.values()]);
  assert(detected === 1, "the real rating manager counts one new drop");
  await persistence.saveState();
  const raw = readFileSync(statePath, "utf8");
  const unsigned = unwrapWithHmacReadOnly(raw) ?? raw;
  const saved = JSON.parse(unsigned) as {
    agentRatings?: Record<string, { handoffsDropped?: number }>;
  };
  assert(saved.agentRatings?.dev?.handoffsDropped === 1, "the dropped count is on disk");
  const again = ratingManager.detectDroppedHandoffs([...ctx.handoffs.values()]);
  assert(again === 0, "a repeated detection in the same instance does not count again");
  await persistence.saveState();
  const after = JSON.parse(unwrapWithHmacReadOnly(readFileSync(statePath, "utf8")) ?? readFileSync(statePath, "utf8")) as {
    agentRatings?: Record<string, { handoffsDropped?: number }>;
  };
  assert(after.agentRatings?.dev?.handoffsDropped === 1, "the persisted count stays at one");
}

try {
  await controllerMarker();
  await detectReturn();
  await persistedCounter();
  console.log(`PROOF PASS: a dropped handoff marks dirty and survives a real save (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(e);
    process.exitCode = 1;
  }
} finally {
  for (const key of envKeys) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(work, { recursive: true, force: true });
}
