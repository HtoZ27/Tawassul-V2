import type { TawassulContext } from "../context.ts";
import type { ToolDefinition } from "../tool.ts";
import type { HandoffEntry, RecordEntry, AgentModelConfig } from "../context/types.ts";
import { tool } from "../tool.ts";
import { t } from "../translations.ts";
import { severityEmoji, timeAgo } from "../utils/format.ts";
import { normalizeName } from "../utils/name-utils.ts";



export function buildStatusTool(ctx: TawassulContext): ToolDefinition {
  return tool({
    description: "Summarise all session records, handoffs, agent errors, and current state.",
    args: {},
    async execute() {
      const allHandoffs = [...ctx.handoffs.values()];
      const pending = allHandoffs.filter((h) => h.status === "pending");
      const accepted = allHandoffs.filter((h) => h.status === "accepted");
      const completed = allHandoffs.filter((h) => h.status === "completed");
      const s = ctx.strictness();
      const errorEntries = Object.entries(ctx.agentErrors).filter(([, c]) => c > 0);
      return {
        title: t("statusTitle"),
        output: [
          `## ${t("statusTitle")}`,
          `**Strictness:** ${s}`,
          t("statusRecords", { count: String(ctx.records.length) }),
          t("statusHandoffs", { p: String(pending.length), a: String(accepted.length), c: String(completed.length) }),
          errorEntries.length > 0
            ? t("statusAgentErrors", { list: errorEntries.map(([a, cc]) => `${a} (${cc})`).join(", ") })
            : "",
          ``,
          pending.length > 0
            ? [
                t("statusSectionPending"),
                ...pending.map((h: HandoffEntry) => {
                  const cp = h.checkpoint
                    ? ` (📌 ${h.checkpoint.completed.length} done · ${h.checkpoint.remaining.length} remaining)`
                    : "";
                  const rescueTag = h.rescue ? " 🚑 " : "";
                  return `- ${rescueTag}**${h.id}** ${h.from} → ${h.to}: ${h.task}${cp}`;
                }),
              ].join("\n")
            : "",
          accepted.length > 0
            ? [
                t("statusSectionActive"),
                ...accepted.map((h: HandoffEntry) => {
                  const cp = h.checkpoint
                    ? ` (📌 ${h.checkpoint.completed.length} done · ${h.checkpoint.remaining.length} remaining)`
                    : "";
                  return `- **${h.id}** ${h.from} → ${h.to}: ${h.task}${cp}`;
                }),
              ].join("\n")
            : "",
          completed.length > 0
            ? [
                t("statusSectionCompleted"),
                ...completed.map((h: HandoffEntry) => {
                  const cp = h.checkpoint
                    ? ` (📌 ${h.checkpoint.completed.length} done · ${h.checkpoint.remaining.length} remaining)`
                    : "";
                  const rescueTag = h.rescue ? " 🚑 " : "";
                  return `- ${rescueTag}**${h.id}** ${h.from} → ${h.to}: ${h.task}${cp}`;
                }),
              ].join("\n")
            : "",
          ctx.records.length > 0
            ? [
                t("statusSectionRecords"),
                ...ctx.records.map(
                  (r: RecordEntry) => `${severityEmoji(r.severity)} **${r.id}** [${r.type}] ${r.title} — ${r.agent}`,
                ),
              ].join("\n")
            : "",
          ctx.dynamicAgents.length > 0 ? [`**Dynamic Agents:** ${ctx.dynamicAgents.join(", ")}`] : "",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    },
  });
}



export function buildReportTool(ctx: TawassulContext): ToolDefinition {
  return tool({
    description: [
      "Generate agent performance report — health scores, flags, dropped tasks, completion ratio.",
      "",
      "EXAMPLES:",
      "  report()                          — all agents (compact)",
      '  report(agent: "@dev")             — single agent (compact)',
      '  report(agent: "@dev", detailed: true)  — full breakdown',
    ].join("\n"),
    args: {
      agent: tool.schema.string().optional().describe("Agent name to filter report (@name)"),
      detailed: tool.schema.boolean().optional().describe("Show full metric breakdown"),
    },
    async execute(args: Record<string, unknown>) {
      const evalCfg = ctx.getEvalConfig();
      if (!evalCfg.enabled) {
        return { output: t("reportDisabled") };
      }
      const agentFilter = args.agent ? normalizeName(String(args.agent)) : null;
      const allAgents = agentFilter ? [agentFilter] : ctx.getAgents();
      const ratings = allAgents
        .map((a) => {
          const r = ctx.getOrCreateRating(a);
          return { rating: r, score: ctx.calculateHealthScore(r), flags: ctx.detectFlags(r, evalCfg) };
        })
        .filter(({ rating: r }) => r.handoffsInitiated > 0 || r.handoffsAccepted > 0 || r.recordsCreated > 0);

      if (ratings.length === 0) {
        if (args.agent) return { output: t("reportNoActivityAgent", { agent: String(args.agent) }) };
        return { output: t("reportNoActivity") };
      }

      const barWidth = 20;

      if (args.detailed) {
        const out: string[] = ["## 📊 Agent Performance Report — Detailed", ""];
        for (const { rating: r, score, flags } of ratings) {
          const cat = ctx.scoreCategory(score);
          const bar = ctx.scoreBar(score, barWidth);
          const avgCtx = r.totalContextHandoffs > 0 ? (r.totalContextWords / r.totalContextHandoffs).toFixed(1) : "—";
          const avgTask = r.totalTaskHandoffs > 0 ? (r.totalTaskWords / r.totalTaskHandoffs).toFixed(1) : "—";
          const compRatio =
            r.handoffsAccepted > 0 ? ((r.handoffsCompletedAsRecipient / r.handoffsAccepted) * 100).toFixed(0) : "—";

          out.push(`### ${r.agent} — ${score}/100 ${cat.emoji} ${cat.label}`);
          out.push(`\`${bar}\``);
          out.push("");
          out.push("| Metric | Value |");
          out.push("|--------|------:|");
          out.push(`| Handoffs initiated | ${r.handoffsInitiated} |`);
          out.push(`| Handoffs accepted | ${r.handoffsAccepted} |`);
          out.push(`| Completed as recipient | ${r.handoffsCompletedAsRecipient} |`);
          out.push(`| Dropped | ${r.handoffsDropped} |`);
          out.push(`| Completion ratio | ${compRatio}% |`);
          out.push(`| Records created | ${r.recordsCreated} |`);
          out.push(`| Validation errors | ${r.validationErrors} |`);
          out.push(`| Checkpoints used | ${r.checkpointsUsed} |`);
          out.push(`| Empty checkpoints | ${r.emptyCheckpoints} |`);
          out.push(`| Rapid re-handoffs | ${r.rapidReHandoffs} |`);
          out.push(`| Help requests sent | ${r.helpRequestsSent} |`);
          out.push(`| Help requests fulfilled | ${r.helpRequestsFulfilled} |`);
          out.push(`| Avg context length | ${avgCtx} words |`);
          out.push(`| Avg task length | ${avgTask} words |`);
          out.push(`| Last active | ${timeAgo(r.lastActionAt)} |`);
          out.push("");

          if (flags.length > 0) {
            out.push("🚩 Flags:");
            for (const f of flags) out.push(`  ${f.symbol} ${f.message}`);
            out.push("");
          } else {
            out.push(t("reportNoIssues"));
            out.push("");
          }
        }
        return { title: "📊 Detailed Agent Report", output: out.join("\n") };
      }

      const out: string[] = ["## 📊 Agent Performance Report", ""];
      const hdr = ["Agent", "Score", "Init.", "Acc.", "Compl.", "Drop.", "Rec.", "Err.", "Bar"];
      const sep = hdr.map(() => "---");
      const rows = ratings.map(({ rating: r, score, flags: _flags }) => {
        const cat = ctx.scoreCategory(score);
        const bar = ctx.scoreBar(score, 10);
        return [
          r.agent,
          `${score} ${cat.emoji}`,
          String(r.handoffsInitiated),
          String(r.handoffsAccepted),
          String(r.handoffsCompletedAsRecipient),
          String(r.handoffsDropped),
          String(r.recordsCreated),
          String(r.validationErrors),
          bar,
        ];
      });

      const colWidths = hdr.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));

      function pad(val: string, idx: number): string {
        return val.padEnd(colWidths[idx] ?? 0);
      }

      out.push("| " + hdr.map(pad).join(" | ") + " |");
      out.push("| " + sep.map((_s, i) => "-".repeat(colWidths[i] ?? 0)).join(" | ") + " |");
      for (const row of rows) {
        out.push("| " + row.map(pad).join(" | ") + " |");
      }
      out.push("");

      for (const { rating: r, score, flags } of ratings) {
        const cat = ctx.scoreCategory(score);
        if (flags.length > 0) {
          out.push(`**${r.agent}** ${cat.emoji} ${score}/100:`);
          for (const f of flags) out.push(`  ${f.symbol} ${f.message}`);
          out.push("");
        } else {
          const compRatio =
            r.handoffsAccepted > 0
              ? ` (${((r.handoffsCompletedAsRecipient / r.handoffsAccepted) * 100).toFixed(0)}% completion)`
              : "";
          out.push(`**${r.agent}** ${cat.emoji} ${score}/100 — ${t("reportNoIssuesCompact")}${compRatio}`);
          out.push("");
        }
      }

      return { title: "📊 Agent Performance Report", output: out.join("\n") };
    },
  });
}



export function buildCheckTool(ctx: TawassulContext): ToolDefinition {
  return tool({
    description: [
      "Diagnose the Tawassul team configuration.",
      "Shows agent models, capabilities, and potential issues.",
      "",
      "EXAMPLES:",
      "  check()  — full team diagnosis",
    ].join("\n"),
    args: {},
    async execute() {
      const lines: string[] = [`🧪 **Tawassul Team Diagnosis**`, `━━━━━━━━━━━━━━━━━━━━━`];
      let hasIssues = false;
      for (const agent of ctx.getAgents()) {
        const cfg = ctx.config.agentModels?.[agent];
        const info = ctx.readAgentMd(agent);
        const capability = cfg?.capability || info?.capability;
        const models = cfg?.models;
        const rating = ctx.agentRatings[normalizeName(agent)];
        const errors = ctx.agentErrors[normalizeName(agent)] ?? 0;
        const currentModel = ctx.agentModelMap[normalizeName(agent)] || null;

        let status: string;
        const parts: string[] = [];
        if (capability) parts.push(`🎯 ${capability}`);
        if (models?.length) {
          const primary = models[0]!.model || "any";
          if (currentModel) {
            const matches = models.some((m: { model?: string }) => m.model === currentModel);
            if (matches) {
              status = "✅";
              parts.push(`model: ${currentModel} ✓`);
            } else {
              status = "⚠️";
              parts.push(`expected: ${primary || "any"}, got: ${currentModel}`);
              hasIssues = true;
            }
          } else {
            status = "ℹ️";
            parts.push(`recommended: ${primary}`);
          }
          if (models[0]!.options) parts.push(`options: ${JSON.stringify(models[0]!.options)}`);
        } else {
          status = "ℹ️";
          parts.push(currentModel ? `running: ${currentModel} (default)` : "no model config");
        }
        if (errors > 0) {
          parts.push(`🔴 ${errors} error${errors > 1 ? "s" : ""}`);
          if (errors >= 3) hasIssues = true;
        }
        if (rating) {
          const dropped = rating.handoffsDropped;
          if (dropped > 0) {
            parts.push(`🔴 ${dropped} dropped`);
            hasIssues = true;
          }
        }
        const line = `${status} **${agent}**${parts.length ? ` — ${parts.join(", ")}` : ""}`;
        lines.push(line);
      }

      if (hasIssues) {
        lines.push(``, t("checkRecommendations"));
        for (const agent of ctx.getAgents()) {
          const cfg: AgentModelConfig | undefined = ctx.config.agentModels?.[agent];
          if (!cfg?.models?.length) {
            lines.push(`  - ${agent}: ${t("checkNoModel", { agent })}`);
          }
          if ((ctx.agentErrors[normalizeName(agent)] ?? 0) >= 3) {
            lines.push(
              `  - ${agent}: ${t("checkHighErrors", { agent, count: String(ctx.agentErrors[normalizeName(agent)]) })}`,
            );
          }
        }
      }
      return { output: lines.join("\n") };
    },
  });
}
