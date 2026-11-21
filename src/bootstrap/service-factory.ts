
import { HealthTracker } from "../services/agent-health.ts";
import { CircuitBreaker } from "../services/circuit-breaker.ts";
import { SelfHealEngine } from "../services/self-heal-engine.ts";
import { resolveFallbackAgent } from "../services/proxy-fallback-chains.ts";
import { HandoffService } from "../services/handoff-service.ts";
import { ProjectIndexService } from "../services/project-index/index.ts";
import { ReadCacheService } from "../services/read-cache/index.ts";
import { resolveProjectIdentity } from "../utils/project-identity.ts";

import { HandoffLedger } from "../services/handoff-ledger.ts";

import { QueueDrainer } from "../services/queue-drainer.ts";
import { AgentValidator } from "../services/third-party-validator.ts";
import { schedulePeriodicCleanup } from "../services/cleanup.ts";
import { flushAllPersists } from "../services/persist-utils.ts";
import { DEFAULT_RETENTION } from "../services/retention.ts";

import { AgentMatcher } from "../services/agent-matcher.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { ParallelDispatcher } from "../services/parallel-dispatcher.ts";
import { PredictiveRouter } from "../features/predictive-router.ts";
import { AgentAvailabilityManager } from "../services/agent-availability.ts";
import crypto from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { getWriteBlockReason } from "../services/isolation.ts";
import { schedulePersist } from "../services/persist-utils.ts";
import { canAutoPauseOverwrite } from "../tools/system-controls.ts";

import { getCollectiveMemoryStore } from "../services/collective-memory/store.ts";
import type { CollectiveMemoryStoreImpl } from "../services/collective-memory/store.ts";
import { TrustScoreCalculator, getTrustScoreCalculator } from "../services/trust-score/calculator.ts";
import { FailureAutopsyAnalyzer, getFailureAutopsyAnalyzer } from "../services/failure-autopsy/analyzer.ts";
import { CostTransparencyTracker, getCostTransparencyTracker } from "../services/cost-transparency/tracker.ts";
import { SpecDrivenManager, getSpecDrivenManager } from "../services/spec-driven/manager.ts";
import { ToolRunLog } from "../services/tool-run-log.ts";
import { getWorktreeBlockReason } from "../services/isolation.ts";
import { ContextCompressionEscalation } from "../services/context-compression-escalation.ts";
import { PrivacyGuard } from "../services/privacy-guard.ts";
import { BackgroundNotifier } from "../services/background-notifier.ts";
import { InMemoryVectorIndex } from "../services/vector-retrieval.ts";
import { CONTEXT_COMPRESSION_NEEDED } from "../services/context-compression-escalation.ts";
import { PRIVACY_REDACTED } from "../services/privacy-guard.ts";
import { setConsentGateEnabled } from "../hooks/validation-pipeline.ts";

import { ImageRouter, getImageRouter } from "../services/image-router/index.ts";
import { StaleDetector, getStaleDetector } from "../services/stale-detector/index.ts";
import { getBackgroundCoordinator } from "../services/background-coordinator/coordinator.ts";
import type { BackgroundTaskResult } from "../services/background-coordinator/types.js";

import { createFailureEventIntegration } from "../services/failure-autopsy/event-integration.ts";
import {
  CollectiveMemoryRouterIntegration,
  createMemoryRouterIntegration,
} from "../services/collective-memory/router-integration.ts";
import { CheckpointManager } from "../services/checkpoint-manager.ts";
import { CodeStateService } from "../services/code-state.ts";
import type { ICodeStateService } from "../services/code-state.ts";
import { TaskOrchestrator } from "../services/task-orchestrator.ts";
import { TaskContextService } from "../services/task-context/index.ts";
import { ResultEngine } from "../services/result-engine.ts";
import { MissionBoard } from "../services/mission-board.ts";
import { StrategyDispatcher } from "../services/strategy-dispatcher.ts";
import { TimelineStore } from "../services/timeline-store.ts";
import { GoalStore } from "../services/goal-store.ts";
import { registerCoreEventIntegrations } from "./event-integrations.ts";
import { registerTimelineIntegration } from "./timeline-integrations.ts";
import { registerMemoryEventIntegrations } from "./memory-integrations.ts";
import { cacheClear } from "../tools/web.ts";
import type { TawaOrchestratorContext } from "../core/service-context.ts";
import type { TawassulEvent } from "../services/event-hub.ts";
import { createHandoffEntry } from "../services/handoff-entry.ts";
import { resolveAgentModelRef } from "../services/model-refs.ts";
import { logger } from "../utils/logger.ts";
import { t } from "../translations.ts";
import { projectStatePath } from "../utils/state-paths.ts";









type ServicesContext = TawaOrchestratorContext & {
  scope: import("../utils/path-resolver.ts").InstallScope;
  projectRoot?: string;
  lifecycleManager: import("../services/lifecycle-manager.ts").LifecycleManager;
  registerEventHubListener: (event: string, handler: (event: TawassulEvent) => void) => void;
  handoffService?: HandoffService;
  agentValidator?: AgentValidator;
  predictiveRouter?: PredictiveRouter;
  contextCompressionEscalation?: ContextCompressionEscalation;
  privacyGuard?: PrivacyGuard;
  memoryRoutingIntegration?: CollectiveMemoryRouterIntegration | null;
};

class NullCodeStateService implements ICodeStateService {
  async capture(_label: string, _messageId?: string) {
    return {
      id: `null-${Date.now()}`,
      index: -1,
      label: _label,
      beforeTree: null,
      afterTree: null,
      timestamp: new Date().toISOString(),
      messageId: _messageId,
    };
  }
  async restoreById(_id: string, _force?: boolean) {
    return { ok: false as const, error: "CodeStateService not available (init failed)" };
  }
  async diffBetween(_before: string | null, _after: string) {
    return null;
  }
  reset() {

  }
}

export interface ServiceFactoryResult {
  healthTracker: HealthTracker;
  circuitBreaker: CircuitBreaker;
  selfHealEngine: SelfHealEngine;
  handoffService: HandoffService;
  projectIndex: ProjectIndexService;
  readCache: ReadCacheService;
  handoffLedger: HandoffLedger;
  queueDrainer: QueueDrainer;
  agentValidator: AgentValidator;
  
  agentMatcher: AgentMatcher;
  parallelDispatcher: ParallelDispatcher;
  predictiveRouter: PredictiveRouter;
  
  collectiveMemory: CollectiveMemoryStoreImpl;
  trustScore: TrustScoreCalculator;
  failureAutopsy: FailureAutopsyAnalyzer;
  costTransparency: CostTransparencyTracker;
  specDriven: SpecDrivenManager;
  
  imageRouter: ImageRouter;
  staleDetector: StaleDetector;
  
  eventIntegrations: Array<{ stop: () => void }>;
  
  checkpointManager: CheckpointManager;
  
  taskOrchestrator: TaskOrchestrator;
  resultEngine: ResultEngine;
  missionBoard: MissionBoard;
  strategyDispatcher: StrategyDispatcher;
  costTracker: CostTransparencyTracker;
  timelineStore?: TimelineStore;
  goalStore?: GoalStore;
}


export function createServices(_tawaCtx: TawaOrchestratorContext, projectDirectory?: string): ServiceFactoryResult {
  
  
  
  const tawaCtx = _tawaCtx as unknown as ServicesContext;
  
  
  
  
  const runtimeStateDir = tawaCtx.persistDir;
  const projectStateDir = resolve(runtimeStateDir, ".opencode");
  const stateFile = (fileName: string): string => join(projectStateDir, fileName);
  const healthCfg = tawaCtx.config.health ?? {};
  const healthTracker = new HealthTracker(healthCfg.stuckTimeoutMs, undefined, tawaCtx.eventHub, tawaCtx.timerManager);
  const circuitBreaker = new CircuitBreaker(
    healthCfg.circuitBreakerThreshold,
    healthCfg.circuitBreakerResetMs,
    (event) => tawaCtx.eventHub.emit(event),
    2,
  );
  const selfHealEngine = new SelfHealEngine(
    tawaCtx.eventHub,
    circuitBreaker,
    healthTracker,
    undefined,


    (component) => {
      try {
        const alt = resolveFallbackAgent(component, {
          availableAgents: tawaCtx.getAgents(),
          agentModelMap: tawaCtx.agentModelMap,
        });
        return alt ? { agent: alt } : null;
      } catch {
        return null;
      }
    },
    tawaCtx.timerManager,
  );
  const handoffService = new HandoffService(tawaCtx, healthTracker, circuitBreaker);
  tawaCtx.handoffService = handoffService;
  const projectIndex = new ProjectIndexService({
    baseDir: tawaCtx.persistDir,
    projectKey:
      tawaCtx.projectIdentity?.key ??
      resolveProjectIdentity(undefined, projectDirectory ?? tawaCtx.persistDir).key,
    projectRoot: tawaCtx.projectIdentity?.canonical ?? tawaCtx.persistDir,
  });
  tawaCtx.projectIndex = projectIndex;
  const readCache = new ReadCacheService({ projectKey: projectIndex.projectKey });
  tawaCtx.readCache = readCache;
  const taskContext = new TaskContextService({
    projectIndex,
    featureIndex: tawaCtx.featureIndex,
    projectRoot: projectIndex.projectRoot,
  });
  tawaCtx.taskContext = taskContext;

  
  const handoffLedger = new HandoffLedger(tawaCtx.persistDir, tawaCtx.timerManager);
  const queueDrainer = new QueueDrainer(handoffService);
  
  tawaCtx.queueDrainer = queueDrainer;
  const agentValidator = new AgentValidator(() => tawaCtx.getAgents(), circuitBreaker);
  tawaCtx.agentValidator = agentValidator;

  
  
  
  
  
  
  let routerStatePath: string | null = null;
  let routerReadPath: string | null = null;
  try {
    routerStatePath = projectStatePath(runtimeStateDir, "predictive-router.json");
    routerReadPath = routerStatePath;
  } catch {
    logger.warn(`[tawassul] ${t("bootNoHome")}`);
  }
  const predictiveRouter = new PredictiveRouter(undefined, tawaCtx.eventHub);
  
  if (routerReadPath) {
    try {
      if (existsSync(routerReadPath)) {
        predictiveRouter.importData(readFileSync(routerReadPath, "utf8"));
      }
    } catch (e) {
      logger.warn(`[tawassul] ${t("bootPredictLoadFail", { err: String(e) })}`);
    }
  }
  tawaCtx.predictiveRouter = predictiveRouter;
  
  
  
  
  
  
  const savePredictiveRouter = async (): Promise<void> => {
    if (!routerStatePath) return;
    if (tawaCtx.stateReadOnly) return;
    const blockReason = getWriteBlockReason(routerStatePath);
    if (blockReason !== null) {
      logger.warn(
        blockReason === "foreign-key"
          ? `[tawassul] predictive-router save blocked: foreign-key (read-only on this device).`
          : `[tawassul] predictive-router save blocked: session is isolated (read-only fail-safe).`,
      );
      return;
    }
    try {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(dirname(routerStatePath), { recursive: true });
      const { writeIfChanged } = await import("../services/persist-utils.ts");
      await writeIfChanged(routerStatePath, predictiveRouter.exportData(), { backup: true });
    } catch (e) {
      logger.warn(`[tawassul] predictive-router save failed:`, e);
    }
  };
  
  if (routerStatePath && tawaCtx.timerManager) {
    tawaCtx.timerManager.setInterval(() => {
      schedulePersist("predictive-router", savePredictiveRouter);
    }, 5 * 60_000);
  }
  
  
  if (routerStatePath) {
    schedulePersist("predictive-router", savePredictiveRouter);
  }

  
  const ctxConfig = tawaCtx.config as Record<string, unknown>;
  const innovations = (ctxConfig?.innovations || {}) as Record<string, { enabled?: boolean }>;
  const isInnovationOn = (name: string): boolean => innovations[name]?.enabled !== false;

  
  
  const pk = tawaCtx.persistDir;
  const memFile = pk
    ? `collective-memory-${crypto.createHash("sha1").update(pk).digest("hex").slice(0, 8)}.json`
    : "collective-memory.json";
  const collectiveMemory = getCollectiveMemoryStore({
    enabled: isInnovationOn("collectiveMemory"),
    maxPatterns: 10000,
    maxMemories: 50000,
    storagePath: stateFile(memFile),
    projectKey: pk,
  });
  const trustScore = getTrustScoreCalculator({
    enabled: isInnovationOn("trustScore"),
    storagePath: stateFile("trust-score.json"),
  });
  const failureAutopsy = getFailureAutopsyAnalyzer({
    enabled: isInnovationOn("failureAutopsy"),
    maxFailures: 1000,
    storagePath: stateFile("failure-autopsy.json"),
  });
  const costTransparency = getCostTransparencyTracker({
    enabled: isInnovationOn("costTransparency"),
    storagePath: stateFile("cost-transparency.json"),
  });
  const specDriven = getSpecDrivenManager({
    enabled: isInnovationOn("specDrivenPhase"),
    mandatory: false,
    storagePath: stateFile("spec-driven.json"),
  });

  setConsentGateEnabled(isInnovationOn("consentGate"));

  
  const imageRouter = getImageRouter();
  const staleDetector = getStaleDetector({
    enabled: true,
    trackedFiles: [join(projectDirectory ?? tawaCtx.stateDir, "AGENTS.md"), join(projectDirectory ?? tawaCtx.stateDir, "codemap.md")],
  });

  
  const loadPromises: Promise<void>[] = [];
  
  
  
  
  
  if (isInnovationOn("collectiveMemory")) {
    loadPromises.push(collectiveMemory.load());
  }
  if (isInnovationOn("trustScore")) loadPromises.push(trustScore.load());
  if (isInnovationOn("failureAutopsy")) loadPromises.push(failureAutopsy.load());
  if (isInnovationOn("costTransparency")) loadPromises.push(costTransparency.load());
  if (isInnovationOn("specDrivenPhase")) loadPromises.push(specDriven.load());
  
  
  
  if (isInnovationOn("contextCompression")) {
    tawaCtx.contextCompressionEscalation = new ContextCompressionEscalation({}, (type, payload) =>
      tawaCtx.eventHub.emit({ type, payload } as Parameters<typeof tawaCtx.eventHub.emit>[0]),
    );
  }
  
  
  if (isInnovationOn("privacyGuard")) {
    
    
    const paranoid = tawaCtx.config.privacyGuardParanoid === true;
    tawaCtx.privacyGuard = new PrivacyGuard({ paranoid });
  }
  
  
  
  if (isInnovationOn("backgroundNotify")) {
    const notifier = new BackgroundNotifier({ rateLimitMs: 60_000 }, (type, payload) =>
      tawaCtx.eventHub.emit({ type, payload } as Parameters<typeof tawaCtx.eventHub.emit>[0]),
    );
    const onEvent = (type: string, e: Record<string, unknown>): void => {
      const p = e as Record<string, unknown>;
      notifier.notify(type, p);
      const dur = typeof p.durationMs === "number" ? (p.durationMs as number) : 0;
      const agent = p.agent;
      const tool = p.tool;
      if (typeof agent === "string") {
        notifier.recordActivity(agent, typeof tool === "string" ? (tool as string) : "unknown", dur);
      }
    };
    tawaCtx.eventHub.on("TASK_COMPLETED", (e) => onEvent("task-completed", e));
    tawaCtx.eventHub.on("AGENT_FAILED", (e) => onEvent("agent-failed", e));
    tawaCtx.eventHub.on("TOOL_OUTPUT_QUARANTINED", (e) => onEvent("tool-quarantined", e));
    tawaCtx.eventHub.on(CONTEXT_COMPRESSION_NEEDED, (e) => onEvent("context-compression", e));
    tawaCtx.eventHub.on(PRIVACY_REDACTED, (e) => onEvent("privacy-redacted", e));
    tawaCtx.backgroundNotifier = notifier;
    
    loadPromises.push(notifier.load(tawaCtx.persistDir).catch((e) => logger.warn("activity-metrics load failed:", e)));
  }
  
  
  
  
  if (isInnovationOn("vectorRetrieval")) {
    const index = new InMemoryVectorIndex();
    
    
    loadPromises.push(
      index
        .load(tawaCtx.persistDir)
        .then(() => {
          const docs = [
            ...tawaCtx.records.map((r) => ({ id: r.id, kind: "record" as const, text: `${r.title}\n${r.detail}` })),
            ...[...tawaCtx.handoffs.values()].map((h) => ({ id: h.id, kind: "handoff" as const, text: h.context })),
          ];
          index.ingest(docs);
        })
        .catch((e) => logger.warn("vector-index load failed:", e)),
    );
    tawaCtx.vectorRetrieval = index;
  }
  
  
  
  const worktreeBlocked = getWorktreeBlockReason(tawaCtx.persistDir, tawaCtx.projectRoot) === "worktree";
  if (worktreeBlocked) {
    logger.warn(
      "⛔ Worktree isolation violated: stateDir escapes TAWASSUL_WORKTREE_ROOT — mutating persistence disabled (read-only fail-safe).",
    );
  }
  
  
  if (isInnovationOn("toolRunLog") && !worktreeBlocked) {
    const toolRunLog = new ToolRunLog(tawaCtx.persistDir);
    tawaCtx.toolRunLog = toolRunLog;
    loadPromises.push(toolRunLog.load());
  }
  if (loadPromises.length > 0) {
    Promise.all(loadPromises).catch((err) => logger.warn("Some innovation services failed to load state:", err));
  }

  
  const staleResults = staleDetector.findStaleFiles();
  if (staleResults.length > 0) {
    logger.warn("Stale files detected:", staleResults.map((r) => r.path).join(", "));
  }

  
  const staleCheckIntervalMs = 1000 * 60 * 60;
  const staleCheckFn = () => {
    const results = staleDetector.findStaleFiles();
    if (results.length > 0) {
      logger.warn("Stale files detected:", results.map((r) => r.path).join(", "));
    }
  };
  const staleCheckTimer = tawaCtx.timerManager
    ? tawaCtx.timerManager.setInterval(staleCheckFn, staleCheckIntervalMs)
    : (() => {
        const t = setInterval(staleCheckFn, staleCheckIntervalMs);
        if (t?.unref) t.unref();
        return t;
      })();
  tawaCtx.lifecycleManager.addCleanupCallback(() => {
    if (tawaCtx.timerManager) tawaCtx.timerManager.clear(staleCheckTimer);
    else clearInterval(staleCheckTimer);
  });

  
  if (isInnovationOn("backgroundCoordinator")) {
    const backgroundCoordinator = getBackgroundCoordinator(
      {
        storagePath: stateFile("background-coordinator.json"),
      },
      tawaCtx.timerManager,
    );
    const systemAgents = new Set<string>();
    const buildResult = (
      jobId: string,
      success: boolean,
      durationMs: number,
      output?: Record<string, unknown>,
      error?: string,
    ): BackgroundTaskResult => ({
      jobId,
      success,
      output,
      error,
      durationMs,
      executedAt: new Date().toISOString(),
    });
    for (const job of backgroundCoordinator.getAllJobs()) {
      job.agentId = `system:${job.name}`;
      systemAgents.add(job.agentId);
      backgroundCoordinator.registerHandler(job.id, async () => {
        const start = Date.now();
        switch (job.name) {
          case "collective-memory-decay":
            collectiveMemory.applyDecay(0.5);
            return buildResult(job.id, true, Date.now() - start);
          case "failure-pattern-detection":
            failureAutopsy.detectPatterns();
            return buildResult(job.id, true, Date.now() - start);
          case "cost-budget-check": {
            const budget = costTransparency.getBudget();
            const over =
              Boolean(budget) &&
              (budget!.currentDailySpend > budget!.dailyLimit || budget!.currentMonthlySpend > budget!.monthlyLimit);
            if (over) logger.warn("[background-coordinator] Budget exceeded:", budget);
            return buildResult(job.id, true, Date.now() - start, { over: Boolean(over) });
          }
          case "state-persistence":
            await tawaCtx.saveState();
            return buildResult(job.id, true, Date.now() - start);
          default:
            return buildResult(job.id, false, Date.now() - start, undefined, `No backing service for job: ${job.name}`);
        }
      });
    }
    backgroundCoordinator.setRunPipeline(async ({ tool, agent }) => ({
      allowed: tool === "background-job" && systemAgents.has(agent),
    }));
    backgroundCoordinator.start();
    tawaCtx.lifecycleManager.addCleanupCallback(() => backgroundCoordinator.stop());
  }

  
  const eventIntegrations: Array<{ stop: () => void }> = [];

  
  if (isInnovationOn("failureAutopsy")) {
    const failureIntegration = createFailureEventIntegration(tawaCtx.eventHub, failureAutopsy, {
      recordToolErrors: true,
      recordAgentErrors: true,
      recordHandoffErrors: true,
      autoGenerateLessons: true,
      detectPatterns: true,
      patternThreshold: 3,
    });
    failureIntegration.start();
    eventIntegrations.push(failureIntegration);
  }

  
  let memoryRoutingIntegration: CollectiveMemoryRouterIntegration | null = null;
  if (isInnovationOn("collectiveMemory")) {
    memoryRoutingIntegration = createMemoryRouterIntegration(collectiveMemory, predictiveRouter);
  }
  tawaCtx.memoryRoutingIntegration = memoryRoutingIntegration;

  
  const coreIntegrations = registerCoreEventIntegrations({
    tawaCtx: tawaCtx as never,
    eventHub: tawaCtx.eventHub,
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
  });
  eventIntegrations.push(coreIntegrations);

  
  
  
  let timelineStore: TimelineStore | undefined;
  if (isInnovationOn("timeline")) {
    timelineStore = new TimelineStore(tawaCtx.persistDir, {
      timers: tawaCtx.timerManager,
    });
    void timelineStore.ensureLoaded();
    const timelineIntegration = registerTimelineIntegration({
      tawaCtx: tawaCtx as never,
      eventHub: tawaCtx.eventHub,
      timelineStore,
    });
    eventIntegrations.push(timelineIntegration);
  }

  
  
  
  let goalStore: GoalStore | undefined;
  try {
    goalStore = new GoalStore(tawaCtx.persistDir);


    void goalStore.ensureLoaded({ sweepStaleMs: 14 * 24 * 3600 * 1000 });
  } catch (err) {
    logger.warn("[goal-store] init failed — goals start empty:", err);
    goalStore = undefined;
  }

  
  const stuckDetectionAbort = new AbortController();
  healthTracker.startStuckDetection(() => [...tawaCtx.handoffs.values()], stuckDetectionAbort.signal);
  tawaCtx.lifecycleManager.addCleanupCallback(() => stuckDetectionAbort.abort());
  healthTracker.onAutoPause((agent, reason) => {
    logger.warn(`Agent ${agent} auto-paused: ${reason}`);
    if (!canAutoPauseOverwrite(tawaCtx.pauseState)) return;
    tawaCtx.pauseState = {
      active: true,
      reason: `Auto-paused: ${reason}`,
      pausedAt: new Date().toISOString(),
      pausedBy: "system",
      scope: "agent",
      affectedHandoffs: [...tawaCtx.handoffs.values()]
        .filter(
          (h) => normalizeName(h.to) === normalizeName(agent) && (h.status === "pending" || h.status === "accepted"),
        )
        .map((h) => h.id),
    };
    tawaCtx.saveState();
  });

  
  
  
  tawaCtx.registerEventHubListener?.("PLUGIN_READY", () => {
    handoffService.sagaCoordinator.listJournalRecords().then((records) => {
      const interrupted = records.filter((r) => r.state === "EXECUTING" || r.state === "PENDING");
      for (const rec of interrupted) {
        logger.warn(
          `[resume] saga ${rec.transactionId} ("${rec.sagaName}") interrupted after steps [${rec.completedSteps.join(", ")}] — resume or compensate manually`,
        );
      }
    });
  });

  
  let codeState: ICodeStateService;
  let checkpointManager: CheckpointManager;
  try {
    codeState = new CodeStateService(process.cwd());
    checkpointManager = new CheckpointManager(codeState, tawaCtx.eventHub, tawaCtx.persistDir);
  } catch (e) {
    logger.warn("[service-factory] CodeStateService init failed — falling back to NullCodeStateService:", e);
    codeState = new NullCodeStateService();
    checkpointManager = new CheckpointManager(codeState, tawaCtx.eventHub, tawaCtx.persistDir);
  }

  
  
  const memoryIntegration = registerMemoryEventIntegrations({
    tawaCtx: tawaCtx as never,
    eventHub: tawaCtx.eventHub,
    cacheClear,
    codeState,
  });
  eventIntegrations.push(memoryIntegration);

  
  tawaCtx.registerEventHubListener("TASK_STARTED", (e: TawassulEvent) => {
    if (e.type !== "TASK_STARTED") return;
    
    
    const pm = tawaCtx.pipelineManager;
    let resumePoint: { phase: string; taskId: string; remainingTasks: string[] } | undefined;
    if (pm) {
      const phases = pm.getPipeline()?.phases ?? [];
      const idx = pm.getCurrentPhaseIndex();
      resumePoint = {
        phase: pm.getCurrentPhase() ?? "execution",
        taskId: e.taskId,
        remainingTasks: phases
          .slice(idx)
          .map((p) => p)
          .filter(Boolean),
      };
    }
    checkpointManager
      .createSnapshot(e.taskId, resumePoint)
      .catch((err) => logger.warn("[checkpoint] auto-snapshot failed:", err));
  });

  
  const agentAvail = new AgentAvailabilityManager(
    { circuitBreaker, healthTracker, taskQueue: tawaCtx.taskPriority },
    tawaCtx.eventHub,
  );
  tawaCtx.agentAvailability = agentAvail;
  agentAvail.setDispatchCallback((task) => {
    const id = tawaCtx.nextHandoffId();
    const entry = createHandoffEntry({
      id,
      from: task.from,
      to: task.to,
      task: task.task,
      implementer: resolveAgentModelRef(
        task.from,
        tawaCtx.modelManager.agentModelMap,
        tawaCtx.agentManager.getRosterModel(task.from),
      ),
      reviewer: resolveAgentModelRef(
        task.to,
        tawaCtx.modelManager.agentModelMap,
        tawaCtx.agentManager.getRosterModel(task.to),
      ),
    });
    tawaCtx.handoffs.set(id, entry);
    healthTracker.onHandoffCreated(task.to, id);
    handoffLedger.append({ type: "handoff_created", handoffId: id, from: task.from, to: task.to, task: task.task });
  });

  
  tawaCtx.rateLimiter.applyConfig(tawaCtx.config.rateLimits);

  
  const agentMatcher = new AgentMatcher(
    
    () => healthTracker.getAllStatuses(),
    
    (agent: string) => {
      const stats = tawaCtx.statsCollector.getAgentStats(agent);
      if (!stats) return undefined;
      return {
        handoffsCompleted: stats.handoffsCompleted,
        errors: stats.errors,
        avgResponseTime: stats.avgResponseTime,
      };
    },
    
    (agent: string) => tawaCtx.capabilityTracker.getCapabilities(agent),
    
    (agent: string) => tawaCtx.capabilityTracker.getCapabilities(agent),
    
    (agent: string, capability: string) => tawaCtx.capabilityTracker.getSuccessRate(agent, capability),
    
    (agent: string, taskDesc: string) => {
      try {
        return predictiveRouter.getPrediction(agent, taskDesc);
      } catch {
        return null;
      }
    },
    
    (agent: string) => tawaCtx.capabilityTracker.getAgentScore(agent),
    
    () => tawaCtx.capabilityTracker.getAll(),
    
    (agent: string) => circuitBreaker.getState(agent) === "OPEN",
    
    
    (agent: string) => tawaCtx.capabilityTracker.getAgentScoreWithCI(agent),
    
    () => tawaCtx.getAgents().filter((agent) => {
      const key = normalizeName(agent);
      return key !== "addagent" && key !== "kick";
    }),
  );

  
  const parallelDispatcher = new ParallelDispatcher(
    
    (params) => {
      const id = tawaCtx.nextHandoffId();
      const entry = createHandoffEntry({
        id,
        from: "@tawa",
        to: params.to,
        task: params.task,
        context: params.context,
        files: params.files,
        parallelId: params.parallelId,
        implementer: resolveAgentModelRef(
          "@tawa",
          tawaCtx.modelManager.agentModelMap,
          tawaCtx.agentManager.getRosterModel("@tawa"),
        ),
        reviewer: resolveAgentModelRef(
          params.to,
          tawaCtx.modelManager.agentModelMap,
          tawaCtx.agentManager.getRosterModel(params.to),
        ),
      });
      tawaCtx.handoffs.set(id, entry);
      healthTracker.onHandoffCreated(params.to, id);
      return id;
    },
    
    (request) => agentMatcher.findBestAgent(request),
  );

  
  
  
  
  
  const taskOrchestrator = new TaskOrchestrator(tawaCtx.eventHub, parallelDispatcher, specDriven, taskContext);
  const resultEngine = new ResultEngine(tawaCtx.eventHub);
  const missionBoard = new MissionBoard(tawaCtx.eventHub, undefined, tawaCtx.persistDir);
  const strategyDispatcher = new StrategyDispatcher(parallelDispatcher);
  
  const costTracker = costTransparency;

  
  tawaCtx.lifecycleManager.addCleanupCallback(() => {
    selfHealEngine.dispose();
    taskOrchestrator.dispose();
  });

  
  const stopCleanup = schedulePeriodicCleanup(
    () => [...tawaCtx.handoffs.values()],
    DEFAULT_RETENTION,
    (removedIds) => {
      for (const id of removedIds) tawaCtx.handoffs.delete(id);
    },
    tawaCtx.timerManager,
  );
  tawaCtx.lifecycleManager.addCleanupCallback(stopCleanup);

  
  tawaCtx.lifecycleManager.addCleanupCallback(() => handoffLedger.dispose());
  if (timelineStore) {
    tawaCtx.lifecycleManager.addCleanupCallback(() => timelineStore!.dispose());
  }
  tawaCtx.lifecycleManager.addCleanupCallback(() => flushAllPersists());
  tawaCtx.lifecycleManager.addCleanupCallback(() => {
    for (const integration of eventIntegrations) {
      try {
        integration.stop();
      } catch {

      }
    }
  });

  return {
    healthTracker,
    circuitBreaker,
    selfHealEngine,
    handoffService,
    projectIndex,
    readCache,
    agentMatcher,
    parallelDispatcher,
    predictiveRouter,
    handoffLedger,
    queueDrainer,
    agentValidator,
    
    collectiveMemory,
    trustScore,
    failureAutopsy,
    costTransparency,
    specDriven,
    
    imageRouter,
    staleDetector,
    
    eventIntegrations,
    
    checkpointManager,
    
    taskOrchestrator,
    resultEngine,
    missionBoard,
    strategyDispatcher,
    costTracker,
    timelineStore,
    goalStore,
  };
}
