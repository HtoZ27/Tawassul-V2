

import { z } from "zod";




export const BackgroundJobSchema = z.object({
  
  id: z.string().uuid(),

  
  agentId: z.string().optional(),

  
  name: z.string(),

  
  description: z.string().optional(),

  
  type: z.enum([
    "periodic",
    "one_shot",
    "on_demand",
    "maintenance",
  ]),

  
  schedule: z
    .object({
      
      type: z.enum(["interval", "cron", "daily", "weekly", "monthly"]),

      
      value: z.string(),

      
      timezone: z.string().optional(),
    })
    .optional(),

  
  priority: z.number().int().min(1).max(5).default(3),

  
  status: z
    .enum([
      "pending",
      "running",
      "completed",
      "failed",
      "cancelled",
      "paused",
    ])
    .default("pending"),

  
  attemptCount: z.number().int().min(0).default(0),

  
  maxAttempts: z.number().int().min(1).default(3),

  
  lastRunAt: z.string().datetime().optional(),

  
  nextRunAt: z.string().datetime().optional(),

  
  createdAt: z.string().datetime(),

  
  updatedAt: z.string().datetime(),

  
  lastOutput: z.record(z.string(), z.unknown()).optional(),

  
  lastError: z.string().optional(),

  
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type BackgroundJob = z.infer<typeof BackgroundJobSchema>;




export interface BackgroundTaskResult {
  
  jobId: string;

  
  success: boolean;

  
  output?: Record<string, unknown>;

  
  error?: string;

  
  durationMs: number;

  
  executedAt: string;
}




export const BackgroundCoordinatorConfigSchema = z.object({
  
  enabled: z.boolean().default(true),

  
  maxConcurrentJobs: z.number().int().min(0).max(100).default(3),

  
  maxJobs: z.number().int().min(10).default(100),

  
  maxResultHistory: z.number().int().min(10).default(500),

  
  retentionMs: z.number().int().min(3600000).default(604800000),

  
  storagePath: z.string().default("~/.config/tawassyl/state/background-coordinator.json"),

  
  autoStart: z.boolean().default(true),

  
  checkIntervalMs: z.number().int().min(1000).default(60000),

  
  jobTimeoutMs: z.number().int().min(1000).default(120000),
});

export type BackgroundCoordinatorConfig = z.infer<typeof BackgroundCoordinatorConfigSchema>;




export interface BackgroundEvent {
  
  type:
    | "job_created"
    | "job_started"
    | "job_completed"
    | "job_failed"
    | "job_cancelled"
    | "job_paused"
    | "job_resumed"
    | "scheduler_tick"
    | "maintenance_run";

  
  payload: Record<string, unknown>;

  
  source: string;

  
  timestamp: string;
}




export function generateJobId(): string {
  return crypto.randomUUID();
}


export function calculateNextRun(schedule: BackgroundJob["schedule"], lastRun?: string): Date {
  const now = new Date();
  const last = lastRun ? new Date(lastRun) : now;

  if (!schedule) {
    return now;
  }

  switch (schedule.type) {
    case "interval": {
      const intervalMs = parseInt(schedule.value, 10);
      return new Date(last.getTime() + intervalMs);
    }
    case "daily": {
      
      const [hours, minutes] = schedule.value.split(":").map(Number);
      const next = new Date(now);
      next.setHours(hours || 0, minutes || 0, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      return next;
    }
    case "weekly": {
      
      const [day, hours, minutes] = schedule.value.split(":").map(Number);
      const next = new Date(now);
      next.setDate(now.getDate() + (((day || 0) - now.getDay() + 7) % 7));
      next.setHours(hours || 0, minutes || 0, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 7);
      }
      return next;
    }
    case "monthly": {
      
      const [date, hours, minutes] = schedule.value.split(":").map(Number);
      const next = new Date(now);
      next.setDate(date || 1);
      next.setHours(hours || 0, minutes || 0, 0, 0);
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
      }
      return next;
    }
    default:
      return now;
  }
}



export const BUILTIN_JOBS: Array<Omit<BackgroundJob, "id" | "status" | "attemptCount" | "createdAt" | "updatedAt">> = [
  {
    name: "collective-memory-decay",
    description: "Apply decay to Collective Memory patterns",
    type: "periodic",
    schedule: { type: "interval", value: "3600000" },
    priority: 2,
    maxAttempts: 3,
  },
  {
    name: "trust-score-cleanup",
    description: "Clean up old trust score history",
    type: "periodic",
    schedule: { type: "daily", value: "03:00" },
    priority: 2,
    maxAttempts: 3,
  },
  {
    name: "failure-pattern-detection",
    description: "Detect recurring failure patterns",
    type: "periodic",
    schedule: { type: "interval", value: "1800000" },
    priority: 3,
    maxAttempts: 3,
  },
  {
    name: "cost-budget-check",
    description: "Check budget limits and send alerts",
    type: "periodic",
    schedule: { type: "interval", value: "300000" },
    priority: 4,
    maxAttempts: 2,
  },
  {
    name: "state-persistence",
    description: "Persist system state to disk",
    type: "periodic",
    schedule: { type: "interval", value: "300000" },
    priority: 5,
    maxAttempts: 3,
  },
];
