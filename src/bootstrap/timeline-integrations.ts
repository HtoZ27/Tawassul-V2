
import type { TawassulContext } from "../context-class.ts";
import type { EventHub, TawassulEvent } from "../services/event-hub.ts";
import type { TimelineStore } from "../services/timeline-store.ts";
import type { TimelineEntryInput, TimelineEntryType } from "../types/timeline-types.ts";
import { logger } from "../utils/logger.ts";
import { t } from "../translations.ts";

export interface TimelineIntegrationDeps {
  tawaCtx: TawassulContext;
  eventHub: EventHub;
  timelineStore: TimelineStore;
}


interface EventMapper {
  type: TimelineEntryType;
  success?: boolean | ((payload: Record<string, unknown>) => boolean);
  build: (payload: Record<string, unknown>) => Omit<TimelineEntryInput, "type" | "summary">;
  summary: (payload: Record<string, unknown>) => string;
}

const MAPPERS: Record<string, EventMapper> = {
  TASK_STARTED: {
    type: "task_started",
    build: (p) => ({ agent: asString(p.agent), taskId: asString(p.taskId) }),
    summary: (p) =>
      t("tlTaskStarted", { task: asString(p.taskId) ?? "", agent: asString(p.agent) ?? t("tlUnknownAgent") }),
  },
  TASK_COMPLETED: {
    type: "task_completed",
    success: true,
    build: (p) => ({
      agent: asString(p.agent),
      taskId: asString(p.taskId),
      ...(typeof p.durationMs === "number" ? { durationMs: p.durationMs } : {}),
    }),
    summary: (p) =>
      t("tlTaskCompleted", { task: asString(p.taskId) ?? "", agent: asString(p.agent) ?? t("tlUnknownAgent") }),
  },
  AGENT_FAILED: {
    type: "task_failed",
    success: false,
    build: (p) => ({
      agent: asString(p.agent),
      taskId: asString(p.taskId),
      metadata: { reason: asString(p.reason) },
    }),
    summary: (p) =>
      t("tlAgentFailed", { agent: asString(p.agent) ?? t("tlUnknownAgent"), reason: asString(p.reason) ?? "" }),
  },
  DISCUSSION_RESOLVED: {
    type: "discussion_resolved",
    success: true,
    build: (p) => ({ discussionId: asString(p.discussionId), metadata: { resolution: asString(p.resolution) } }),
    summary: (p) =>
      t("tlDiscussionResolved", { id: asString(p.discussionId) ?? "", resolution: asString(p.resolution) ?? "" }),
  },
  CIRCUIT_OPEN: {
    type: "circuit_event",
    success: false,
    build: (p) => ({ agent: asString(p.component) }),
    summary: (p) => t("tlCircuitOpen", { agent: asString(p.component) ?? t("tlUnknownAgent") }),
  },
  CIRCUIT_CLOSED: {
    type: "circuit_event",
    success: true,
    build: (p) => ({ agent: asString(p.component) }),
    summary: (p) => t("tlCircuitClosed", { agent: asString(p.component) ?? t("tlUnknownAgent") }),
  },
  CHECKPOINT_CREATED: {
    type: "checkpoint",
    build: (p) => ({ taskId: asString(p.taskId), metadata: { snapshotId: asString(p.snapshotId) } }),
    summary: (p) => t("tlCheckpointCreated", { task: asString(p.taskId) ?? "" }),
  },
  STATE_SAVED: {
    type: "state_saved",
    build: (p) => ({ metadata: { kind: (p.payload as Record<string, unknown>)?.type } }),
    summary: () => t("tlStateSaved"),
  },
  CHAIN_REFLECTED: {
    type: "reflection",
    build: (p) => ({
      taskId: asString(p.taskId),
      metadata: { facts: Array.isArray(p.facts) ? p.facts.length : undefined },
    }),
    summary: (p) => t("tlChainReflected", { task: asString(p.taskId) ?? "" }),
  },
  TASK_STATUS_CHANGED: {
    type: "pipeline_phase",
    build: (p) => ({ boardId: asString(p.boardId), taskId: asString(p.taskId) }),
    summary: (p) =>
      t("tlTaskStatusChanged", {
        task: asString(p.taskId) ?? "",
        from: asString(p.from) ?? "",
        to: asString(p.to) ?? "",
      }),
  },
  BOARD_CREATED: {
    type: "pipeline_phase",
    build: (p) => ({ boardId: asString(p.boardId) }),
    summary: (p) => t("tlBoardCreated", { name: asString(p.name) ?? "" }),
  },
  
  CHECKPOINT_RESTORED: {
    type: "checkpoint",
    build: (p) => ({ metadata: { snapshotId: asString(p.snapshotId) } }),
    summary: (p) => t("tlCheckpointRestored", { snapshot: asString(p.snapshotId) ?? "" }),
  },
  SUBTASK_STARTED: {
    type: "task_started",
    build: (p) => ({ agent: asString(p.agent), taskId: asString(p.subtaskId) }),
    summary: (p) =>
      t("tlSubtaskStarted", { task: asString(p.subtaskId) ?? "", agent: asString(p.agent) ?? t("tlUnknownAgent") }),
  },
  AGENT_STUCK: {
    type: "circuit_event",
    success: false,
    build: (p) => ({ agent: asString(p.agent) }),
    summary: (p) =>
      t("tlAgentStuck", { agent: asString(p.agent) ?? t("tlUnknownAgent"), reason: asString(p.reason) ?? "" }),
  },
  AGENT_AUTO_PAUSED: {
    type: "circuit_event",
    success: false,
    build: (p) => ({ agent: asString(p.agent) }),
    summary: (p) =>
      t("tlAgentAutoPaused", { agent: asString(p.agent) ?? t("tlUnknownAgent"), reason: asString(p.reason) ?? "" }),
  },
  HEAL_ATTEMPTED: {
    type: "achievement",
    success: (p) => !!(p as { success?: boolean }).success,
    build: (p) => ({ metadata: { taskId: asString(p.taskId) } }),
    summary: (p) =>
      t("tlHealAttempted", {
        task: asString(p.taskId) ?? "",
        outcome: (p as { success?: boolean }).success ? t("tlOutcomeSucceeded") : t("tlOutcomeFailed"),
      }),
  },
  EVALUATION_RECORDED: {
    type: "evidence_completed",
    success: true,
    build: (p) => ({ metadata: { featureId: asString(p.featureId), issueCount: p.issueCount } }),
    summary: (p) =>
      t("tlEvaluationRecorded", { feature: asString(p.featureId) ?? "", count: String(p.issueCount ?? "") }),
  },
  ISSUE_RESOLVED: {
    type: "discussion_resolved",
    success: true,
    build: (p) => ({
      discussionId: asString(p.issueId),
      metadata: { featureId: asString(p.featureId), resolvedBy: asString(p.resolvedBy) },
    }),
    summary: (p) =>
      t("tlIssueResolved", {
        issue: asString(p.issueId) ?? "",
        feature: asString(p.featureId) ?? "",
        by: asString(p.resolvedBy) ?? t("tlUnknownAgent"),
      }),
  },
  REPORT_MERGED: {
    type: "achievement",
    success: true,
    build: (p) => ({ metadata: { qualityScore: p.qualityScore } }),
    summary: (p) => t("tlReportMerged", { report: asString(p.reportId) ?? "", quality: String(p.qualityScore ?? "") }),
  },
  TASK_DECOMPOSED: {
    type: "pipeline_phase",
    build: (p) => ({ taskId: asString(p.taskId), metadata: { subtaskCount: p.subtaskCount } }),
    summary: (p) => t("tlTaskDecomposed", { task: asString(p.taskId) ?? "", count: String(p.subtaskCount ?? "") }),
  },
  RESULTS_COLLECTED: {
    type: "evidence_completed",
    success: true,
    build: (p) => ({ taskId: asString(p.taskId), metadata: { resultCount: p.resultCount } }),
    summary: (p) => t("tlResultsCollected", { count: String(p.resultCount ?? ""), task: asString(p.taskId) ?? "" }),
  },
  STATE_SAVE_FAILED: {
    type: "state_saved",
    success: false,
    build: (p) => {
      const pl = (p.payload as Record<string, unknown>) ?? {};
      return { metadata: { kind: asString(pl.type), error: String(pl.error ?? "") } };
    },
    summary: (p) =>
      t("tlStateSaveFailed", { error: String(((p.payload as Record<string, unknown>)?.error as unknown) ?? "") }),
  },
};

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}


const STATE_SAVE_THROTTLE_MS = 5_000;
let lastStateSavedAt = 0;

function throttled(payload: Record<string, unknown>): boolean {
  if (payload.type !== "STATE_SAVED") return false;
  const now = Date.now();
  if (now - lastStateSavedAt < STATE_SAVE_THROTTLE_MS) return true;
  lastStateSavedAt = now;
  return false;
}


export function mapEvent(e: TawassulEvent): TimelineEntryInput | null {
  if (throttled(e as unknown as Record<string, unknown>)) return null;
  const mapper = MAPPERS[e.type];
  if (!mapper) return null;
  const payload = e as unknown as Record<string, unknown>;
  const success = typeof mapper.success === "function" ? mapper.success(payload) : mapper.success;
  return {
    type: mapper.type,
    summary: mapper.summary(payload),
    ...(success !== undefined ? { success } : {}),
    ...mapper.build(payload),
  };
}


export function registerTimelineIntegration(deps: TimelineIntegrationDeps): { stop: () => void } {
  const { eventHub, timelineStore } = deps;

  const onAnyEvent = (eventName: string, data: unknown): void => {
    try {
      
      const event =
        data && typeof data === "object" && "type" in (data as object)
          ? (data as TawassulEvent)
          : ({ type: eventName, ...(data as object) } as TawassulEvent);
      const entry = mapEvent(event);
      if (entry) timelineStore.append(entry);
    } catch (err) {
      
      logger.warn("[timeline] wildcard handler error:", err);
    }
  };

  eventHub.on("*", onAnyEvent);

  return {
    stop: () => {
      eventHub.off("*", onAnyEvent as (...args: unknown[]) => void);
    },
  };
}
