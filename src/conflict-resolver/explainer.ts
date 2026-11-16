import { t } from "../translations.ts";
import type { RuleDecision } from "./types.ts";

const EXPLANATIONS: Record<string, string> = {
  "PROTECT-001": "crProtect001",
  "PROTECT-002": "crProtect002",
  "PROTECT-003": "crProtect003",
  "PRIORITY-001": "crPriority001",
  "PRIORITY-002": "crPriority002",
  "QUALITY-001": "crQuality001",
  "ROUTE-001": "crRoute001",
  "ROUTE-002": "crRoute002",
  "QUEUE-001": "crQueue001",
};

export function explainDecision(decision: RuleDecision, ruleId?: string): string {
  const baseExplanation = ruleId && EXPLANATIONS[ruleId] ? t(EXPLANATIONS[ruleId]) : "";

  const parts: string[] = [];

  if (baseExplanation) {
    parts.push(baseExplanation);
  }

  parts.push(t("crDecision", { action: actionLabel(decision.action) }));
  parts.push(t("crConfidence", { pct: String(((decision.confidence ?? 0) * 100).toFixed(0)) }));

  if (decision.suggestedAgent) {
    parts.push(t("crSuggestedAgent", { agent: decision.suggestedAgent }));
  }

  if (decision.reason) {
    parts.push(t("crReason", { reason: decision.reason }));
  }

  return parts.join(" | ");
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    allow: t("crAllow"),
    block: t("crBlock"),
    reroute: t("crReroute"),
    warn: t("crWarn"),
    queue: t("crQueue"),
  };
  return labels[action] || action;
}
