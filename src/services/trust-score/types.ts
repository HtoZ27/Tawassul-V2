

import { z } from "zod";




export const TrustComponentsSchema = z.object({
  
  successRate: z.number().min(0).max(1),

  
  avgResponseTimeMs: z.number().min(0),

  
  completedTasks: z.number().int().min(0),

  
  errorCount: z.number().int().min(0),

  
  avgOutputQuality: z.number().min(0).max(1),

  
  helpRequests: z.number().int().min(0),

  
  rollbackCount: z.number().int().min(0),

  
  memoryHits: z.number().int().min(0),

  
  memoryMisses: z.number().int().min(0),
});

export type TrustComponents = z.infer<typeof TrustComponentsSchema>;


export const TrustReportSchema = z.object({
  
  agentId: z.string(),

  
  agentName: z.string(),

  
  overallScore: z.number().min(0).max(1),

  
  components: TrustComponentsSchema,

  
  level: z.enum([
    "untrusted", // < 0.3
    "low", // 0.3 - 0.5
    "medium", // 0.5 - 0.7
    "high", // 0.7 - 0.9
    "excellent", // > 0.9
  ]),

  
  beta: z.boolean().default(true),

  
  explanations: z.record(z.string(), z.string()),

  
  lastUpdated: z.string().datetime(),

  
  firstEvaluated: z.string().datetime(),

  
  evaluationCount: z.number().int().min(0),

  
  trend: z.enum(["improving", "declining", "stable"]),

  
  recommendations: z.array(z.string()),

  
  warnings: z.array(z.string()),
});

export type TrustReport = z.infer<typeof TrustReportSchema>;




export const TrustCalculationConfigSchema = z.object({
  
  weights: z.object({
    successRate: z.number().min(0).max(1).default(0.35),
    responseTime: z.number().min(0).max(1).default(0.15),
    outputQuality: z.number().min(0).max(1).default(0.25),
    errorRate: z.number().min(0).max(1).default(0.15),
    memoryEfficiency: z.number().min(0).max(1).default(0.1),
  }),

  
  minTasksForEvaluation: z.number().int().min(1).default(10),

  
  historyLimit: z.number().int().min(10).default(100),

  
  useCollectiveMemory: z.boolean().default(true),

  
  minTrustForRecommendations: z.number().min(0).max(1).default(0.3),
});

export type TrustCalculationConfig = z.infer<typeof TrustCalculationConfigSchema>;




export const TrustScoreHistorySchema = z.object({
  
  agentId: z.string(),

  
  timestamp: z.string().datetime(),

  
  score: z.number().min(0).max(1),

  
  components: TrustComponentsSchema,

  
  taskCount: z.number().int().min(0),
});

export type TrustScoreHistory = z.infer<typeof TrustScoreHistorySchema>;




export const TrustConfigSchema = z.object({
  
  enabled: z.boolean().default(false), // opt-in only

  
  beta: z.boolean().default(true),

  
  calculation: TrustCalculationConfigSchema.default(() => ({
    weights: {
      successRate: 0.35,
      responseTime: 0.15,
      outputQuality: 0.25,
      errorRate: 0.15,
      memoryEfficiency: 0.1,
    },
    minTasksForEvaluation: 10,
    historyLimit: 100,
    useCollectiveMemory: true,
    minTrustForRecommendations: 0.3,
  })),

  
  storagePath: z.string().default("~/.config/tawassyl/state/trust-scores.json"),

  
  retentionMs: z.number().int().min(86400000).default(7776000000),

  
  autoPersist: z.boolean().default(true),

  
  showWarnings: z.boolean().default(true),

  
  showRecommendations: z.boolean().default(true),
});

export type TrustConfig = z.infer<typeof TrustConfigSchema>;


export type TrustOutcomePriors = {
  
  successes: number;
  
  failures: number;
};


function sampleGamma(shape: number, rng: () => number = Math.random): number {
  if (shape < 1) {
    
    return sampleGamma(shape + 1, rng) * Math.pow(rng(), 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  let x: number;
  let v: number;

  while (true) {
    do {
      x = rng();
      v = 1 + c * (rng() * 2 - 1);
    } while (v <= 0);

    v = v * v * v;
    const u = rng();
    const accept = u < 1 - 0.0331 * x * x * x * x || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v));

    if (accept) {
      break;
    }
    void x;
    void v;
  }

  return d * v;
}


export function sampleBeta(alpha: number, beta: number, rng: () => number = Math.random): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  if (x + y === 0) return 0.5;
  return x / (x + y);
}


export function sampleThompsonWeights(
  priors: Record<keyof TrustCalculationConfig["weights"], TrustOutcomePriors>,
  config: TrustCalculationConfig,
  rng: () => number = Math.random,
): TrustCalculationConfig["weights"] {
  const base = config.weights;
  const keys = Object.keys(base) as Array<keyof typeof base>;

  let hasData = false;
  for (const key of keys) {
    if (priors[key].successes > 0 || priors[key].failures > 0) {
      hasData = true;
      break;
    }
  }

  if (!hasData) {
    return { ...base };
  }

  const sampled: Record<keyof typeof base, number> = { ...base };
  for (const key of keys) {
    const { successes, failures } = priors[key];
    if (successes + failures === 0) continue;
    const alpha = 1 + successes;
    const beta = 1 + failures;
    const theta = sampleBeta(alpha, beta, rng);
    
    sampled[key] = 0.3 * theta + 0.7 * base[key];
  }

  
  const total = keys.reduce((sum, key) => sum + sampled[key], 0);
  if (total > 0) {
    for (const key of keys) {
      sampled[key] = sampled[key] / total;
    }
  }

  return sampled;
}


export function getTrustLevel(score: number): TrustReport["level"] {
  if (score < 0.3) return "untrusted";
  if (score < 0.5) return "low";
  if (score < 0.7) return "medium";
  if (score < 0.9) return "high";
  return "excellent";
}


export function calculateOverallScore(components: TrustComponents, config: TrustCalculationConfig): number {
  const { weights } = config;

  
  const errorRate = components.completedTasks > 0 ? 1 - components.errorCount / components.completedTasks : 1;

  
  const memoryEfficiency =
    components.memoryHits + components.memoryMisses > 0
      ? components.memoryHits / (components.memoryHits + components.memoryMisses)
      : 0.5;

  
  const maxResponseTime = 30000; 
  const responseTimeScore = Math.max(0, 1 - components.avgResponseTimeMs / maxResponseTime);

  
  const overallScore =
    weights.successRate * components.successRate +
    weights.responseTime * responseTimeScore +
    weights.outputQuality * components.avgOutputQuality +
    weights.errorRate * errorRate +
    weights.memoryEfficiency * memoryEfficiency;

  return Math.min(1, Math.max(0, overallScore));
}


export function generateRecommendations(components: TrustComponents, level: TrustReport["level"]): string[] {
  const recommendations: string[] = [];

  if (components.successRate < 0.7) {
    recommendations.push("Increase task completion rate by focusing on simpler tasks first");
  }

  if (components.avgResponseTimeMs > 15000) {
    recommendations.push("Reduce response time by optimizing tool usage and context");
  }

  if (components.errorCount > components.completedTasks * 0.2) {
    recommendations.push("High error rate detected — review error patterns and add guards");
  }

  if (components.helpRequests > components.completedTasks * 0.3) {
    recommendations.push("Frequent help requests — consider using Collective Memory for patterns");
  }

  if (components.rollbackCount > 2) {
    recommendations.push("Multiple rollbacks detected — ensure changes are validated before applying");
  }

  if (level === "untrusted" || level === "low") {
    recommendations.push("Trust score is low — start with simpler tasks and build confidence");
  }

  return recommendations;
}


export function generateWarnings(components: TrustComponents, level: TrustReport["level"]): string[] {
  const warnings: string[] = [];

  if (level === "untrusted") {
    warnings.push("Agent is untrusted — exercise extreme caution");
  }

  if (components.errorCount > components.completedTasks * 0.5) {
    warnings.push("Error rate exceeds 50% — agent may be unreliable");
  }

  if (components.completedTasks < 10) {
    warnings.push("Insufficient task history — trust score may be unreliable");
  }

  if (components.rollbackCount > 5) {
    warnings.push("Frequent rollbacks — agent may be making risky changes");
  }

  return warnings;
}


export function calculateTrend(history: TrustScoreHistory[]): TrustReport["trend"] {
  if (history.length < 2) return "stable";

  const recent = history.slice(-5);
  const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
  const secondHalf = recent.slice(Math.floor(recent.length / 2));

  const avgFirst = firstHalf.reduce((sum, h) => sum + h.score, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((sum, h) => sum + h.score, 0) / secondHalf.length;

  const diff = avgSecond - avgFirst;

  if (diff > 0.05) return "improving";
  if (diff < -0.05) return "declining";
  return "stable";
}
