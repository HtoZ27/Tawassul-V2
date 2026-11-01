import type { ToolDefinition } from "../tool.ts";
import { tool } from "../tool.ts";
import { toolScopeOnlyHint } from "../utils/text-utils.ts";
import type { TimelineStore } from "../services/timeline-store.ts";
import type { TimelineEntryType } from "../types/timeline-types.ts";

const TYPE_EMOJI: Record<string, string> = {
  activation: "🟢",
  task_started: "🚀",
  task_completed: "✅",
  task_failed: "❌",
  agent_handoff: "🤝",
  pipeline_phase: "🔄",
  discussion_resolved: "✅",
  evidence_completed: "📄",
  circuit_event: "⚡",
  checkpoint: "📌",
  state_saved: "💾",
  reflection: "🧠",
  achievement: "🏅",
};

function fmtEntry(e: { timestamp: string; type: TimelineEntryType; summary: string; agent?: string }): string {
  const time = new Date(e.timestamp).toISOString().slice(11, 16);
  return `${TYPE_EMOJI[e.type] ?? "•"} [${time}] ${e.summary}${e.agent ? ` (${e.agent})` : ""}`;
}

export function buildTimelineTool(store: TimelineStore): ToolDefinition {
  return tool({
    description: [
      "View the activity timeline — tasks, handoffs, discussions, checkpoints by time/date.",
      toolScopeOnlyHint("The timeline lives ONLY behind this tool", "it"),
      "",
      'VIEWS: timeline() last 20 events; timeline(view: "day") today; timeline(view: "agent", agent: "@dev") one agent; timeline(view: "range", from: "...", to: "...") a date range; timeline(view: "achievements") milestones per agent. All accept limit.',
    ].join("\n"),
    args: {
      view: tool.schema
        .enum(["recent", "day", "agent", "range", "achievements"])
        .optional()
        .describe("Which timeline view to render (default: recent)"),
      agent: tool.schema.string().optional().describe("Agent name to filter (@name)"),
      date: tool.schema.string().optional().describe("Date for day view (YYYY-MM-DD, default: today)"),
      from: tool.schema.string().optional().describe("Start ISO datetime for range view"),
      to: tool.schema.string().optional().describe("End ISO datetime for range view"),
      limit: tool.schema.number().optional().describe("Max events to return (default: 20)"),
    },
    async execute(args) {
      await store.ensureLoaded();
      const view = (args.view as string) || "recent";
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);

      switch (view) {
        case "day": {
          const date = (args.date as string) ?? localToday();
          const s = store.getDailySummary(date);
          const lines = [
            `## 📅 Timeline — ${date}`,
            `**Total:** ${s.total} · **Completed:** ${s.completed} · **Failed:** ${s.failed} · **Duration:** ${Math.round(s.totalDurationMs / 1000)}s`,
          ];
          const byAgent = Object.entries(s.agents)
            .sort((a, b) => b[1] - a[1])
            .map(([a, c]) => `- ${a}: ${c}`)
            .join("\n");
          if (byAgent) lines.push(`**By agent:**\n${byAgent}`);
          const types = Object.entries(s.types)
            .sort((a, b) => b[1] - a[1])
            .map(([t, c]) => `${TYPE_EMOJI[t] ?? t} ${c}`)
            .join(" · ");
          if (types) lines.push(`**Types:** ${types}`);
          lines.push("", ...store.query({ limit }).map(fmtEntry));
          return { title: `Timeline ${date}`, output: lines.join("\n") };
        }
        case "agent": {
          const agent = (args.agent as string) || "@dev";
          const entries = store.getAgentTimeline(agent, { limit });
          const ach = store.getAchievements();
          const a = ach.agents.find((x) => x.agent === agent);
          const header = `## 🤖 Timeline — ${agent}`;
          const stats = a ? `**Total:** ${a.count} completed · ${a.failed} failed` : "_No data yet for this agent._";
          const body = entries.length > 0 ? entries.map(fmtEntry).join("\n") : "_No events yet._";
          return { title: `Timeline ${agent}`, output: [header, stats, "", body].join("\n") };
        }
        case "range": {
          const q = { from: (args.from as string) || undefined, to: (args.to as string) || undefined, limit };
          const entries = store.query(q);
          return {
            title: `Timeline range`,
            output: [
              `## 📆 Timeline — ${q.from ?? "…"} → ${q.to ?? "…"}`,
              `**Events:** ${entries.length}`,
              "",
              entries.length > 0 ? entries.map(fmtEntry).join("\n") : "_No events in this range._",
            ].join("\n"),
          };
        }
        case "achievements": {
          const ach = store.getAchievements();
          const lines = [
            `## 🏆 Achievements`,
            `**Total:** ${ach.totalCompleted} completed · ${ach.totalFailed} failed · ${ach.activeDays} active days`,
          ];
          for (const a of ach.agents) {
            lines.push(`- **${a.agent}**: ${a.count} completed · ${a.failed} failed`);
          }
          if (ach.milestones.length > 0) {
            lines.push("", "**Milestones:**", ...ach.milestones.map((m) => `- ${m.agent}: ${m.level} (${m.count})`));
          }
          return { title: "Timeline Achievements", output: lines.join("\n") };
        }
        case "recent":
        default: {
          const entries = store.query({ limit });
          return {
            title: "Timeline",
            output: [
              `## 📋 Timeline`,
              `**Last ${entries.length} events** (${store.getStats().entries} total)`,
              "",
              entries.length > 0 ? entries.map(fmtEntry).join("\n") : "_No events yet._",
            ].join("\n"),
          };
        }
      }
    },
  });
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}