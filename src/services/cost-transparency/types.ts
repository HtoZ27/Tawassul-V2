

import { z } from 'zod';




export const PricingModelSchema = z.object({

  id: z.string().min(1),
  
  
  name: z.string(),
  
  
  provider: z.string(),
  
  
  model: z.string(),
  
  
  inputCostPer1MTokens: z.number().min(0),
  
  
  outputCostPer1MTokens: z.number().min(0),
  
  
  cacheReadCostPer1MTokens: z.number().min(0).optional(),
  
  
  maxContextTokens: z.number().int().min(1),
  
  
  maxOutputTokens: z.number().int().min(1),
  
  
  supported: z.boolean().default(true),
});

export type PricingModel = z.infer<typeof PricingModelSchema>;


export const OperationCostSchema = z.object({
  
  id: z.string().uuid(),
  
  
  modelId: z.string().min(1),
  
  
  inputTokens: z.number().int().min(0),
  
  
  outputTokens: z.number().int().min(0),
  
  
  cacheReadTokens: z.number().int().min(0).optional(),
  
  
  totalCost: z.number().min(0),
  
  
  task: z.string().optional(),
  
  
  agentId: z.string().optional(),
  
  
  success: z.boolean(),
  
  
  durationMs: z.number().int().min(0),


  timestamp: z.string().datetime(),


  estimated: z.boolean().optional(),
});

export type OperationCost = z.infer<typeof OperationCostSchema>;




export const CostSummarySchema = z.object({
  
  totalCost: z.number().min(0),
  
  
  avgCostPerOperation: z.number().min(0),
  
  
  totalInputTokens: z.number().int().min(0),
  
  
  totalOutputTokens: z.number().int().min(0),
  
  
  operationCount: z.number().int().min(0),
  
  
  successRate: z.number().min(0).max(1),
  
  
  byModel: z.record(z.string(), z.number()),
  
  
  byTask: z.record(z.string(), z.number()),
  
  
  byAgent: z.record(z.string(), z.number()),
  
  
  period: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  }),
});

export type CostSummary = z.infer<typeof CostSummarySchema>;


export const CostPerOutcomeSchema = z.object({
  
  outcomeType: z.string(),
  
  
  avgCostPerOutcome: z.number().min(0),
  
  
  outcomeCount: z.number().int().min(0),
  
  
  totalCost: z.number().min(0),
  
  
  successRate: z.number().min(0).max(1),
  
  
  isEfficient: z.boolean(),
  
  
  vsAverage: z.number(), // percentage difference
});

export type CostPerOutcome = z.infer<typeof CostPerOutcomeSchema>;




export const BudgetSchema = z.object({
  
  dailyLimit: z.number().min(0),
  
  
  monthlyLimit: z.number().min(0),
  
  
  currentDailySpend: z.number().min(0).default(0),
  
  
  currentMonthlySpend: z.number().min(0).default(0),
  
  
  lastDailyReset: z.string().datetime(),
  
  
  lastMonthlyReset: z.string().datetime(),
  
  
  alertThreshold: z.number().min(0).max(1).default(0.8),
  
  
  exceeded: z.boolean().default(false),
});

export type Budget = z.infer<typeof BudgetSchema>;




export const CostTransparencyConfigSchema = z.object({
  
  enabled: z.boolean().default(false),
  
  
  maxOperations: z.number().int().min(100).default(10000),
  
  
  retentionMs: z.number().int().min(86400000).default(7776000000),
  
  
  storagePath: z.string().default('~/.config/tawassyl/state/cost-transparency.json'),
  
  
  showRealTimeCost: z.boolean().default(true),
  
  
  alertOnBudgetApproach: z.boolean().default(true),
  
  
  alertThreshold: z.number().min(0).max(1).default(0.8),
});

export type CostTransparencyConfig = z.infer<typeof CostTransparencyConfigSchema>;




export const CostQuerySchema = z.object({
  
  modelId: z.string().uuid().optional(),
  
  
  task: z.string().optional(),
  
  
  agentId: z.string().optional(),
  
  
  success: z.boolean().optional(),
  
  
  since: z.string().datetime().optional(),
  
  
  until: z.string().datetime().optional(),
  
  
  minCost: z.number().min(0).optional(),
  
  
  maxCost: z.number().min(0).optional(),
  
  
  limit: z.number().int().min(1).max(100).optional(),
  
  
  orderBy: z.enum(['cost', 'recent', 'duration']).optional(),
});

export type CostQuery = z.infer<typeof CostQuerySchema>;




export const CostEventSchema = z.object({
  
  type: z.enum([
    'operation_recorded',
    'budget_alert',
    'budget_exceeded',
    'summary_generated',
    'model_added',
    'model_updated',
  ]),
  
  
  payload: z.record(z.string(), z.unknown()),
  
  
  source: z.string(),
  
  
  timestamp: z.string().datetime(),
});

export type CostEvent = z.infer<typeof CostEventSchema>;




export function generateOperationId(): string {
  return crypto.randomUUID();
}


export function generateModelId(): string {
  return crypto.randomUUID();
}


export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: PricingModel,
  cacheReadTokens?: number
): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputCostPer1MTokens;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputCostPer1MTokens;
  const cacheCost = cacheReadTokens && pricing.cacheReadCostPer1MTokens
    ? (cacheReadTokens / 1_000_000) * pricing.cacheReadCostPer1MTokens
    : 0;
  
  return inputCost + outputCost + cacheCost;
}


export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${(cost * 1000).toFixed(2)}m`;
  }
  return `$${cost.toFixed(4)}`;
}


export function formatTokens(tokens: number): string {
  if (tokens < 1000) {
    return tokens.toString();
  }
  if (tokens < 1_000_000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}



export const UNATTRIBUTED_MODEL_ID = "unattributed";

export const DEFAULT_PRICING_MODELS: PricingModel[] = [
  {
    id: UNATTRIBUTED_MODEL_ID,
    name: 'Unattributed (no host usage data)',
    provider: 'unknown',
    model: UNATTRIBUTED_MODEL_ID,
    inputCostPer1MTokens: 0,
    outputCostPer1MTokens: 0,
    maxContextTokens: 128000,
    maxOutputTokens: 16384,
    supported: true,
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    model: 'gpt-4o',
    inputCostPer1MTokens: 2.50,
    outputCostPer1MTokens: 10.00,
    maxContextTokens: 128000,
    maxOutputTokens: 16384,
    supported: true,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    model: 'gpt-4o-mini',
    inputCostPer1MTokens: 0.15,
    outputCostPer1MTokens: 0.60,
    maxContextTokens: 128000,
    maxOutputTokens: 16384,
    supported: true,
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    inputCostPer1MTokens: 3.00,
    outputCostPer1MTokens: 15.00,
    maxContextTokens: 200000,
    maxOutputTokens: 8192,
    supported: true,
  },
  {
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    provider: 'deepseek',
    model: 'deepseek-chat',
    inputCostPer1MTokens: 0.27,
    outputCostPer1MTokens: 1.10,
    maxContextTokens: 64000,
    maxOutputTokens: 8192,
    supported: true,
  },
];
