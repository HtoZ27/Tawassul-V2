
import type { TawassulContext } from "../context.ts";
import type { DiscussionManager } from "../discussion/discussion-logic.ts";
import type { ServiceFactoryResult } from "./service-factory.ts";
import { createMessageUpdatedHook } from "../hooks/message-updated.ts";
import { createSessionCompactedHook } from "../hooks/session.ts";
import { createToolExecuteBeforeHook, createToolExecuteAfterHook } from "../hooks/tool-execute.ts";
import { createToolOutputStreamHook } from "../hooks/tool-output-stream.ts";
import { createDisposeHook } from "../hooks/dispose.ts";
import { PriorityIndex } from "../context/priority-index.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { AgentTransactionManager } from "../context/transaction-manager.ts";
import { ToolDeduplicator } from "../services/tool-dedup.ts";
import { AsyncStageQueue } from "../services/async-stage-queue.ts";
import { ContextNudgeManager } from "../services/context-nudges.ts";
import { DYNAMIC_MODEL_SENTINEL, getDynamicFallbackChainForRole } from "../services/proxy-fallback-chains.ts";
import { RETIRED_MODEL_IDS } from "../core/variant-names.ts";
import { resolveRole } from "../utils/agent.ts";
import type { ToolExecuteServiceClients } from "../hooks/tool-execute-types.ts";
import type { MessageUpdatedServiceClients } from "../hooks/message-updated-types.ts";
import { analyzeMessage } from "../services/routing-algorithm.ts";
import { analyzeEffort, isComplexTask } from "../services/effort-analyzer.ts";
import { runElicitationGate, buildOptions } from "../services/elicitation-gate.ts";
import { formatAskPrompt, isAskInjection } from "../services/ask-channel-parse.ts";
import { getPipeline, describePipeline } from "../services/pipeline-phases.ts";
import { classifyMessagePriority, estimateTokens } from "../services/message-priority.ts";
import { estimateContextUsage } from "../services/context-nudges.ts";
import { isIsolationActiveSync } from "../services/isolation.ts";
import { wrapUntrusted, escapeGoalText } from "../services/prompt-sanitizer.ts";
import { truncateToolOutput } from "../services/context-compressor.ts";
import { evaluateGates, generateReport } from "../services/quality-gate-manager.ts";
import { newChainId } from "../services/chain-ctx.ts";
import { maybeAutoCapture } from "../services/code-state-auto.ts";
import { runTodoReconcile, stashCopilotDigest, takeCopilotDigest } from "../services/goal-auto.ts";

export interface HooksResult {
  messageUpdatedHook: ReturnType<typeof createMessageUpdatedHook>;
  sessionCompactedHook: ReturnType<typeof createSessionCompactedHook>;
  toolExecuteBeforeHook: ReturnType<typeof createToolExecuteBeforeHook>;
  toolExecuteAfterHook: ReturnType<typeof createToolExecuteAfterHook>;
  toolOutputStreamHook: ReturnType<typeof createToolOutputStreamHook>;
  disposeHook: ReturnType<typeof createDisposeHook>;
}

export function createHooks(
  tawaCtx: TawassulContext,
  directory: string,
  services: ServiceFactoryResult,
  _discussionManager: DiscussionManager,
  serverUrl?: string,
): HooksResult {
  const { healthTracker, circuitBreaker, agentMatcher, parallelDispatcher, predictiveRouter } = services;

  
  
  const serviceClients: ToolExecuteServiceClients = {
    wrapUntrusted,
    escapeGoalText,
    truncateToolOutput,
    evaluateGates,
    generateReport,
    newChainId,
    maybeAutoCapture,
    reconcileTodos: services?.goalStore
      ? (input) => runTodoReconcile({ store: services.goalStore!, ...input })
      : undefined,
    stashCopilotDigest,
  };

  
  const messageServiceClients: MessageUpdatedServiceClients = {
    analyzeMessage,
    analyzeEffort,
    isComplexTask,
    runElicitationGate,
    buildOptions,
    formatAskPrompt,
    isAskInjection,
    getPipeline,
    describePipeline,
    classifyMessagePriority,
    estimateTokens,
    estimateContextUsage,
    takeCopilotDigest,
  };

  const getAgentModel = (agent: string) => {
    const key = normalizeName(agent);
    const raw = tawaCtx.modelManager.agentModelMap[key] as string | undefined;
    const isMissing = !raw;
    const isDynamic = raw === DYNAMIC_MODEL_SENTINEL;
    const isRetired = raw !== undefined && RETIRED_MODEL_IDS.has(raw);
    const failed = tawaCtx.modelManager.tawaPreferences.failedModels[key];
    const isFailed = !!failed && Date.now() - new Date(failed.failedAt).getTime() < 36e5;
    const isCircuitOpen = (() => {
      try {
        return raw !== undefined && circuitBreaker.evaluate(raw) === "OPEN";
      } catch {
        return false;
      }
    })();
    const needsFallback = isMissing || isDynamic || isRetired || isFailed || isCircuitOpen;
    if (!needsFallback && raw) return raw;
    if (isMissing && !tawaCtx.modelManager.agentModelMap[key]) {
      
      
      
      
      const role = resolveRole(agent);
      if (!role) return "default/default";
      const chain = getDynamicFallbackChainForRole(role, {
        dynamicAgents: tawaCtx.dynamicAgents,
        agentModelMap: tawaCtx.modelManager.agentModelMap,
      });
      const healthy =
        chain.find((m) => {
          if (RETIRED_MODEL_IDS.has(m)) return false;
          try {
            return circuitBreaker.evaluate(m) !== "OPEN";
          } catch {
            return true;
          }
        }) ?? chain[0];
      return healthy ?? "default/default";
    }
    const role = resolveRole(agent) ?? agent;
    const chain = getDynamicFallbackChainForRole(role, {
      dynamicAgents: tawaCtx.dynamicAgents,
      agentModelMap: tawaCtx.modelManager.agentModelMap,
    });
    const isOpen = (m: string) => {
      try {
        return circuitBreaker.evaluate(m) === "OPEN";
      } catch {
        return false;
      }
    };
    const healthy =
      chain.find((m) => !RETIRED_MODEL_IDS.has(m) && m !== raw && !isOpen(m)) ??
      chain.find((m) => !RETIRED_MODEL_IDS.has(m) && !isOpen(m)) ??
      chain[0] ??
      raw ??
      "opencode/big-pickle";
    return healthy;
  };

  
  const priorityIndex = new PriorityIndex();
  const toolDeduplicator = new ToolDeduplicator();
  const asyncStageQueue = new AsyncStageQueue();
  const contextNudgeManager = new ContextNudgeManager();
  const transactionManager = new AgentTransactionManager();

  
  const messageUpdatedHook = createMessageUpdatedHook({
    detectedMode: tawaCtx.detectedMode,
    agentModelMap: tawaCtx.modelManager.agentModelMap,
    seenAgents: tawaCtx.seenAgents,
    onboardedAgents: tawaCtx.onboardedAgents,
    handoffs: tawaCtx.handoffs,
    records: tawaCtx.records,
    config: tawaCtx.configManager.config,
    agentErrors: tawaCtx.errorManager.agentErrors,
    agentRatings: tawaCtx.ratingManager.agentRatings,
    trainingEvaluator: {
      markOutcomeByAgent: tawaCtx.trainingEvaluator.markOutcomeByAgent.bind(tawaCtx.trainingEvaluator),
    } as import("../hooks/message-updated-types.ts").MessageUpdatedContext["trainingEvaluator"],
    serviceClients: messageServiceClients,
    readAgentMd: (tag: string) => tawaCtx.readAgentMd(tag),
    getEvalConfig: () => tawaCtx.getEvalConfig(),
    getOrCreateRating: (agent: string) => tawaCtx.getOrCreateRating(agent),
    detectFlags: (r: import("../context/types.ts").AgentRating, cfg: import("../context/types.ts").EvaluationConfig) =>
      tawaCtx.detectFlags(r, cfg),
    getAgents: () => tawaCtx.getAgents(),
    recordHandoffAccepted: (agent: string, id: string) => tawaCtx.recordHandoffAccepted(agent, id),
    updateLastActive: (agent: string) => tawaCtx.updateLastActive(agent),
    saveState: () => tawaCtx.saveState(),
    buildModelsInjectionText: () => tawaCtx.buildModelsInjectionText(serverUrl),
    directory,
    sessionId: tawaCtx.sessionManager.getSessionId(),
    get userMentionedTawa() {
      return tawaCtx.userMentionedTawa;
    },
    set userMentionedTawa(v: boolean) {
      tawaCtx.userMentionedTawa = v;
    },
    get directRoutingAgent() {
      return tawaCtx.directRoutingAgent;
    },
    set directRoutingAgent(v: string | null) {
      tawaCtx.directRoutingAgent = v;
    },
    get userExplicitDispatch() {
      return tawaCtx.userExplicitDispatch;
    },
    set userExplicitDispatch(v: boolean) {
      tawaCtx.userExplicitDispatch = v;
    },
    get userIntervened() {
      return tawaCtx.userIntervened;
    },
    set userIntervened(v: boolean) {
      tawaCtx.userIntervened = v;
    },
    elicitationEmit: (e: unknown) => {
      tawaCtx.eventHub.emit(e as import("../services/event-hub.ts").TawassulEvent);
    },
    
    get askChannel() {
      return tawaCtx.askChannelInstance;
    },
    
    get elicitationAsk() {
      return tawaCtx.askChannel;
    },
    set elicitationAsk(v: import("../services/elicitation-gate.ts").ElicitationAsk | undefined) {
      tawaCtx.askChannel = v;
    },
    emitWithChain: (type: string, payload: Record<string, unknown>) => {
      tawaCtx.emitWithChain(type, payload);
    },
    get chainCtx() {
      return tawaCtx.activeChain;
    },
    
    recordDecision: (content: string, opts?: { tags?: string[]; importance?: "low" | "medium" | "high" }) => {
      tawaCtx.sharedMemory.addDecision({
        agent: "@tawa",
        content,
        tags: opts?.tags ?? ["user", "decision"],
        importance: opts?.importance ?? "medium",
        provenance: "user_stated",
      });
    },
    statsCollector: tawaCtx.statsCollector,
    pipelineManager: tawaCtx.pipelineManager,
    
    agentMatcher,
    parallelDispatcher,
    predictiveRouter,
    handoffsRef: () => [...tawaCtx.handoffs.values()],
    circuitBreaker,
    healthTracker,
    featureIndex: tawaCtx.featureIndex,
    regressionGuard: tawaCtx.regressionGuard,
    pipelineState: tawaCtx.pipelineState,
    priorityIndex,
    transactionManager,
    contextNudgeManager,
  });

  const sessionCompactedHook = createSessionCompactedHook({
    records: tawaCtx.records,
    get handoffs() {
      return [...tawaCtx.handoffs.values()];
    },
    agentErrors: tawaCtx.errorManager.agentErrors,
    getMaxCompactItems: () => tawaCtx.getMaxCompactItems(),
    sessionId: tawaCtx.sessionManager.getSessionId(),
    seenAgents: tawaCtx.seenAgents,
    priorityIndex,
    
    
    getGoalDigest: services?.goalStore
      ? async () => {
          await services.goalStore!.ensureLoaded();
          return services.goalStore!.compactDigest();
        }
      : undefined,
  });

  const toolExecuteBeforeHook = createToolExecuteBeforeHook({
    get detectedMode() {
      return tawaCtx.detectedMode;
    },
    get pauseState() {
      return tawaCtx.pauseState;
    },
    trainingEvaluator: tawaCtx.trainingEvaluator,
    sessionId: tawaCtx.sessionManager.getSessionId(),
    get userMentionedTawa() {
      return tawaCtx.userMentionedTawa;
    },
    get directRoutingAgent() {
      return tawaCtx.directRoutingAgent;
    },
    get userExplicitDispatch() {
      return tawaCtx.userExplicitDispatch;
    },
    get chainActive() {
      return tawaCtx.chainActive;
    },
    set chainActive(v: boolean) {
      tawaCtx.chainActive = v;
    },
    get lastChainResult() {
      return tawaCtx.lastChainResult;
    },
    set lastChainResult(v: string) {
      tawaCtx.lastChainResult = v;
    },
    get chainStepsRemaining() {
      return tawaCtx.chainStepsRemaining;
    },
    set chainStepsRemaining(v: number) {
      tawaCtx.chainStepsRemaining = v;
    },
    get chainCtx() {
      return tawaCtx.activeChain;
    },
    set chainCtx(v: import("../services/chain-ctx.ts").ChainCtx | null) {
      tawaCtx.activeChain = v;
    },
    emitWithChain: (type: string, payload: Record<string, unknown>) => {
      tawaCtx.emitWithChain(type, payload);
    },
    
    get ask() {
      return tawaCtx.askChannel;
    },
    set ask(v: import("../tool.ts").ToolContext["ask"] | undefined) {
      tawaCtx.askChannel = v;
    },
    
    get askChannelInstance() {
      return tawaCtx.askChannelInstance;
    },
    circuitBreaker,
    healthTracker,
    getAgentModel,
    pipelineManager: tawaCtx.pipelineManager,
    discussionManager: tawaCtx.discussionManager,
    
    agentMatcher,
    predictiveRouter,
    configManager: tawaCtx.configManager,
    handoffsRef: () => [...tawaCtx.handoffs.values()],
    capabilityTracker: tawaCtx.capabilityTracker,
    statsCollector: tawaCtx.statsCollector,
    pipelineState: tawaCtx.pipelineState,
    rateLimiter: tawaCtx.rateLimiter,
    priorityIndex,
    transactionManager,
    toolDeduplicator,
    toolRunLog: tawaCtx.toolRunLog,
    contextCompressionEscalation: tawaCtx.contextCompressionEscalation,
    asyncStageQueue,
    serviceClients,
  });

  const _toolExecuteAfterHook = createToolExecuteAfterHook({
    recordToolCall: (agent: string, tool: string, success: boolean) => tawaCtx.recordToolCall(agent, tool, success),
    incrementError: (agent: string) => tawaCtx.errorManager.incrementError(agent),
    sessionId: tawaCtx.sessionManager.getSessionId(),
    get chainActive() {
      return tawaCtx.chainActive;
    },
    set chainActive(v: boolean) {
      tawaCtx.chainActive = v;
    },
    get lastChainResult() {
      return tawaCtx.lastChainResult;
    },
    set lastChainResult(v: string) {
      tawaCtx.lastChainResult = v;
    },
    get chainStepsRemaining() {
      return tawaCtx.chainStepsRemaining;
    },
    set chainStepsRemaining(v: number) {
      tawaCtx.chainStepsRemaining = v;
    },
    get chainCtx() {
      return tawaCtx.activeChain;
    },
    set chainCtx(v: import("../services/chain-ctx.ts").ChainCtx | null) {
      tawaCtx.activeChain = v;
    },
    emitWithChain: (type: string, payload: Record<string, unknown>) => {
      tawaCtx.emitWithChain(type, payload);
    },
    eventHub: tawaCtx.eventHub,
    conflictLearner: {
      recordOutcome: (r, d, a, ag) => tawaCtx.conflictLearner.recordOutcome(r, d, a, ag),
      checkAllRules: () => tawaCtx.conflictLearner.checkAllRules(),
    },
    getAgentModel,
    pipelineManager: tawaCtx.pipelineManager,
    
    predictiveRouter,
    handoffsRef: () => [...tawaCtx.handoffs.values()],
    getAgentDescription: (agent: string) => {
      const agentInfo = tawaCtx.readAgentMd(agent);
      return agentInfo?.role || agentInfo?.capability || "general";
    },
    featureIndex: tawaCtx.featureIndex,
    regressionGuard: tawaCtx.regressionGuard,
    semanticCoverageGuard: tawaCtx.semanticCoverageGuard,
    semanticRegressionOracle: tawaCtx.semanticRegressionOracle,
    pipelineState: tawaCtx.pipelineState,
    rateLimiter: tawaCtx.rateLimiter,
    gamification: {
      recordAction: (agent: string, metric: string, value?: number) =>
        tawaCtx.gamification.recordAction(agent, metric, value),
    },
    priorityIndex,
    transactionManager,
    toolRunLog: tawaCtx.toolRunLog,
    contextCompressionEscalation: tawaCtx.contextCompressionEscalation,
    privacyGuard: tawaCtx.privacyGuard,
    asyncStageQueue,
    goalStore: services?.goalStore,
    serviceClients,
  });

  
  
  
  
  const toolExecuteAfterHook = async (...args: Parameters<typeof _toolExecuteAfterHook>) => {
    const result = await _toolExecuteAfterHook(...args);
    if (Object.keys(tawaCtx.modelManager.agentModelMap).length > 200) {
      const entries = Object.entries(tawaCtx.modelManager.agentModelMap);
      tawaCtx.modelManager.agentModelMap = Object.fromEntries(entries.slice(-100));
    }
    if (Object.keys(tawaCtx.errorManager.agentErrors).length > 200) {
      const entries = Object.entries(tawaCtx.errorManager.agentErrors);
      tawaCtx.errorManager.agentErrors = Object.fromEntries(entries.slice(-100));
    }
    return result;
  };

  
  
  tawaCtx.lifecycleManager.addCleanupCallback(() => healthTracker.cleanup());
  tawaCtx.lifecycleManager.addCleanupCallback(() => asyncStageQueue.dispose());
  tawaCtx.lifecycleManager.addCleanupCallback(() => transactionManager.dispose());
  const disposeHook = createDisposeHook({
    get handoffs() {
      return [...tawaCtx.handoffs.values()];
    },
    detectDroppedHandoffs: () => tawaCtx.detectDroppedHandoffs(),
    destroy: () => tawaCtx.destroy(),
  });

  return {
    messageUpdatedHook,
    sessionCompactedHook,
    toolExecuteBeforeHook,
    toolExecuteAfterHook,
    toolOutputStreamHook: createToolOutputStreamHook({ isIsolationActive: isIsolationActiveSync }),
    disposeHook,
  };
}
