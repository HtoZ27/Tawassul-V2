import { ParallelDispatcher, toAgentResults, defaultFindBestAgent } from "./parallel-dispatcher.ts";
import type { DispatchTask, DispatchResult } from "./parallel-dispatcher.ts";
import { TaskTracker } from "../lib/task-tracker.ts";
import { isComplexTask } from "./effort-analyzer.ts";
import type { TawaOrchestratorContext } from "../core/service-context.ts";
import type { SubTask, ExecutionReport, AgentResult } from "../types/plan.types.ts";
import type { EventHub } from "./event-hub.ts";
import type { SpecDrivenManager } from "./spec-driven/manager.ts";
import crypto from "node:crypto";

export class TaskOrchestrator {
  private static readonly MAX_PROGRESS_ENTRIES = 50;

  private dispatcher: ParallelDispatcher;
  private tracker: TaskTracker;
  private progress: Map<string, ExecutionReport> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(
    private eventHub?: EventHub,
    dispatcher?: ParallelDispatcher,
    private specDriven?: SpecDrivenManager,
  ) {
    this.dispatcher = dispatcher ?? new ParallelDispatcher(() => crypto.randomUUID(), defaultFindBestAgent);
    this.tracker = new TaskTracker();
  }

  
  private acceptanceCriteriaFor(task: string): string[] {
    try {
      return this.specDriven?.createSpecFromText(task).acceptanceCriteria ?? [];
    } catch {
      return [];
    }
  }

  decompose(task: string, _context?: TawaOrchestratorContext): SubTask[] {
    const complex = isComplexTask(task);
    const parts = task
      .split(/[,;]|\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length <= 1) {
      const dispatchTasks: DispatchTask[] = [
        {
          id: `sub-${crypto.randomUUID().slice(0, 8)}`,
          description: task,
          context: "",
          files: [],
          dependencies: [],
          preferredRole: complex ? "@dev" : undefined,
          specializations: [],
          estimatedComplexity: complex ? ("complex" as const) : ("medium" as const),
        },
      ];
      if (this.eventHub) {
        this.eventHub.emit({ type: "TASK_DECOMPOSED", taskId: task, subtaskCount: dispatchTasks.length });
      }
      return dispatchTasks.map((dt) => ({
        id: dt.id,
        description: dt.description,
        files: dt.files,
        agent: dt.preferredRole ?? "dev",
        dependencies: dt.dependencies,
        successCriteria: this.acceptanceCriteriaFor(dt.description),
        status: "pending" as const,
      }));
    }
    const dispatchTasks: DispatchTask[] = parts.map((part, _i) => ({
      id: `sub-${crypto.randomUUID().slice(0, 8)}`,
      description: part,
      context: "",
      files: [],
      dependencies: [],
      preferredRole: undefined,
      specializations: [],
      estimatedComplexity: "medium" as const,
    }));
    if (this.eventHub) {
      this.eventHub.emit({ type: "TASK_DECOMPOSED", taskId: task, subtaskCount: dispatchTasks.length });
    }
    return dispatchTasks.map((dt, i) => ({
      id: dt.id,
      description: dt.description,
      files: dt.files,
      agent: dt.preferredRole ?? "dev",
      dependencies: i > 0 ? [dispatchTasks[i - 1]!.id] : [],
      successCriteria: this.acceptanceCriteriaFor(dt.description),
      status: "pending" as const,
    }));
  }

  async execute(subtasks: SubTask[], signal?: AbortSignal): Promise<ExecutionReport> {
    const taskId = crypto.randomUUID();
    const startTime = Date.now();
    const controller = new AbortController();
    this.abortControllers.set(taskId, controller);

    
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }

    const dispatchTasks: DispatchTask[] = subtasks.map((st) => ({
      id: st.id,
      description: st.description,
      context: "",
      files: st.files,
      dependencies: st.dependencies,
      preferredRole: st.agent,
      specializations: [],
      estimatedComplexity: "medium" as const,
    }));

    const plan = this.dispatcher.buildPlan(dispatchTasks);
    const results = await this.dispatcher.executePlan(
      plan,
      (batch) => {
        for (const t of batch.tasks) {
          if (this.eventHub) {
            this.eventHub.emit({ type: "SUBTASK_STARTED", subtaskId: t.id, agent: t.preferredRole ?? "dev" });
          }
        }
      },
      (result: DispatchResult) => {
        if (this.eventHub) {
          this.eventHub.emit({
            type: "SUBTASK_COMPLETED",
            subtaskId: result.taskId,
            agent: result.assignedAgent,
            status: result.success ? "done" : "failed",
          });
        }
      },
      controller.signal,
    );

    const agentResults: AgentResult[] = toAgentResults(results);

    const endTime = Date.now();
    const report: ExecutionReport = {
      taskId,
      subtasks,
      results: agentResults,
      startTime,
      endTime,
      status: results.every((r: DispatchResult) => r.success)
        ? "success"
        : results.some((r: DispatchResult) => r.success)
          ? "partial"
          : "failed",
    };

    this.progress.set(taskId, report);
    if (this.progress.size > TaskOrchestrator.MAX_PROGRESS_ENTRIES) {
      const excess = this.progress.size - TaskOrchestrator.MAX_PROGRESS_ENTRIES;
      for (const key of [...this.progress.keys()].slice(0, excess)) {
        this.progress.delete(key);
      }
    }
    this.abortControllers.delete(taskId);

    if (this.eventHub) {
      this.eventHub.emit({ type: "EXECUTION_FINISHED", taskId, status: report.status });
    }

    return report;
  }

  getProgress(taskId: string): ExecutionReport {
    return (
      this.progress.get(taskId) ?? {
        taskId,
        subtasks: [],
        results: [],
        startTime: 0,
        endTime: 0,
        status: "failed",
      }
    );
  }

  async cancel(taskId: string): Promise<void> {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(taskId);
    }
  }

  getTracker(): TaskTracker {
    return this.tracker;
  }

  dispose(): void {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
    this.progress.clear();
  }
}
