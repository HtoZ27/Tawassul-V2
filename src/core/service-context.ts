import type { EventHub } from "../services/event-hub.ts";
import type { SagaEffect } from "./saga-effects.ts";
import type {
  RecordEntry,
  HandoffEntry,
  AgentFlag,
  AgentRating,
  EvaluationConfig,
  Strictness,
  TawassulConfig,
} from "../context/types.ts";
import type { TawaPreferences } from "../conflict-resolver/types.ts";

export interface HandoffContext {
  handoffs: Map<string, HandoffEntry>;
  recSeq: number;
  hoffSeq: number;
  nextHandoffId(): string;
  recordHandoffCompleted(agent: string): void;
  recordHandoffInitiated(agent: string, ctx: string, task: string, hcp: boolean, ce: boolean): void;
  recordHandoffAccepted(agent: string, id: string): void;
  recordHandoffDropped(agent: string): void;
  recordRecordCreated(agent: string): void;
}

export interface AgentContext {
  getAgents(): string[];
  readAgentMd(tag: string): { name?: string; role?: string; capability?: string; responsibilities?: string[] } | null;
  updateLastActive(agent: string): void;
  detectDroppedHandoffs(): void;
}

export interface ErrorContext {
  agentErrors: Record<string, number>;
  incrementError(agent: string): void;
}

export interface ModelContext {
  agentModelMap: Record<string, string>;
  eventHub: EventHub;
}

export interface SaveHealth {
  stale: boolean;
  failureCount: number;
  backingOff: boolean;
}

export interface StateContext {
  stateDir: string;
  persistDir: string;
  saveState(): Promise<void>;
  getSaveHealth(): SaveHealth;
  flushSaves(): Promise<void>;
  doSave(type?: string): Promise<void>;
  loadStateAsync(): Promise<void>;
  clearAllState(): string;
}

export interface RatingContext {
  agentRatings: Record<string, AgentRating>;
  getOrCreateRating(agent: string): AgentRating;
  calculateHealthScore(r: AgentRating): number;
  scoreCategory(score: number): { emoji: string; label: string };
  detectFlags(r: AgentRating, cfg: EvaluationConfig): AgentFlag[];
  scoreBar(score: number, width: number): string;
}

export interface PreferenceContext {
  tawaPreferences: TawaPreferences;
  strictness(): Strictness;
}

export interface LifecycleContext {
  eventHub: EventHub;
  markDisposing(): void;
  destroy(): Promise<void>;
}

export interface PipelineContext {
  handoffs: Map<string, HandoffEntry>;
  records: RecordEntry[];
}

export interface ConfigContext {
  config: TawassulConfig;
  safeConfigPath(name: string | undefined, fallback: string): string;
  statePath(): string;
  getMaxRecords(): number;
  getMaxHandoffs(): number;
}

export interface DiscussionContext {
  saveState(): Promise<void>;
}

export interface FileLockContext {
  fileLocks: import("../infra/file-lock.ts").FileLockManager;
}

export interface TaskPriorityContext {
  taskPriority: import("../features/task-priority.ts").TaskPriorityManager;
}

export interface AgentAvailabilityContext {
  agentAvailability: import("../services/agent-availability.ts").AgentAvailabilityManager | null;
}

export interface StateManagerContext {
  stateManager: import("../context/managers/StateManager.ts").StateManager;
  sessionManager: import("../context/session-manager.ts").SessionManager;
  seenAgents: Map<string, Set<string>>;
  pauseState: import("../tools/system-controls.ts").PauseState | null;
  timerManager: import("../services/timer-manager.ts").TimerManager;
}

export interface SharedMemoryContext {
  sharedMemory: import("../services/shared-memory.ts").SharedMemoryManager;
}

export interface OrchestratorManagerContext {
  agentManager: import("../context/managers/AgentManager.ts").AgentManager;
  modelManager: import("../context/managers/ModelManager.ts").ModelManager;
  metricsCollector: import("../services/metrics-collector.ts").MetricsCollector;
  trainingEvaluator: import("../training-evaluator.ts").TrainingEvaluator;
  pipelineManager: import("../context/managers/PipelineStateManager.ts").PipelineStateManager;
  discussionManager: import("../discussion/index.ts").DiscussionManager;
  featureIndex: import("../services/feature-index.ts").FeatureIndex;
  conflictLearner: import("../conflict-resolver/learner.ts").ConflictLearner;
  rateLimiter: import("../context/rate-limit.ts").RateLimiter;
  memoryWatchdog: import("../services/memory-watchdog.ts").MemoryWatchdog;
  taskTracker: import("../lib/task-tracker.ts").TaskTracker;
  statsCollector: import("../services/stats.ts").StatsCollector;
  capabilityTracker: import("../features/capability-tracker.ts").CapabilityTracker;
  gamification: import("../features/gamification.ts").GamificationManager;
  ratingOps: import("../core/rating-operations.ts").IRatingOperations;
  toolRunLog?: import("../services/tool-run-log.ts").ToolRunLog;
  vectorRetrieval?: import("../services/vector-retrieval.ts").VectorStore;
  backgroundNotifier?: import("../services/background-notifier.ts").BackgroundNotifier;
}

export interface RatingErrorManagerContext {
  ratingManager: import("../context/managers/RatingManager.ts").RatingManager;
  errorManager: import("../context/managers/ErrorManager.ts").ErrorManager;
}

export interface SessionInfoContext {
  sessionId: string;
  cleanupHubListeners(): void;
  recordHelpRequestFulfilled(agent: string): void;
}

export interface TawaOrchestratorContext
  extends
    HandoffContext,
    AgentContext,
    ErrorContext,
    ModelContext,
    StateContext,
    RatingContext,
    PreferenceContext,
    LifecycleContext,
    PipelineContext,
    ConfigContext,
    DiscussionContext,
    FileLockContext,
    TaskPriorityContext,
    StateManagerContext,
    SharedMemoryContext,
    AgentAvailabilityContext,
    OrchestratorManagerContext,
    RatingErrorManagerContext,
    SessionInfoContext {
  queueDrainer?: QueueDrainerPort;
  stateReadOnly?: boolean;
  projectIdentity?: import("../utils/project-identity.ts").ProjectIdentity;
  projectIndex?: import("../services/project-index/index.ts").ProjectIndexService;
  readCache?: import("../services/read-cache/index.ts").ReadCacheService;
  taskContext?: import("../services/task-context/index.ts").TaskContextService;
  readonly intelligence?: IntelligenceMetrics;
}

export type IntelligenceMetrics = {
  cacheHits: number;
  cacheMisses: number;
  cacheBytes: number;
  indexFiles: number;
  indexSymbols: number;
  indexEdges: number;
  indexBytes: number;
  bundlesBuilt: number;
  bundleBytes: number;
};

export interface QueueDrainerPort {
  shouldDrain(agent: string): boolean;
  buildDrainEffects(
    agent: string,
    allHandoffs: HandoffEntry[],
    alternateAgent: string,
  ): SagaEffect<TawaOrchestratorContext>[];
}
