export type IssueSeverity = "critical" | "major" | "minor" | "info";

export type IssueCategory =
  | "security"
  | "correctness"
  | "performance"
  | "usability"
  | "maintainability"
  | "completeness";

export type IssueStatus = "open" | "in_progress" | "resolved" | "wont_fix" | "duplicate";

export interface EvaluationIssue {
  id: string;
  severity: IssueSeverity;
  category: IssueCategory;
  file?: string;
  line?: number;
  dedupKey: string;
  description: string;
  recommendation: string;
  status: IssueStatus;
  createdAt: string;
  reportedBy: string;
  resolvedAt?: string;
  resolvedBy?: string;
  relatedRecordIds?: string[];
}

export interface TawassulEvaluationReport {
  featureId: string;
  reportId: string;
  round: number;
  issues: EvaluationIssue[];
  recommendations: string[];
  uncoveredAreas: string[];
  summary: string;
  coverageMap: Record<string, string[]>;
  metadata: {
    agent: string;
    sessionId: string;
    timestamp: string;
  };
}

export const MAX_REPORTS_PER_FEATURE = 50;
export const REPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000; 

export function isReportExpired(report: TawassulEvaluationReport): boolean {
  const age = Date.now() - new Date(report.metadata.timestamp).getTime();
  return age > REPORT_TTL_MS;
}
