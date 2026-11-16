import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TawassulContext } from "../src/context-class.ts";
import { HandoffService } from "../src/services/handoff-service.ts";
import { HealthTracker } from "../src/services/agent-health.ts";
import { CircuitBreaker } from "../src/services/circuit-breaker.ts";
import { migrateStateData } from "../src/context/migration.ts";
import { STATE_VERSION } from "../src/context/constants.ts";
import type { HandoffEntry } from "../src/context/types.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "tawassul-cancel-metric-"));

type RatingProbe = { handoffsDropped?: number };

function ratingsOf(state: Record<string, unknown>): Record<string, RatingProbe> {
  return (state.agentRatings ?? {}) as Record<string, RatingProbe>;
}

async function cancellationIsNeutral(): Promise<void> {
  const dir = join(work, "project");
  mkdirSync(join(dir, ".opencode", "agents"), { recursive: true });
  copyFileSync(join(repo, ".opencode", "agents", "dev.md"), join(dir, ".opencode", "agents", "dev.md"));
  const ctx = new TawassulContext(dir);
  ctx.ensureConfig();
  try {
    const handoff: HandoffEntry = {
      id: "H-001",
      from: "@tawa",
      to: "general",
      task: "probe the cancellation metric",
      context: "the sender cancels this probe deliberately",
      files: [],
      timestamp: new Date().toISOString(),
      status: "pending",
    };
    ctx.handoffs.set(handoff.id, handoff);
    ctx.hoffSeq = 1;
    const healthTracker = new HealthTracker();
    const circuitBreaker = new CircuitBreaker();
    const service = new HandoffService(ctx, healthTracker, circuitBreaker);
    healthTracker.onHandoffCreated("general", handoff.id);
    circuitBreaker.recordFailure("general");
    circuitBreaker.recordFailure("general");
    ctx.capabilityTracker.updateCapability("general", "implementation", true);
    const healthBefore = JSON.stringify(healthTracker.getStatus("general"));
    const circuitBefore = JSON.stringify(circuitBreaker.getAllStates());
    const capabilityBefore = JSON.stringify(ctx.capabilityTracker.getAll());
    const memoryBefore = JSON.stringify({
      handoffs: ctx.sharedMemory.get().handoffHistory,
      learnings: ctx.sharedMemory.get().learnings,
    });
    const trainingBefore = JSON.stringify(ctx.trainingEvaluator.getStats());
    const result = await service.cancelHandoff(handoff.id, "@tawa");
    assert(result.success, "the sender can cancel a pending handoff");
    assert(handoff.status === "cancelled", "the handoff is recorded as cancelled");
    assert(
      (ctx.ratingManager.agentRatings["tawa"]?.handoffsDropped ?? 0) === 0,
      "a deliberate cancellation is not a dropped handoff for the sender",
    );
    assert(
      (ctx.ratingManager.agentRatings["general"]?.handoffsDropped ?? 0) === 0,
      "a deliberate cancellation is not a dropped handoff for the recipient",
    );
    assert(
      JSON.stringify(healthTracker.getStatus("general")) === healthBefore,
      "a deliberate cancellation does not count as a recipient failure in health tracking",
    );
    assert(
      JSON.stringify(circuitBreaker.getAllStates()) === circuitBefore,
      "a deliberate cancellation does not add a circuit-breaker failure",
    );
    assert(
      JSON.stringify(ctx.capabilityTracker.getAll()) === capabilityBefore,
      "a deliberate cancellation does not lower the recipient capability score",
    );
    assert(
      JSON.stringify({
        handoffs: ctx.sharedMemory.get().handoffHistory,
        learnings: ctx.sharedMemory.get().learnings,
      }) === memoryBefore,
      "a deliberate cancellation adds no shared-memory handoff or learning record",
    );
    assert(
      JSON.stringify(ctx.trainingEvaluator.getStats()) === trainingBefore,
      "a deliberate cancellation does not mark a training outcome as failure",
    );
  } finally {
    await ctx.lifecycleManager.destroy();
  }
  assert(
    (ctx.ratingManager.agentRatings["tawa"]?.handoffsDropped ?? 0) === 0,
    "shutdown does not resurrect the cancellation drop",
  );
}

function legacyState(): Record<string, unknown> {
  return {
    version: 4,
    records: [],
    handoffs: [
      { id: "H-005", from: "@tawa", to: "general", status: "cancelled" },
      { id: "H-006", from: "@tawa", to: "general", status: "cancelled" },
      { id: "H-007", from: "@tawa", to: "general", status: "cancelled" },
      { id: "H-008", from: "general", to: "dev-gemini", status: "completed" },
      { id: "H-009", from: "build", to: "dev", status: "cancelled" },
    ],
    recSeq: 0,
    hoffSeq: 9,
    agentErrors: {},
    agentRatings: {
      tawa: { handoffsDropped: 3 },
      build: { handoffsDropped: 3 },
      general: { handoffsDropped: 1 },
      dev: { handoffsDropped: 0 },
    },
    dynamicAgents: [],
    agentModelMap: {},
  };
}

function migrationRepairsLegacyDrops(): void {
  const migrated = migrateStateData(legacyState());
  const ratings = ratingsOf(migrated);
  assert(migrated.version === STATE_VERSION, "the migration stamps the current state version");
  assert(ratings.tawa?.handoffsDropped === 0, "legacy cancellation drops are removed for the sender");
  assert(ratings.build?.handoffsDropped === 2, "genuine drops survive the cancellation repair");
  assert(ratings.general?.handoffsDropped === 1, "cancelled handoffs are not charged to the recipient");
  assert(ratings.dev?.handoffsDropped === 0, "an unaffected rating stays at zero");
  const again = migrateStateData(migrated);
  const againRatings = ratingsOf(again);
  assert(againRatings.tawa?.handoffsDropped === 0, "a current-version state is never repaired twice");
  assert(againRatings.build?.handoffsDropped === 2, "the second pass preserves the repaired count");
}

try {
  await cancellationIsNeutral();
  migrationRepairsLegacyDrops();
  console.log(
    `PROOF PASS: deliberate cancellations are neutral and legacy cancellation drops are repaired (${passed} assertions)`,
  );} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
