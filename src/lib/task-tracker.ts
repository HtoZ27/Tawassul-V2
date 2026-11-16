import { msg } from "../services/messages.ts";
import type { Lang } from "../services/routing-algorithm.ts";
import { randomUUID } from "node:crypto";

export type TaskStatus = "pending" | "dispatched" | "running" | "completed" | "failed";

export interface TrackedTask {
  id: string;
  sessionId: string;
  agent: string;
  role: string;
  status: TaskStatus;
  startedAt: number;
  completedAt?: number;
  summary?: string;
  error?: string;
}

const MAX_TRACKED_TASKS = 1000;
const TASK_TTL_MS = 30 * 60 * 1000;

export class TaskTracker {
  private tasks = new Map<string, TrackedTask>();

  private cleanupOldTasks(): void {
    if (this.tasks.size <= MAX_TRACKED_TASKS) return;
    const now = Date.now();
    const entries = [...this.tasks.entries()];
    entries.sort((a, b) => a[1].startedAt - b[1].startedAt);
    for (const [id, task] of entries) {
      if (this.tasks.size <= MAX_TRACKED_TASKS) break;
      if (task.status === "completed" || task.status === "failed") {
        if (now - (task.completedAt ?? task.startedAt) > TASK_TTL_MS) {
          this.tasks.delete(id);
        }
      }
    }
    if (this.tasks.size > MAX_TRACKED_TASKS) {
      for (let i = 0; i < entries.length && this.tasks.size > MAX_TRACKED_TASKS; i++) {
        this.tasks.delete(entries[i]![0]);
      }
    }
  }

  create(sessionId: string, agent: string, role: string): TrackedTask {
    const id = randomUUID();
    const task: TrackedTask = {
      id,
      sessionId,
      agent,
      role,
      status: "pending",
      startedAt: Date.now(),
    };
    this.tasks.set(id, task);
    if (this.tasks.size > MAX_TRACKED_TASKS * 1.5) this.cleanupOldTasks();
    return task;
  }

  updateStatus(id: string, status: TaskStatus, extra?: { summary?: string; error?: string }): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = status;
    if (status === "completed" || status === "failed") {
      task.completedAt = Date.now();
    }
    if (extra?.summary) task.summary = extra.summary;
    if (extra?.error) task.error = extra.error;
  }

  getSessionTasks(sessionId: string): TrackedTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.sessionId === sessionId);
  }

  getProgressMessage(sessionId: string, lang: Lang): string {
    const sessionTasks = this.getSessionTasks(sessionId);
    if (sessionTasks.length === 0) return "";

    const active = sessionTasks.filter((t) => t.status === "running" || t.status === "dispatched");
    const completed = sessionTasks.filter((t) => t.status === "completed");
    const failed = sessionTasks.filter((t) => t.status === "failed");

    if (active.length > 0) {
      const names = active.map((t) => t.role).join(", ");
      return msg("tawaProgressUpdate", lang, { team: names });
    }
    if (failed.length > 0 && completed.length === 0) {
      const errors = failed.map((t) => t.error || "Unknown error").join("; ");
      return msg("tawaTaskFailed", lang, { reason: errors });
    }
    return "";
  }

  buildFinalSummary(sessionId: string, lang: Lang): string {
    const sessionTasks = this.getSessionTasks(sessionId);
    const completed = sessionTasks.filter((t) => t.status === "completed");
    const failed = sessionTasks.filter((t) => t.status === "failed");

    const lines: string[] = [];
    for (const task of completed) {
      lines.push(`✅ **${task.role}**: ${task.summary || "Completed successfully"}`);
    }
    for (const task of failed) {
      lines.push(`❌ **${task.role}**: ${task.error || "Failed"}`);
    }

    if (lines.length === 0) return "";
    return msg("tawaResultSummary", lang, { summary: lines.join("\n") });
  }

  get count(): number {
    return this.tasks.size;
  }

  clearSession(sessionId: string): void {
    for (const [id, task] of this.tasks) {
      if (task.sessionId === sessionId) {
        this.tasks.delete(id);
      }
    }
  }
}