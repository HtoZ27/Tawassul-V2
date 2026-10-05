import { classifyText } from "../lib/classifier.ts";
import { WeightingResolver } from "./weighting-resolver.ts";

const WORD_SPLIT = /\s+/;
const FILE_EXT_PATTERN =
  /\b[\w\-./]+\.(ts|js|tsx|jsx|rs|py|go|rb|java|c|cpp|h|hpp|cs|swift|kt|scala|php|vue|svelte|json|yaml|yml|toml|md|css|scss|less|html|sql|sh|bash|zsh|fish|env|gitignore|dockerfile|dockerignore|tf|hcl|mod|sum)\b/gi;
const STEP_PATTERNS = [
  /\b(first|second|third)\b/gi,
  /\b(then|after|finally|next)\b/gi,
  /\d+[.)]\s+/g,
  /\bstep\s*\d+/gi,
  /\bphase\s*\d+/gi,
];

export type ThinkingEffort = "shallow" | "moderate" | "deep" | "analyze-first";

export type EffortAnalysis = {
  specializations: string[];
  thinking_effort: ThinkingEffort | null;
  role: string | null;
  reasoning: string;
  ambiguity: boolean;
  action_hint: string;
  structuralComplexity: number;
  specializationConfidence?: { lower: number; upper: number; marginOfError: number };
  taskScope: {
    toolMentions: number;
    fileMentions: number;
    stepsDetected: number;
    wordCount: number;
  };
};

const SHALLOW_KEYWORDS = [
  "color",
  "typo",
  "rename",
  "change",
  "small change",
  "simple",
  "update",
  "version",
  "line",
  "css",
  "style",
  "button color",
  "button",
];

const MODERATE_KEYWORDS = [
  "add",
  "feature",
  "improve",
  "implement",
  "build",
  "develop",
  "medium",
  "moderate",
  "unit",
  "module",
  "test",
  "testing",
  "quality",
  "qa",
  "bug",
  "fix",
  "error",
  "function",
  "component",
];

const DEEP_KEYWORDS = [
  "design",
  "architecture",
  "redesign",
  "refactor",
  "complete",
  "system",
  "complex",
  "large",
  "platform",
  "pickle",
  "full",
  "comprehensive",
  "integrate",
  "vulnerability",
  "secure",
  "security",
  "monolith",
  "microservice",
  "microservices",
  "event-driven",
  "concurrent",
  "distributed",
];

const ANALYZE_FIRST_KEYWORDS = [
  "slow",
  "analyze",
  "study",
  "problem",
  "issue",
  "unknown",
  "choose",
  "select",
  "strategy",
  "plan",
  "migrate",
  "migration",
  "not sure",
  "investigate",
  "diagnose",
  "performance",
  "optimization",
  "performance optimization",
  "compare",
  "comparison",
  "evaluate",
  "options",
  "alternatives",
];

const AMBIGUITY_INDICATORS = [
  "fix",
  "fix it",
  "this",
  "that",
  "something",
  "issue",
  "some problem",
  "it",
  "he",
  "she",
  "they",
];

function softmax(scores: number[]): number[] {
  const max = Math.max(...scores, 0);
  const exps = scores.map((s) => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

interface EffortArchetype {
  name: ThinkingEffort;
  keywords: string[];
  baseScore: number;
}

const MATCH_BOOST = 0.3;

const ARCHETYPES: EffortArchetype[] = [
  { name: "shallow", keywords: SHALLOW_KEYWORDS, baseScore: 0.35 },
  { name: "moderate", keywords: MODERATE_KEYWORDS, baseScore: 0.34 },
  { name: "deep", keywords: DEEP_KEYWORDS, baseScore: 0.26 },
  { name: "analyze-first", keywords: ANALYZE_FIRST_KEYWORDS, baseScore: 0.28 },
];

function countKeywordMatches(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) count++;
  }
  return count;
}

const SPEC_TO_ROLE: Record<string, string> = {
  architecture: "architect",
  backend: "dev",
  frontend: "dev",
  security: "reviewer",
  testing: "tester",
  devops: "dev",
  data: "analyst",
  documentation: "doc",
  performance: "dev",
  refactoring: "dev",
  review: "reviewer",
};

function determineRole(specializations: string[]): string | null {
  if (specializations.length === 0) return null;

  if (specializations.includes("security") && specializations.includes("backend")) {
    return "reviewer";
  }

  if (specializations.includes("architecture")) return "architect";
  if (specializations.includes("testing")) return "tester";
  if (specializations.includes("review")) return "reviewer";
  if (specializations.includes("documentation")) return "doc";
  if (specializations.includes("data")) return "analyst";
  if (specializations.includes("security")) return "reviewer";

  const primary = specializations[0]!;
  return SPEC_TO_ROLE[primary] ?? "dev";
}

function buildReasoning(
  specializations: string[],
  effort: ThinkingEffort | null,
  role: string | null,
  shallowScore: number,
  moderateScore: number,
  deepScore: number,
  analyzeScore: number,
  wordCount: number,
  structuralComplexity: number,
  taskScope: { toolMentions: number; fileMentions: number; stepsDetected: number; wordCount: number },
): string {
  const parts: string[] = [];

  if (specializations.length > 0) {
    parts.push(`Specializations: ${specializations.join(" + ")}`);
  } else {
    parts.push("No specific specialization identified");
  }

  if (effort) {
    const effortNames: Record<string, string> = {
      shallow: "Shallow",
      moderate: "Moderate",
      deep: "Deep",
      "analyze-first": "Analyze-First",
    };
    parts.push(
      `Thinking effort: ${effortNames[effort]} (shallow=${shallowScore}, moderate=${moderateScore}, deep=${deepScore}, analyze=${analyzeScore})`,
    );
  }

  if (role) parts.push(`Role: ${role}`);

  parts.push(`Structural complexity: ${(structuralComplexity * 100).toFixed(0)}%`);

  if (taskScope.toolMentions > 0) parts.push(`Tools mentioned: ${taskScope.toolMentions}`);
  if (taskScope.fileMentions > 0) parts.push(`Files mentioned: ${taskScope.fileMentions}`);
  if (taskScope.stepsDetected > 0) parts.push(`Steps required: ${taskScope.stepsDetected}`);

  if (wordCount < 3) {
    parts.push("⚠️ Request is very short — may need clarification");
  } else if (wordCount > 80) {
    parts.push("📋 Long request — requires careful processing");
  }

  return parts.join(" | ");
}

function analyzeStructure(text: string): {
  toolMentions: number;
  fileMentions: number;
  stepsDetected: number;
  wordCount: number;
} {
  const lower = text.toLowerCase();
  const wordCount = text.split(WORD_SPLIT).filter(Boolean).length;

  const fileMatches = text.match(FILE_EXT_PATTERN);
  const fileMentions = fileMatches ? new Set(fileMatches.map((m) => m.toLowerCase())).size : 0;

  const toolVerbs = [
    "use tool",
    "run",
    "execute",
    "install",
    "npm",
    "pip",
    "cargo",
    "go get",
    "git",
    "docker",
    "docker-compose",
    "kubectl",
    "helm",
    "terraform",
    "curl",
    "wget",
    "ssh",
    "scp",
    "rsync",
    "sed",
    "awk",
  ];
  let toolMentions = 0;
  for (const tv of toolVerbs) {
    if (lower.includes(tv)) toolMentions++;
  }

  let stepsDetected = 0;
  for (const sp of STEP_PATTERNS) {
    const m = text.match(sp);
    if (m) stepsDetected += m.length;
  }

  return { toolMentions, fileMentions, stepsDetected, wordCount };
}

export function analyzeEffort(task: string): EffortAnalysis {
  if (!task.trim()) {
    return {
      specializations: [],
      thinking_effort: null,
      role: null,
      reasoning: "Empty request",
      ambiguity: true,
      action_hint: "Ask the user to write a task description",
      structuralComplexity: 0,
      taskScope: { toolMentions: 0, fileMentions: 0, stepsDetected: 0, wordCount: 0 },
    };
  }

  const lower = task.toLowerCase();
  const wordCount = lower.split(/\s+/).filter(Boolean).length;

  const shallowScore = countKeywordMatches(lower, SHALLOW_KEYWORDS);
  const moderateScore = countKeywordMatches(lower, MODERATE_KEYWORDS);
  const deepScore = countKeywordMatches(lower, DEEP_KEYWORDS);
  const analyzeScore = countKeywordMatches(lower, ANALYZE_FIRST_KEYWORDS);
  const ambiguityScore = countKeywordMatches(lower, AMBIGUITY_INDICATORS);

  const structure = analyzeStructure(task);
  const { toolMentions, fileMentions, stepsDetected } = structure;

  const structuralComplexity = computeStructuralComplexity(wordCount, toolMentions, fileMentions, stepsDetected);

  const tfidfSpecializations = classifyText(task);

  const resolver = new WeightingResolver();
  const weightedItems = resolver.resolve(
    tfidfSpecializations.map((s, i) => ({
      specialization: s,
      label: s,
      recencyMs: Date.now() - i * 60000,
      agentMatch: 0.5,
      completeness: 0.8,
      confidence: 1.0 - i * 0.1,
      sampleSize: tfidfSpecializations.length,
    })),
  );
  const specializations = weightedItems.map((w) => w.specialization);

  const specializationConfidence =
    weightedItems.length > 0
      ? (resolver.getConfidenceInterval(weightedItems, tfidfSpecializations.length) ?? undefined)
      : undefined;

  const role = determineRole(specializations);

  const isAmbiguous = ambiguityScore > 0 && wordCount < 5;

  let thinking_effort: ThinkingEffort | null;
  let action_hint: string;

  const keywordScore = shallowScore + moderateScore + deepScore + analyzeScore;

  if (isAmbiguous && wordCount < 3) {
    thinking_effort = null;
    action_hint = "Ask the user for clarification — the request is unclear";
  } else if (keywordScore === 0 && wordCount < 4) {
    thinking_effort = null;
    action_hint = "The request is short — may need additional clarification";
  } else if (keywordScore === 0) {
    if (structuralComplexity > 0.6) {
      thinking_effort = "moderate";
      action_hint = "The task may be moderate (based on structural analysis). Use @dev for execution";
    } else if (wordCount > 20) {
      thinking_effort = "shallow";
      action_hint = "The task seems simple. Use a fast agent";
    } else {
      thinking_effort = null;
      action_hint = "The request is unclear — ask the user for clarification";
    }
  } else {
    const scores = ARCHETYPES.map((a) => {
      const matches = countKeywordMatches(lower, a.keywords);
      return a.baseScore + matches * MATCH_BOOST;
    });
    const probs = softmax(scores);
    const maxIdx = probs.indexOf(Math.max(...probs));
    thinking_effort = ARCHETYPES[maxIdx]!.name;

    if (structuralComplexity > 0.6 && thinking_effort === "shallow") {
      thinking_effort = "moderate";
    } else if (structuralComplexity > 0.8 && thinking_effort === "moderate") {
      thinking_effort = "deep";
    }

    const HINT_MAP: Record<string, string> = {
      shallow: "Simple task — use a fast agent (shallow)",
      moderate: "Moderate task — use @dev with @tester review",
      deep: "Deep problem — use @analyst for initial analysis, then @dev for execution",
      "analyze-first": "Start by analyzing the problem before execution — use analyst or architect first",
    };
    action_hint = HINT_MAP[thinking_effort] ?? "Use @dev for execution";

    if (fileMentions > 3) action_hint += ` (${fileMentions} files mentioned)`;
    if (stepsDetected > 2) action_hint += ` (${stepsDetected} steps)`;
  }

  if (specializations.length === 0 && thinking_effort !== null) {
    action_hint = `No clear specialization identified. ${action_hint}`;
  }

  const reasoning = buildReasoning(
    specializations,
    thinking_effort,
    role,
    shallowScore,
    moderateScore,
    deepScore,
    analyzeScore,
    wordCount,
    structuralComplexity,
    { toolMentions, fileMentions, stepsDetected, wordCount },
  );

  return {
    specializations,
    thinking_effort,
    role,
    reasoning,
    ambiguity: isAmbiguous,
    action_hint,
    structuralComplexity,
    taskScope: { toolMentions, fileMentions, stepsDetected, wordCount },
    ...(specializationConfidence ? { specializationConfidence } : {}),
  };
}

function computeStructuralComplexity(
  wordCount: number,
  toolMentions: number,
  fileMentions: number,
  stepsDetected: number,
): number {
  const wordScore = Math.min(1.0, wordCount / 100);
  const toolScore = Math.min(1.0, toolMentions / 5);
  const fileScore = Math.min(1.0, fileMentions / 8);
  const stepScore = Math.min(1.0, stepsDetected / 6);

  const weights = { word: 0.25, tool: 0.3, file: 0.25, step: 0.2 };
  const weighted =
    wordScore * weights.word + toolScore * weights.tool + fileScore * weights.file + stepScore * weights.step;

  return weighted > 0.4 ? Math.min(1.0, weighted * 1.2) : weighted;
}

export function isComplexTask(task: string): boolean {
  if (!passesComplexityGate(task)) return false;
  const analysis = analyzeEffort(task);
  return isComplexEffort(analysis, task);
}

export function passesComplexityGate(task: string): boolean {
  const words = task.split(/\s+/).filter(Boolean);
  if (words.length < 12) {
    const hasFile = /[a-zA-Z0-9_-]+\.[a-z]{2,4}\b|\//.test(task);
    const stepMarkers = (task.match(/(?:after that|step\s*\d|then|and then|first|second|third)/gi) ?? []).length;
    if (!hasFile && stepMarkers < 2 && words.length < 8) return false;
  }
  return true;
}

export function isComplexEffort(effort: EffortAnalysis | null, content: string): boolean {
  if (!effort || !passesComplexityGate(content)) return false;
  return (
    effort.thinking_effort === "deep" ||
    effort.thinking_effort === "analyze-first" ||
    (effort.structuralComplexity ?? 0) > 0.6
  );
}