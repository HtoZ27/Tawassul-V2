


export type ContextPriority = "pinned" | "critical" | "high" | "normal" | "low" | "ephemeral";

export type MessageSource = "tool" | "agent" | "message" | "hybrid";

export interface PriorityResult {
  priority: ContextPriority;
  score: number;
  factors: string[];
  source: MessageSource;
}

export interface ScoredContextEntry {
  id: string;
  priority: ContextPriority;
  score: number;
  tokens: number;
  protected: boolean;
  agent: string;
  timestamp: number;
  type: string;
  dependsOn: string[];
}

export interface PriorityIndexStats {
  total: number;
  byPriority: Record<string, number>;
  byAgent: Record<string, number>;
  totalTokens: number;
  protectedCount: number;
}

export interface DedupSignature {
  tool: string;
  agent: string;
  sessionId: string;
  callDepth: number;
  argsHash: string;
  timestamp: number;
}

export interface DedupResult {
  isDuplicate: boolean;
  strategy: "skip" | "merge" | "throttle" | "pass";
  reason: string;
  mergeWithId?: string;
}

export type NudgeAction = "defer" | "compact" | "summarize" | "save" | "handoff" | "pause";

export interface NudgeConfig {
  threshold: number;
  severity: "info" | "warning" | "critical";
  action: NudgeAction;
}

export interface ContextNudge {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
  action: NudgeAction;
  threshold: number;
  timestamp: number;
}

export interface ContextUsage {
  usedTokens: number;
  maxTokens: number;
  percentage: number;
  breakdown: {
    systemPrompt: number;
    conversationHistory: number;
    toolOutputs: number;
    agentMemory: number;
  };
}

export const PRIORITY_ORDER: ContextPriority[] = ["pinned", "critical", "high", "normal", "low", "ephemeral"];

export function priorityWeight(p: ContextPriority): number {
  const w: Record<string, number> = {
    pinned: 100,
    critical: 80,
    high: 60,
    normal: 40,
    low: 20,
    ephemeral: 0,
  };
  return w[p] ?? 0;
}
