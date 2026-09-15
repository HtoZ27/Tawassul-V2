

import { z } from "zod";
import type { ExecutionReport } from "../../types/plan.types.ts";




export const UsagePatternSchema = z.object({
  
  id: z.string().uuid(),

  
  type: z.enum([
    "tool_usage", // استخدام أدوات محددة
    "agent_routing", // توجيه الوكلاء
    "error_recovery", // التعافي من الأخطاء
    "workflow_sequence", // تسلسلات العمل
    "preference", // تفضيلات المستخدم
    "context_window", // نافذة السياق
  ]),

  
  description: z.string(),

  
  frequency: z.number().int().min(1),

  
  successRate: z.number().min(0).max(1),

  
  weight: z.number().min(0).max(1),

  
  lastSeen: z.string().datetime(),

  
  firstSeen: z.string().datetime(),

  
  userIds: z.array(z.string()),

  
  tags: z.array(z.string()).default([]),

  
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type UsagePattern = z.infer<typeof UsagePatternSchema>;




export const MemoryEntrySchema = z.object({
  
  id: z.string().uuid(),

  
  patternId: z.string().uuid(),

  
  content: z.string(),

  
  source: z.enum(["user_interaction", "agent_learning", "failure_analysis", "cost_tracking", "spec_learning"]),

  
  provenance: z.enum(["user_stated", "agent_inferred", "tool_observed"]).default("agent_inferred"),

  
  decision_kind: z.enum(["decision", "proposal"]).optional(),

  
  confidence: z.number().min(0).max(1),

  
  retrievalCount: z.number().int().min(0),

  
  lastRetrieved: z.string().datetime().optional(),

  
  createdAt: z.string().datetime(),

  
  expiresAt: z.string().datetime().optional(),

  
  tags: z.array(z.string()),

  
  classification: z.enum([
    "public", // متاحة لجميع المستخدمين
    "private", // خاصة بالمستخدم الحالي
    "shared", // مشتركة مع مستخدمين محددين
  ]),
});

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;




export interface CollectiveMemoryStore {
  
  addPattern(pattern: Omit<UsagePattern, "id" | "frequency" | "weight" | "lastSeen" | "firstSeen">): UsagePattern;

  
  updatePattern(id: string, updates: Partial<UsagePattern>): UsagePattern | null;

  
  getPatternsByType(type: UsagePattern["type"]): UsagePattern[];

  
  findSimilarPatterns(query: string, limit?: number): UsagePattern[];

  
  addMemory(memory: Omit<MemoryEntry, "id" | "retrievalCount" | "createdAt">): MemoryEntry;

  
  retrieveMemories(query: string, limit?: number): MemoryEntry[];

  
  applyDecay(factor?: number): void;

  
  getStats(): MemoryStats;

  
  persist(): Promise<void>;

  
  load(): Promise<void>;

  
  recordExecution(taskId: string, result: ExecutionReport): void;

  
  recordPattern(errorCategory: string, frequency: number): void;
}




export const MemoryStatsSchema = z.object({
  
  totalPatterns: z.number().int().min(0),

  
  totalMemories: z.number().int().min(0),

  
  averageWeight: z.number().min(0).max(1),

  
  highConfidencePatterns: z.number().int().min(0),

  
  expiredMemories: z.number().int().min(0),

  
  lastPersisted: z.string().datetime().optional(),
});

export type MemoryStats = z.infer<typeof MemoryStatsSchema>;




export const MemoryQuerySchema = z.object({
  
  text: z.string().optional(),

  
  tags: z.array(z.string()).optional(),

  
  type: UsagePatternSchema.shape.type.optional(),

  
  source: MemoryEntrySchema.shape.source.optional(),

  
  minConfidence: z.number().min(0).max(1).optional(),

  
  minFrequency: z.number().int().min(1).optional(),

  
  since: z.string().datetime().optional(),

  
  until: z.string().datetime().optional(),

  
  limit: z.number().int().min(1).max(100).optional(),

  
  orderBy: z.enum(["relevance", "frequency", "recency", "confidence"]).optional(),
});

export type MemoryQuery = z.infer<typeof MemoryQuerySchema>;




export const MemoryQueryResultSchema = z.object({
  
  patterns: z.array(UsagePatternSchema),

  
  memories: z.array(MemoryEntrySchema),

  
  total: z.number().int().min(0),

  
  queryTimeMs: z.number().min(0),

  
  truncated: z.boolean(),
});

export type MemoryQueryResult = z.infer<typeof MemoryQueryResultSchema>;




export const MemoryEventSchema = z.object({
  
  type: z.enum([
    "pattern_detected",
    "pattern_updated",
    "memory_created",
    "memory_retrieved",
    "memory_expired",
    "decay_applied",
    "stats_updated",
  ]),

  
  payload: z.record(z.string(), z.unknown()),

  
  source: z.string(),

  
  timestamp: z.string().datetime(),
});

export type MemoryEvent = z.infer<typeof MemoryEventSchema>;




export const MemoryConfigSchema = z.object({
  
  enabled: z.boolean().default(true),

  
  maxPatterns: z.number().int().min(100).default(10000),

  
  maxMemories: z.number().int().min(100).default(50000),

  
  decayFactor: z.number().min(0).max(1).default(0.95),

  
  minConfidenceThreshold: z.number().min(0).max(1).default(0.1),

  
  storagePath: z.string().default("~/.config/tawassyl/state/collective-memory.json"),

  
  retentionMs: z.number().int().min(86400000).default(2592000000),

  
  autoPersist: z.boolean().default(true),

  
  persistRateLimit: z.number().int().min(1).default(1),

  
  projectKey: z.string().default(""),
});

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;




export function createDefaultMemoryConfig(overrides?: Partial<MemoryConfig>): MemoryConfig {
  return MemoryConfigSchema.parse(overrides || {});
}


export function generatePatternId(): string {
  return crypto.randomUUID();
}


export function generateMemoryId(): string {
  return crypto.randomUUID();
}
