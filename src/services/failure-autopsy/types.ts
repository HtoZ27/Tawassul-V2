

import { z } from 'zod';




export const FailureCategorySchema = z.enum([
  'tool_error',           // خطأ في أداة
  'validation_error',     // خطأ في التحقق
  'timeout',              // انتهت المهلة
  'resource_exhaustion',  // نفاذ الموارد
  'logic_error',          // خطأ منطقي
  'integration_error',    // خطأ في التكامل
  'user_error',           // خطأ المستخدم
  'agent_error',          // خطأ الوكيل
  'rate_limited',         // تجاوز حد الطلبات
  'auth_error',           // خطأ مصادقة
  'unknown',              // غير معروف
]);

export type FailureCategory = z.infer<typeof FailureCategorySchema>;


export const FailureInstanceSchema = z.object({
  
  id: z.string().uuid(),
  
  
  category: FailureCategorySchema,
  
  
  summary: z.string(),
  
  
  originalMessage: z.string(),
  
  
  stackTrace: z.string().optional(),
  
  
  source: z.string(),
  
  
  task: z.string().optional(),
  
  
  context: z.record(z.string(), z.unknown()).optional(),
  
  
  timestamp: z.string().datetime(),
  
  
  resolved: z.boolean().default(false),
  
  
  resolution: z.string().optional(),
  
  
  occurrenceCount: z.number().int().min(1).default(1),
  
  
  affectedUsers: z.array(z.string()).default([]),
});

export type FailureInstance = z.infer<typeof FailureInstanceSchema>;




export const LessonSchema = z.object({
  
  id: z.string().uuid(),
  
  
  failureId: z.string().uuid(),
  
  
  title: z.string(),
  
  
  description: z.string(),
  
  
  type: z.enum([
    'prevention',      // كيف نمنع هذا الخطأ
    'recovery',        // كيف نتعافى من هذا الخطأ
    'detection',       // كيف نكتشف هذا الخطأ مبكراً
    'mitigation',      // كيف نخفف الأثر
  ]),
  
  
  priority: z.number().int().min(1).max(5),
  
  
  applied: z.boolean().default(false),
  
  
  createdAt: z.string().datetime(),
  
  
  retrievalCount: z.number().int().min(0).default(0),
  
  
  source: z.enum([
    'failure_analysis',
    'user_feedback',
    'agent_learning',
    'pattern_detection',
  ]),
});

export type Lesson = z.infer<typeof LessonSchema>;




export const DiagnosisSchema = z.object({
  
  id: z.string().uuid(),
  
  
  failureId: z.string().uuid(),
  
  
  rootCause: z.string(),
  
  
  contributingFactors: z.array(z.string()),
  
  
  impact: z.enum(['low', 'medium', 'high', 'critical']),
  
  
  recurrenceProbability: z.number().min(0).max(1),
  
  
  suggestedFixes: z.array(z.string()),
  
  
  affectedTools: z.array(z.string()),
  
  
  diagnosedAt: z.string().datetime(),
  
  
  diagnosedBy: z.enum(['agent', 'user', 'system']),
});

export type Diagnosis = z.infer<typeof DiagnosisSchema>;




export const FailurePatternSchema = z.object({
  
  id: z.string().uuid(),
  
  
  description: z.string(),
  
  
  category: FailureCategorySchema,
  
  
  frequency: z.number().int().min(2),
  
  
  failureIds: z.array(z.string().uuid()),
  
  
  successfulResolutions: z.array(z.string()),
  
  
  permanentlyResolved: z.boolean().default(false),
  
  
  lastSeen: z.string().datetime(),
  
  
  firstSeen: z.string().datetime(),
});

export type FailurePattern = z.infer<typeof FailurePatternSchema>;




export const FailureAutopsyConfigSchema = z.object({
  
  enabled: z.boolean().default(true),
  
  
  maxFailures: z.number().int().min(100).default(1000),
  
  
  maxLessons: z.number().int().min(50).default(500),
  
  
  retentionMs: z.number().int().min(86400000).default(2592000000),
  
  
  autoGenerateLessons: z.boolean().default(true),
  
  
  patternThreshold: z.number().int().min(2).default(3),
  
  
  storagePath: z.string().default('~/.config/tawassyl/state/failure-autopsy.json'),
});

export type FailureAutopsyConfig = z.infer<typeof FailureAutopsyConfigSchema>;




export const FailureQuerySchema = z.object({
  
  category: FailureCategorySchema.optional(),
  
  
  source: z.string().optional(),
  
  
  resolved: z.boolean().optional(),
  
  
  since: z.string().datetime().optional(),
  
  
  until: z.string().datetime().optional(),
  
  
  minOccurrences: z.number().int().min(1).optional(),
  
  
  limit: z.number().int().min(1).max(100).optional(),
  
  
  orderBy: z.enum(['recent', 'frequent', 'impact']).optional(),
});

export type FailureQuery = z.infer<typeof FailureQuerySchema>;




export const FailureQueryResultSchema = z.object({
  
  failures: z.array(FailureInstanceSchema),
  
  
  lessons: z.array(LessonSchema),
  
  
  patterns: z.array(FailurePatternSchema),
  
  
  total: z.number().int().min(0),
  
  
  queryTimeMs: z.number().min(0),
});

export type FailureQueryResult = z.infer<typeof FailureQueryResultSchema>;




export const FailureEventSchema = z.object({
  
  type: z.enum([
    'failure_recorded',
    'diagnosis_created',
    'lesson_generated',
    'lesson_applied',
    'pattern_detected',
    'pattern_resolved',
    'failure_resolved',
  ]),
  
  
  payload: z.record(z.string(), z.unknown()),
  
  
  source: z.string(),
  
  
  timestamp: z.string().datetime(),
});

export type FailureEvent = z.infer<typeof FailureEventSchema>;




export function generateFailureId(): string {
  return crypto.randomUUID();
}


export function generateLessonId(): string {
  return crypto.randomUUID();
}


export function generateDiagnosisId(): string {
  return crypto.randomUUID();
}


export function generatePatternId(): string {
  return crypto.randomUUID();
}


export function categorizeError(message: string): FailureCategory {
  const lower = message.toLowerCase();
  
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'timeout';
  }
  if (lower.includes('validation') || lower.includes('invalid')) {
    return 'validation_error';
  }
  if (lower.includes('tool') || lower.includes('command')) {
    return 'tool_error';
  }
  if (lower.includes('memory') || lower.includes('heap') || lower.includes('resource')) {
    return 'resource_exhaustion';
  }
  if (lower.includes('integrat') || lower.includes('connect')) {
    return 'integration_error';
  }
  if (lower.includes('permission') || lower.includes('access')) {
    return 'agent_error';
  }
  if (lower.includes('rate_limit') || lower.includes('429')) {
    return 'rate_limited';
  }
  if (lower.includes('auth') || lower.includes('unauthorized') || lower.includes('403')) {
    return 'auth_error';
  }
  
  return 'unknown';
}


export function assessImpact(message: string): Diagnosis['impact'] {
  const lower = message.toLowerCase();
  
  if (lower.includes('critical') || lower.includes('fatal') || lower.includes('crash')) {
    return 'critical';
  }
  if (lower.includes('error') || lower.includes('fail')) {
    return 'high';
  }
  if (lower.includes('warning') || lower.includes('warn')) {
    return 'medium';
  }
  
  return 'low';
}
