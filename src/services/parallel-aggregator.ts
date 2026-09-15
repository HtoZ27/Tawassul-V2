import type { HandoffEntry } from "../context/types.ts";
import { selectCentroid } from "./similarity.ts";
import type { EvaluationIssue, TawassulEvaluationReport } from "../context/evaluation-report.ts";
import {
  mergeEvaluationReports as utilsMerge,
  deduplicateIssues as utilsDedup,
  findCoverageGaps as utilsGaps,
} from "./evaluation-utils.ts";

export interface AggregatedResult {
  parallelId: string;
  totalCount: number;
  completedCount: number;
  results: Array<{
    handoffId: string;
    agent: string;
    task: string;
    result: string;
    success: boolean;
    completedAt: string;
  }>;
  allDone: boolean;
  bestResult?: string;
  bestAgent?: string;
  summary: string;
}

export class ParallelAggregator {
  aggregate(handoffs: HandoffEntry[], parallelId: string): AggregatedResult {
    const group = handoffs.filter((h) => h.parallelId === parallelId);
    const completed = group.filter((h) => h.status === "completed" && h.result);

    const results = completed.map((h) => ({
      handoffId: h.id,
      agent: h.to,
      task: h.task,
      result: h.result || "",
      success: !h.rescue,
      completedAt: h.timestamp,
    }));

    const allDone = group.length > 0 && group.every((h) => h.status === "completed" || h.status === "cancelled");

    let bestResult: string | undefined;
    let bestAgent: string | undefined;
    if (results.length > 0) {
      const outputs = results.map((r) => r.result);
      const centroidIdx = selectCentroid(outputs);
      bestResult = outputs[centroidIdx];
      bestAgent = results[centroidIdx]?.agent ?? "";
    }

    const summary = this.buildSummary(results, allDone, parallelId);

    return {
      parallelId,
      totalCount: group.length,
      completedCount: results.length,
      results,
      allDone,
      bestResult,
      bestAgent,
      summary,
    };
  }

  buildReport(aggregated: AggregatedResult): string {
    if (aggregated.results.length === 0) {
      return `## 📊 Parallel results (${aggregated.parallelId})\nNo results yet.`;
    }

    const sections = aggregated.results.map((r) => {
      const fence = r.result.includes("```") ? "~~~" : "```";
      return [
        `### 🎯 ${r.handoffId} — ${r.agent}`,
        `**Task:** ${r.task}`,
        `**Result (${r.result.length} chars):**`,
        fence,
        r.result,
        fence,
        ``,
      ].join("\n");
    });

    return [
      ``,
      `---`,
      `## 📊 ${aggregated.allDone ? "✅ All done" : "⏳ In progress"} — ${aggregated.completedCount}/${aggregated.totalCount}`,
      aggregated.bestAgent ? `**Best agent (centroid):** ${aggregated.bestAgent}` : "",
      ``,
      ...sections,
      `---`,
      aggregated.allDone
        ? `💡 Use \`compare(handoffIds: [${aggregated.results.map((r) => `"${r.handoffId}"`).join(", ")}])\` to compare`
        : `⏳ Waiting for the remaining agents...`,
    ].join("\n");
  }

  private buildSummary(results: AggregatedResult["results"], allDone: boolean, parallelId: string): string {
    const agents = results.map((r) => r.agent).join(", ");
    const status = allDone ? "✅ Completed" : "⏳ In progress";
    return `[${parallelId}] ${status} — agents: ${agents || "none"}`;
  }

  isParallelGroupComplete(handoffs: HandoffEntry[], parallelId: string): boolean {
    return this.aggregate(handoffs, parallelId).allDone;
  }

  getBestAgent(handoffs: HandoffEntry[], parallelId: string): string | null {
    const agg = this.aggregate(handoffs, parallelId);
    return agg.bestAgent ?? null;
  }

  mergeEvaluationReports(reports: TawassulEvaluationReport[]): TawassulEvaluationReport {
    return utilsMerge(reports);
  }

  deduplicateIssues(issues: EvaluationIssue[]): EvaluationIssue[] {
    return utilsDedup(issues);
  }

  findCoverageGaps(reports: TawassulEvaluationReport[]): string[] {
    return utilsGaps(reports);
  }
}