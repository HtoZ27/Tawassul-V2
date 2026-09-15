import type { TawaOrchestratorContext } from "../core/service-context.ts";
import { access, rename } from "node:fs/promises";
import { AutoSaveManager } from "./auto-save-manager.ts";
import { StatePersistence } from "./state-persistence.ts";
import { FeatureIndex } from "./feature-index.ts";
import { drainStructuralAnalyses, drainTaskTimeouts } from "./lifecycle-drain.ts";
import { resetBackgroundCoordinator } from "./background-coordinator/coordinator.ts";
import { resetCollectiveMemoryStore } from "./collective-memory/store.ts";
import { resetTrustScoreCalculator } from "./trust-score/calculator.ts";
import { resetFailureAutopsyAnalyzer } from "./failure-autopsy/analyzer.ts";
import { resetCostTransparencyTracker } from "./cost-transparency/tracker.ts";
import { resetSpecDrivenManager } from "./spec-driven/manager.ts";
import { resetStaleDetector } from "./stale-detector/index.ts";
import { resetImageRouter } from "./image-router/index.ts";
import { flushAllPersists } from "./persist-utils.ts";
import { isIsolationActiveSync, isForeignKeyTargetSync } from "./isolation.ts";
import { logger } from "../utils/logger.ts";

export class LifecycleController {
  private autoSaveManager: AutoSaveManager;
  private cleanupCallbacks: Array<() => void> = [];
  private destroyed = false;

  constructor(
    private ctx: TawaOrchestratorContext,
    private persistence: StatePersistence,
  ) {
    this.autoSaveManager = new AutoSaveManager(() => this.persistence.doSave(), ctx.timerManager);
  }

  addCleanupCallback(cb: () => void): void {
    if (this.persistence.isDisposing()) return;
    this.cleanupCallbacks.push(cb);
  }

  markDisposing(): void {
    this.persistence.markDisposing();
    this.autoSaveManager.dispose();
    if (this.persistence.saveTimeout) {
      clearTimeout(this.persistence.saveTimeout);
      this.persistence.saveTimeout = null;
    }
  }

  async init(): Promise<void> {
    const { mark, measure } = await import("../utils/perf.ts");
    mark("lifecycle:init:start");
    mark("lifecycle:loadState:start");
    await this.persistence.loadStateAsync();
    mark("lifecycle:loadState:end");
    measure("lifecycle:loadState:start", "lifecycle:loadState:end", "  loadStateAsync");
    mark("lifecycle:ensureMds:start");
    await this.ctx.agentManager.ensureDefaultAgentMds();
    mark("lifecycle:ensureMds:end");
    measure("lifecycle:ensureMds:start", "lifecycle:ensureMds:end", "  ensureDefaultAgentMds");
    await this.ctx.sessionManager.start();
    this.autoSaveManager.start();
    this.ctx.metricsCollector.startPeriodicSave(this.ctx.timerManager);
  }

  clearAllState(): string {
    this.autoSaveManager.dispose();
    const counts = {
      handoffs: this.ctx.handoffs.size,
      records: this.ctx.records.length,
      agentErrors: Object.keys(this.ctx.errorManager.agentErrors).length,
      agentRatings: Object.keys(this.ctx.ratingManager.agentRatings).length,
      dynamicAgents: this.ctx.agentManager.dynamicAgents.length,
    };
    this.ctx.handoffs.clear();
    this.ctx.records.length = 0;
    this.ctx.recSeq = 0;
    this.ctx.hoffSeq = 0;
    this.ctx.errorManager.clearErrors();
    this.ctx.ratingManager.agentRatings = {};
    this.ctx.agentManager.dynamicAgents.length = 0;
    this.ctx.pauseState = null;
    this.ctx.seenAgents.clear();
    this.ctx.modelManager.agentModelMap = {};
    this.ctx.trainingEvaluator.reset();
    this.ctx.pipelineManager.reset();
    try {
      this.ctx.discussionManager.reset();
    } catch (e) {
      logger.debug("discussionManager.reset failed:", e);
    }
    try {
      this.ctx.discussionManager.getEvidenceManager()?.reset();
    } catch (e) {
      logger.debug("evidenceManager.reset failed:", e);
    }
    try {
      if (this.ctx.sharedMemory) {
        const sm = this.ctx.sharedMemory.get();
        sm.decisions = [];
        sm.learnings = [];
        sm.warnings = [];
        sm.handoffHistory = [];
        sm.agentContext = {};
        sm.fileContext = {};
      }
    } catch (e) {
      logger.debug("sharedMemory reset failed:", e);
    }
    try {
      if (this.ctx.featureIndex) {
        this.ctx.featureIndex = new FeatureIndex();
      }
    } catch (e) {
      logger.debug("featureIndex reset failed:", e);
    }
    this.ctx.modelManager.flushPrefsSave();
    this.persistence.saveState();
    return [
      "🧹 **Panic Reset Complete**",
      "",
      "All state was cleared successfully:",
      `- ${counts.handoffs} handoffs`,
      `- ${counts.records} records`,
      `- ${counts.agentErrors} agent error entries`,
      `- ${counts.agentRatings} agent rating entries`,
      `- ${counts.dynamicAgents} dynamic agents`,
      "",
      "You can start fresh.",
    ].join("\n");
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.autoSaveManager.dispose();
    try {
      this.ctx.discussionManager.flushSave();
    } catch (e) {
      logger.debug("destroy: flushSave threw:", e);
    }
    try {
      await this.ctx.modelManager.flushPrefsSave();
    } catch (e) {
      logger.debug("destroy: flushPrefsSave threw:", e);
    }
    try {
      await this.persistence.flushSaves();
    } catch (e) {
      logger.warn("destroy: flushSaves failed:", e);
    }
    try {
      await drainStructuralAnalyses(2000);
    } catch (e) {
      logger.debug("destroy: drainStructuralAnalyses failed:", e);
    }
    try {
      drainTaskTimeouts();
    } catch (e) {
      logger.debug("destroy: drainTaskTimeouts failed:", e);
    }
    try {
      this.ctx.agentAvailability?.dispose?.();
    } catch (e) {
      logger.debug("destroy: agentAvailability.dispose failed:", e);
    }
    try {
      resetBackgroundCoordinator();
    } catch (e) {
      logger.debug("destroy: resetBackgroundCoordinator failed:", e);
    }
    try {
      resetStaleDetector();
    } catch (e) {
      logger.debug("destroy: resetStaleDetector failed:", e);
    }
    try {
      resetImageRouter();
    } catch (e) {
      logger.debug("destroy: resetImageRouter failed:", e);
    }
    try {
      resetCollectiveMemoryStore();
    } catch (e) {
      logger.debug("destroy: resetCollectiveMemoryStore failed:", e);
    }
    try {
      resetTrustScoreCalculator();
    } catch (e) {
      logger.debug("destroy: resetTrustScoreCalculator failed:", e);
    }
    try {
      resetFailureAutopsyAnalyzer();
    } catch (e) {
      logger.debug("destroy: resetFailureAutopsyAnalyzer failed:", e);
    }
    try {
      resetCostTransparencyTracker();
    } catch (e) {
      logger.debug("destroy: resetCostTransparencyTracker failed:", e);
    }
    try {
      resetSpecDrivenManager();
    } catch (e) {
      logger.debug("destroy: resetSpecDrivenManager failed:", e);
    }
    try {
      await flushAllPersists();
    } catch (e) {
      logger.debug("destroy: flushAllPersists failed:", e);
    }
    this.markDisposing();
    try {
      const allHandoffs = [...this.ctx.handoffs.values()];
      const pending = allHandoffs.filter((h) => h.status === "pending").length;
      const active = allHandoffs.filter((h) => h.status === "accepted").length;
      if (pending > 0 || active > 0) {
        logger.warn(`dispose: ${pending} pending, ${active} active handoffs`);
      }
    } catch (e) {
      logger.debug("destroy: handoff count failed:", e);
    }
    try {
      this.ctx.ratingManager.detectDroppedHandoffs([...this.ctx.handoffs.values()]);
    } catch (e) {
      logger.debug("destroy: detectDroppedHandoffs failed:", e);
    }
    try {
      const fp = this.ctx.statePath();
      if (!isIsolationActiveSync() && !isForeignKeyTargetSync(fp)) {
        try {
          await access(fp + ".tmp");
          try {
            await rename(fp + ".tmp", fp + ".bak.orphan-" + Date.now());
          } catch (e) {
            logger.debug("destroy: rename tmp failed:", e);
          }
        } catch (e) {
          logger.debug("destroy: access tmp failed:", e);
        }
      }
    } catch (e) {
      logger.debug("destroy: statePath failed:", e);
    }
    try {
      this.ctx.pipelineManager.reset();
    } catch (e) {
      logger.debug("destroy: pipelineManager.reset failed:", e);
    }
    try {
      this.ctx.agentManager.stopRefresh();
    } catch (e) {
      logger.debug("destroy: agentManager.stopRefresh failed:", e);
    }
    try {
      this.ctx.memoryWatchdog.stop();
    } catch (e) {
      logger.debug("destroy: memoryWatchdog.stop failed:", e);
    }
    try {
      await this.ctx.sessionManager.cleanup();
    } catch (e) {
      logger.debug("destroy: sessionManager.cleanup failed:", e);
    }
    try {
      this.ctx.eventHub.shutdown();
    } catch (e) {
      logger.debug("destroy: eventHub.shutdown failed:", e);
    }
    for (const cb of this.cleanupCallbacks) {
      try {
        cb();
      } catch (e) {
        logger.debug("destroy: cleanup callback failed:", e);
      }
    }
    this.cleanupCallbacks.length = 0;
    try {
      this.ctx.seenAgents.clear();
    } catch (e) {
      logger.debug("destroy: seenAgents.clear failed:", e);
    }
    try {
      this.ctx.fileLocks.clearAll();
    } catch (e) {
      logger.debug("destroy: fileLocks.clearAll failed:", e);
    }
    try {
      this.ctx.conflictLearner.clearMemory();
    } catch (e) {
      logger.debug("destroy: conflictLearner.clearMemory failed:", e);
    }
    try {
      this.ctx.cleanupHubListeners();
    } catch (e) {
      logger.debug("destroy: cleanupHubListeners failed:", e);
    }
    try {
      this.ctx.rateLimiter.resetRateLimiters();
    } catch (e) {
      logger.debug("destroy: resetRateLimiters failed:", e);
    }
    try {
      this.ctx.timerManager.dispose();
    } catch (e) {
      logger.debug("destroy: timerManager.dispose failed:", e);
    }
    try {
      this.ctx.metricsCollector.stopPeriodicSave(this.ctx.timerManager);
      void this.ctx.metricsCollector.saveToDisk();
    } catch (e) {
      logger.debug("destroy: metricsCollector.save failed:", e);
    }
    logger.debug(`Session ended: ${this.ctx.sessionManager.getSessionId()}`);
  }
}