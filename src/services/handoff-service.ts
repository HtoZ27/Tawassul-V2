import type { TawaOrchestratorContext } from "../core/service-context.ts";
import type { HandoffEntry } from "../context/types.ts";
import type { CircuitBreaker } from "./circuit-breaker.ts";
import { SagaCoordinator } from "./saga-coordinator.ts";
import { effect, type SagaEffect } from "../core/saga-effects.ts";
import { logRuleAdjustments } from "../core/rule-utils.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { logger } from "../utils/logger.ts";
import { clearOwner, clearRunFlags, continuityEnabled, stampOwner } from "./continuity/owner.ts";

const RESUME_UNVERIFIED_MAX = 5;

export function appendResumeRecord(
  ctx: TawaOrchestratorContext,
  handoff: HandoffEntry,
  agent: string,
  reason: string,
): void {
  const resumedBy = normalizeName(agent);
  ctx.recSeq += 1;
  ctx.records.push({
    id: `R-${String(ctx.recSeq).padStart(3, "0")}`,
    timestamp: new Date().toISOString(),
    agent: resumedBy,
    type: "fix",
    title: `Resumed interrupted handoff ${handoff.id}`,
    detail: `Handoff ${handoff.id} (${handoff.from} → ${handoff.to}) was reopened by ${resumedBy} after run state interrupted (${reason}); status is pending and the owner was re-stamped.`,
    severity: "minor",
    provenance: "tool_observed",
  });
  ctx.recordRecordCreated(agent);
}

interface HandoffCompletionResult {
  success: boolean;
  message: string;
  handoff: HandoffEntry | null;
}

type HandoffLookup = HandoffEntry | undefined;

function buildCompletionEffects(
  healthTracker?: { onHandoffCompleted: (agent: string) => void; onHandoffFailed: (agent: string) => void },
  circuitBreaker?: CircuitBreaker,
): SagaEffect<TawaOrchestratorContext>[] {
  return [
    effect(
      "core.handoffStatus",
      (h) => {
        h.status = "completed";
      },
      (h) => {
        h.status = "pending";
      },
    ),
    effect(
      "core.agentErrors",
      (h, ctx) => {
        const nf = normalizeName(h.from);
        const current = ctx.agentErrors[nf] ?? 0;
        if (current > 0) {
          ctx.agentErrors[nf] = current - 1;
          h.senderErrorCleared = true;
        } else {
          h.senderErrorCleared = false;
        }
      },
      (h, ctx) => {
        const nf = normalizeName(h.from);
        if (h.senderErrorCleared) ctx.agentErrors[nf] = (ctx.agentErrors[nf] ?? 0) + 1;
        h.senderErrorCleared = false;
      },
    ),
    effect(
      "core.recordHandoffCompleted",
      (h, ctx) => {
        const to = normalizeName(h.to);
        ctx.ratingOps.recordHandoffCompleted(to);
      },
      (h, ctx) => {
        const to = normalizeName(h.to);
        ctx.ratingOps.recordHandoffDropped(to);
      },
    ),
    effect(
      "healthTracker.onHandoffCompleted",
      (h) => {
        const to = normalizeName(h.to);
        if (healthTracker) healthTracker.onHandoffCompleted(to);
      },
      (h) => {
        const to = normalizeName(h.to);
        if (healthTracker) healthTracker.onHandoffFailed(to);
      },
    ),
    effect(
      "circuitBreaker.recordSuccess",
      (h) => {
        const to = normalizeName(h.to);
        if (circuitBreaker) circuitBreaker.recordSuccess(to);
      },
      (h) => {
        const to = normalizeName(h.to);
        if (circuitBreaker) circuitBreaker.recordFailure(to);
      },
    ),
    effect(
      "trainingEvaluator.markOutcomeByAgent",
      (h, ctx) => {
        const to = normalizeName(h.to);
        if (ctx.trainingEvaluator) ctx.trainingEvaluator.markOutcomeByAgent(to, "success");
      },
      (h, ctx) => {
        const to = normalizeName(h.to);
        if (ctx.trainingEvaluator) ctx.trainingEvaluator.markOutcomeByAgent(to, "failure");
      },
    ),
    effect(
      "statsCollector.recordHandoff",
      (h, ctx) => {
        const to = normalizeName(h.to);
        ctx.statsCollector.recordHandoff(to, true, Date.now() - new Date(h.timestamp || Date.now()).getTime());
      },
      (h, ctx) => {
        const to = normalizeName(h.to);
        ctx.statsCollector.recordHandoff(to, false, 0);
      },
    ),
    effect(
      "gamification.recordAction",
      (h, ctx) => {
        const to = normalizeName(h.to);
        ctx.gamification.recordAction(to, "completedHandoffs");
      },
      (h, ctx) => {
        const to = normalizeName(h.to);
        ctx.gamification.recordAction(to, "failedHandoffs");
      },
    ),
    effect(
      "sharedMemory.addHandoffRecord",
      (h, ctx) => {
        ctx.sharedMemory.addHandoffRecord({
          id: h.id,
          from: normalizeName(h.from),
          to: normalizeName(h.to),
          task: h.task,
          timestamp: new Date().toISOString(),
          success: true,
          duration: 0,
        });
      },
      (h, ctx) => {
        const memory = ctx.sharedMemory.get();
        const idx = memory.handoffHistory.findIndex((r) => r.id === h.id);
        if (idx !== -1) memory.handoffHistory.splice(idx, 1);
      },
    ),
    effect(
      "taskTracker.logHandoffCompletion",
      (h, ctx) => {
        const task = ctx.taskTracker.create(ctx.sessionId || "handoff", normalizeName(h.to), h.task);
        ctx.taskTracker.updateStatus(task.id, "completed", { summary: `Handoff ${h.id} completed` });
      },
      (_h, _ctx) => {},
    ),
    effect(
      "fileLocks.releaseAllForHandoff",
      (h, ctx) => {
        ctx.fileLocks.releaseAllForHandoff(h.id);
      },
      () => {},
    ),
    effect(
      "taskPriority.removeFromQueue",
      (h, ctx) => {
        ctx.taskPriority.removeFromQueue(h.id);
      },
      () => {},
    ),
    effect(
      "conflictLearner.recordOutcome",
      (h, ctx) => {
        const decision = h.decision ?? { action: "allow", reason: "Handoff completed", confidence: 1 };
        ctx.conflictLearner.recordOutcome(
          h.decisionRuleId ?? "COMPLETE",
          decision,
          decision.action === "allow",
          normalizeName(h.to),
        );
        logRuleAdjustments(ctx.conflictLearner);
      },
      (h, ctx) => {
        ctx.conflictLearner.recordOutcome(
          "ROLLBACK",
          { action: "block", reason: "Handoff saga rollback", confidence: 0.5 },
          false,
          normalizeName(h.to),
        );
      },
    ),
    effect(
      "capabilityTracker.updateCapability",
      (h, ctx) => {
        const to = normalizeName(h.to);
        const cap = ctx.config.agentModels?.[to]?.capability || ctx.readAgentMd(to)?.capability;
        if (cap) ctx.capabilityTracker.updateCapability(to, cap, true);
      },
      (h, ctx) => {
        const to = normalizeName(h.to);
        const cap = ctx.config.agentModels?.[to]?.capability || ctx.readAgentMd(to)?.capability;
        if (cap) ctx.capabilityTracker.updateCapability(to, cap, false);
      },
    ),
  ];
}

function buildCancellationEffects(): SagaEffect<TawaOrchestratorContext>[] {
  return [
    effect(
      "core.handoffStatus",
      (h) => {
        h.status = "cancelled";
      },
      (h) => {
        h.status = "pending";
      },
    ),
    effect(
      "fileLocks.releaseAllForHandoff",
      (h, ctx) => {
        ctx.fileLocks.releaseAllForHandoff(h.id);
      },
      () => {},
    ),
    effect(
      "taskPriority.removeFromQueue",
      (h, ctx) => {
        ctx.taskPriority.removeFromQueue(h.id);
      },
      () => {},
    ),
  ];
}

async function runSideEffects(
  effects: SagaEffect<TawaOrchestratorContext>[],
  h: HandoffEntry,
  ctx: TawaOrchestratorContext,
  coordinator?: SagaCoordinator<{ handoff: HandoffEntry; ctx: TawaOrchestratorContext }>,
): Promise<string | null> {
  const saga = coordinator ?? new SagaCoordinator<{ handoff: HandoffEntry; ctx: TawaOrchestratorContext }>();
  const tx = saga.createSaga("handoff-completion", effects, h.id);
  const r = await saga.executeSaga(tx, { handoff: h, ctx });
  return r.success ? null : r.failedStep;
}

function findHandoffOrError(
  handoffs: Map<string, HandoffEntry> | HandoffEntry[],
  handoffId: string,
  allowedStatuses?: Set<string>,
): { handoff: HandoffEntry; error: null } | { handoff: null; error: HandoffCompletionResult } {
  const h: HandoffLookup =
    handoffs instanceof Map ? handoffs.get(handoffId) : handoffs.find((entry) => entry.id === handoffId);
  if (!h) {
    return {
      handoff: null,
      error: { success: false, message: `Handoff ${handoffId} not found`, handoff: null },
    };
  }
  if (allowedStatuses && !allowedStatuses.has(h.status)) {
    return {
      handoff: null,
      error: {
        success: false,
        message: `Handoff ${handoffId} has status "${h.status}" — expected one of: ${[...allowedStatuses].join(", ")}`,
        handoff: h,
      },
    };
  }
  return { handoff: h, error: null };
}

export class HandoffService {
  private _lockChains = new Map<string, Promise<unknown>>();
  private _lockChainAccess = new Map<string, number>();
  private _sagaCoordinator: SagaCoordinator<{ handoff: HandoffEntry; ctx: TawaOrchestratorContext }>;

  get sagaCoordinator(): SagaCoordinator<{ handoff: HandoffEntry; ctx: TawaOrchestratorContext }> {
    return this._sagaCoordinator;
  }

  shouldDrain(agent: string, threshold = 5): boolean {
    const normalized = normalizeName(agent);
    const pendingForAgent = [...this.ctx.handoffs.values()].filter(
      (h) => normalizeName(h.to) === normalized && h.status === "pending",
    );
    return pendingForAgent.length >= threshold;
  }

  async drainAgent(agent: string, alternateAgent: string): Promise<number> {
    const drainer = this.ctx.queueDrainer;
    if (!drainer) return 0;
    if (!drainer.shouldDrain(agent)) return 0;
    const allHandoffs = [...this.ctx.handoffs.values()];
    const effects = drainer.buildDrainEffects(agent, allHandoffs, alternateAgent);
    if (effects.length === 0) return 0;
    const representative = allHandoffs.find(
      (h) => normalizeName(h.to) === normalizeName(agent) && h.status === "pending",
    );
    if (!representative) return 0;
    const failed = await runSideEffects(effects, representative, this.ctx, this._sagaCoordinator);
    if (failed) logger.warn(`[tawassul] drainAgent effects failed at step: ${failed}`);
    return effects.length;
  }

  async resumeInterruptedSagas(): Promise<number> {
    let resumed = 0;
    try {
      const records = await this._sagaCoordinator.listJournalRecords();
      for (const record of records) {
        if (record.state === "COMPLETED" || record.state === "COMPENSATED" || record.state === "FAILED") continue;
        if (!record.taskId || !this.ctx.handoffs.has(record.taskId)) continue;
        const h = this.ctx.handoffs.get(record.taskId)!;
        if (h.status === "completed" || h.status === "cancelled" || h.status === "closed") continue;
        const effects = buildCompletionEffects(this.healthTracker, this.circuitBreaker);
        const result = await this._sagaCoordinator.resumeSaga(
          effects,
          {
            phase: "handoff-completion",
            taskId: h.id,
            remainingTasks: [h.id],
          },
          { handoff: h, ctx: this.ctx },
        );
        if (result.recovered || result.success) {
          clearRunFlags(h);
          await clearOwner(h.id);
          resumed += 1;
          logger.info(`[tawassul] P2.3: resumed interrupted saga for handoff ${h.id}`);
        }
      }
      return resumed;
    } catch (e) {
      logger.warn("[tawassul] P2.3: resumeInterruptedSagas failed:", e);
      return resumed;
    }
  }

  async resumeInterrupted(
    handoffId: string,
    resumedBy: string,
    sessionId = "",
    unverified?: string[],
  ): Promise<HandoffCompletionResult> {
    return this._withLock(handoffId, async (_signal) => {
      if (!continuityEnabled()) {
        return { success: false, message: "Continuity is disabled — resume is unavailable", handoff: null };
      }
      const h = this.ctx.handoffs.get(handoffId);
      if (!h) {
        return { success: false, message: `Handoff ${handoffId} not found`, handoff: null };
      }
      const caller = normalizeName(resumedBy);
      if (caller !== normalizeName(h.from) && caller !== "analyst") {
        return {
          success: false,
          message: `Only ${h.from} or @analyst can resume ${handoffId}`,
          handoff: h,
        };
      }
      if (h.status === "completed" || h.status === "cancelled" || h.status === "closed") {
        return {
          success: false,
          message: `Handoff ${handoffId} is ${h.status} — only pending, accepted, or paused can be resumed`,
          handoff: h,
        };
      }
      if (h.runState === "stale") {
        return {
          success: false,
          message: `Handoff ${handoffId} has a live but stale owner — use rescue instead`,
          handoff: h,
        };
      }
      if (h.runState !== "interrupted") {
        return {
          success: false,
          message: `Handoff ${handoffId} is not interrupted (runState: ${h.runState ?? "none"})`,
          handoff: h,
        };
      }
      const reason = h.interruptedReason ?? "unknown";
      const extra = Array.isArray(unverified)
        ? unverified.filter((item): item is string => typeof item === "string")
        : [];
      clearRunFlags(h);
      await stampOwner(h, sessionId);
      h.status = "pending";
      h.resumedAt = new Date().toISOString();
      if (extra.length > 0) {
        const checkpoint = h.checkpoint ?? { completed: [], remaining: [], filesChanged: [], decisions: [] };
        checkpoint.unverified = [...(checkpoint.unverified ?? []), ...extra].slice(0, RESUME_UNVERIFIED_MAX);
        h.checkpoint = checkpoint;
      }
      appendResumeRecord(this.ctx, h, resumedBy, reason);
      this.ctx.updateLastActive(resumedBy);
      await this.ctx.saveState();
      return { success: true, message: `Handoff ${handoffId} resumed`, handoff: h };
    });
  }

  constructor(
    private ctx: TawaOrchestratorContext,
    private healthTracker?: {
      onHandoffCompleted: (agent: string) => void;
      onHandoffFailed: (agent: string) => void;
      onHandoffCompletionReverted: (agent: string) => void;
      onHandoffFailureReverted?: (agent: string) => void;
    },
    private circuitBreaker?: CircuitBreaker,
  ) {
    this._sagaCoordinator = new SagaCoordinator<{ handoff: HandoffEntry; ctx: TawaOrchestratorContext }>(ctx.persistDir);
  }

  private async _withLock<T>(
    handoffId: string,
    fn: (signal: AbortSignal) => Promise<T>,
    timeoutMs = 30000,
  ): Promise<T> {
    const prev = this._lockChains.get(handoffId) ?? Promise.resolve();
    const abortController = new AbortController();
    const next = prev.then(
      () => fn(abortController.signal),
      (err) => {
        throw err;
      },
    );
    this._lockChains.set(handoffId, next);
    this._lockChainAccess.set(handoffId, Date.now());
    if (this._lockChains.size > 200) {
      const cutoff = Date.now() - 60_000;
      for (const [id, ts] of this._lockChainAccess) {
        if (ts < cutoff && this._lockChains.has(id)) {
          this._lockChains.delete(id);
        }
      }
    }
    try {
      return await Promise.race([
        next,
        new Promise<never>((_, rej) => {
          const t = setTimeout(() => {
            abortController.abort();
            if (this._lockChains.get(handoffId) === next) {
              this._lockChains.delete(handoffId);
              this._lockChainAccess.delete(handoffId);
            }
            rej(new Error(`Handoff ${handoffId} operation timed out after ${timeoutMs}ms`));
          }, timeoutMs);
          t.unref?.();
        }),
      ]);
    } finally {
      if (this._lockChains.get(handoffId) === next) {
        this._lockChains.delete(handoffId);
        this._lockChainAccess.delete(handoffId);
      }
    }
  }

  async completeHandoff(handoffId: string, completedBy: string): Promise<HandoffCompletionResult> {
    return this._withLock(handoffId, async (_signal) => {
      const found = findHandoffOrError(this.ctx.handoffs, handoffId, new Set(["pending", "accepted"]));
      if (found.error) return found.error;
      const h = found.handoff;

      const effects = buildCompletionEffects(this.healthTracker, this.circuitBreaker);
      const failedEffect = await runSideEffects(effects, h, this.ctx, this._sagaCoordinator);

      if (failedEffect) {
        await this.ctx.flushSaves();
        return {
          success: false,
          message: `Handoff ${handoffId} side effect "${failedEffect}" failed — fully rolled back`,
          handoff: h,
        };
      }

      if (h.task.startsWith("🆘 HELP:")) {
        this.ctx.recordHelpRequestFulfilled(completedBy);
      }

      clearRunFlags(h);
      await clearOwner(h.id);
      this.ctx.updateLastActive(completedBy);
      try {
        await this.ctx.flushSaves();
      } catch (e) {
        logger.error("[tawassul] flushSaves failed after completion:", e);
      }

      return {
        success: true,
        message: `Handoff ${handoffId} completed by ${completedBy}`,
        handoff: h,
      };
    });
  }

  async cancelHandoff(handoffId: string, cancelledBy: string): Promise<HandoffCompletionResult> {
    return this._withLock(handoffId, async (_signal) => {
      const found = findHandoffOrError(this.ctx.handoffs, handoffId, new Set(["pending", "accepted"]));
      if (found.error) {
        const existing = this.ctx.handoffs.get(handoffId);
        if (existing?.status === "completed") {
          return { success: false, message: `Handoff ${handoffId} already completed`, handoff: existing };
        }
        if (existing?.status === "cancelled") {
          return { success: false, message: `Handoff ${handoffId} already cancelled`, handoff: existing };
        }
        return found.error;
      }
      const h = found.handoff;

      if (
        normalizeName(cancelledBy) !== normalizeName(h.from) &&
        normalizeName(cancelledBy) !== normalizeName(h.to) &&
        normalizeName(cancelledBy) !== "analyst"
      ) {
        return {
          success: false,
          message: `Handoff ${handoffId} not cancelled — ${cancelledBy} not authorized`,
          handoff: h,
        };
      }

      const effects = buildCancellationEffects();
      const failedEffect = await runSideEffects(effects, h, this.ctx);

      if (failedEffect) {
        try {
          await this.ctx.flushSaves();
        } catch (e) {
          logger.error("[tawassul] flushSaves failed after cancellation rollback:", e);
        }
        return {
          success: false,
          message: `Handoff ${handoffId} cancellation failed at step "${failedEffect}" — fully rolled back`,
          handoff: h,
        };
      }

      clearRunFlags(h);
      await clearOwner(h.id);
      this.ctx.updateLastActive(cancelledBy);
      try {
        await this.ctx.flushSaves();
      } catch (e) {
        logger.error("[tawassul] flushSaves failed after cancellation:", e);
      }

      return {
        success: true,
        message: `Handoff ${handoffId} cancelled`,
        handoff: h,
      };
    });
  }

  async undoHandoff(handoffId: string, undoneBy: string): Promise<HandoffCompletionResult> {
    return this._withLock(handoffId, async (_signal) => {
      const h = this.ctx.handoffs.get(handoffId);
      if (!h) {
        return { success: false, message: `Handoff ${handoffId} not found`, handoff: null };
      }
      if (h.status === "pending") {
        return { success: false, message: `Handoff ${handoffId} is already pending`, handoff: h };
      }
      const actor = normalizeName(undoneBy);
      if (actor !== normalizeName(h.from) && actor !== "analyst") {
        return {
          success: false,
          message: `Handoff ${handoffId} not reverted — ${undoneBy} not authorized`,
          handoff: h,
        };
      }

      const wasCompleted = h.status === "completed";
      const wasRescued = h.rescue === true;
      h.status = "pending";
      if (wasCompleted) {
        const from = normalizeName(h.from);
        if (h.senderErrorCleared) {
          this.ctx.agentErrors[from] = (this.ctx.agentErrors[from] ?? 0) + 1;
        }
        h.senderErrorCleared = false;
        const to = normalizeName(h.to);
        this.ctx.ratingOps.revertHandoffCompleted(to);
        if (this.healthTracker) this.healthTracker.onHandoffCompletionReverted(to);
        const cap = this.ctx.config.agentModels?.[to]?.capability || this.ctx.readAgentMd(to)?.capability;
        if (cap) this.ctx.capabilityTracker.revertCapabilityUpdate(to, cap, true);
        this.ctx.statsCollector.revertHandoff(to, true);
        this.ctx.gamification.revertAction(to, "completedHandoffs");
        const memory = this.ctx.sharedMemory.get();
        const idx = memory.handoffHistory.findIndex((r) => r.id === h.id);
        if (idx !== -1) memory.handoffHistory.splice(idx, 1);
      }
      if (wasRescued) {
        h.rescue = false;
        const to = normalizeName(h.to);
        this.healthTracker?.onHandoffFailureReverted?.(to);
      }
      await this.ctx.fileLocks.releaseAllForHandoff(h.id);
      this.ctx.taskPriority.removeFromQueue(h.id);
      clearRunFlags(h);
      await clearOwner(h.id);
      this.ctx.updateLastActive(undoneBy);
      try {
        await this.ctx.flushSaves();
      } catch (e) {
        logger.error("[tawassul] flushSaves failed after undo:", e);
      }

      return {
        success: true,
        message: `Handoff ${handoffId} reverted to pending`,
        handoff: h,
      };
    });
  }

  async closeForRescue(handoffId: string, rescuedBy: string): Promise<HandoffCompletionResult> {
    return this._withLock(handoffId, async (_signal) => {
      const h = this.ctx.handoffs.get(handoffId);
      if (!h) {
        return { success: false, message: `Handoff ${handoffId} not found`, handoff: null };
      }
      if (h.status === "completed") {
        return { success: false, message: `Handoff ${handoffId} already completed`, handoff: h };
      }
      if (h.status !== "accepted" && h.status !== "paused") {
        return {
          success: false,
          message: `Handoff ${handoffId} is ${h.status} — only an accepted or paused handoff can be rescued`,
          handoff: h,
        };
      }
      h.status = "closed";
      h.rescue = true;
      const to = normalizeName(h.to);
      if (this.healthTracker) this.healthTracker.onHandoffFailed(to);
      await this.ctx.fileLocks.releaseAllForHandoff(h.id);
      this.ctx.taskPriority.removeFromQueue(h.id);
      clearRunFlags(h);
      await clearOwner(h.id);
      this.ctx.updateLastActive(rescuedBy);
      try {
        await this.ctx.flushSaves();
      } catch (e) {
        logger.error("[tawassul] flushSaves failed after rescue close:", e);
      }
      return {
        success: true,
        message: `Handoff ${handoffId} closed for rescue`,
        handoff: h,
      };
    });
  }

  async redirectHandoff(handoffId: string, newTo: string, redirectedBy: string): Promise<HandoffCompletionResult> {
    return this._withLock(handoffId, async (_signal) => {
      const targetAgent = normalizeName(newTo);
      const callerAgent = normalizeName(redirectedBy);
      if (targetAgent === "tawa" && callerAgent !== "tawa") {
        return { success: false, message: `Redirecting to @tawa is forbidden.`, handoff: null };
      }
      const found = findHandoffOrError(this.ctx.handoffs, handoffId, new Set(["pending"]));
      if (found.error) {
        const existing = this.ctx.handoffs.get(handoffId);
        if (existing?.status === "completed") {
          return { success: false, message: `Handoff ${handoffId} already completed`, handoff: existing };
        }
        return found.error;
      }
      const h = found.handoff;
      const oldTo = h.to;

      const redirectEffects: SagaEffect<TawaOrchestratorContext>[] = [
        effect(
          "redirect.state",
          () => {
            h.to = targetAgent;
          },
          () => {
            h.to = oldTo;
          },
        ),
        effect(
          "redirect.conflictLearner",
          () => {
            this.ctx.conflictLearner.recordOutcome(
              "REDIRECT",
              { action: "reroute", reason: `Handoff redirected: ${oldTo} → ${newTo}`, confidence: 0.7 },
              true,
              redirectedBy,
            );
            logRuleAdjustments(this.ctx.conflictLearner);
          },
          () => {},
        ),
        effect(
          "redirect.lastActive",
          () => this.ctx.updateLastActive(redirectedBy),
          () => {},
        ),
      ];
      const failedEffect = await runSideEffects(redirectEffects, h, this.ctx);

      if (failedEffect) {
        try {
          await this.ctx.flushSaves();
        } catch (e) {
          logger.error("[tawassul] flushSaves failed after redirect rollback:", e);
        }
        return {
          success: false,
          message: `Handoff ${handoffId} redirect failed at step "${failedEffect}" — fully rolled back`,
          handoff: h,
        };
      }

      try {
        await this.ctx.flushSaves();
      } catch (e) {
        logger.error("[tawassul] flushSaves failed after redirect:", e);
      }

      return {
        success: true,
        message: `Handoff ${handoffId} redirected: ${oldTo} → ${newTo}`,
        handoff: h,
      };
    });
  }
}