


import type { HandoffEntry } from "../context/types.ts";
import type { TaskPhase } from "./pipeline.ts";
import { normalizeName } from "../utils/name-utils.ts";

export interface TaskUnit {
  id: string;
  agent: string;
  phase: TaskPhase;
  description: string;
  targetFiles: string[];
  dependencies: string[];
  estimatedDuration: number;
}

export interface CoordinationPlan {
  phase: TaskPhase;
  parallelBatches: TaskUnit[][];
  sequentialBatches: TaskUnit[][];
  fileLocks: Map<string, string>;
}

type ConflictStrategy = "queue" | "reroute" | "split" | "wait";

export interface ConflictResolution {
  strategy: ConflictStrategy;
  message: string;
  suggestedAgent?: string;
  estimatedWaitMs?: number;
}


const CIRCUIT_BREAKER_THRESHOLD = 3;

export type AgentFailureCounts = ReadonlyMap<string, number>;

export function createCoordinationPlan(
  phase: TaskPhase,
  tasks: TaskUnit[],
  failureCounts: AgentFailureCounts,
): CoordinationPlan {
  const plan: CoordinationPlan = {
    phase,
    parallelBatches: [],
    sequentialBatches: [],
    fileLocks: new Map(),
  };
  const fileMap = new Map<string, TaskUnit[]>();
  for (const task of tasks) {
    for (const file of task.targetFiles) {
      const existing = fileMap.get(file) ?? [];
      existing.push(task);
      fileMap.set(file, existing);
    }
  }
  const conflicts = new Map<string, TaskUnit[]>();
  for (const [file, units] of fileMap) {
    if (units.length > 1) conflicts.set(file, units);
  }
  const conflictIds = new Set<string>();
  for (const [, units] of conflicts) {
    for (const u of units) conflictIds.add(u.id);
  }
  const independent: TaskUnit[] = [],
    dependent: TaskUnit[] = [];
  for (const task of tasks) {
    if ((task.dependencies ?? []).length === 0) independent.push(task);
    else dependent.push(task);
  }
  const noConflict = independent.filter((t) => !conflictIds.has(t.id));
  const hasConflict = independent.filter((t) => conflictIds.has(t.id));
  const ok = noConflict.filter((t) => (failureCounts.get(normalizeName(t.agent)) ?? 0) < CIRCUIT_BREAKER_THRESHOLD);
  if (ok.length > 0) {
    plan.parallelBatches.push(ok);
    for (const t of ok) {
      for (const f of t.targetFiles) {
        if (!plan.fileLocks.has(f)) plan.fileLocks.set(f, normalizeName(t.agent));
      }
    }
  }
  if (hasConflict.length > 0) {
    hasConflict.sort(
      (a, b) => a.targetFiles.length - b.targetFiles.length || a.estimatedDuration - b.estimatedDuration,
    );
    for (const t of hasConflict) {
      plan.sequentialBatches.push([t]);
      for (const f of t.targetFiles) plan.fileLocks.set(f, normalizeName(t.agent));
    }
  }
  if (dependent.length > 0) {
    const taskMap = new Map(dependent.map((t) => [t.id, t]));
    const visited = new Set<string>();
    const sorted: TaskUnit[] = [];
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const d of taskMap.get(id)?.dependencies ?? []) {
        if (taskMap.has(d)) visit(d);
      }
      const t = taskMap.get(id);
      if (t) sorted.push(t);
    };
    for (const t of dependent) {
      if (!visited.has(t.id)) visit(t.id);
    }
    for (const t of sorted) {
      plan.sequentialBatches.push([t]);
      for (const f of t.targetFiles) plan.fileLocks.set(f, normalizeName(t.agent));
    }
  }
  return plan;
}

export function handleConflict(
  agents: string[],
  files: string[],
  activeHandoffs: HandoffEntry[],
  failureCounts: AgentFailureCounts,
): ConflictResolution {
  const available = agents.filter((a) => (failureCounts.get(normalizeName(a)) ?? 0) < CIRCUIT_BREAKER_THRESHOLD);
  if (available.length === 0)
    return {
      strategy: "wait",
      message: `All agents (${agents.join(", ")}) exceeded the failure threshold — wait`,
      estimatedWaitMs: 60000,
    };
  const busy = activeHandoffs.filter(
    (h) => (h.status === "accepted" || h.status === "pending") && files.some((f) => h.files.includes(f)),
  );
  if (busy.length > 0) {
    const busyNames = busy.map((h) => h.to);
    const alt = available.filter((a) => !busyNames.includes(a));
    if (alt.length > 0)
      return {
        strategy: "reroute",
        message: `Files ${files.join(", ")} are locked by ${busyNames.join(", ")}. Rerouting to ${alt[0]}`,
        suggestedAgent: alt[0],
      };
    const h = busy[0]!;
    const elapsed = h.timestamp ? Date.now() - new Date(h.timestamp).getTime() : 0;
    return {
      strategy: "queue",
      message: `Waiting for ${busyNames.join(", ")} to finish work on ${files.join(", ")}`,
      estimatedWaitMs: Math.max(30000 - elapsed, 5000),
    };
  }
  if (files.length > 1 && agents.length >= files.length)
    return { strategy: "split", message: `Splitting files ${files.join(", ")} between agents ${agents.join(", ")}` };
  return {
    strategy: "queue",
    message: `Conflict on files ${files.join(", ")} — adding to queue`,
    estimatedWaitMs: 30000,
  };
}
