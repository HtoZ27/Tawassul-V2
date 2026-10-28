import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TawassulContext } from "../src/context-class.ts";
import { HandoffService } from "../src/services/handoff-service.ts";
import { HealthTracker } from "../src/services/agent-health.ts";
import { CircuitBreaker } from "../src/services/circuit-breaker.ts";
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
const work = mkdtempSync(join(tmpdir(), "tawassul-handoff-undo-"));

function makeHandoff(id: string, from: string, to: string): HandoffEntry {
  return {
    id,
    from,
    to,
    task: `probe ${id}`,
    context: `the sender completes and reverts ${id} deliberately`,
    files: [],
    timestamp: new Date().toISOString(),
    status: "pending",
  };
}

async function main(): Promise<void> {
  const dir = join(work, "project");
  mkdirSync(join(dir, ".opencode", "agents"), { recursive: true });
  copyFileSync(join(repo, ".opencode", "agents", "dev.md"), join(dir, ".opencode", "agents", "dev.md"));
  const ctx = new TawassulContext(dir);
  ctx.ensureConfig();
  const healthTracker = new HealthTracker();
  const circuitBreaker = new CircuitBreaker();
  const service = new HandoffService(ctx, healthTracker, circuitBreaker);
  try {
    const first = makeHandoff("H-101", "@tawa", "dev");
    ctx.handoffs.set(first.id, first);
    ctx.hoffSeq = 101;
    ctx.agentErrors["tawa"] = 2;
    healthTracker.onHandoffCreated("dev", first.id);

    const completed = await service.completeHandoff(first.id, "dev");
    assert(completed.success, "the recipient completes a pending handoff");
    assert(first.status === "completed", "the handoff is recorded as completed");
    assert(ctx.agentErrors["tawa"] === 1, "completion clears one sender error");
    assert(
      ctx.ratingManager.agentRatings["dev"]?.handoffsCompletedAsRecipient === 1,
      "completion credits the recipient rating",
    );
    assert(healthTracker.getStatus("dev")?.completedCount === 1, "completion credits the recipient health count");
    assert(
      ctx.capabilityTracker.getCapabilities("dev").includes("implementation"),
      "completion records the recipient capability",
    );
    assert(
      ctx.capabilityTracker.getSuccessRate("dev", "implementation") > 0.5,
      "completion raises the recipient capability score",
    );
    assert(
      ctx.sharedMemory.get().handoffHistory.some((r) => r.id === first.id),
      "completion records the handoff in shared memory",
    );
    assert(
      ctx.statsCollector.getAgentStats("dev")?.handoffsCompleted === 1,
      "completion credits the recipient team stats",
    );
    assert(
      ctx.gamification.getMetrics("dev")?.completedHandoffs === 1,
      "completion credits the recipient gamification count",
    );
    const learningsAfterCompletion = ctx.sharedMemory.get().learnings.length;

    const undone = await service.undoHandoff(first.id, "@tawa");
    assert(undone.success, "the sender reverts the completed handoff");
    assert(first.status === "pending", "the handoff is pending again");
    assert(ctx.agentErrors["tawa"] === 2, "undo restores the sender error instead of clearing a second one");
    assert(
      ctx.ratingManager.agentRatings["dev"]?.handoffsCompletedAsRecipient === 0,
      "undo removes the completion credit from the recipient rating",
    );
    assert(healthTracker.getStatus("dev")?.completedCount === 0, "undo removes the recipient health credit");
    assert(
      ctx.capabilityTracker.toJSON().every((c) => c.attempts["implementation"] === 0),
      "undo removes the capability attempt",
    );
    assert(
      Math.abs(ctx.capabilityTracker.getSuccessRate("dev", "implementation") - 0.5) < 1e-9,
      "undo restores the capability score",
    );
    assert(
      !ctx.sharedMemory.get().handoffHistory.some((r) => r.id === first.id),
      "undo removes the shared-memory handoff record",
    );
    assert(
      ctx.statsCollector.getAgentStats("dev")?.handoffsCompleted === 0,
      "undo removes the completion credit from the recipient team stats",
    );
    assert(
      ctx.gamification.getMetrics("dev")?.completedHandoffs === 0,
      "undo removes the completion credit from the recipient gamification count",
    );
    assert(
      ctx.sharedMemory.get().learnings.length === learningsAfterCompletion,
      "undo adds no conflict-learning outcome",
    );

    const second = await service.completeHandoff(first.id, "dev");
    assert(second.success && first.status === "completed", "a reverted handoff can be completed again");
    assert(ctx.agentErrors["tawa"] === 1, "the second completion clears one sender error again");
    const secondUndo = await service.undoHandoff(first.id, "@tawa");
    assert(secondUndo.success && first.status === "pending", "the second completion can be reverted again");
    assert(ctx.agentErrors["tawa"] === 2, "the second undo restores the sender error exactly once");
    assert(
      ctx.ratingManager.agentRatings["dev"]?.handoffsCompletedAsRecipient === 0,
      "the second undo leaves the rating at zero, not negative",
    );

    const cancelled = makeHandoff("H-102", "@tawa", "dev");
    ctx.handoffs.set(cancelled.id, cancelled);
    const cancelledResult = await service.cancelHandoff(cancelled.id, "@tawa");
    assert(cancelledResult.success && cancelled.status === "cancelled", "the sender cancels a second handoff");
    const reopened = await service.undoHandoff(cancelled.id, "@tawa");
    assert(reopened.success && cancelled.status === "pending", "undo reopens a cancelled handoff");
    assert(ctx.agentErrors["tawa"] === 2, "reopening a cancelled handoff does not touch the sender error");

    const guarded = makeHandoff("H-103", "@tawa", "dev");
    ctx.handoffs.set(guarded.id, guarded);
    const guardedComplete = await service.completeHandoff(guarded.id, "dev");
    assert(guardedComplete.success, "a third handoff completes for the authorization probe");
    const ratingBefore = ctx.ratingManager.agentRatings["dev"]?.handoffsCompletedAsRecipient;
    const refused = await service.undoHandoff(guarded.id, "dev");
    assert(!refused.success, "the recipient cannot revert the sender's handoff");
    assert(guarded.status === "completed", "a refused undo leaves the status untouched");
    assert(
      ctx.ratingManager.agentRatings["dev"]?.handoffsCompletedAsRecipient === ratingBefore,
      "a refused undo leaves the completion credit untouched",
    );
    const cleared = await service.undoHandoff(guarded.id, "@analyst");
    assert(cleared.success && guarded.status === "pending", "@analyst can revert a completed handoff");
    assert(
      (ctx.ratingManager.agentRatings["dev"]?.handoffsCompletedAsRecipient ?? 0) === 0,
      "the analyst revert removes the last completion credit",
    );

    const clean = makeHandoff("H-104", "reviewer", "dev");
    ctx.handoffs.set(clean.id, clean);
    ctx.agentErrors["reviewer"] = 0;
    const cleanComplete = await service.completeHandoff(clean.id, "dev");
    assert(cleanComplete.success, "a handoff from a clean sender completes");
    assert((ctx.agentErrors["reviewer"] ?? 0) === 0, "completion leaves a clean sender at zero");
    const cleanUndo = await service.undoHandoff(clean.id, "reviewer");
    assert(cleanUndo.success && clean.status === "pending", "a clean sender can revert the completion");
    assert((ctx.agentErrors["reviewer"] ?? 0) === 0, "undo invents no phantom sender error");

    const rescued = makeHandoff("H-105", "@tawa", "dev");
    ctx.handoffs.set(rescued.id, rescued);
    const failedBefore = healthTracker.getStatus("dev")?.failedCount ?? 0;
    rescued.status = "closed";
    rescued.rescue = true;
    healthTracker.onHandoffFailed("dev");
    assert(
      (healthTracker.getStatus("dev")?.failedCount ?? 0) === failedBefore + 1,
      "a rescued handoff charges the recipient failure",
    );
    const rescuedUndo = await service.undoHandoff(rescued.id, "@tawa");
    assert(rescuedUndo.success && String(rescued.status) === "pending", "undo reopens a rescued handoff");
    assert(!rescued.rescue, "undo clears the rescue marker");
    assert(
      (healthTracker.getStatus("dev")?.failedCount ?? 0) === failedBefore,
      "undo removes the rescued recipient failure",
    );

    console.log(`PROOF PASS: handoff undo reverses completion credits and restores the sender error (${passed} assertions)`);
  } finally {
    await ctx.lifecycleManager.destroy();
  }
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
