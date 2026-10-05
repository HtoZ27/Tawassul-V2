
import type { TawassulContext } from "../context-class.ts";
import type { EventHub, TawassulEvent } from "../services/event-hub.ts";
import type { CircuitBreaker } from "../services/circuit-breaker.ts";
import type { HealthTracker } from "../services/agent-health.ts";
import type { PredictiveRouter } from "../features/predictive-router.ts";
import type { HandoffLedger } from "../services/handoff-ledger.ts";
import crypto from "node:crypto";
import { logger } from "../utils/logger.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { resolveFallbackAgent } from "../services/proxy-fallback-chains.ts";
import type { TrustScoreCalculator } from "../services/trust-score/calculator.ts";
import { estimateTokensByFactor, TOKENS_PER_CHAR_COMPRESS } from "../services/token-estimation.ts";
import type { CostTransparencyTracker } from "../services/cost-transparency/tracker.ts";
import { UNATTRIBUTED_MODEL_ID } from "../services/cost-transparency/types.ts";
import type { CollectiveMemoryRouterIntegration } from "../services/collective-memory/router-integration.ts";
import type { CollectiveMemoryStoreImpl } from "../services/collective-memory/store.ts";
import { extractFacts, factToLearning } from "../services/reflection-pass.ts";
import type { SelfHealEngine } from "../services/self-heal-engine.ts";
import { withTimeout } from "../utils/with-timeout.ts";

const lastCostWarn = { message: "", at: 0 };
function warnCostOnce(message: string): void {
  const now = Date.now();
  if (lastCostWarn.message === message && now - lastCostWarn.at < 5 * 60_000) return;
  lastCostWarn.message = message;
  lastCostWarn.at = now;
  logger.warn(`[tawassul] cost-transparency: ${message}`);
}

export interface CoreEventIntegrationDeps {
  tawaCtx: TawassulContext;
  eventHub: EventHub;
  circuitBreaker: CircuitBreaker;
  healthTracker: HealthTracker;
  predictiveRouter: PredictiveRouter;
  handoffLedger: HandoffLedger;
  trustScore: TrustScoreCalculator;
  costTransparency: CostTransparencyTracker;
  memoryRoutingIntegration: CollectiveMemoryRouterIntegration | null;
  collectiveMemory: CollectiveMemoryStoreImpl;
  isInnovationOn: (name: string) => boolean;
  selfHealEngine?: SelfHealEngine;
}


export function registerCoreEventIntegrations(deps: CoreEventIntegrationDeps): {
  stop: () => void;
} {
  const {
    tawaCtx,
    eventHub,
    circuitBreaker,
    healthTracker,
    predictiveRouter,
    handoffLedger,
    trustScore,
    costTransparency,
    memoryRoutingIntegration,
    collectiveMemory,
    isInnovationOn,
    selfHealEngine,
  } = deps;

  const MAX_HEAL_ATTEMPTS = 5;
  const healCounts = new Map<string, number>();

  
  const redirectAfterHealExhausted = (agent: string): void => {
    try {
      const alt = resolveFallbackAgent(agent, {
        availableAgents: tawaCtx.getAgents(),
        agentModelMap: tawaCtx.agentModelMap,
      });
      if (!alt) {
        logger.warn(`[tawassul] self-heal for ${agent} exhausted — no live alternate agent for its role`);
        return;
      }
      const pendingIds = [...tawaCtx.handoffs.values()]
        .filter((h) => normalizeName(h.to) === normalizeName(agent) && h.status === "pending")
        .map((h) => h.id);
      for (const id of pendingIds) {
        void tawaCtx.handoffService?.redirectHandoff(id, alt, "self-heal").catch(() => {
          // redirect is best-effort — never break the failure pipeline
        });
      }
      logger.info(
        `[tawassul] self-heal for ${agent} exhausted — redirecting ${pendingIds.length} pending handoff(s) to ${alt}`,
      );
    } catch (e) {
      logger.warn(
        `[tawassul] self-redirect after heal exhaustion failed for ${agent}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  const onAgentFailed = (e: TawassulEvent) => {
    if (e.type !== "AGENT_FAILED") return;
    circuitBreaker.recordFailure(e.agent);
    healthTracker.onHandoffFailed(e.agent);
    
    const handoffTaskFailed =
      [...tawaCtx.handoffs.values()].reverse().find((h) => normalizeName(h.to) === normalizeName(e.agent))?.task ??
      (e as { task?: string }).task ??
      "unknown";
    predictiveRouter.recordOutcome(e.agent, handoffTaskFailed, false);
    memoryRoutingIntegration?.recordRoutingOutcome(e.agent, false, handoffTaskFailed);
    handoffLedger.append({
      type: "handoff_failed",
      handoffId: "event",
      from: "",
      to: e.agent,
      task: "",
      metadata: { event: e },
    });
    
    if (selfHealEngine) {
      const agentKey = normalizeName(e.agent);
      const n = (healCounts.get(agentKey) ?? 0) + 1;
      if (n <= MAX_HEAL_ATTEMPTS) {
        healCounts.set(agentKey, n);
        withTimeout(
          (_signal) =>
            selfHealEngine.heal({
              component: e.agent,
              taskId: (e as { taskId?: string }).taskId ?? "",
              error: new Error("AGENT_FAILED"),
            }),
          { timeoutMs: 10_000 },
        )
          .then((r) => {
            if (r.success) healCounts.delete(agentKey);
          })
          .catch(() => {
            // heal is best-effort — never let it break the failure pipeline
          });
      } else {
        
        
        
        
        redirectAfterHealExhausted(e.agent);
      }
    }
    
    if (isInnovationOn("trustScore")) {
      const hStatus = healthTracker.getStatus(e.agent);
      const completed = hStatus?.completedCount ?? 0;
      const failed = hStatus?.failedCount ?? 0;
      const total = completed + failed;
      const successRate = total > 0 ? completed / total : 0.3;
      const realDuration = (e as { durationMs?: number }).durationMs;
      const outputLenFail = (e as { outputLength?: number }).outputLength ?? 0;
      const qualityFail = outputLenFail > 0 ? Math.min(0.5, 0.2 + Math.min(0.3, outputLenFail / 5000)) : 0.25;
      trustScore.recordTaskOutcome(e.agent, {
        success: false,
        successRate,
        avgResponseTimeMs: typeof realDuration === "number" ? realDuration : 5000,
        avgOutputQuality: qualityFail,
      });
      trustScore.evaluate(e.agent, e.agent, {
        successRate,
        avgResponseTimeMs: typeof realDuration === "number" ? realDuration : 5000,
        completedTasks: total,
        errorCount: failed,
        avgOutputQuality: qualityFail,
        helpRequests: 1,
        rollbackCount: 1,
        memoryHits: 0,
        memoryMisses: 1,
      });
    }
  };

  const onAgentSuccess = (e: TawassulEvent) => {
    if (e.type !== "AGENT_SUCCESS") return;
    healCounts.delete(normalizeName(e.agent));
    const wasOpen = circuitBreaker.getState(e.agent) === "OPEN";
    circuitBreaker.recordSuccess(e.agent);
    healthTracker.onHandoffCompleted(e.agent);
    
    const handoffTaskSuccess =
      [...tawaCtx.handoffs.values()].reverse().find((h) => normalizeName(h.to) === normalizeName(e.agent))?.task ??
      (e as { task?: string }).task ??
      "unknown";
    predictiveRouter.recordOutcome(e.agent, handoffTaskSuccess, true);
    memoryRoutingIntegration?.recordRoutingOutcome(e.agent, true, handoffTaskSuccess);
    if (wasOpen) {
      eventHub.emit({ type: "CIRCUIT_CLOSED", component: e.agent });
    }
    
    if (isInnovationOn("trustScore")) {
      const hStatus = healthTracker.getStatus(e.agent);
      const completed = hStatus?.completedCount ?? 0;
      const failed = hStatus?.failedCount ?? 0;
      const total = completed + failed;
      const successRate = total > 0 ? completed / total : 0.9;
      const realDuration = (e as { durationMs?: number }).durationMs;
      const outputLen = (e as { outputLength?: number }).outputLength ?? 0;
      
      const qualityFromOutput = outputLen > 0 ? Math.min(0.95, 0.5 + Math.min(0.35, outputLen / 5000)) : 0.85;
      trustScore.recordTaskOutcome(e.agent, {
        success: true,
        successRate,
        avgResponseTimeMs: typeof realDuration === "number" ? realDuration : 1000,
        avgOutputQuality: qualityFromOutput,
      });
      trustScore.evaluate(e.agent, e.agent, {
        successRate,
        avgResponseTimeMs: typeof realDuration === "number" ? realDuration : 1000,
        completedTasks: total,
        errorCount: failed,
        avgOutputQuality: qualityFromOutput,
        helpRequests: 0,
        rollbackCount: 0,
        memoryHits: 1,
        memoryMisses: 0,
      });
    }
    
    
    
    
    if (isInnovationOn("costTransparency")) {
      try {
        const outputTokens =
          e.outputLength !== undefined && e.outputLength > 0
            ? Math.max(1, estimateTokensByFactor(e.outputLength, TOKENS_PER_CHAR_COMPRESS))
            : 200;
        const inputTokens = Math.max(1, Math.round(outputTokens * 1.5));
        costTransparency.recordOperation(UNATTRIBUTED_MODEL_ID, inputTokens, outputTokens, {
          task: `agent:${e.agent}`,
          agentId: e.agent,
          success: true,
          estimated: true,
          ...(e.durationMs !== undefined ? { durationMs: e.durationMs } : {}),
        });
      } catch {
        warnCostOnce("pricing catalog miss on cost record - numbers are output-length heuristics");
      }
    }
    
    if (!tawaCtx.userIntervened) {
      const pending = [...tawaCtx.handoffs.values()].filter(
        (h) => normalizeName(h.to) === normalizeName(e.agent) && h.status === "pending",
      );
      const next = pending[0];
      if (next) {
        tawaCtx.timerManager.setTimeout(() => {
          eventHub.emit({ type: "TASK_STARTED", agent: e.agent, taskId: next.id });
        }, 500);
      }
    }
  };

  const onToolOutputQuarantined = (e: TawassulEvent) => {
    if (e.type !== "TOOL_OUTPUT_QUARANTINED") return;
    try {
      
      collectiveMemory.addMemory({
        patternId: crypto.randomUUID(),
        content: JSON.stringify({
          tool: e.tool,
          agent: e.agent,
          patterns: e.patterns,
          snippet: e.snippet,
        }),
        source: "agent_learning",
        provenance: "tool_observed",
        confidence: 0.1,
        tags: ["quarantine", "tool_output", e.tool],
        classification: "private",
      });
      if (isInnovationOn("collectiveMemory")) {
        collectiveMemory.persist().catch(() => {});
      }
    } catch {
      // quarantine record is best-effort — never let it break the pipeline
    }
  };

  const onExecutionFinished = (e: TawassulEvent) => {
    if (e.type !== "EXECUTION_FINISHED") return;
    try {
      
      const status = e.status === "success" ? "success" : e.status === "partial" ? "partial" : "failed";
      const facts = extractFacts({ taskId: e.taskId, subtasks: [], status });
      for (const fact of facts) {
        const learning = factToLearning(fact);
        tawaCtx.sharedMemory.addLearning({ ...learning, tags: [...learning.tags, e.taskId] });
      }
      
      try {
        collectiveMemory.recordExecution(e.taskId, {
          taskId: e.taskId,
          subtasks: [],
          results: [],
          startTime: 0,
          endTime: 0,
          status,
        });
      } catch {
        // recordExecution is best-effort — never let it break reflection
      }
      if (isInnovationOn("collectiveMemory")) {
        collectiveMemory.persist().catch(() => {});
      }
      eventHub.emit({
        type: "CHAIN_REFLECTED",
        chainId: (e as { chain?: { chainId?: string } }).chain?.chainId ?? e.taskId,
        taskId: e.taskId,
        facts,
        chain: (e as { chain?: import("../services/chain-ctx.ts").ChainCtx }).chain,
      });
    } catch {
      // reflection is best-effort — never let it break the pipeline
    }
  };

  const onSaveConflictDetected = (e: TawassulEvent) => {
    if (e.type !== "SAVE_CONFLICT_DETECTED") return;
    try {
      logger.warn(
        `[tawassul] SAVE_CONFLICT_DETECTED: attempt=${e.payload.attempt} session=${e.payload.sessionId} ` +
          `baseRev=${e.payload.baseRevision} diskRev=${e.payload.currentRevision} outcome=${e.payload.outcome}`,
      );
    } catch {
      // logging is best-effort
    }
  };

  tawaCtx.registerEventHubListener("AGENT_FAILED", onAgentFailed);
  tawaCtx.registerEventHubListener("AGENT_SUCCESS", onAgentSuccess);
  tawaCtx.registerEventHubListener("TOOL_OUTPUT_QUARANTINED", onToolOutputQuarantined);
  tawaCtx.registerEventHubListener("EXECUTION_FINISHED", onExecutionFinished);
  tawaCtx.registerEventHubListener("SAVE_CONFLICT_DETECTED", onSaveConflictDetected);

  return {
    stop: () => {
      eventHub.off("AGENT_FAILED", onAgentFailed as (...args: unknown[]) => void);
      eventHub.off("AGENT_SUCCESS", onAgentSuccess as (...args: unknown[]) => void);
      eventHub.off("TOOL_OUTPUT_QUARANTINED", onToolOutputQuarantined as (...args: unknown[]) => void);
      eventHub.off("EXECUTION_FINISHED", onExecutionFinished as (...args: unknown[]) => void);
      eventHub.off("SAVE_CONFLICT_DETECTED", onSaveConflictDetected as (...args: unknown[]) => void);
    },
  };
}
