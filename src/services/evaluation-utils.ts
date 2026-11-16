import type { EvaluationIssue, TawassulEvaluationReport } from "../context/evaluation-report.ts";
import { isReportExpired } from "../context/evaluation-report.ts";

export function mergeEvaluationReports(reports: TawassulEvaluationReport[]): TawassulEvaluationReport {
  if (reports.length === 0) {
    throw new Error("Cannot merge empty reports array");
  }

  const allIssues = reports.flatMap(r => r.issues);
  const deduped = deduplicateIssues(allIssues);
  const allRecommendations = [...new Set(reports.flatMap(r => r.recommendations))];
  const allUncovered = [...new Set(reports.flatMap(r => r.uncoveredAreas))];
  const mergedCoverage: Record<string, string[]> = {};
  for (const r of reports) {
    for (const [key, files] of Object.entries(r.coverageMap)) {
      (mergedCoverage[key] ??= []).push(...files);
    }
  }
  for (const key of Object.keys(mergedCoverage)) {
    mergedCoverage[key] = [...new Set(mergedCoverage[key])];
  }

  return {
    featureId: reports[0]!.featureId,
    reportId: `merged-${Date.now()}`,
    round: Math.max(...reports.map(r => r.round)),
    issues: deduped,
    recommendations: allRecommendations,
    uncoveredAreas: allUncovered,
    summary: `Merged ${reports.length} reports: ${deduped.length} issues, ${allUncovered.length} uncovered`,
    coverageMap: mergedCoverage,
    metadata: {
      agent: "system",
      sessionId: "merged",
      timestamp: new Date().toISOString(),
    },
  };
}

export function deduplicateIssues(issues: EvaluationIssue[]): EvaluationIssue[] {
  const seen = new Map<string, EvaluationIssue>();

  for (const issue of issues) {
    const existing = seen.get(issue.dedupKey);
    if (!existing) {
      seen.set(issue.dedupKey, issue);
    } else if (issue.severity === "critical" && existing.severity !== "critical") {
      seen.set(issue.dedupKey, issue);
    }
  }

  return [...seen.values()];
}

export function findCoverageGaps(reports: TawassulEvaluationReport[]): string[] {
  const allCovered = new Set<string>();
  const allCoveredKeys = new Set<string>();
  const allUncovered = new Set<string>();

  for (const report of reports) {
    if (isReportExpired(report)) continue;
    for (const [key, files] of Object.entries(report.coverageMap)) {
      allCoveredKeys.add(key);
      for (const f of files) allCovered.add(f);
    }
    for (const area of report.uncoveredAreas) {
      allUncovered.add(area);
    }
  }

  const notActuallyCovered: string[] = [];
  for (const area of allUncovered) {
    let found = false;
    if (allCoveredKeys.has(area)) found = true;
    if (!found) {
      for (const covered of allCovered) {
        const segments = covered.split(/[/._-]/);
        if (segments.includes(area)) {
          found = true;
          break;
        }
      }
    }
    if (!found) notActuallyCovered.push(area);
  }

  return notActuallyCovered;
}
