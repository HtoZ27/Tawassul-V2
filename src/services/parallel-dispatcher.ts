import type { AgentMatchResult, MatchRequest } from "./agent-matcher.ts";
import type { AgentResult } from "../types/plan.types.ts";
import { logger } from "../utils/logger.ts";
import { normalizeName } from "../utils/name-utils.ts";

let dispatchRunSeq = 0;

export interface DispatchTask {
  id: string;
  description: string;
  context: string;
  files: string[];
  declaredFiles?: string[];
  copyOf?: string;
  dependencies: string[];
  preferredRole?: string;
  specializations: string[];
  estimatedComplexity: "simple" | "medium" | "complex";
}

interface DispatchBatch {
  id: string;
  tasks: DispatchTask[];
  parallel: boolean;
}

export interface DispatchPlan {
  batches: DispatchBatch[];
  totalTasks: number;
  estimatedParallelGroups: number;
  fileConflicts: Map<string, string[]>;
}

export interface DispatchResult {
  batchId: string;
  taskId: string;
  assignedAgent: string;
  handoffId: string;
  success: boolean;
  error?: string;
}

export interface CreateHandoffParams {
  to: string;
  task: string;
  context: string;
  files: string[];
  parallelId?: string;
}

export class ParallelDispatcher {
  constructor(
    private createHandoff: (params: CreateHandoffParams) => string,
    private findBestAgent: (request: MatchRequest) => AgentMatchResult | null,
  ) {}

  buildPlan(tasks: DispatchTask[]): DispatchPlan {
    const fileMap = new Map<string, DispatchTask[]>();
    for (const task of tasks) {
      for (const file of new Set(task.declaredFiles ?? task.files)) {
        const existing = fileMap.get(file) ?? [];
        existing.push(task);
        fileMap.set(file, existing);
      }
    }
    const fileConflicts = new Map<string, string[]>();
    for (const [file, owners] of fileMap) {
      const groups = new Set(owners.map((task) => task.copyOf ?? task.id));
      if (groups.size > 1) {
        fileConflicts.set(file, owners.map((task) => task.id));
      }
    }

    const dependencyMap = new Map<string, string[]>();
    for (const task of tasks) {
      dependencyMap.set(task.id, task.dependencies ?? []);
    }

    const independent: DispatchTask[] = [];
    const dependent: DispatchTask[] = [];

    for (const task of tasks) {
      const deps = dependencyMap.get(task.id) ?? [];
      if (deps.length === 0) {
        independent.push(task);
      } else {
        dependent.push(task);
      }
    }

    const conflictTaskIds = new Set<string>();
    for (const [, taskIds] of fileConflicts) {
      for (const id of taskIds) {
        conflictTaskIds.add(id);
      }
    }

    const noConflict: DispatchTask[] = [];
    const hasConflict: DispatchTask[] = [];
    for (const task of independent) {
      if (conflictTaskIds.has(task.id)) {
        hasConflict.push(task);
      } else {
        noConflict.push(task);
      }
    }

    const batches: DispatchBatch[] = [];
    let batchSeq = 0;
    const runId = ++dispatchRunSeq;

    if (noConflict.length > 0) {
      batchSeq++;
      batches.push({
        id: `BATCH-P${runId}-${batchSeq}`,
        tasks: noConflict,
        parallel: true,
      });
    }

    if (hasConflict.length > 0) {
      batchSeq++;
      batches.push({
        id: `BATCH-S${runId}-${batchSeq}`,
        tasks: hasConflict,
        parallel: false,
      });
    }

    if (dependent.length > 0) {
      const sorted = this.topologicalSort(dependent, dependencyMap);
      const levels = this.groupByDependencyLevel(sorted, dependencyMap);
      for (const level of levels) {
        if (level.length > 0) {
          batchSeq++;
          const hasConflictInLevel = level.some((t) => conflictTaskIds.has(t.id));
          const canParallel = level.length > 0 && !hasConflictInLevel;
          batches.push({
            id: `BATCH-${canParallel ? "P" : "S"}${runId}-${batchSeq}`,
            tasks: level,
            parallel: canParallel,
          });
        }
      }
    }

    return {
      batches,
      totalTasks: tasks.length,
      estimatedParallelGroups: batches.filter((b) => b.parallel).length,
      fileConflicts,
    };
  }

  async executePlan(
    plan: DispatchPlan,
    onBatchStart?: (batch: DispatchBatch) => void,
    onTaskComplete?: (result: DispatchResult) => void,
    signal?: AbortSignal,
  ): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];

    for (const batch of plan.batches) {
      if (signal?.aborted) {
        for (const task of batch.tasks) {
          const result: DispatchResult = {
            batchId: batch.id,
            taskId: task.id,
            assignedAgent: "",
            handoffId: "",
            success: false,
            error: "cancelled",
          };
          onTaskComplete?.(result);
          results.push(result);
        }
        continue;
      }
      onBatchStart?.(batch);

      if (batch.parallel) {
        const BATCH_TIMEOUT_MS = 120_000;
        const batchAbort = new AbortController();
        const onExternalAbort = () => batchAbort.abort();
        signal?.addEventListener("abort", onExternalAbort, { once: true });
        const timeoutId = setTimeout(() => {
          logger.warn(`Batch ${batch.id} timed out after ${BATCH_TIMEOUT_MS}ms`);
          batchAbort.abort();
        }, BATCH_TIMEOUT_MS);
        if (timeoutId?.unref) timeoutId.unref();

        const taskPromises = batch.tasks.map((task) =>
          this.dispatchSingle(task, batch.id, batchAbort.signal, batch.id)
            .then((result) => {
              onTaskComplete?.(result);
              return result;
            })
            .catch((err) => {
              const result: DispatchResult = {
                batchId: batch.id,
                taskId: task.id,
                assignedAgent: "",
                handoffId: "",
                success: false,
                error: String(err),
              };
              onTaskComplete?.(result);
              return result;
            }),
        );

        const settled = await Promise.allSettled(taskPromises);
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onExternalAbort);

        for (const s of settled) {
          if (s.status === "fulfilled") {
            results.push(s.value);
          } else {
            results.push({
              batchId: batch.id,
              taskId: "",
              assignedAgent: "",
              handoffId: "",
              success: false,
              error: String(s.reason),
            });
          }
        }
      } else {
        for (const task of batch.tasks) {
          if (signal?.aborted) {
            const result: DispatchResult = {
              batchId: batch.id,
              taskId: task.id,
              assignedAgent: "",
              handoffId: "",
              success: false,
              error: "cancelled",
            };
            onTaskComplete?.(result);
            results.push(result);
            continue;
          }
          const result = await this.dispatchSingle(task, batch.id);
          onTaskComplete?.(result);
          results.push(result);
        }
      }
    }

    return results;
  }

  private async dispatchSingle(
    task: DispatchTask,
    batchId?: string,
    signal?: AbortSignal,
    parallelId?: string,
  ): Promise<DispatchResult> {
    if (signal?.aborted) {
      return {
        batchId: batchId ?? "",
        taskId: task.id,
        assignedAgent: "none",
        handoffId: "",
        success: false,
        error: "batch timeout",
      };
    }

    const match = this.findBestAgent({
      task: task.description,
      preferredRole: task.preferredRole,
      specializations: task.specializations,
      requireAvailability: true,
      excludeAgents: ["tawa", "@tawa"],
    });

    if (!match) {
      return {
        batchId: batchId ?? "",
        taskId: task.id,
        assignedAgent: "none",
        handoffId: "",
        success: false,
        error: "No agent available for this task",
      };
    }

    try {
      const handoffId = this.createHandoff({
        to: match.agent,
        task: task.description,
        context: task.context,
        files: task.files,
        ...(parallelId !== undefined ? { parallelId } : {}),
      });

      return {
        batchId: batchId ?? "",
        taskId: task.id,
        assignedAgent: match.agent,
        handoffId,
        success: true,
      };
    } catch (err) {
      return {
        batchId: batchId ?? "",
        taskId: task.id,
        assignedAgent: match.agent,
        handoffId: "",
        success: false,
        error: String(err),
      };
    }
  }

  private topologicalSort(tasks: DispatchTask[], dependencyMap: Map<string, string[]>): DispatchTask[] {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const sorted: DispatchTask[] = [];

    const visit = (taskId: string): boolean => {
      if (inStack.has(taskId)) return false;
      if (visited.has(taskId)) return true;
      inStack.add(taskId);
      visited.add(taskId);

      const deps = dependencyMap.get(taskId) ?? [];
      for (const depId of deps) {
        if (!visit(depId)) return false;
      }

      inStack.delete(taskId);
      const task = taskMap.get(taskId);
      if (task) sorted.push(task);
      return true;
    };

    for (const task of tasks) {
      if (!visited.has(task.id)) {
        if (!visit(task.id)) {
          logger.warn(`Cycle detected in task dependencies, returning original order`);
          return tasks;
        }
      }
    }

    return sorted;
  }

  private groupByDependencyLevel(sorted: DispatchTask[], dependencyMap: Map<string, string[]>): DispatchTask[][] {
    const levels: DispatchTask[][] = [];
    const levelMap = new Map<string, number>();

    for (const task of sorted) {
      const deps = dependencyMap.get(task.id) ?? [];
      let maxDepLevel = -1;
      for (const depId of deps) {
        const depLevel = levelMap.get(depId) ?? -1;
        maxDepLevel = Math.max(maxDepLevel, depLevel);
      }
      const taskLevel = maxDepLevel + 1;
      levelMap.set(task.id, taskLevel);

      if (!levels[taskLevel]) levels[taskLevel] = [];
      levels[taskLevel]!.push(task);
    }

    return levels.filter(Boolean);
  }

  estimateParallelism(tasks: DispatchTask[]): number {
    const plan = this.buildPlan(tasks);
    let maxParallel = 0;
    for (const batch of plan.batches) {
      if (batch.parallel && batch.tasks.length > maxParallel) {
        maxParallel = batch.tasks.length;
      }
    }
    return maxParallel;
  }
}

export function buildDispatchPlanFromHandoffs(
  handoffs: { id: string; task: string; files: string[]; to?: string }[],
): DispatchPlan {
  const dispatcher = new ParallelDispatcher(
    () => {
      throw new Error("buildDispatchPlanFromHandoffs: createHandoff not implemented for bulk dispatch");
    },
    () => {
      throw new Error("buildDispatchPlanFromHandoffs: findBestAgent not implemented for bulk dispatch");
    },
  );

  const tasks: DispatchTask[] = handoffs.map((h, _i) => ({
    id: h.id,
    description: h.task,
    context: "",
    files: h.files || [],
    dependencies: [],
    preferredRole: normalizeName(h.to ?? ""),
    specializations: [],
    estimatedComplexity: "simple" as const,
  }));

  return dispatcher.buildPlan(tasks);
}

export function toAgentResults(results: DispatchResult[]): AgentResult[] {
  return results.map((r: DispatchResult) => ({
    agentId: r.assignedAgent,
    output: r.success ? "completed" : (r.error ?? "failed"),
    files: [],
    metrics: {},
    error: r.error,
  }));
}

const ROLE_TO_AGENT: Record<string, string> = {
  dev: "dev",
  developer: "dev",
  analyst: "analyst",
  analysis: "analyst",
  tester: "tester",
  testing: "tester",
  reviewer: "reviewer",
  review: "reviewer",
  architect: "architect",
  architecture: "architect",
  designer: "designer",
  design: "designer",
  doc: "doc",
  documentation: "doc",
  writer: "doc",
};

export function defaultFindBestAgent(request: MatchRequest): AgentMatchResult | null {
  const preferred = normalizeName(request.preferredRole ?? "") ?? "";
  const direct = ROLE_TO_AGENT[preferred];
  if (direct)
    return {
      agent: direct,
      score: 0.9,
      reason: "default role match",
      breakdown: { roleMatch: 1, specializationMatch: 0, performanceScore: 0, availabilityScore: 0, errorPenalty: 0 },
    };
  const spec = request.specializations.find((s) => ROLE_TO_AGENT[normalizeName(s)]);
  if (spec)
    return {
      agent: ROLE_TO_AGENT[normalizeName(spec)]!,
      score: 0.7,
      reason: "default specialization match",
      breakdown: { roleMatch: 0, specializationMatch: 1, performanceScore: 0, availabilityScore: 0, errorPenalty: 0 },
    };
  return {
    agent: "@dev",
    score: 0.4,
    reason: "default fallback",
    breakdown: { roleMatch: 0, specializationMatch: 0, performanceScore: 0, availabilityScore: 0, errorPenalty: 0 },
  };
}

export type { TaskUnit, CoordinationPlan, ConflictResolution } from "./task-coordinator.ts";
export { createCoordinationPlan, handleConflict } from "./task-coordinator.ts";