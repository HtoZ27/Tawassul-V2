import type { HandoffEntry, AgentRating, EvaluationConfig, RecordEntry } from "../context.ts";
import type { PipelineDefinition } from "../services/pipeline.ts";
import type { AgentMatcher } from "../services/agent-matcher.ts";
import type { ParallelDispatcher } from "../services/parallel-dispatcher.ts";
import type { PredictiveRouter } from "../features/predictive-router.ts";
import type { AgentStatus } from "../services/agent-health.ts";
import type { CircuitBreaker } from "../services/circuit-breaker.ts";
import type { FeatureIndex } from "../services/feature-index.ts";
import type { RegressionGuard } from "../services/regression-guard.ts";
import type { PipelineState } from "./PipelineState.ts";
import type { PriorityIndex } from "../context/priority-index.ts";
import type { AgentTransactionManager } from "../context/transaction-manager.ts";
import type { ContextNudgeManager } from "../services/context-nudges.ts";
import type { RoutingResult } from "../services/routing-algorithm.ts";
import type { EffortAnalysis, ThinkingEffort } from "../services/effort-analyzer.ts";
import type { ElicitationGateDeps, ElicitationResult } from "../services/elicitation-gate.ts";
import type { AskKind } from "../services/ask-channel-parse.ts";
import type { PriorityResult, ContextUsage } from "../context/priority-types.ts";

export interface MessageUpdatedContext {
  detectedMode: "plan" | "build" | null;
  agentModelMap: Record<string, string>;
  seenAgents: Map<string, Set<string>>;
  
  onboardedAgents: Set<string>;
  handoffs: Map<string, HandoffEntry> | HandoffEntry[];
  records: RecordEntry[];
  config: import("../context/types.ts").TawassulConfig;
  agentErrors: Record<string, number>;
  agentRatings: Record<string, AgentRating>;

  trainingEvaluator: { markOutcomeByAgent: (agent: string, outcome: string) => void; [key: string]: unknown };

  statsCollector: import("../services/stats.ts").StatsCollector;

  readAgentMd: (tag: string) => { name?: string; role?: string; capability?: string } | null;
  getEvalConfig: () => EvaluationConfig;
  getOrCreateRating: (agent: string) => AgentRating;
  detectFlags: (r: AgentRating, cfg: EvaluationConfig) => Array<{ symbol: string; message: string; metric: string }>;
  getAgents: () => string[];
  recordHandoffAccepted: (agent: string, handoffId: string) => void;
  updateLastActive: (agent: string) => void;
  saveState: () => Promise<void>;
  buildModelsInjectionText: () => Promise<string>;

  directory: string;

  sessionId: string;

  userMentionedTawa: boolean;

  directRoutingAgent: string | null;

  
  userExplicitDispatch?: boolean;

  userIntervened: boolean;

  pipelineManager: {
    setPipeline: (pipeline: PipelineDefinition, taskId?: string) => void;
    setHandoffsRef: (handoffs: Map<string, HandoffEntry>) => void;
    setFeatureId: (id: string) => void;
    getCurrentPhase: () => string | null;
    getCurrentPhaseConfig: () => {
      allowRead: boolean;
      allowWrite: boolean;
      mode: string;
      maxAgents: number;
      allowedAgentRoles: string[];
      phase: string;
    } | null;
    getCurrentPhaseIndex: () => number;
    getPipeline: () => PipelineDefinition | null;
    describe: () => string;
    isComplete: () => boolean;
  } | null;

  agentMatcher: AgentMatcher;
  parallelDispatcher: ParallelDispatcher;
  predictiveRouter: PredictiveRouter;
  handoffsRef: () => HandoffEntry[];
  circuitBreaker: CircuitBreaker;
  healthTracker: {
    getAllStatuses: () => AgentStatus[];
    isAutoPaused: (agent: string) => boolean;
  };
  featureIndex: FeatureIndex;
  regressionGuard: RegressionGuard;
  pipelineState?: PipelineState;
  priorityIndex?: PriorityIndex;
  transactionManager?: AgentTransactionManager;
  contextNudgeManager?: ContextNudgeManager;
  
  elicitationEmit?: (event: unknown) => void;
  
  elicitationAsk?: import("../services/elicitation-gate.ts").ElicitationAsk;
  
  askChannel?: import("../services/ask-channel.ts").AskChannel;
  
  emitWithChain?: (type: string, payload: Record<string, unknown>) => void;
  
  chainCtx?: import("../services/chain-ctx.ts").ChainCtx | null;
  
  recordDecision?: (content: string, opts?: { tags?: string[]; importance?: "low" | "medium" | "high" }) => void;
  
  serviceClients?: MessageUpdatedServiceClients;
}


export interface MessageUpdatedServiceClients {
  analyzeMessage: (text: string) => RoutingResult;
  analyzeEffort: (task: string) => EffortAnalysis;
  isComplexTask: (task: string) => boolean;
  isComplexEffort: (effort: EffortAnalysis | null, content: string) => boolean;
  runElicitationGate: (
    analysis: EffortAnalysis,
    task: string,
    deps?: ElicitationGateDeps,
  ) => Promise<ElicitationResult>;
  buildOptions: (analysis: EffortAnalysis, task: string) => string[];
  formatAskPrompt: (title: string, kind: AskKind) => string;
  isAskInjection: (message?: {
    role?: string;
    message?: { role?: string };
    parts?: Array<{ type?: string; text?: unknown; [k: string]: unknown }>;
  }) => boolean;
  getPipeline: (effort: ThinkingEffort) => PipelineDefinition;
  describePipeline: (pipeline: PipelineDefinition) => string;
  classifyMessagePriority: (text: string, tool?: string, agent?: string) => PriorityResult;
  estimateTokens: (text: string) => number;
  estimateContextUsage: (
    conversationTokens: number,
    toolOutputTokens: number,
    memoryTokens: number,
    systemPromptTokens: number,
    maxTokens: number,
  ) => ContextUsage;
  
  takeCopilotDigest?: (sessionId: string) => string | undefined;




}
