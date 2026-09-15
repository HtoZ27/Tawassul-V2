



export type Severity = "critical" | "moderate" | "low";
export type Priority = "high" | "medium" | "low";
export type Risk = "high" | "medium" | "low";

export type DiscussionPhase = "collecting" | "proposing" | "voting" | "dividing" | "completed";

export interface DiscussionError {
  id: string;
  file: string;
  line: number;
  type: string;
  severity: Severity;
  message: string;
}

export interface Proposal {
  id: string;
  agentId: string;
  errorId: string;
  solution: string;
  priority: Priority;
  estimatedEffort: number; 
  risk: Risk;
  justification?: string;
  timestamp: string;
}

export interface Vote {
  agentId: string;
  proposalId: string;
  weight: number;
  reason?: string;
  timestamp: string;
}

export interface Task {
  id: string;
  description: string;
  assignedTo: string;
  priority: Priority;
  estimatedTime: number; 
  dependsOn?: string[];
  status: "pending" | "in-progress" | "completed";
}

export interface Solution {
  id: string;
  proposalId: string;
  score: number;
  tasks: Task[];
  selectedAt: string;
}

export interface Discussion {
  id: string;
  phase: DiscussionPhase;
  errors: DiscussionError[];
  participants: string[];
  proposals: Proposal[];
  votes: Vote[];
  result?: Solution;
  
  adr?: { id: string; decision: string; quorumReached: boolean; alternativesCount: number };
  createdAt: string;
  updatedAt: string;
  consensusActive?: boolean;
}



export interface CreateDiscussionInput {
  errors: DiscussionError[];
  participants: string[];
}



export interface DiscussionResult {
  success: boolean;
  discussion?: Discussion;
  error?: string;
}

export interface VoteResult {
  success: boolean;
  winningProposal?: Proposal;
  score?: number;
  
  structured?: {
    discussionId: string;
    phase: string;
    votesCast: number;
    totalParticipants: number;
    quorumMet: boolean;
    leader?: { id: string; agent: string; solution: string; score: number };
  };
  error?: string;
}

export interface TaskDivisionResult {
  success: boolean;
  tasks?: Task[];
  assignments?: Record<string, Task[]>;
  handoffIds?: string[];
  error?: string;
}



export const SCORING_WEIGHTS = {
  
  voteConsensus: 0.4,
  
  riskLow: 0.2,
  
  priorityBoost: 0.1,
  
  solutionCoverage: 0.3,
} as const;

export const PRIORITY_WEIGHTS: Record<Priority, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
};

export const RISK_WEIGHTS: Record<Risk, number> = {
  high: 0.3,
  medium: 0.6,
  low: 1.0,
};

export const MAX_SOLUTION_LENGTH = 2000;
export const MAX_PARTICIPANTS_PER_DISCUSSION = 10;



export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputValidationError";
  }
}



export const MAX_TASKS_PER_AGENT = 3;
export const AGENT_TASK_ROLES: Record<string, string[]> = {
  dev: ["implementation", "bug-fix", "optimization"],
  architect: ["design", "architecture", "refactoring"],
  reviewer: ["review", "security", "quality"],
  tester: ["testing", "verification"],
};
