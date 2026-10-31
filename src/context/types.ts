

import type { RuleDecision } from "../conflict-resolver/types.ts";

export type FileLocation = {
  file: string;
  line?: number;
  lineEnd?: number;
  snippet?: string;
  label?: string;
  specializations?: string[];
  confidence?: number;
};

export type RecordEntry = {
  id: string;
  type: "decision" | "fix" | "incident" | "note";
  timestamp: string;
  agent: string;
  title: string;
  detail: string;
  severity?: "critical" | "severe" | "moderate" | "minor";
  specializations?: string[];
  locations?: FileLocation[];
  provenance?: "user_stated" | "agent_inferred" | "tool_observed";
  decision_kind?: "decision" | "proposal";
};

export type Checkpoint = {
  completed: string[];
  remaining: string[];
  filesChanged: string[];
  decisions: { title: string; detail: string }[];
};

export type HandoffEntry = {
  id: string;
  from: string;
  to: string;
  task: string;
  context: string;
  files: string[];
  timestamp: string;
  status: "pending" | "accepted" | "completed" | "cancelled" | "paused" | "closed";
  checkpoint?: Checkpoint;
  rescue?: boolean;
  senderErrorCleared?: boolean;
  result?: string;
  parallelId?: string;
  sourceLocations?: FileLocation[];
  sourceRecordId?: string;
  sourceDiscussionId?: string;
  credentialScope?: "inherit" | "isolated";
  
  acceptanceCriteria?: string[];
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  
  
  decisionRuleId?: string;
  decision?: RuleDecision;
  
  
  reroutedModel?: string;


  contextPackId?: string;
  contextPackDigest?: string;
  contextPackActivatedAt?: string;
  parentID?: string;
};

export type Strictness = "relaxed" | "normal" | "strict";

export type AgentModelEntry = {
  model?: string;
  options?: Record<string, unknown>;
};

export type AgentModelConfig = {
  models?: AgentModelEntry[];
  capability?: string;
};

export type TawassulConfig = {
  disabled?: boolean;
  team?: string[];
  strictness?: "relaxed" | "normal" | "strict";
  maxRecords?: number;
  maxHandoffs?: number;
  maxCompactItems?: number;
  maxDynamicAgents?: number;
  maxCallDepth?: number;
  iterationBudgets?: Record<string, number>;
  adaptiveBudgets?: boolean;
  projectScale?: "small" | "medium" | "large";
  budgetStepPercent?: number;
  budgetCeilingFactor?: number;
  budgetTiers?: Record<string, number>;
  maxTotalTasks?: number;
  suggestedHandoffs?: Record<string, string[]>;
  stateFile?: string;
  configFile?: string;
  language?: "en";
  privacyGuardParanoid?: boolean;
  consensusBroker?: boolean;
  
  
  agents?: Record<string, unknown>;
  deleted?: string[];
  agentEvaluation?: EvaluationConfig;
  agentModels?: Record<string, AgentModelConfig>;
  
  
  routing?: {
    applyAgentMatcherSuggestion?: boolean;
  };
  rateLimits?: {
    burstMax?: number;
    burstWindowMs?: number;
    concurrentMax?: number;
    slidingMax?: number;
    slidingWindowMs?: number;
    backToBurstAfterMs?: number;
    apiRetryMax?: number;
    apiRetryBaseMs?: number;
  };
  freeLimit?: {
    notice?: boolean;
    noRetry?: boolean;
  };
  fallback?: {
    enabled?: boolean;
    maxSwitches?: number;
    cooldownMs?: number;
    chains?: Record<string, string[]>;
  };
  health?: {
    stuckTimeoutMs?: number;
    circuitBreakerThreshold?: number;
    circuitBreakerResetMs?: number;
  };
  
  
  
  innovations?: Record<string, { enabled?: boolean; beta?: boolean; mandatory?: boolean }>;
  memoryWatchdogThreshold?: number;
  initTimeoutMs?: number;
  
  
  
  injectToolSchemas?: boolean;
};

export type AgentFlag = {
  symbol: "🔴" | "🟠" | "🟡";
  message: string;
  metric: string;
};

export type AgentRating = {
  agent: string;
  handoffsInitiated: number;
  handoffsCompletedAsRecipient: number;
  handoffsAccepted: number;
  handoffsDropped: number;
  checkpointsUsed: number;
  emptyCheckpoints: number;
  recordsCreated: number;
  validationErrors: number;
  totalContextWords: number;
  totalContextHandoffs: number;
  totalTaskWords: number;
  totalTaskHandoffs: number;
  rapidReHandoffs: number;
  helpRequestsSent: number;
  helpRequestsFulfilled: number;
  lastAcceptedHandoffId: string | null;
  lastActionType: "initiated" | "accepted" | "completed" | "recorded" | "reverted" | "none";
  lastActionAt: string;
  toolCallStats?: {
    total: number;
    success: number;
    failed: number;
    byTool: Record<string, { total: number; success: number; failed: number }>;
  };
  toolCallSuccessRate?: number;
};

export type EvaluationConfig = {
  enabled?: boolean;
  minCompletionRatio?: number;
  minContextLengthAvg?: number;
  minTaskLengthAvg?: number;
  minRecordsPerAgent?: number;
  scoreWeights?: {
    completedAsRecipient: number;
    completedCap: number;
    checkpointUsed: number;
    checkpointCap: number;
    recordCreated: number;
    recordCap: number;
    droppedHandoff: number;
    emptyCheckpoint: number;
    rapidReHandoff: number;
    validationError: number;
    validationErrorCap: number;
    helpRequestSent: number;
    helpRequestSentCap: number;
    helpRequestFulfilled: number;
    helpRequestFulfilledCap: number;
  };
};
