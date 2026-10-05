import { CircuitBreaker } from "./circuit-breaker.ts";
import { HealthTracker } from "./agent-health.ts";
import { FailureAutopsyAnalyzer } from "./failure-autopsy/analyzer.ts";
import { GracefulDegradation } from "./graceful-degradation.ts";
import { RollbackManager } from "./rollback-manager.ts";
import { HealPolicy, MAX_RETRIES } from "./heal-policy.ts";
import type { HealResult } from "../types/plan.types.ts";
import { logger } from "../utils/logger.ts";
import { t } from "../translations.ts";
import type { EventHub } from "./event-hub.ts";
import type { TimerManagerLike } from "../types/timer-types.ts";

interface Issue {
  component?: string;
  taskId?: string;
  error: Error;
}

interface RootCause {
  message: string;
  severity: string;
  category: string;
  suggestion?: string;
}

export class SelfHealEngine {
  private circuitBreaker: CircuitBreaker;
  private healthTracker: HealthTracker;
  private autopsyAnalyzer: FailureAutopsyAnalyzer;
  private gracefulDegradation: GracefulDegradation;
  private rollbackManager: RollbackManager;
  private healPolicy: HealPolicy;

  private memoryTimer: ReturnType<typeof setInterval> | null = null;
  private timers: TimerManagerLike | null = null;

  
  private lastFailureContext: { phase: string; reason: string } | null = null;

  
  private fallbackResolver?: (component: string) => { agent?: string } | null;

  constructor(
    private eventHub?: EventHub,
    circuitBreaker?: CircuitBreaker,
    healthTracker?: HealthTracker,
    healPolicy?: HealPolicy,
    fallbackResolver?: (component: string) => { agent?: string } | null,
    timers?: TimerManagerLike,
  ) {
    this.circuitBreaker = circuitBreaker ?? new CircuitBreaker();
    this.healthTracker = healthTracker ?? new HealthTracker();
    this.autopsyAnalyzer = new FailureAutopsyAnalyzer();
    this.gracefulDegradation = new GracefulDegradation();
    this.rollbackManager = new RollbackManager();
    this.healPolicy = healPolicy ?? new HealPolicy();
    this.fallbackResolver = fallbackResolver;
    this.timers = timers ?? null;
    this.memoryTimer = this.timers
      ? this.timers.setInterval(() => this.checkMemory(), 30000)
      : setInterval(() => this.checkMemory(), 30000);
    this.memoryTimer?.unref?.();
  }

  
  private resolveFallback(component: string): { agent?: string } | null {
    try {
      return this.fallbackResolver ? this.fallbackResolver(component) : null;
    } catch {
      return null;
    }
  }

  analyze(error: Error): RootCause {
    const analyzer = this.autopsyAnalyzer;
    const instance = analyzer.recordFailure(error.message, "self-heal-engine", {
      stackTrace: error.stack,
    });
    const diagnosis = instance ? analyzer.diagnose(instance.id) : null;
    const category = instance?.category ?? "unknown";
    if (this.eventHub) {
      this.eventHub.emit({
        type: "FAILURE_ANALYZED",
        taskId: "",
        rootCause: error.message,
        category,
      });
    }
    return {
      message: error.message,
      severity: "high",
      category,
      suggestion: diagnosis?.rootCause ?? "",
    };
  }

  private checkMemory(): void {
    try {
      const usage = process.memoryUsage();
      const heapMB = usage.heapUsed / 1024 / 1024;
      if (heapMB > 400) {
        logger.warn(`SelfHealEngine: high memory (${Math.round(heapMB)}MB) — consider cleanup`);
        this.eventHub?.emit({
          type: "PERFORMANCE_DEGRADED",
          agent: "self-heal-engine",
          metric: "heapMemoryMB",
          value: heapMB,
        });
      }
    } catch {
      // memory check not available
    }
  }

  async heal(issue: Issue, retryCount = 0): Promise<HealResult> {
    this.checkMemory();
    if (retryCount >= MAX_RETRIES) {
      
      
      const alt = this.resolveFallback(issue.component ?? "unknown")?.agent;
      const fallback = alt ? `@${alt}` : "manual review";
      if (alt) logger.info(`[tawassul] self-heal retries exhausted for ${issue.component} — fallback ${fallback}`);
      return {
        success: false,
        reason: t("sheRetriesExhausted", { max: String(MAX_RETRIES) }),
        action: "escalate",
        fallback,
      };
    }
    const component = issue.component ?? "unknown";
    const cbState = this.circuitBreaker.getState(component);
    if (cbState === "OPEN") {
      return { success: false, reason: t("sheCircuitOpen"), action: "wait", fallback: "escalate" };
    }
    try {
      this.healthTracker.onHandoffCreated(component, "");
      const analysis = this.analyze(issue.error);
      this.lastFailureContext = { phase: component, reason: analysis.message };
      const decision = this.healPolicy.decide(analysis.category, retryCount);

      if (decision.action === "escalate") {
        this.healthTracker.onHandoffFailed(component);
        this.circuitBreaker.recordFailure(component);
        this.gracefulDegradation.recordError(component);
        
        
        const alt = this.resolveFallback(component)?.agent;
        const fallback = alt ? `@${alt}` : "manual review";
        if (alt) logger.info(`[tawassul] self-heal escalated for ${component} — fallback ${fallback}`);
        if (this.eventHub) {
          this.eventHub.emit({
            type: "HEAL_ATTEMPTED",
            taskId: issue.taskId ?? "",
            success: false,
            redirectTo: alt ?? undefined,
          });
        }
        return {
          success: false,
          reason: decision.reason,
          action: "escalate",
          fallback,
        };
      }

      const healed = await this.attemptHeal(issue, analysis.category);
      if (healed) {
        this.healthTracker.onHandoffCompleted(component);
        this.circuitBreaker.recordSuccess(component);
        if (this.eventHub) {
          this.eventHub.emit({ type: "HEAL_ATTEMPTED", taskId: issue.taskId ?? "", success: true });
        }
        return { success: true, reason: decision.reason, action: "continue" };
      }

      this.healthTracker.onHandoffFailed(component);
      this.circuitBreaker.recordFailure(component);
      this.gracefulDegradation.recordError(component);
      if (this.eventHub) {
        this.eventHub.emit({ type: "HEAL_ATTEMPTED", taskId: issue.taskId ?? "", success: false });
      }
      if (decision.action === "retry") {
        return this.heal(issue, retryCount + 1);
      }
      return { success: false, reason: decision.reason, action: "escalate", fallback: "manual review" };
    } catch (e) {
      this.healthTracker.onHandoffFailed(component);
      this.circuitBreaker.recordFailure(component);
      if (this.eventHub) {
        this.eventHub.emit({ type: "HEAL_ATTEMPTED", taskId: issue.taskId ?? "", success: false });
      }
      return { success: false, reason: t("sheError", { msg: (e as Error).message }), action: "escalate" };
    }
  }

  async rollback(sessionId: string, signal?: AbortSignal): Promise<void> {
    
    
    const ctx = this.lastFailureContext;
    const toPhase = ctx?.phase ?? sessionId;
    const reason = ctx?.reason ?? `rollback for session ${sessionId}`;
    if (this.eventHub) {
      this.eventHub.emit({ type: "ROLLBACK_EXECUTED", sessionId, reason });
    }
    this.rollbackManager.rollback(toPhase, reason, signal);
  }

  dispose(): void {
    if (this.memoryTimer) {
      if (this.timers) this.timers.clear(this.memoryTimer);
      else clearInterval(this.memoryTimer);
      this.memoryTimer = null;
    }
    this.circuitBreaker.resetAll();
  }

  isHealthy(agentId: string): boolean {
    const cbState = this.circuitBreaker.getState(agentId);
    const isAutoPaused = this.healthTracker.isAutoPaused(agentId);
    return cbState !== "OPEN" && !isAutoPaused;
  }

  isSystemHealthy(): boolean {
    const allStatuses = this.healthTracker.getAllStatuses();
    const openCount = allStatuses.filter((s) => s.state === "STUCK" || s.state === "AUTO_PAUSED").length;
    return openCount < 3;
  }

  private async attemptHeal(issue: Issue, category: string): Promise<boolean> {
    const component = issue.component ?? "unknown";
    switch (category) {
      case "rate_limited":
        await new Promise((r) => setTimeout(r, 1000));
        return true;
      case "timeout":
        await new Promise((r) => setTimeout(r, 500));
        return true;
      case "tool_error":
        this.rollbackManager.rollback(component, this.lastFailureContext?.reason ?? "tool_error");
        return true;
      default:
        return false;
    }
  }
}
