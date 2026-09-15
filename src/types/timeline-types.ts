

export type TimelineEntryType =
  | "activation"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "agent_handoff"
  | "pipeline_phase"
  | "discussion_resolved"
  | "evidence_completed"
  | "circuit_event"
  | "checkpoint"
  | "state_saved"
  | "reflection"
  | "achievement";

export interface TimelineEntry {
  id: string;
  timestamp: string;
  type: TimelineEntryType;
  agent?: string;
  taskId?: string;
  boardId?: string;
  discussionId?: string;
  durationMs?: number;
  success?: boolean;
  summary: string;
  metadata?: Record<string, unknown>;
}


export type TimelineEntryInput = Omit<TimelineEntry, "id" | "timestamp"> & {
  id?: string;
  timestamp?: string;
};

export interface TimelineDailySummary {
  date: string;
  total: number;
  completed: number;
  failed: number;
  agents: Record<string, number>;
  types: Partial<Record<TimelineEntryType, number>>;
  totalDurationMs: number;
}

export interface TimelineQuery {
  from?: string;
  to?: string;
  agent?: string;
  type?: TimelineEntryType;
  taskId?: string;
  limit?: number;
  offset?: number;
}

export interface TimelineAchievements {
  totalCompleted: number;
  totalFailed: number;
  activeDays: number;
  agents: Array<{ agent: string; count: number; failed: number }>;
  milestones: Array<{ agent: string; level: string; count: number }>;
}

export interface TimelineStats {
  entries: number;
  seq: number;
  days: number;
  agents: number;
  maxEntries: number;
  maxAgeMs: number;
  monotonic: boolean;
}
