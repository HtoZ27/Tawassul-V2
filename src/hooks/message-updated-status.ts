import type { MessageUpdatedContext } from "./message-updated-types.ts";
import { t } from "../translations.ts";

const STATUS_KEYWORDS = /\b(status|progress|update|report|overview|summary|dashboard|what'?s\s+(up|going|happening)|how('s| is).*(going|progressing)|show\s+(me\s+)?(status|progress))\b/i;

export function injectAutoStatus(
  ctx: MessageUpdatedContext,
  output: { message: { role: string; text?: string; [key: string]: unknown }; parts: { type: string; text?: string; [key: string]: unknown }[] },
  content: string,
): void {
  if (!STATUS_KEYWORDS.test(content)) return;

  const allHandoffs = Array.isArray(ctx.handoffs) ? ctx.handoffs : [...ctx.handoffs.values()];
  const pending = allHandoffs.filter(h => h.status === "pending").length;
  const accepted = allHandoffs.filter(h => h.status === "accepted").length;
  const completed = allHandoffs.filter(h => h.status === "completed").length;
  const hasHandoffs = allHandoffs.length > 0;

  const lines: string[] = [
    `## ${t("statusTitle")}`,
    t("statusRecords", { count: String(ctx.records.length) }),
    hasHandoffs
      ? t("statusHandoffs", { p: String(pending), a: String(accepted), c: String(completed) })
      : t("statusNoHandoffs"),
    "",
  ];

  if (Array.isArray(output.parts)) {
    output.parts.push({
      type: "text" as const,
      text: `\n\n${lines.filter(Boolean).join("\n")}`,
    });
  }
}

export function injectPerformanceAlerts(
  ctx: MessageUpdatedContext,
  output: { parts: { type: string; text?: string; [key: string]: unknown }[] },
): void {
  const alertParts: string[] = [];
  for (const agent of ctx.getAgents?.() ?? []) {
    const rating = ctx.getOrCreateRating(agent);
    const flags = ctx.detectFlags(rating, ctx.getEvalConfig());
    for (const flag of flags) {
      alertParts.push(`${flag.symbol} **${agent}**: ${flag.message}`);
    }
  }
  if (alertParts.length > 0 && Array.isArray(output.parts)) {
    output.parts.push({
      type: "text" as const,
      text: `\n> 🚨 **تنبيهات الأداء:**\n${alertParts.map(a => `> ${a}`).join("\n")}\n`,
    });
  }
}
