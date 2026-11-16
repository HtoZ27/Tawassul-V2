import { classifyProblemSize } from "../conflict-resolver/problem-classifier.ts";
import type { RuleInput, TaskPriority } from "../conflict-resolver/types.ts";
import type { TawassulConfig } from "../context/types.ts";
import type { FileLockManager } from "../infra/file-lock.ts";
import type { ErrorManager } from "../context/managers/ErrorManager.ts";
import type { RatingManager } from "../context/managers/RatingManager.ts";
import { cfgPriority } from "../utils/agent.ts";
import { normalizeName } from "../utils/name-utils.ts";

export interface BuildRuleInputParams {
  from: string;
  to: string;
  task: string;
  context: string;
  files: string[];
  taskComplexity?: "simple" | "medium" | "complex";
  taskPriority?: "P1" | "P2" | "P3";
}

export class RuleInputBuilder {
  private capabilityCache: Record<string, string> | null = null;
  private capabilityCacheTime = 0;

  constructor(
    private handoffs: { to: string; status: string; timestamp: string; id?: string; task?: string }[],
    private errorManager: ErrorManager,
    private fileLocks: FileLockManager,
    private config: TawassulConfig,
    private readAgentMd: (tag: string) => { name?: string; role?: string; capability?: string } | null,
    private getAgents: () => string[],
    private ratingManager: RatingManager,
  ) {}

  async build(params: BuildRuleInputParams): Promise<RuleInput> {
    const { from, to, task, context, files, taskComplexity: inputComplexity, taskPriority: inputPriority } = params;

    let taskComplexity = inputComplexity;
    if (!taskComplexity) {
      const ctx = `${task} ${context}`;
      const lineEstimate = ctx.split(/\s+/).filter(Boolean).length;
      const classification = classifyProblemSize({
        description: ctx,
        lineCount: lineEstimate,
        fileCount: files.length,
      });
      taskComplexity =
        classification.tier === "SIMPLE" ? "simple" : classification.tier === "MEDIUM" ? "medium" : "complex";
    }

    const normFrom = normalizeName(from);
    const agentBusy = this.handoffs.some((h) => normalizeName(h.to) === normFrom && h.status === "accepted");
    const busyHandoff = this.handoffs.find((h) => normalizeName(h.to) === normFrom && h.status === "accepted");
    const activeHandoffs = this.handoffs.filter(
      (h) => normalizeName(h.to) === normFrom && h.status !== "completed",
    ).length;
    const errorCount = this.errorManager.getErrorCount(to);

    const fileChecks = await Promise.all(files.map((f) => this.fileLocks.checkFileConflict(f, from)));
    const fileConflict = fileChecks.some((c) => c.conflict);
    const conflictCheck = fileChecks.find((c) => c.conflict);
    const conflictFiles = conflictCheck ? files.filter((_, i) => fileChecks[i]!.conflict) : [];
    const lockedCheckResults = await Promise.all(files.map((f) => this.fileLocks.isLocked(f)));
    const lockedFiles = files.filter((_, i) => fileChecks[i]!.conflict || lockedCheckResults[i]!);

    const srcCap = this.config.agentModels?.[from]?.capability || this.readAgentMd(from)?.capability;
    const dstCap = this.config.agentModels?.[to]?.capability || this.readAgentMd(to)?.capability;
    const capabilityMatch = !srcCap || !dstCap || srcCap === dstCap;

    const agentRating = this.ratingManager.calculateHealthScore(this.ratingManager.getOrCreateRating(from));

    const handoffsArr = [...this.handoffs.values()];
    const totalHandoffsToday = handoffsArr.length;
    const lastHandoffTime =
      handoffsArr.length > 0 ? new Date(handoffsArr[handoffsArr.length - 1]!.timestamp).getTime() : 0;
    const timeSinceLastHandoff = lastHandoffTime > 0 ? Date.now() - lastHandoffTime : 999999;

    let taskPriority = inputPriority;
    if (!taskPriority) {
      const combined = `${task} ${context}`.toLowerCase();
      if (
        combined.includes("p1") ||
        combined.includes("critical") ||
        combined.includes("critical") ||
        combined.includes("priority 1")
      ) {
        taskPriority = "P1";
      } else if (
        combined.includes("p2") ||
        combined.includes("high") ||
        combined.includes("high priority") ||
        combined.includes("priority 2")
      ) {
        taskPriority = "P2";
      } else {
        taskPriority = "P3";
      }
    }

    if (!this.capabilityCache || Date.now() - this.capabilityCacheTime > 30000) {
      this.capabilityCache = {};
      for (const agent of this.getAgents()) {
        const cap = this.config.agentModels?.[agent]?.capability || this.readAgentMd(agent)?.capability;
        if (cap) this.capabilityCache[agent] = cap;
      }
      this.capabilityCacheTime = Date.now();
    }
    const allAgentCapabilities: Record<string, string> = { ...this.capabilityCache };

    return {
      from,
      to,
      task,
      context,
      files,
      agentBusy,
      activeHandoffs,
      errorCount,
      fileConflict,
      conflictFiles,
      conflictAgent: conflictCheck?.lockedBy,
      lockedFiles,
      agentPriority: cfgPriority(to),
      capabilityMatch,
      srcCap,
      dstCap,
      allAgentCapabilities,
      taskPriority: taskPriority as TaskPriority,
      taskComplexity,
      timeSinceLastHandoff,
      totalHandoffsToday,
      agentRating,
      busyHandoffId: busyHandoff?.id,
      busyTask: busyHandoff?.task,
    };
  }
}