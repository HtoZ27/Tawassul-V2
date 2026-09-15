import { ParallelAggregator } from "./parallel-aggregator.ts";
import type { AggregatedResult } from "./parallel-aggregator.ts";
import { mergeEvaluationReports, deduplicateIssues, findCoverageGaps } from "./evaluation-utils.ts";
import type { EvaluationIssue, TawassulEvaluationReport } from "../context/evaluation-report.ts";
import type { AgentResult, MergedReport, Finding } from "../types/plan.types.ts";
import type { EventHub } from "./event-hub.ts";
import type { HandoffEntry } from "../context/types.ts";

const SEVERITY_MAP: Record<Finding["severity"], EvaluationIssue["severity"]> = {
  low: "info",
  medium: "minor",
  high: "major",
  critical: "critical",
};

function toEvaluationReport(r: MergedReport): TawassulEvaluationReport {
  const now = new Date().toISOString();
  return {
    featureId: "merged",
    reportId: `merged-${Date.now()}`,
    round: 1,
    issues: r.findings.map((f, i) => ({
      id: `merged-${Date.now()}-${i}`,
      severity: SEVERITY_MAP[f.severity],
      category: "correctness",
      file: f.file,
      line: f.line,
      dedupKey: `${f.file}:${f.line ?? 0}:${f.message}`,
      description: f.message,
      recommendation: "",
      status: "open",
      createdAt: now,
      reportedBy: "result-engine",
    })),
    recommendations: r.recommendations,
    uncoveredAreas: [],
    summary: r.summary,
    coverageMap: {},
    metadata: {
      agent: "result-engine",
      sessionId: "",
      timestamp: now,
    },
  };
}

export class ResultEngine {
  private aggregator: ParallelAggregator;

  constructor(private eventHub?: EventHub) {
    this.aggregator = new ParallelAggregator();
  }

  collect(results: AgentResult[]): AggregatedResult {
    if (!results || !Array.isArray(results)) {
      const empty: AggregatedResult = {
        parallelId: "",
        totalCount: 0,
        completedCount: 0,
        results: [],
        allDone: false,
        summary: "",
      };
      if (this.eventHub) {
        this.eventHub.emit({ type: "RESULTS_COLLECTED", taskId: "", resultCount: 0 });
      }
      return empty;
    }
    const parallelId = `collect-${Date.now()}`;
    const handoffs: HandoffEntry[] = results.map((r, i) => ({
      id: `agent-${i}`,
      from: r.agentId,
      to: r.agentId,
      task: r.output?.slice(0, 100) ?? "",
      context: "",
      files: r.files ?? [],
      timestamp: new Date().toISOString(),
      status: "completed",
      rescue: !!r.error,
      result: r.error ?? r.output,
      parallelId,
    }));
    const aggregated = this.aggregator.aggregate(handoffs, parallelId);
    if (this.eventHub) {
      this.eventHub.emit({ type: "RESULTS_COLLECTED", taskId: parallelId, resultCount: results.length });
    }
    return aggregated;
  }

  merge(reports: MergedReport[]): MergedReport {
    const evaluationReports: TawassulEvaluationReport[] = [];
    if (reports.length > 0) {
      for (const r of reports) {
        evaluationReports.push(toEvaluationReport(r));
      }
    }
    mergeEvaluationReports(evaluationReports);
    deduplicateIssues(evaluationReports.flatMap((r) => r.issues));
    findCoverageGaps(evaluationReports);
    const qualityScore =
      evaluationReports.length > 0
        ? Math.min(
            1,
            evaluationReports.filter((r) => r.summary && r.issues.length === 0).length / evaluationReports.length,
          )
        : 0;
    const allFindings = reports.flatMap((r) => r.findings);
    const allRecommendations = reports.flatMap((r) => r.recommendations);
    const result: MergedReport = {
      summary: `دمج ${reports.length} تقرير`,
      findings: allFindings,
      recommendations: allRecommendations,
      qualityScore,
    };
    if (this.eventHub) {
      this.eventHub.emit({ type: "REPORT_MERGED", reportId: "", qualityScore });
    }
    return result;
  }

  extractKeyFindings(result: AggregatedResult): Finding[] {
    return result.results
      .filter((r) => r.result)
      .map((r) => ({
        file: "",
        message: r.result.substring(0, 200),
        severity: "medium" as const,
      }));
  }
}
