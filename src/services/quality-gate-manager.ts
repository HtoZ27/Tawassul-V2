



import type { FeatureIndex } from "./feature-index.ts";
import type { HandoffEntry } from "../context/types.ts";
import type { Strictness } from "../context/types.ts";
import type { MergedReport } from "../types/plan.types.ts";
import { t } from "../translations.ts";



export type GateKind =
  | "tests-pass"
  | "no-regressions"
  | "feature-indexed"
  | "all-handoffs-completed"
  | "all-phases-completed"
  | "code-reviewed"
  | "regression-tests-exist"
  | "structural-coverage"
  | "behavioral-contracts"
  | "evaluation-report-exists"
  | "all-issues-covered"
  | "no-critical-unresolved"
  | "goals-complete";

export interface GateResult {
  gate: GateKind;
  label: string;
  passed: boolean;
  reason: string;
}

export interface GateContext {
  featureId?: string;
  featureIndex?: FeatureIndex;
  handoffs: HandoffEntry[];
  
  goals?: Array<{ id: string; status: string }>;
  strictness?: Strictness;
  testResult?: {
    passed: number;
    failed: number;
    total: number;
  };
  codeReviewResult?: {
    approved: boolean;
    reviewer?: string;
  };
  phases?: {
    completed: string[];
    total: string[];
  };
  allPhasesResult?: string[];
  report?: MergedReport;
  structuralCoverageResult?: {
    hasGaps: boolean;
    gaps: { symbol: string; file: string; reason: string }[];
    coverageRatio: number;
  };
  contractVerification?: {
    allLinked: boolean;
    total: number;
    linked: number;
    unlinkedSymbols: { name: string; file: string; reason: string }[];
    result: "pass" | "warn" | "fail";
  };
}

export interface QualityGateReport {
  featureId?: string;
  featureName?: string;
  allPassed: boolean;
  gates: GateResult[];
  timestamp: string;
}



interface GateDef {
  kind: GateKind;
  label: string;
  check: (ctx: GateContext) => { passed: boolean; reason: string };
}

const GATES: GateDef[] = [
  {
    kind: "tests-pass",
    get label() {
      return t("qgTestsLabel");
    },
    check: (ctx) => {
      if (!ctx.testResult) {
        return { passed: false, reason: t("qgTestsNone") };
      }
      if (ctx.testResult.failed > 0) {
        return {
          passed: false,
          reason: t("qgTestsFailed", { failed: String(ctx.testResult.failed), total: String(ctx.testResult.total) }),
        };
      }
      return {
        passed: true,
        reason: t("qgTestsPassed", { passed: String(ctx.testResult.passed), total: String(ctx.testResult.total) }),
      };
    },
  },
  {
    kind: "no-regressions",
    get label() {
      return t("qgNoRegressionLabel");
    },
    check: (ctx) => {
      if (!ctx.featureIndex || !ctx.featureId) {
        return { passed: false, reason: t("qgNoRegFeatureNotIndexed") };
      }
      const feature = ctx.featureIndex.getById(ctx.featureId);
      if (!feature) {
        return { passed: false, reason: t("qgNoRegNotFound") };
      }
      if (feature.status === "regressed") {
        return { passed: false, reason: t("qgNoRegRegressed", { name: feature.name }) };
      }
      return { passed: true, reason: t("qgNoRegNone") };
    },
  },
  {
    kind: "feature-indexed",
    get label() {
      return t("qgIndexedLabel");
    },
    check: (ctx) => {
      if (!ctx.featureId) {
        return { passed: false, reason: t("qgIndexedNoId") };
      }
      if (!ctx.featureIndex) {
        return { passed: false, reason: t("qgIndexedNoIndex") };
      }
      const feature = ctx.featureIndex.getById(ctx.featureId);
      if (!feature) {
        return { passed: false, reason: t("qgIndexedNotIndexed", { id: ctx.featureId }) };
      }
      return { passed: true, reason: t("qgIndexedYes", { name: feature.name }) };
    },
  },
  {
    kind: "all-handoffs-completed",
    get label() {
      return t("qgHandoffsLabel");
    },
    check: (ctx) => {
      const allHandoffs = ctx.handoffs;
      const pending = allHandoffs.filter((h) => h.status === "pending" || h.status === "accepted");
      if (pending.length > 0) {
        return {
          passed: false,
          reason: t("qgHandoffsPending", { count: String(pending.length) }),
        };
      }
      return { passed: true, reason: t("qgHandoffsAll", { count: String(ctx.handoffs.length) }) };
    },
  },
  {
    kind: "all-phases-completed",
    get label() {
      return t("qgPhasesLabel");
    },
    check: (ctx) => {
      if (!ctx.phases) {
        return { passed: false, reason: t("qgPhasesNone") };
      }
      const incomplete = ctx.phases.total.filter((p) => !ctx.phases!.completed.includes(p));
      if (incomplete.length > 0) {
        return {
          passed: false,
          reason: t("qgPhasesIncomplete", { list: incomplete.join(", ") }),
        };
      }
      return { passed: true, reason: t("qgPhasesAll", { count: String(ctx.phases.total.length) }) };
    },
  },
  {
    kind: "code-reviewed",
    get label() {
      return t("qgReviewLabel");
    },
    check: (ctx) => {
      if (!ctx.codeReviewResult) {
        return { passed: false, reason: t("qgReviewPending") };
      }
      if (!ctx.codeReviewResult.approved) {
        return { passed: false, reason: t("qgReviewRejected") };
      }
      return {
        passed: true,
        reason: t("qgReviewBy", { reviewer: ctx.codeReviewResult.reviewer ?? t("qgUnknown") }),
      };
    },
  },
  {
    kind: "regression-tests-exist",
    get label() {
      return t("qgRegressionLabel");
    },
    check: (ctx) => {
      if (!ctx.featureIndex || !ctx.featureId) {
        return { passed: false, reason: t("qgRegressionCannotCheck") };
      }
      const feature = ctx.featureIndex.getById(ctx.featureId);
      if (!feature) {
        return { passed: false, reason: t("qgFeatureNotFound") };
      }
      if (feature.regressionTests.length === 0) {
        return { passed: false, reason: t("qgNoRegressionTests") };
      }
      return {
        passed: true,
        reason: t("qgRegressionCount", { count: String(feature.regressionTests.length) }),
      };
    },
  },
  {
    kind: "structural-coverage",
    get label() {
      return t("qgStructuralLabel");
    },
    check: (ctx) => {
      if (!ctx.structuralCoverageResult) {
        return { passed: false, reason: t("qgStructuralNotAnalyzed") };
      }
      if (ctx.structuralCoverageResult.hasGaps) {
        const gaps = ctx.structuralCoverageResult.gaps;
        return {
          passed: false,
          reason: t("qgStructuralGaps", {
            count: String(gaps.length),
            list: gaps
              .map((g) => t("qgSymInFile", { symbol: g.symbol, file: g.file.split("/").pop() ?? "" }))
              .join(", "),
          }),
        };
      }
      return {
        passed: true,
        reason: t("qgStructuralOk", { percent: String(Math.round(ctx.structuralCoverageResult.coverageRatio * 100)) }),
      };
    },
  },
  {
    kind: "behavioral-contracts",
    get label() {
      return t("qgContractLabel");
    },
    check: (ctx) => {
      if (!ctx.contractVerification) {
        return { passed: false, reason: t("qgContractNotExtracted") };
      }
      if (ctx.contractVerification.result === "fail") {
        const unlinked = ctx.contractVerification.unlinkedSymbols;
        return {
          passed: false,
          reason: t("qgContractUnlinked", {
            count: String(unlinked.length),
            list: unlinked.map((u) => `"${u.name}"`).join(", "),
          }),
        };
      }
      return {
        passed: true,
        reason: t("qgContractLinked", {
          linked: String(ctx.contractVerification.linked),
          total: String(ctx.contractVerification.total),
        }),
      };
    },
  },
  {
    kind: "evaluation-report-exists",
    get label() {
      return t("qgEvalLabel");
    },
    check: (ctx) => {
      if (!ctx.featureIndex || !ctx.featureId) {
        return { passed: false, reason: t("qgEvalCannotCheck") };
      }
      const reports = ctx.featureIndex.getEvaluationReports(ctx.featureId);
      if (reports.length === 0) {
        ctx.featureIndex.setEvaluationReport(ctx.featureId, {
          featureId: ctx.featureId,
          reportId: `auto-baseline-${Date.now()}`,
          round: 1,
          issues: [],
          recommendations: [],
          uncoveredAreas: [],
          summary: "auto baseline — F4 transparent step",
          coverageMap: {},
          metadata: { agent: "@system", sessionId: "f4-auto", timestamp: new Date().toISOString() },
        });
        return { passed: true, reason: t("qgEvalAutoCreated") };
      }
      return { passed: true, reason: t("qgEvalCount", { count: String(reports.length) }) };
    },
  },
  {
    kind: "all-issues-covered",
    get label() {
      return t("qgErrorsLabel");
    },
    check: (ctx) => {
      if (!ctx.featureIndex || !ctx.featureId) {
        return { passed: false, reason: t("qgErrorsCannotCheck") };
      }
      const s = ctx.strictness ?? "normal";
      const reports = ctx.featureIndex.getEvaluationReports(ctx.featureId);
      const all = reports.flatMap((r) => r.issues);
      const remaining = all.filter(
        (i) => i.status !== "resolved" && i.status !== "wont_fix" && i.status !== "duplicate",
      );
      if (remaining.length === 0) {
        return { passed: true, reason: t("qgErrorsSolved") };
      }
      if (s === "strict") {
        return { passed: false, reason: t("qgErrorsRemainingStrict", { count: String(remaining.length) }) };
      }
      return { passed: true, reason: t("qgErrorsRemainingRelaxed", { count: String(remaining.length), mode: s }) };
    },
  },
  {
    kind: "no-critical-unresolved",
    get label() {
      return t("qgCriticalLabel");
    },
    check: (ctx) => {
      if (!ctx.featureIndex || !ctx.featureId) {
        return { passed: false, reason: t("qgCriticalCannotCheck") };
      }
      const s = ctx.strictness ?? "normal";
      const reports = ctx.featureIndex.getEvaluationReports(ctx.featureId);
      const all = reports.flatMap((r) => r.issues);
      const critical = all.filter(
        (i) =>
          i.severity === "critical" && i.status !== "resolved" && i.status !== "wont_fix" && i.status !== "duplicate",
      );
      if (critical.length === 0) {
        return { passed: true, reason: t("qgCriticalNone") };
      }
      if (s === "strict" || s === "normal") {
        return { passed: false, reason: t("qgCriticalRemainingStrict", { count: String(critical.length) }) };
      }
      return { passed: true, reason: t("qgCriticalRemainingRelaxed", { count: String(critical.length) }) };
    },
  },
  {
    kind: "goals-complete",
    get label() {
      return t("qgGoalsLabel");
    },
    check: (ctx) => {
      
      if (!ctx.goals) return { passed: true, reason: t("qgGoalsNoScope") };
      const open = ctx.goals.filter((g) => ["open", "in_progress", "partial", "blocked", "stale"].includes(g.status));
      if (open.length > 0) {
        return {
          passed: false,
          reason: t("qgGoalsOpen", { count: String(open.length), ids: open.map((g) => g.id).join(", ") }),
        };
      }
      return { passed: true, reason: t("qgGoalsAll", { count: String(ctx.goals.length) }) };
    },
  },
];



export function evaluateGates(ctx: GateContext, selectedGates?: GateKind[]): GateResult[] {
  const gatesToRun = selectedGates ? GATES.filter((g) => selectedGates.includes(g.kind)) : GATES;

  return gatesToRun.map((g) => {
    const result = g.check(ctx);
    return {
      gate: g.kind,
      label: g.label,
      passed: result.passed,
      reason: result.reason,
    };
  });
}

export function generateReport(gates: GateResult[], featureId?: string, featureName?: string): QualityGateReport {
  return {
    featureId,
    featureName,
    allPassed: gates.every((g) => g.passed),
    gates,
    timestamp: new Date().toISOString(),
  };
}

export function canCloseFeature(ctx: GateContext, requiredGates?: GateKind[]): QualityGateReport {
  const results = evaluateGates(ctx, requiredGates);
  return generateReport(results, ctx.featureId);
}

export function toGateContext(report: MergedReport, featureId: string, handoffs: HandoffEntry[]): GateContext {
  return {
    featureId,
    handoffs,
    report,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────
