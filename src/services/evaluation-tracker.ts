import type {
  EvaluationIssue,
  TawassulEvaluationReport,
} from "../context/evaluation-report.ts";
import { MAX_REPORTS_PER_FEATURE, isReportExpired } from "../context/evaluation-report.ts";
import type { FeatureIndex } from "./feature-index.ts";
import type { EventHub } from "./event-hub.ts";
import type { EvaluationSessionManager } from "./evaluation-session-manager.ts";
import { mergeEvaluationReports, deduplicateIssues, findCoverageGaps } from "./evaluation-utils.ts";

export class EvaluationTracker {
  constructor(
    private featureIndex: FeatureIndex,
    private eventHub?: EventHub,
    private sessionManager?: EvaluationSessionManager,
  ) {}

  recordEvaluation(featureId: string, report: TawassulEvaluationReport): boolean {
    this.cleanupExpired(featureId);

    const existing = this.featureIndex.getEvaluationReports(featureId);
    if (existing.length >= MAX_REPORTS_PER_FEATURE) {
      return false;
    }

    const result = this.featureIndex.setEvaluationReport(featureId, report);

    if (result && this.eventHub) {
      this.eventHub.emit({ type: "EVALUATION_RECORDED", featureId, reportId: report.reportId, issueCount: report.issues.length });
    }

    if (result && this.sessionManager) {
      const sessions = this.sessionManager.getActiveSessions(featureId);
      if (sessions.length > 0) {
        this.sessionManager.updateSession(sessions[0]!.sessionId, {
          totalRounds: report.round,
          totalIssues: report.issues.length,
        });
      }
      this.sessionManager.evictStale();
    }

    return result;
  }

  getRemainingIssues(featureId: string): EvaluationIssue[] {
    const reports = this.featureIndex.getEvaluationReports(featureId);
    const active = reports.filter(r => !isReportExpired(r));
    const allOpen = active.flatMap(r =>
      r.issues.filter(i =>
        i.status !== "resolved" && i.status !== "wont_fix" && i.status !== "duplicate"
      )
    );
    return deduplicateIssues(allOpen);
  }

  getEvaluationHistory(featureId: string): TawassulEvaluationReport[] {
    return this.featureIndex.getEvaluationReports(featureId).filter(r => !isReportExpired(r));
  }

  mergeReports(reports: TawassulEvaluationReport[]): TawassulEvaluationReport {
    return mergeEvaluationReports(reports);
  }

  deduplicateIssues(issues: EvaluationIssue[]): EvaluationIssue[] {
    return deduplicateIssues(issues);
  }

  findCoverageGaps(reports: TawassulEvaluationReport[]): string[] {
    return findCoverageGaps(reports);
  }

  resolveIssue(featureId: string, issueId: string): EvaluationIssue | null {
    const reports = this.featureIndex.getEvaluationReports(featureId);
    for (let i = 0; i < reports.length; i++) {
      const issue = reports[i]!.issues.find(j => j.id === issueId && (j.status === "open" || j.status === "in_progress"));
      if (issue) {
        const reportCopy = structuredClone(reports[i]!);
        const resolvedIssue = reportCopy.issues.find(j => j.id === issueId)!;
        resolvedIssue.status = "resolved";
        resolvedIssue.resolvedAt = new Date().toISOString();
        resolvedIssue.resolvedBy = "system";
        reports[i] = reportCopy;

        this.featureIndex.setEvaluationReports(featureId, reports);

        if (this.eventHub) {
          this.eventHub.emit({ type: "ISSUE_RESOLVED", featureId, issueId, resolvedBy: "system" });
        }

        if (this.sessionManager) {
          const sessions = this.sessionManager.getActiveSessions(featureId);
          if (sessions.length > 0) {
            this.sessionManager.updateSession(sessions[0]!.sessionId, {
              addResolvedIssues: 1,
            });
          }
        }

        return resolvedIssue;
      }
    }
    return null;
  }

  cleanupExpired(featureId: string): number {
    const reports = this.featureIndex.getEvaluationReports(featureId);
    const before = reports.length;
    const active = reports.filter(r => !isReportExpired(r));
    let removed = before - active.length;

    if (active.length > MAX_REPORTS_PER_FEATURE) {
      active.sort((a, b) => new Date(a.metadata.timestamp).getTime() - new Date(b.metadata.timestamp).getTime());
      const excess = active.length - MAX_REPORTS_PER_FEATURE;
      active.splice(0, excess);
      removed += excess;
    }

    if (removed > 0) {
      this.featureIndex.setEvaluationReports(featureId, active);
    }

    return removed;
  }
}
