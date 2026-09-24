import { tool } from "../tool.ts";
import type { ToolContext } from "../tool.ts";
import type { TawassulContext } from "../context.ts";
import { t } from "../translations.ts";
import { randomUUID } from "node:crypto";
import type { IssueSeverity, IssueCategory } from "../context/evaluation-report.ts";
import { mergeEvaluationReports, deduplicateIssues, findCoverageGaps } from "../services/evaluation-utils.ts";
import { scanToolOutput } from "../hooks/guards/threat_patterns.ts";

const SEVERITIES: IssueSeverity[] = ["critical", "major", "minor", "info"];
const CATEGORIES: IssueCategory[] = [
  "security",
  "correctness",
  "performance",
  "usability",
  "maintainability",
  "completeness",
];

export function sanitizeReportTextForConsumption(text: string): string {
  if (!text) return text;
  const threats = scanToolOutput(text);
  if (threats.length === 0) return text;
  let softened = text;
  const flags: string[] = [];
  for (const threat of threats) {
    if (!threat.match || threat.match.length === 0) continue;
    const marker = `[softened:${threat.pattern}]`;
    softened = softened.split(threat.match).join(marker);
    flags.push(`${threat.pattern}(${threat.severity})`);
  }
  const body = softened.trim();
  return `${body.length > 0 ? body : "[content hidden]"}\n\n⚠️ Security alert: the text contained threat patterns and was softened: ${flags.join(", ")}`;
}

export function buildEvaluationReportTool(ctx: TawassulContext) {
  return tool({
    description: [
      "Evaluation Report — Record a structured evaluation of a feature.",
      "",
      "WRITE — Required: featureId, at least one issue with description and recommendation.",
      "",
      "READ-BACK (write-only gap fix):",
      '  evaluationreport(get: true, featureId: "my-feature") → all stored rounds for that feature',
      "",
      "Each issue requires:",
      "  - severity: critical|major|minor|info",
      "  - category: security|correctness|performance|usability|maintainability|completeness",
      "  - description: what the problem is",
      "  - recommendation: how to fix it",
      "",
      "Optional per issue: file, line, relatedRecordIds (array of record/handoff IDs).",
      "",
      "Top-level optional: recommendations (general), uncoveredAreas, coverageMap, summary.",
      "",
      "You MUST report ALL issues you find — not just the biggest ones.",
      "Use relatedRecordIds to link issues to existing records or handoffs.",
    ].join("\n"),
    args: {
      featureId: tool.schema.string().describe("ID of the feature being evaluated"),
      get: tool.schema.boolean().optional().describe("Read back stored evaluations for this feature"),
      issues: tool.schema
        .array(
          tool.schema.object({
            severity: tool.schema.enum(SEVERITIES).describe("How severe is this issue"),
            category: tool.schema.enum(CATEGORIES).describe("Category of the issue"),
            file: tool.schema.string().optional().describe("File path where the issue was found"),
            line: tool.schema.number().optional().describe("Line number in the file"),
            dedupKey: tool.schema.string().describe("Key for deduplication (e.g., 'security-sqli-login')"),
            description: tool.schema.string().describe("What the problem is"),
            recommendation: tool.schema.string().describe("How to fix the issue"),
            relatedRecordIds: tool.schema
              .array(tool.schema.string())
              .optional()
              .describe("IDs of related records or handoffs"),
          }),
        )
        .optional()
        .describe("Issues found — required on write (at least 1), omitted on read"),
      recommendations: tool.schema.array(tool.schema.string()).optional().describe("General recommendations"),
      uncoveredAreas: tool.schema.array(tool.schema.string()).optional().describe("Areas not yet evaluated"),
      summary: tool.schema.string().optional().describe("Brief summary of this evaluation round"),
      coverageMap: tool.schema
        .record(tool.schema.string(), tool.schema.array(tool.schema.string()))
        .optional()
        .describe("Map of area → files covered"),
    },
    async execute(args, cctx: ToolContext) {
      const tracker = ctx.evaluationTracker;
      const featureIndex = ctx.featureIndex;

      let feature = featureIndex.getById(args.featureId);
      let fallbackUsed = false;
      if (!feature) {
        fallbackUsed = true;
        const fallbackName = `session:${ctx.sessionId ?? "unknown"}`;
        feature = featureIndex.getByName(fallbackName);
        if (!feature) {
          feature = featureIndex.register({
            name: fallbackName,
            description: "Session-scoped evaluations for features not yet registered",
          });
        }
      }

      if (args.get) {
        const reports = featureIndex.getEvaluationReports(feature.id);
        if (reports.length === 0) {
          return { output: t("evalEmpty", { feature: feature.name }) };
        }
        const body = reports
          .map((r) =>
            [
              `**Round ${r.round}** — ${r.metadata?.agent ?? "?"} · ${r.metadata?.timestamp ?? ""}`,
              r.summary ? `_${r.summary}_` : "",
              ...(r.issues ?? []).map(
                (i) =>
                  `- **${i.severity}** (${i.category}): ${i.description} → ${i.recommendation}${i.file ? ` [${i.file}${i.line ? `:${i.line}` : ""}]` : ""}`,
              ),
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n\n---\n\n");
        return { title: t("evalReadTitle", { feature: feature.name, rounds: String(reports.length) }), output: body };
      }

      const issuesArg = args.issues;
      if (!args.get && (!Array.isArray(issuesArg) || issuesArg.length === 0)) {
        return { title: "Missing issues", output: t("evalRequiredIssues") };
      }

      const reportId = `eval-${randomUUID().slice(0, 8)}`;
      const reports = featureIndex.getEvaluationReports(feature.id);
      const round = reports.length + 1;

      const issues = (issuesArg ?? []).map((issue) => ({
        id: `iss-${randomUUID().slice(0, 8)}`,
        severity: issue.severity as IssueSeverity,
        category: issue.category as IssueCategory,
        file: issue.file,
        line: issue.line,
        dedupKey: issue.dedupKey,
        description: issue.description,
        recommendation: issue.recommendation,
        status: "open" as const,
        createdAt: new Date().toISOString(),
        reportedBy: cctx.agent,
        relatedRecordIds: issue.relatedRecordIds,
      }));

      const dedupedIssues = deduplicateIssues(issues);

      const report = {
        featureId: feature.id,
        reportId,
        round,
        issues: dedupedIssues,
        recommendations: args.recommendations ?? [],
        uncoveredAreas: args.uncoveredAreas ?? [],
        summary: args.summary ?? `Evaluation round ${round}: ${dedupedIssues.length} issues`,
        coverageMap: args.coverageMap ?? {},
        metadata: {
          agent: cctx.agent,
          sessionId: ctx.sessionId,
          timestamp: new Date().toISOString(),
        },
      };

      const recorded = tracker.recordEvaluation(feature.id, report);
      if (!recorded) {
        return { title: "Report Limit Reached", output: t("evalLimitReached", { max: "50" }) };
      }

      await ctx.saveState();
      const health = ctx.getSaveHealth();
      const persistenceNote = health.stale
        ? `\n\n⚠️ Persistence warning: on-disk save failed (${String(health.failureCount)} failure(s)) — this report is in memory but may not survive a restart.`
        : "";

      const allReports = featureIndex.getEvaluationReports(feature.id);
      const mergedReport = allReports.length > 1 ? mergeEvaluationReports(allReports) : report;

      const totalIssues = mergedReport.issues?.length ?? dedupedIssues.length;

      const issueList = dedupedIssues
        .map(
          (i) =>
            `- **${i.severity}** (${i.category}): ${i.description} → ${i.recommendation}${i.file ? ` [${i.file}${i.line ? `:${i.line}` : ""}]` : ""}`,
        )
        .join("\n");

      const previousReports = featureIndex.getEvaluationReports(feature.id);
      const coverageGaps = previousReports.length > 0 ? findCoverageGaps([...previousReports, report]) : [];

      const fallbackNote = fallbackUsed
        ? `\n${t("evalFallbackFeature", { featureId: args.featureId, featureName: feature.name })}`
        : "";

      const rawOutput = [
        `## ${t("evalRecorded", { count: String(dedupedIssues.length) })} — ${reportId}`,
        ``,
        `**Feature:** ${feature.name} (${feature.id})`,
        `**Round:** ${round}`,
        `**Issues:** ${totalIssues} (merged from ${allReports.length} report(s))`,
        ``,
        ``,
        issueList,
        args.recommendations?.length
          ? `\n**Recommendations:**\n${args.recommendations.map((r) => `- ${r}`).join("\n")}`
          : "",
        coverageGaps.length > 0 ? `\n**Coverage Gaps:**\n${coverageGaps.map((g) => `- ${g}`).join("\n")}` : "",
        fallbackNote,
        persistenceNote,
      ].join("\n");

      return sanitizeReportTextForConsumption(rawOutput);
    },
  });
}