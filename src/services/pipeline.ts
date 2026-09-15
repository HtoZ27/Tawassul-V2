import { t } from "../translations.ts";

import type { ThinkingEffort } from "./effort-analyzer.ts";

export type TaskPhase = "analysis" | "planning" | "execution" | "testing";
export type ClosurePhase = "completed" | "closed";
export type TransitionPhase = TaskPhase | ClosurePhase;

export interface PipelineDefinition {
  phases: TaskPhase[];
  closurePhases?: ClosurePhase[];
  effort: ThinkingEffort;
  description: string;
}

export interface AgentAssignment {
  phase: TaskPhase;
  agents: string[];
  maxConcurrent: number;
  mode: "parallel" | "sequential" | "hybrid";
}

export interface PhaseConfig {
  phase: TaskPhase;
  allowRead: boolean;
  allowWrite: boolean;
  mode: "parallel" | "sequential" | "hybrid";
  maxAgents: number;
  allowedAgentRoles: string[];
}

export interface PhaseResult {
  phase: TaskPhase;
  status: "pending" | "in-progress" | "completed" | "failed" | "skipped";
  completeness?: number;
  agents?: string[];
  output?: Record<string, unknown>;
  filesChanged?: string[];
  errors?: string[];
  startedAt?: string;
  completedAt?: string;
  duration?: number;
}

export interface TransitionResult {
  allowed: boolean;
  reason: string;
  requiredActions: string[];
}

export type TestVerdict = "pass" | "minor" | "major";

export interface TestFailure {
  testName: string;
  file: string;
  errorMessage: string;
  category: "syntax" | "logic" | "integration" | "performance" | "unknown";
  severity: "minor" | "major";
}

export interface TestClassification {
  verdict: TestVerdict;
  passedTests: number;
  failedTests: number;
  totalTests: number;
  failures: TestFailure[];
  passRate: number;
}

export interface TestPlan {
  testTypes: string[];
  files: string[];
  estimatedDuration: number;
  requiredAgents: string[];
}

export interface TestOutput {
  total: number;
  passed: number;
  failed: number;
  failures?: Array<{ name: string; file: string; message: string }>;
}

export interface ExecutionResultInput {
  filesChanged: string[];
  specializations?: string[];
  errors?: string[];
}

export const PIPELINE_MAP: Record<ThinkingEffort, PipelineDefinition> = {
  shallow: {
    phases: ["analysis", "execution"],
    closurePhases: ["completed", "closed"],
    effort: "shallow",
    get description() {
      return t("pipeShallowDesc");
    },
  },
  moderate: {
    phases: ["analysis", "execution", "testing"],
    closurePhases: ["completed", "closed"],
    effort: "moderate",
    get description() {
      return t("pipeModerateDesc");
    },
  },
  deep: {
    phases: ["analysis", "planning", "execution", "testing"],
    closurePhases: ["completed", "closed"],
    effort: "deep",
    get description() {
      return t("pipeDeepDesc");
    },
  },
  "analyze-first": {
    phases: ["analysis", "planning", "execution", "testing"],
    closurePhases: ["completed", "closed"],
    effort: "analyze-first",
    get description() {
      return t("pipeAnalyzeFirstDesc");
    },
  },
};

export const DEFAULT_PHASE_AGENTS: Record<TaskPhase, string[]> = {
  analysis: ["@analyst"],
  planning: ["@architect"],
  execution: ["@dev"],
  testing: ["@tester"],
};

export const PHASE_CONFIGS: Record<TaskPhase, PhaseConfig> = {
  analysis: {
    phase: "analysis",
    allowRead: true,
    allowWrite: false,
    mode: "parallel",
    maxAgents: 3,
    allowedAgentRoles: ["analyst"],
  },
  planning: {
    phase: "planning",
    allowRead: true,
    allowWrite: true,
    mode: "sequential",
    maxAgents: 1,
    allowedAgentRoles: ["architect"],
  },
  execution: {
    phase: "execution",
    allowRead: true,
    allowWrite: true,
    mode: "hybrid",
    maxAgents: 3,
    allowedAgentRoles: ["dev"],
  },
  testing: {
    phase: "testing",
    allowRead: true,
    allowWrite: false,
    mode: "sequential",
    maxAgents: 1,
    allowedAgentRoles: ["tester"],
  },
};

export const PHASE_LABELS: Record<TaskPhase, string> = {
  analysis: "Analysis",
  planning: "Planning",
  execution: "Execution",
  testing: "Testing",
};

export const EFFORT_LABELS: Record<ThinkingEffort, string> = {
  shallow: "Shallow",
  moderate: "Moderate",
  deep: "Deep",
  "analyze-first": "Analyze-First",
};

export const PASS_THRESHOLD = 0.95;
export const MINOR_THRESHOLD = 0.7;
export const MINOR_MAX_FAILURES = 5;
export const MAJOR_FAILURE_THRESHOLD = 5;