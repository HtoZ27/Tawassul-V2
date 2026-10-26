
import type { PauseState } from "../tools/system-controls.ts";
import type { ToolContext } from "../tool.ts";
import type { AgentMatcher } from "../services/agent-matcher.ts";
import type { PredictiveRouter } from "../features/predictive-router.ts";
import type { StatsCollector } from "../services/stats.ts";
import type { HandoffEntry } from "../context/types.ts";
import type { TawassulEvent } from "../services/event-hub.ts";
import type { RuleDecision } from "../conflict-resolver/types.ts";
import type { FeatureIndex } from "../services/feature-index.ts";
import type { RegressionGuard } from "../services/regression-guard.ts";
import type { SemanticCoverageGuard } from "../services/semantic-coverage-guard.ts";
import type { SemanticRegressionOracle } from "../services/semantic-regression-oracle.ts";
import type { PipelineDefinition, PhaseResult } from "../services/pipeline.ts";
import type { PipelineState } from "./PipelineState.ts";
import type { PriorityIndex } from "../context/priority-index.ts";
import type { AgentTransactionManager } from "../context/transaction-manager.ts";
import type { ToolDeduplicator } from "../services/tool-dedup.ts";
import type { AsyncStageQueue } from "../services/async-stage-queue.ts";
import type { GateContext, GateKind, GateResult, QualityGateReport } from "../services/quality-gate-manager.ts";


export interface ToolExecuteServiceClients {
  wrapUntrusted: (content: string) => string;
  escapeGoalText: (text: string) => string;
  truncateToolOutput: (text: string, maxChars?: number) => string;
  evaluateGates: (ctx: GateContext, selectedGates?: GateKind[]) => GateResult[];
  generateReport: (gates: GateResult[], featureId?: string, featureName?: string) => QualityGateReport;
  newChainId: () => string;
  maybeAutoCapture: (toolName: string, success: boolean) => Promise<void>;
  
  reconcileTodos?: (input: {
    store?: import("../services/goal-store.ts").GoalStore;
    sessionId: string;
    owner: string;
    todos: Array<{ title: string; status: string }>;
  }) => Promise<{ ok: boolean; goalId?: string; digest?: string }>;
  stashCopilotDigest?: (sessionId: string, digest: string) => void;
}

export interface ToolExecuteBeforeContext {
  detectedMode: "plan" | "build" | null;
  pauseState: PauseState | null;
  trainingEvaluator: {
    record: (entry: {
      agent: string;
      role: string;
      prompt: string;
      blocked: boolean;
      blockReason?: string;
      sessionId: string;
    }) => void;
  };
  sessionId: string;
  userMentionedTawa: boolean;
  directRoutingAgent: string | null;
  userExplicitDispatch?: boolean;
  chainActive: boolean;
  lastChainResult: string;
  chainStepsRemaining: number;
  circuitBreaker?: {
    evaluate: (agent: string) => "CLOSED" | "OPEN" | "HALF_OPEN";
    getAllStates: () => { agent: string; state: "CLOSED" | "OPEN" | "HALF_OPEN"; failureCount: number }[];
  };
  healthTracker?: { isAutoPaused: (agent: string) => boolean };
  getAgentModel: (agent: string) => string;
  pipelineManager: {
    getCurrentPhaseConfig: () => {
      allowRead: boolean;
      allowWrite: boolean;
      mode: string;
      maxAgents: number;
      allowedAgentRoles: string[];
      phase: string;
    } | null;
  } | null;
  discussionManager: {
    calculateRiskScore: (tasks: unknown[]) => number;
    getAllDiscussions: () => unknown[];
  } | null;
  agentMatcher: AgentMatcher;
  predictiveRouter: PredictiveRouter;
  
  configManager?: import("../context/managers/ConfigManager.ts").ConfigManager;
  handoffsRef: () => HandoffEntry[];
  capabilityTracker: {
    getCapabilities: (agent: string) => string[];
    getSuccessRate: (agent: string, capability: string) => number;
  };
  statsCollector: StatsCollector;
  pipelineState?: PipelineState;
  rateLimiter?: {
    checkRateLimit: (agent: string, provider: string, model: string) => boolean;
    releaseConcurrent: (agent: string, provider: string, model: string) => void;
    resetRateLimiters: () => void;
  };
  priorityIndex?: PriorityIndex;
  transactionManager?: AgentTransactionManager;
  toolDeduplicator?: ToolDeduplicator;
  
  toolRunLog?: import("../services/tool-run-log.ts").ToolRunLog;
  
  contextCompressionEscalation?: import("../services/context-compression-escalation.ts").ContextCompressionEscalation;
  asyncStageQueue?: AsyncStageQueue;
  
  ask?: ToolContext["ask"];
  
  askChannelInstance?: import("../services/ask-channel.ts").AskChannel;
  
  chatOnlyAsk?: boolean;

  chainCtx?: import("../services/chain-ctx.ts").ChainCtx | null;
  
  emitWithChain?: (type: string, payload: Record<string, unknown>) => void;
  
  serviceClients?: ToolExecuteServiceClients;
}

export interface ToolExecuteAfterContext {
  recordToolCall: (agent: string, tool: string, success: boolean) => void;
  incrementError: (agent: string) => void;
  sessionId: string;
  chainActive: boolean;
  lastChainResult: string;
  chainStepsRemaining: number;
  chainCtx?: import("../services/chain-ctx.ts").ChainCtx | null;
  
  emitWithChain?: (type: string, payload: Record<string, unknown>) => void;
  circuitBreaker?: { recordFailure: (agent: string) => void; recordSuccess: (agent: string) => void };
  healthTracker?: { onHandoffFailed: (agent: string) => void; onHandoffCompleted: (agent: string) => void };
  eventHub?: { emit: (event: TawassulEvent) => void };
  conflictLearner?: {
    recordOutcome: (ruleId: string, decision: RuleDecision, accepted: boolean, agent: string) => void;
    checkAllRules: () => { ruleId: string; disable: boolean; adjustPriority?: number }[];
  };
  getAgentModel: (agent: string) => string;
  pipelineManager: {
    recordToolResult: (tool: string, success: boolean) => unknown;
    isComplete: () => boolean;
    getFeatureId: () => string;
    getStates: () => Partial<Record<string, PhaseResult>>;
    getPipeline: () => PipelineDefinition | null;
  } | null;
  predictiveRouter: PredictiveRouter;
  handoffsRef: () => HandoffEntry[];
  getAgentDescription: (agent: string) => string;
  featureIndex: FeatureIndex;
  regressionGuard: RegressionGuard;
  semanticCoverageGuard: SemanticCoverageGuard;
  semanticRegressionOracle: SemanticRegressionOracle;
  pipelineState?: PipelineState;
  rateLimiter?: {
    checkRateLimit: (agent: string, provider: string, model: string) => boolean;
    releaseConcurrent: (agent: string, provider: string, model: string) => void;
    resetRateLimiters: () => void;
  };
  gamification?: {
    recordAction: (agent: string, metric: string, value?: number) => unknown[];
  };
  priorityIndex?: PriorityIndex;
  transactionManager?: AgentTransactionManager;
  
  toolRunLog?: import("../services/tool-run-log.ts").ToolRunLog;
  
  contextCompressionEscalation?: import("../services/context-compression-escalation.ts").ContextCompressionEscalation;
  
  privacyGuard?: import("../services/privacy-guard.ts").PrivacyGuard;
  asyncStageQueue?: AsyncStageQueue;
  
  goalStore?: import("../services/goal-store.ts").GoalStore;
  
  serviceClients?: ToolExecuteServiceClients;
}

export interface ValidationStage {
  name: string;
  check: (
    ctx: ToolExecuteBeforeContext,
    input: { tool: string; agent?: string; sessionID: string; callID?: string },
    output: { args: Record<string, unknown>; error?: string },
  ) => Promise<boolean>;
}
