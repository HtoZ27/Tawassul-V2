import crypto from "node:crypto";
import { ParallelDispatcher, toAgentResults, defaultFindBestAgent } from "./parallel-dispatcher.ts";
import type { DispatchTask } from "./parallel-dispatcher.ts";
import type { SubTask, AgentResult } from "../types/plan.types.ts";
import { normalizeName } from "../utils/name-utils.ts";

export type DispatchMode = "parallel" | "swarm" | "moa" | "auto";

const DEFAULT_SWARM_COPIES = 3;

export const MOA_AGENTS = ["dev", "tester", "analyst"];

export class StrategyDispatcher {
  private parallelDispatcher: ParallelDispatcher;
  private swarmCopies: number;

  constructor(parallelDispatcher?: ParallelDispatcher, options?: { swarmCopies?: number }) {
    this.parallelDispatcher =
      parallelDispatcher ?? new ParallelDispatcher(() => crypto.randomUUID(), defaultFindBestAgent);
    this.swarmCopies = options?.swarmCopies ?? DEFAULT_SWARM_COPIES;
  }

  selectMode(task: SubTask, preferred?: DispatchMode): DispatchMode {
    if (preferred && preferred !== "auto") return preferred;
    const files = task.declaredFiles ?? task.files;
    const isComplex = task.dependencies.length > 3 || files.length > 5;
    const needsAccuracy = task.successCriteria.length > 5;
    if (needsAccuracy) return "moa";
    if (isComplex) return "swarm";
    return "parallel";
  }

  async dispatch(task: SubTask, mode: DispatchMode, roles?: readonly string[]): Promise<AgentResult[]> {
    const actualMode = this.selectMode(task, mode);
    if (actualMode === "swarm" || actualMode === "moa") {
      return this.dispatchToRoles(task, roles ?? this.buildRoles(actualMode), actualMode);
    }
    return this.dispatchParallel(task);
  }

  private buildRoles(mode: "swarm" | "moa"): readonly string[] {
    if (mode === "swarm") {
      return Array.from({ length: this.swarmCopies }, (_, i) => MOA_AGENTS[i % MOA_AGENTS.length]!);
    }
    return MOA_AGENTS;
  }

  private singleTaskToDispatchTask(task: SubTask): DispatchTask {
    const normalizedRole = normalizeName(task.agent);
    return {
      id: task.id,
      description: task.description,
      context: task.context ?? "",
      files: task.files,
      declaredFiles: task.declaredFiles,
      dependencies: task.dependencies,
      preferredRole: normalizedRole,
      specializations: [],
      estimatedComplexity: "medium" as const,
    };
  }

  private async dispatchParallel(task: SubTask): Promise<AgentResult[]> {
    const dispatchTasks: DispatchTask[] = [this.singleTaskToDispatchTask(task)];
    const plan = this.parallelDispatcher.buildPlan(dispatchTasks);
    const results = await this.parallelDispatcher.executePlan(plan);
    return toAgentResults(results);
  }

  private async dispatchToRoles(
    task: SubTask,
    roles: readonly string[],
    kind: "swarm" | "moa",
  ): Promise<AgentResult[]> {
    const dispatchTasks: DispatchTask[] = roles.map((role, i) => ({
      ...this.singleTaskToDispatchTask(task),
      id: `${task.id}-${kind}-${i}`,
      preferredRole: role,
      copyOf: task.id,
    }));
    const plan = this.parallelDispatcher.buildPlan(dispatchTasks);
    const results = await this.parallelDispatcher.executePlan(plan);
    return toAgentResults(results);
  }
}
