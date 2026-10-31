

import { tool } from "../tool.ts";

export const configSchema = tool.schema.object({
  disabled: tool.schema.boolean().optional(),
  team: tool.schema.array(tool.schema.string()).optional(),
  strictness: tool.schema.enum(["relaxed", "normal", "strict"]).optional(),
  maxRecords: tool.schema.number().min(10).max(10000).optional(),
  maxHandoffs: tool.schema.number().min(10).max(10000).optional(),
  maxCompactItems: tool.schema.number().min(5).max(200).optional(),
  maxDynamicAgents: tool.schema.number().min(1).max(100).optional(),
  maxCallDepth: tool.schema.number().min(1).max(20).optional(),
  iterationBudgets: tool.schema.record(tool.schema.string(), tool.schema.number().min(1).max(10000)).optional(),
  adaptiveBudgets: tool.schema.boolean().optional(),
  projectScale: tool.schema.enum(["small", "medium", "large"]).optional(),
  budgetStepPercent: tool.schema.number().min(0).max(200).optional(),
  budgetCeilingFactor: tool.schema.number().min(1).max(20).optional(),
  budgetTiers: tool.schema.record(tool.schema.string(), tool.schema.number().min(1).max(10000)).optional(),
  maxTotalTasks: tool.schema.number().min(1).max(100).optional(),
  suggestedHandoffs: tool.schema.record(tool.schema.string(), tool.schema.array(tool.schema.string())).optional(),
  stateFile: tool.schema.string().optional(),
  configFile: tool.schema.string().optional(),
  language: tool.schema.enum(["en"]).optional(),
  
  
  privacyGuardParanoid: tool.schema.boolean().optional(),
  
  
  consensusBroker: tool.schema.boolean().optional(),
  
  
  
  agents: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
  deleted: tool.schema.array(tool.schema.string()).optional(),
  agentEvaluation: tool.schema
    .object({
      enabled: tool.schema.boolean().optional(),
      minCompletionRatio: tool.schema.number().min(0).max(1).optional(),
      minContextLengthAvg: tool.schema.number().min(1).max(100).optional(),
      minTaskLengthAvg: tool.schema.number().min(1).max(50).optional(),
      minRecordsPerAgent: tool.schema.number().min(0).max(100).optional(),
    })
    .optional(),
  agentModels: tool.schema
    .record(
      tool.schema.string(),
      tool.schema.object({
        models: tool.schema
          .array(
            tool.schema.object({
              model: tool.schema.string().optional(),
              options: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
            }),
          )
          .optional(),
        capability: tool.schema.string().optional(),
      }),
    )
    .optional(),
  
  
  routing: tool.schema
    .object({
      applyAgentMatcherSuggestion: tool.schema.boolean().optional(),
    })
    .optional(),
  rateLimits: tool.schema
    .object({
      burstMax: tool.schema.number().min(1).max(1000).optional(),
      burstWindowMs: tool.schema.number().min(100).max(60000).optional(),
      concurrentMax: tool.schema.number().min(1).max(100).optional(),
      slidingMax: tool.schema.number().min(1).max(1000).optional(),
      slidingWindowMs: tool.schema.number().min(100).max(60000).optional(),
      backToBurstAfterMs: tool.schema.number().min(0).max(60000).optional(),
      
      apiRetryMax: tool.schema.number().min(0).max(50).optional(),
      apiRetryBaseMs: tool.schema.number().min(100).max(60000).optional(),
    })
    .optional(),
  freeLimit: tool.schema
    .object({
      notice: tool.schema.boolean().optional(),
      noRetry: tool.schema.boolean().optional(),
    })
    .optional(),
  fallback: tool.schema
    .object({
      enabled: tool.schema.boolean().optional(),
      maxSwitches: tool.schema.number().min(0).max(20).optional(),
      cooldownMs: tool.schema.number().min(0).max(60000).optional(),
      chains: tool.schema
        .record(tool.schema.string(), tool.schema.array(tool.schema.string()))
        .optional(),
    })
    .optional(),
  health: tool.schema
    .object({
      stuckTimeoutMs: tool.schema.number().min(1000).max(300000).optional(),
      circuitBreakerThreshold: tool.schema.number().min(1).max(100).optional(),
      circuitBreakerResetMs: tool.schema.number().min(1000).max(3600000).optional(),
    })
    .optional(),
  
  
  
  
  
  
  innovations: tool.schema
    .object({
      contextHandoff: tool.schema
        .object({
          enabled: tool.schema.boolean().optional(),
          beta: tool.schema.boolean().optional(),
          mandatory: tool.schema.boolean().optional(),
        })
        .optional(),
    })
    .catchall(
      tool.schema.object({
        enabled: tool.schema.boolean().optional(),
        beta: tool.schema.boolean().optional(),
        mandatory: tool.schema.boolean().optional(),
      }),
    )
    .optional(),
});
