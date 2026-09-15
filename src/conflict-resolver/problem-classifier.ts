import type { ProblemSize, AgentAssignment, ClassificationResult, ClassificationInput } from "./types.ts";



const THRESHOLDS = {
  SIMPLE_MAX: 10,
  MEDIUM_MAX: 100,
} as const;



const AGENT_MATRIX: Record<ProblemSize, AgentAssignment> = {
  SIMPLE: {
    primary: "@dev",
    secondary: [],
    coordination: "none",
    handoffPattern: 1,
    model: "opencode/mimo-v2.5-free",
  },
  MEDIUM: {
    primary: "@dev",
    secondary: ["@tester"],
    coordination: "sequential",
    handoffPattern: 2,
    model: "opencode/mimo-v2.5-free",
  },
  COMPLEX: {
    primary: "@analyst",
    secondary: ["@dev", "@reviewer", "@tester"],
    coordination: "parallel",
    handoffPattern: 4,
    model: "opencode/big-pickle",
  },
};




type PatternSignature = {
  regex: RegExp;
  suggestedTier: ProblemSize;
  confidenceBonus: number;
  label: string;
};

const PATTERNS: PatternSignature[] = [
  
  {
    regex: /param(?:eter)?\s*(config|sett|error|fix)/i,
    suggestedTier: "SIMPLE",
    confidenceBonus: 15,
    label: "parameter configuration error",
  },
  {
    regex: /syntax\s*(valid|error|fix|issue)/i,
    suggestedTier: "SIMPLE",
    confidenceBonus: 15,
    label: "syntax validation issue",
  },
  {
    regex: /(simple|trivial|minor|typo|typing)\s*(fix|bug|error|issue)/i,
    suggestedTier: "SIMPLE",
    confidenceBonus: 10,
    label: "simple/trivial fix",
  },
  {
    regex: /config\s*(bug|error|fix|typo)/i,
    suggestedTier: "SIMPLE",
    confidenceBonus: 10,
    label: "configuration bug",
  },

  
  {
    regex: /(perform|optim|slow|latency|throughput)/i,
    suggestedTier: "MEDIUM",
    confidenceBonus: 10,
    label: "performance optimization",
  },
  {
    regex: /(connection\s*pool|db\s*pool|pool\s*exhaust|database\s*conn)/i,
    suggestedTier: "MEDIUM",
    confidenceBonus: 12,
    label: "database connection management",
  },
  {
    regex: /(module|component|service)\s*(level|improve|refactor)/i,
    suggestedTier: "MEDIUM",
    confidenceBonus: 8,
    label: "module-level improvement",
  },
  {
    regex: /(ui|ux|interface|frontend|layout)\s*(logic|fix|adjust|bug)/i,
    suggestedTier: "MEDIUM",
    confidenceBonus: 8,
    label: "UI logic adjustment",
  },
  {
    regex: /(cache|memory|resource)\s*(leak|exhaust|manage|optim)/i,
    suggestedTier: "MEDIUM",
    confidenceBonus: 10,
    label: "resource management issue",
  },

  
  {
    regex: /(multi.?agent|coordination|orchestrat|handoff)\s*(fail|break|deadlock|race)/i,
    suggestedTier: "COMPLEX",
    confidenceBonus: 15,
    label: "multi-agent coordination failure",
  },
  {
    regex: /(system.?wide|enterprise|architect|production.\s*deploy)/i,
    suggestedTier: "COMPLEX",
    confidenceBonus: 12,
    label: "system-wide architecture issue",
  },
  {
    regex: /(security|vulnerab|exploit|auth.?|permission)\s*(audit|breach|fix|issue)/i,
    suggestedTier: "COMPLEX",
    confidenceBonus: 12,
    label: "security vulnerability",
  },
  {
    regex: /(distribut|consensus|replic|shard|partition)/i,
    suggestedTier: "COMPLEX",
    confidenceBonus: 10,
    label: "distributed systems issue",
  },
];




export function classifyProblemSize(input: ClassificationInput): ClassificationResult {
  const { description, lineCount, impactScope, fileCount } = input;

  
  let baseTier: ProblemSize;
  let baseConfidence: number;

  if (lineCount <= THRESHOLDS.SIMPLE_MAX) {
    baseTier = "SIMPLE";
    baseConfidence = 90;
  } else if (lineCount <= THRESHOLDS.MEDIUM_MAX) {
    baseTier = "MEDIUM";
    baseConfidence = 85;
  } else {
    baseTier = "COMPLEX";
    baseConfidence = 95;
  }

  
  let matchedPattern: PatternSignature | undefined;
  for (const p of PATTERNS) {
    if (p.regex.test(description)) {
      matchedPattern = p;
      break;
    }
  }

  
  
  let finalTier: ProblemSize = baseTier;
  let confidence = baseConfidence;

  if (matchedPattern) {
    const tierRank: Record<ProblemSize, number> = { SIMPLE: 0, MEDIUM: 1, COMPLEX: 2 };

    if (tierRank[matchedPattern.suggestedTier] > tierRank[baseTier]) {
      
      finalTier = matchedPattern.suggestedTier;
    }
    
    confidence = Math.min(100, confidence + matchedPattern.confidenceBonus);
  }

  
  if (impactScope === "system" && finalTier === "MEDIUM") {
    finalTier = "COMPLEX";
    confidence = Math.min(100, confidence + 10);
  }
  if (impactScope === "localized" && finalTier === "MEDIUM" && lineCount <= THRESHOLDS.SIMPLE_MAX) {
    finalTier = "SIMPLE";
    confidence = Math.min(100, confidence + 5);
  }

  
  const effectiveFileCount = fileCount ?? 1;
  if (effectiveFileCount >= 4 && finalTier !== "COMPLEX") {
    finalTier = "COMPLEX";
    confidence = Math.min(100, confidence + 5);
  } else if (effectiveFileCount >= 2 && finalTier === "SIMPLE") {
    finalTier = "MEDIUM";
    confidence = Math.min(100, confidence + 5);
  }

  
  const approach = getApproach(finalTier);

  
  const analysisTime = getAnalysisTime(finalTier);

  return {
    tier: finalTier,
    lineCount,
    confidence,
    agents: { ...AGENT_MATRIX[finalTier] },
    approach,
    analysisTime,
    matchedPattern: matchedPattern?.label,
  };
}



function getApproach(tier: ProblemSize): string {
  switch (tier) {
    case "SIMPLE":
      return "Direct fix or parameter correction with unit validation";
    case "MEDIUM":
      return "Optimized implementation with intermediate validation and integration tests";
    case "COMPLEX":
      return "Comprehensive architecture redesign with parallel agent coordination and full E2E testing";
  }
}

function getAnalysisTime(tier: ProblemSize): string {
  switch (tier) {
    case "SIMPLE": return "5-10 min";
    case "MEDIUM": return "15-30 min";
    case "COMPLEX": return "1-2+ hours";
  }
}






export const SCENARIO_CLASSIFICATIONS: Record<string, ClassificationResult> = {
  "TAWA parameter configuration error": classifyProblemSize({
    description: "parameter configuration error in tawassul.json",
    lineCount: 5,
    impactScope: "localized",
    fileCount: 1,
  }),
  "Multi-agent coordination failure in production": classifyProblemSize({
    description: "multi-agent coordination failure in production environment causing deadlock",
    lineCount: 150,
    impactScope: "system",
    fileCount: 5,
  }),
  "Database connection pool exhaustion": classifyProblemSize({
    description: "database connection pool exhaustion under peak load",
    lineCount: 75,
    impactScope: "module",
    fileCount: 2,
  }),
}
