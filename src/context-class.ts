
import { resolve } from "node:path";
import { mark, measure } from "./utils/perf.ts";
import { logger } from "./utils/logger.ts";
import type { TawaOrchestratorContext, SaveHealth } from "./core/service-context.ts";
import { ConflictLearner } from "./conflict-resolver/learner.ts";
import { FileLockManager } from "./infra/file-lock.ts";
import { RateLimiter } from "./context/rate-limit.ts";
import { RuleInputBuilder } from "./services/rule-input-builder.ts";
import { TaskPriorityManager } from "./features/task-priority.ts";
import { StatsCollector } from "./services/stats.ts";
import { CapabilityTracker } from "./features/capability-tracker.ts";
import { SharedMemoryManager } from "./services/shared-memory.ts";
import { GamificationManager } from "./features/gamification.ts";
import type { RuleInput, TawaPreferences, SharedMemory } from "./conflict-resolver/types.ts";
import { DiscussionManager, EvidenceManager } from "./discussion/index.ts";
import { EventHub, type TawassulEvent } from "./services/event-hub.ts";
import { MemoryWatchdog } from "./services/memory-watchdog.ts";
import type { AgentAvailabilityManager } from "./services/agent-availability.ts";
import { TrainingEvaluator } from "./training-evaluator.ts";
import type { PauseState } from "./tools/system-controls.ts";
import type {
  RecordEntry,
  HandoffEntry,
  TawassulConfig,
  AgentRating,
  EvaluationConfig,
  Strictness,
} from "./context/types.ts";
import type { FetchResult } from "./context/model-utils.ts";
import { ModelCache } from "./core/model-cache.ts";
import {
  AgentManager,
  RatingManager,
  ErrorManager,
  ModelManager,
  PreferenceManager,
  StateManager,
  ConfigManager,
} from "./context/managers/index.ts";
import { SessionManager } from "./context/session-manager.ts";
import { PipelineStateManager } from "./context/managers/PipelineStateManager.ts";
import { CommandRouter } from "./services/command-router.ts";
import { LifecycleManager } from "./services/lifecycle-manager.ts";
import { FeatureIndex } from "./services/feature-index.ts";
import { EvaluationTracker } from "./services/evaluation-tracker.ts";
import { EvaluationSessionManager } from "./services/evaluation-session-manager.ts";
import { RegressionGuard } from "./services/regression-guard.ts";
import { SemanticCoverageGuard } from "./services/semantic-coverage-guard.ts";
import { SemanticRegressionOracle } from "./services/semantic-regression-oracle.ts";
import { TawassulState } from "./context/tawassul-state.ts";
import { detectInstallScope } from "./core/install-scope.ts";
import { resolveRuntimeStateDir } from "./utils/path-resolver.ts";
import { lazy } from "./core/lazy.ts";
import { createRatingOperations, type IRatingOperations } from "./core/rating-operations.ts";
import { PipelineState } from "./hooks/PipelineState.ts";
import { TaskTracker } from "./lib/task-tracker.ts";
import { TimerManager } from "./services/timer-manager.ts";
import { MetricsCollector } from "./services/metrics-collector.ts";
import * as RatingFacade from "./context/facades/rating-facade.ts";
import * as AgentFacade from "./context/facades/agent-facade.ts";
import * as CommandFacade from "./context/facades/command-facade.ts";
import * as RuleFacade from "./context/facades/rule-facade.ts";
import * as StateFacade from "./context/facades/state-facade.ts";
import * as ConfigFacade from "./context/facades/config-facade.ts";
import * as LifecycleFacade from "./context/facades/lifecycle-facade.ts";


export class TawassulContext implements TawaOrchestratorContext {
  
  state: import("./context/tawassul-state.ts").TawassulState;
  get records(): RecordEntry[] {
    return this.state.records;
  }
  set records(v: RecordEntry[]) {
    this.state.records = v;
  }
  get handoffs(): Map<string, HandoffEntry> {
    return this.state.handoffs;
  }
  set handoffs(v: Map<string, HandoffEntry>) {
    this.state.handoffs = v;
  }
  get recSeq(): number {
    return this.state.recSeq;
  }
  set recSeq(v: number) {
    this.state.recSeq = v;
  }
  get hoffSeq(): number {
    return this.state.hoffSeq;
  }
  set hoffSeq(v: number) {
    this.state.hoffSeq = v;
  }
  get seenAgents(): Map<string, Set<string>> {
    return this.state.seenAgents;
  }
  set seenAgents(v: Map<string, Set<string>>) {
    this.state.seenAgents = v;
  }
  get onboardedAgents(): Set<string> {
    return this.state.onboardedAgents;
  }
  set onboardedAgents(v: Set<string>) {
    this.state.onboardedAgents = v;
  }
  get pauseState(): PauseState | null {
    return this.state.pauseState;
  }
  set pauseState(v: PauseState | null) {
    this.state.pauseState = v;
  }
  nextHandoffId(): string {
    this.hoffSeq++;
    return `H-${String(this.hoffSeq).padStart(3, "0")}`;
  }
  stateDir: string;
  
  scope: import("./utils/path-resolver.ts").InstallScope;
  sessionManager: SessionManager;
  detectedMode: "plan" | "build" | null = null;
  userMentionedTawa = false;
  directRoutingAgent: string | null = null;
  userExplicitDispatch = false;
  userIntervened = false;
  chainActive = false;
  lastChainResult = "";
  chainStepsRemaining = 0;
  
  activeChain: import("./services/chain-ctx.ts").ChainCtx | null = null;
  
  askChannel: import("./tool.ts").ToolContext["ask"] = undefined;
  
  askChannelInstance: import("./services/ask-channel.ts").AskChannel | undefined = undefined;
  eventHub: EventHub;
  handoffService?: import("./services/handoff-service.ts").HandoffService;
  predictiveRouter?: import("./features/predictive-router.ts").PredictiveRouter;
  
  memoryRoutingIntegration?:
    import("./services/collective-memory/router-integration.ts").CollectiveMemoryRouterIntegration | null;
  
  queueDrainer?: import("./services/queue-drainer.ts").QueueDrainer;
  agentValidator?: import("./services/third-party-validator.ts").AgentValidator;
  
  toolRunLog?: import("./services/tool-run-log.ts").ToolRunLog;
  
  contextCompressionEscalation?: import("./services/context-compression-escalation.ts").ContextCompressionEscalation;
  
  privacyGuard?: import("./services/privacy-guard.ts").PrivacyGuard;
  
  backgroundNotifier?: import("./services/background-notifier.ts").BackgroundNotifier;
  
  vectorRetrieval?: import("./services/vector-retrieval.ts").VectorStore;

  timerManager = new TimerManager();

  pipelineState = new PipelineState(this.timerManager);

  taskTracker = new TaskTracker();
  
  private _eventHubCleanups: Array<() => void> = [];
  private _lifecycleManager!: LifecycleManager;
  private _commandRouter!: CommandRouter;
  configManager: ConfigManager;
  _configLoaded = false;

  
  private _agentManager!: AgentManager;
  private _ratingManager = new RatingManager();
  private _errorManager = new ErrorManager();
  private _modelManager!: ModelManager;
  private _preferenceManager = new PreferenceManager();
  private _stateManager!: StateManager;
  private _featureIndex = new FeatureIndex();
  private _evaluationSessionManager = new EvaluationSessionManager();
  private _regressionGuard = new RegressionGuard();
  private _semanticCoverageGuard = new SemanticCoverageGuard();
  private _semanticRegressionOracle = new SemanticRegressionOracle();
  private _fileLocks = new FileLockManager(true);
  private _taskPriority = new TaskPriorityManager();
  private _statsCollector = new StatsCollector();
  private _capabilityTracker = new CapabilityTracker();
  private _sharedMemory = new SharedMemoryManager();
  private _gamification = new GamificationManager();
  private _trainingEvaluator = new TrainingEvaluator();
  
  rateLimiter = new RateLimiter(this.timerManager);
  
  metricsCollector = new MetricsCollector();
  private _dm: DiscussionManager | null = null;
  private _em: EvidenceManager | null = null;
  private _ensureDiscussionPair(): void {
    if (this._dm) return;
    const dm = new DiscussionManager(
      () => {
        this.saveState();
      },
      undefined,
      this.eventHub,
      this.timerManager,
      
      (adr) => {
        this._sharedMemory.addDecision({
          agent: "@tawa",
          content: JSON.stringify(adr),
          tags: ["adr", "discussion", "decision"],
          importance: "high",
        });
      },
      
      (type: string, payload: Record<string, unknown>) => {
        this.emitWithChain(type, payload);
      },
    );
    
    
    dm.setConsensusBrokerEnabled(this.configManager.config.consensusBroker === true);
    const em = new EvidenceManager(dm, () => {
      this.saveState();
    });
    dm.setEvidenceManager(em);
    this._dm = dm;
    this._em = em;
  }
  private _discussionManager = lazy(() => {
    this._ensureDiscussionPair();
    return this._dm!;
  });
  private _evidenceManager = lazy(() => {
    this._ensureDiscussionPair();
    return this._em!;
  });
  private _memoryWatchdog = lazy(() => {
    const threshold = this.configManager.config.memoryWatchdogThreshold ?? 8192;
    return new MemoryWatchdog(threshold, this.eventHub, this.timerManager);
  });
  private _agentAvailability: AgentAvailabilityManager | null = null;
  
  
  private _pipelineManager = lazy(() => {
    return new PipelineStateManager({ handoffs: this.handoffs, featureIndex: this.featureIndex });
  });
  private _evaluationTracker = lazy(
    () => new EvaluationTracker(this.featureIndex, this.eventHub, this.evaluationSessionManager),
  );
  private _conflictLearner = lazy(() => new ConflictLearner(this.sharedMemory.get()));
  private _ruleInputBuilder = lazy(() => {
    this.ensureConfig();
    return new RuleInputBuilder(
      [...this.handoffs.values()],
      this.errorManager,
      this.fileLocks,
      this.configManager.config,
      (tag) => this.readAgentMd(tag),
      () => this.getAgents(),
      this.ratingManager,
    );
  });

  
  get lifecycleManager(): LifecycleManager {
    return this._lifecycleManager;
  }
  get commandRouter(): CommandRouter {
    return this._commandRouter;
  }
  get agentManager(): AgentManager {
    return this._agentManager;
  }
  get ratingManager(): RatingManager {
    return this._ratingManager;
  }
  get errorManager(): ErrorManager {
    return this._errorManager;
  }
  get modelManager(): ModelManager {
    return this._modelManager;
  }
  get preferenceManager(): PreferenceManager {
    return this._preferenceManager;
  }
  get stateManager(): StateManager {
    return this._stateManager;
  }
  get pipelineManager(): PipelineStateManager {
    return this._pipelineManager();
  }
  get featureIndex(): FeatureIndex {
    return this._featureIndex;
  }
  set featureIndex(v: FeatureIndex) {
    this._featureIndex = v;
  }
  get evaluationTracker(): EvaluationTracker {
    return this._evaluationTracker();
  }
  get evaluationSessionManager(): EvaluationSessionManager {
    return this._evaluationSessionManager;
  }
  get regressionGuard(): RegressionGuard {
    return this._regressionGuard;
  }
  get semanticCoverageGuard(): SemanticCoverageGuard {
    return this._semanticCoverageGuard;
  }
  get semanticRegressionOracle(): SemanticRegressionOracle {
    return this._semanticRegressionOracle;
  }
  get fileLocks(): FileLockManager {
    return this._fileLocks;
  }
  get taskPriority(): TaskPriorityManager {
    return this._taskPriority;
  }
  get statsCollector(): StatsCollector {
    return this._statsCollector;
  }
  get capabilityTracker(): CapabilityTracker {
    return this._capabilityTracker;
  }
  get sharedMemory(): SharedMemoryManager {
    return this._sharedMemory;
  }
  
  getMemoryForAgent(agent: string): SharedMemory {
    return this._sharedMemory.getForAgent(agent);
  }
  get gamification(): GamificationManager {
    return this._gamification;
  }
  get conflictLearner(): ConflictLearner {
    return this._conflictLearner();
  }
  get discussionManager(): DiscussionManager {
    return this._discussionManager();
  }
  get evidenceManager(): EvidenceManager {
    return this._evidenceManager();
  }
  get memoryWatchdog(): MemoryWatchdog {
    return this._memoryWatchdog();
  }
  get agentAvailability(): AgentAvailabilityManager | null {
    return this._agentAvailability ?? null;
  }
  set agentAvailability(v: AgentAvailabilityManager) {
    this._agentAvailability = v;
  }
  get trainingEvaluator(): TrainingEvaluator {
    return this._trainingEvaluator;
  }
  get ruleInputBuilder(): RuleInputBuilder {
    return this._ruleInputBuilder();
  }
  
  get modelCache(): ModelCache {
    return this._modelCache;
  }

  
  private _ratingOps = lazy(() =>
    createRatingOperations(this.ratingManager, this.errorManager, this.ruleInputBuilder, () => [
      ...this.handoffs.values(),
    ]),
  );
  get ratingOps(): IRatingOperations {
    return this._ratingOps();
  }

  
  get config(): TawassulConfig {
    return this.configManager.config;
  }
  set config(v: TawassulConfig) {
    this.configManager.config = v;
  }
  get agentErrors(): Record<string, number> {
    return this.errorManager.agentErrors;
  }
  set agentErrors(v: Record<string, number>) {
    this.errorManager.agentErrors = v;
  }
  get dynamicAgents(): string[] {
    return this.agentManager.dynamicAgents;
  }
  set dynamicAgents(v: string[]) {
    this.agentManager.dynamicAgents = v;
  }
  get agentModelMap(): Record<string, string> {
    return this.modelManager.agentModelMap;
  }
  set agentModelMap(v: Record<string, string>) {
    this.modelManager.agentModelMap = v;
  }
  get tawaPreferences(): TawaPreferences {
    return this.modelManager.tawaPreferences;
  }
  set tawaPreferences(v: TawaPreferences) {
    this.modelManager.tawaPreferences = v;
  }
  get agentRatings(): Record<string, AgentRating> {
    return this.ratingManager.agentRatings;
  }
  set agentRatings(v: Record<string, AgentRating>) {
    this.ratingManager.agentRatings = v;
  }
  get sessionId(): string {
    return this.sessionManager.getSessionId();
  }
  get saveTimeout() {
    return this.lifecycleManager.saveTimeout;
  }

  constructor(directory: string) {
    mark("context:ctor:start");
    this.state = new TawassulState();
    this.stateDir = directory;
    this.scope = detectInstallScope(import.meta.url);
    this.sessionManager = new SessionManager(directory);
    logger.debug(`Session started: ${this.sessionManager.getSessionId()}`);
    this.configManager = new ConfigManager(directory, (n, f) => this.safeConfigPath(n, f), this.scope);
    this.eventHub = new EventHub(this.timerManager, this.metricsCollector); 
    this._agentManager = new AgentManager(this.stateDir, this.timerManager, this.scope);
    this._modelManager = new ModelManager(this.stateDir, (n, f) => this.safeConfigPath(n, f), this.timerManager);
    this._stateManager = new StateManager(this.stateDir, () => this.statePath());
    this._lifecycleManager = new LifecycleManager(this);
    this._commandRouter = new CommandRouter(this);
    this.metricsCollector = new MetricsCollector(
      resolve(resolveRuntimeStateDir(directory, this.scope), "metrics.json"),
    );
    this.registerEventHubListener("CRITICAL_ERROR", (d) => logger.error("[Tawassul] Critical:", d));
    const modeEnv = process?.env?.OPENCODE_MODE;
    if (modeEnv === "plan" || modeEnv === "build") this.detectedMode = modeEnv;
    mark("context:ctor:end");
    measure("context:ctor:start", "context:ctor:end", "constructor total");
  }

  
  registerEventHubListener(event: string, handler: (event: TawassulEvent) => void): void {
    this.eventHub.on(event, handler);
    this._eventHubCleanups.push(() => this.eventHub.off(event, handler as (...args: unknown[]) => void));
  }

  
  emitWithChain(type: string, payload: Record<string, unknown>): void {
    const event = { type, ...payload } as TawassulEvent;
    if (this.activeChain) {
      (event as Record<string, unknown>).chain = this.activeChain;
    }
    this.eventHub.emit(event);
  }
  
  cleanupHubListeners(): void {
    for (const cleanup of this._eventHubCleanups) {
      try {
        cleanup();
      } catch {

      }
    }
    this._eventHubCleanups.length = 0;
  }

  
  
  isConfigDisabled(): boolean {
    return ConfigFacade.configIsConfigDisabled(this);
  }

  ensureConfig(): void {
    if (this._configLoaded) return;
    ConfigFacade.configLoadConfig(this);
  }

  
  async init(): Promise<void> {
    await LifecycleFacade.lifecycleInit(this);
  }

  
  async saveState(): Promise<void> {
    await StateFacade.stateSaveState(this);
  }
  getSaveHealth(): SaveHealth {
    return StateFacade.stateSaveHealth(this);
  }
  async flushSaves(): Promise<void> {
    await StateFacade.stateFlushSaves(this);
  }
  markDisposing(): void {
    StateFacade.stateMarkDisposing(this);
  }
  async doSave(type?: string): Promise<void> {
    await StateFacade.stateDoSave(this, type);
  }
  async loadStateAsync(): Promise<void> {
    await StateFacade.stateLoadStateAsync(this);
  }
  clearAllState(): string {
    return StateFacade.stateClearAllState(this);
  }
  async destroy(): Promise<void> {
    await LifecycleFacade.lifecycleDestroy(this);
  }

  async executeCommand(cmd: Record<string, unknown>) {
    return CommandFacade.commandExecute(this, cmd);
  }
  async executeMultiStep(multi: {
    steps?: { action?: string; model?: string; agent?: string; reason?: string }[];
    on_error?: { action?: string }[];
    workflow?: { action?: string; model?: string; agent?: string; reason?: string; on_error?: unknown }[];
  }) {
    return CommandFacade.commandExecuteMultiStep(this, multi);
  }

  statePath(): string {
    return StateFacade.statePath(this);
  }
  strictness(): Strictness {
    return AgentFacade.agentStrictness(this);
  }
  readAgentMd(tag: string) {
    return AgentFacade.agentReadMd(this, tag);
  }
  getAgents(): string[] {
    return AgentFacade.agentGetAgents(this);
  }
  getMaxRecords(): number {
    return AgentFacade.agentGetMaxRecords(this);
  }
  getMaxHandoffs(): number {
    return AgentFacade.agentGetMaxHandoffs(this);
  }
  getMaxCompactItems(): number {
    return AgentFacade.agentGetMaxCompactItems(this);
  }
  getEvalConfig(): EvaluationConfig {
    return AgentFacade.agentGetEvalConfig(this);
  }
  getSuggestedHandoffs(): Record<string, string[]> {
    return AgentFacade.agentGetSuggestedHandoffs(this);
  }
  incrementError(agent: string): void {
    RatingFacade.ratingIncrementError(this, agent);
  }
  getOrCreateRating(agent: string): AgentRating {
    return RatingFacade.ratingGetOrCreate(this, agent);
  }
  recordHandoffCompleted(agent: string): void {
    RatingFacade.ratingRecordHandoffCompleted(this, agent);
  }
  recordHandoffInitiated(agent: string, ctx: string, task: string, hcp: boolean, ce: boolean): void {
    RatingFacade.ratingRecordHandoffInitiated(this, agent, ctx, task, hcp, ce);
  }
  recordHandoffAccepted(agent: string, id: string): void {
    RatingFacade.ratingRecordHandoffAccepted(this, agent, id);
  }
  recordHandoffDropped(agent: string): void {
    RatingFacade.ratingRecordHandoffDropped(this, agent);
  }
  recordRecordCreated(agent: string): void {
    RatingFacade.ratingRecordRecordCreated(this, agent);
  }
  recordValidationError(agent: string): void {
    RatingFacade.ratingRecordValidationError(this, agent);
  }
  recordHelpRequestSent(agent: string): void {
    RatingFacade.ratingRecordHelpRequestSent(this, agent);
  }
  recordHelpRequestFulfilled(agent: string): void {
    RatingFacade.ratingRecordHelpRequestFulfilled(this, agent);
  }
  recordToolCall(agent: string, tool: string, success: boolean): void {
    RatingFacade.ratingRecordToolCall(this, agent, tool, success);
  }
  updateLastActive(agent: string): void {
    RatingFacade.ratingUpdateLastActive(this, agent);
  }
  calculateHealthScore(r: AgentRating): number {
    return RatingFacade.ratingCalculateHealthScore(this, r);
  }
  scoreCategory(score: number) {
    return RatingFacade.ratingScoreCategory(this, score);
  }
  detectFlags(r: AgentRating, cfg: EvaluationConfig) {
    return RatingFacade.ratingDetectFlags(this, r, cfg);
  }
  detectDroppedHandoffs(): void {
    RatingFacade.ratingDetectDroppedHandoffs(this);
  }
  scoreBar(score: number, width: number): string {
    return RatingFacade.ratingScoreBar(this, score, width);
  }
  async buildRuleInput(
    from: string,
    to: string,
    task: string,
    context: string,
    files: string[],
    tc?: "simple" | "medium" | "complex",
    tp?: "P1" | "P2" | "P3",
  ): Promise<RuleInput> {
    return RatingFacade.ratingBuildRuleInput(this, from, to, task, context, files, tc, tp);
  }
  private _modelCache = new ModelCache();
  async buildModelsInjectionText(serverUrl?: string): Promise<string> {
    return RuleFacade.ruleBuildModelsInjectionText(this, serverUrl);
  }
  async fetchAllAvailableModels(force = false, serverUrl?: string): Promise<FetchResult> {
    return RuleFacade.ruleFetchAllAvailableModels(this, force, serverUrl);
  }

  safeConfigPath(name: string | undefined, fallback: string): string {
    return ConfigFacade.configSafeConfigPath(this, name, fallback);
  }
}
