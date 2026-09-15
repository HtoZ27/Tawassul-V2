export type TaskPriority = "P0" | "P1" | "P2" | "P3" | "P4";

export type RuleInput = {
  from: string;
  to: string;
  task: string;
  context: string;
  files: string[];
  agentBusy: boolean;
  busyHandoffId?: string;
  busyTask?: string;
  activeHandoffs: number;
  errorCount: number;
  fileConflict: boolean;
  conflictAgent?: string;
  conflictFiles?: string[];
  lockedFiles: string[];
  agentPriority: number;
  capabilityMatch: boolean;
  
  srcCap?: string;
  
  dstCap?: string;
  
  allAgentCapabilities?: Record<string, string>;
  taskPriority: TaskPriority;
  taskComplexity: "simple" | "medium" | "complex";
  timeSinceLastHandoff: number;
  totalHandoffsToday: number;
  agentRating: number;
};

export type RuleDecision = {
  action: "allow" | "block" | "reroute" | "warn" | "queue";
  reason: string;
  confidence: number;
  suggestedAgent?: string;
  suggestedPriority?: TaskPriority;
  metadata?: Record<string, unknown>;
};

export type ClassifierInput = {
  agentBusy: boolean;
  fileConflict: boolean;
  capabilityMatch: boolean;
  agentPriority: number;
  activeHandoffs: number;
  errorCount: number;
  taskComplexity: "simple" | "medium" | "complex";
};

export type ClassifierOutput = {
  action: "allow" | "block" | "reroute" | "warn";
  confidence: number;
};

export type FileLock = {
  file: string;
  lockedBy: string;
  handoffId: string;
  lockedAt: string;
  expiresAt: string;
};

export type TeamStats = {
  activeAgents: number;
  activeHandoffs: number;
  completedToday: number;
  avgCompletionTime: number;
  successRate: number;
  topAgent: string;
  bottleneckAgent: string;
  recentErrors: number;
};

export type SmartAlert = {
  level: "info" | "warning" | "critical";
  message: string;
  action?: string;
  agent?: string;
};

export type MemoryEntry = {
  id: string;
  agent: string;
  timestamp: string;
  content: string | Record<string, unknown>;
  tags: string[];
  importance: "low" | "medium" | "high";
  decayFactor: number;
  
  occurrences?: number;
  
  classification?: "public" | "private" | "shared";
  
  source?: string;
  
  sharedWith?: string[];
  
  expiresAt?: string;
  
  provenance?: "user_stated" | "agent_inferred" | "tool_observed";
};

export type SharedMemory = {
  version: number;
  lastCompacted: string;
  decisions: MemoryEntry[];
  learnings: MemoryEntry[];
  warnings: MemoryEntry[];
  fileContext: Record<
    string,
    { path: string; lastModified: string; lastAgent: string; summary: string; relatedFiles: string[] }
  >;
  agentContext: Record<
    string,
    { agent: string; lastActive: string; currentTask?: string; expertise: string[]; recentErrors: string[] }
  >;
  handoffHistory: {
    id: string;
    from: string;
    to: string;
    task: string;
    timestamp: string;
    success: boolean;
    duration: number;
  }[];
};

export type Achievement = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "handoff" | "record" | "quality" | "collaboration" | "special";
  requirement:
    | { type: "count"; metric: string; count: number }
    | { type: "streak"; days: number }
    | { type: "rating"; minRating: number }
    | { type: "special"; condition: string };
  points: number;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
};

export type AgentScore = {
  agent: string;
  points: number;
  level: number;
  achievements: Achievement[];
  streak: number;
  
  lastActiveDate?: string;
  rank: "beginner" | "intermediate" | "expert" | "master" | "legendary";
};



export type ProblemSize = "SIMPLE" | "MEDIUM" | "COMPLEX";

export type AgentAssignment = {
  primary: string;
  secondary: string[];
  coordination: "none" | "sequential" | "parallel";
  handoffPattern: number;
  model: string;
};

export type ClassificationResult = {
  tier: ProblemSize;
  lineCount: number;
  confidence: number;
  agents: AgentAssignment;
  approach: string;
  analysisTime: string;
  matchedPattern?: string;
};

export type ClassificationInput = {
  description: string;
  lineCount: number;
  impactScope?: "localized" | "module" | "system";
  fileCount?: number;
};

export type FailedModel = {
  model: string;
  failedAt: string;
  error: string;
  retryAfter?: number;
};

export type TawaPreferences = {
  modelChoices: Record<string, string>;
  userProviders: string[];
  learnedPreferences: Record<string, unknown>;
  failedModels: Record<string, FailedModel>;
  lastUpdated: string;
};
