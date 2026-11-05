import { tool } from "../../tool.ts";
import type { ToolDefinition } from "../../tool.ts";
import type { ServiceIndex } from "../../services/service-index.ts";
import type { TawassulContext } from "../../context-class.ts";

type DashboardSection = "status" | "agents" | "discussions" | "all";

const CACHE_TTL_MS = 5000;

const cache = new Map<string, { at: number; lines: string[] }>();

function cached(key: string, lines: string[]): string[] {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.lines;
  cache.set(key, { at: now, lines });
  return lines;
}

function sectionStatus(ctx: TawassulContext, status: import("../../services/service-index.ts").SystemStatus): string[] {
  const handoffs = ctx.handoffs instanceof Map ? [...ctx.handoffs.values()] : ctx.handoffs;
  const counters: Record<string, number> = {};
  for (const h of handoffs) counters[h.status] = (counters[h.status] ?? 0) + 1;
  const counts = Object.entries(counters)
    .map(([s, n]) => `${s}: ${n}`)
    .join(" · ");
  const statusIcon = ctx.pauseState ? "🔴" : "🟢";
  const statusLabel = ctx.pauseState ? "Paused" : "Active";
  const lines = [`## ${statusIcon} System status — ${statusLabel}`, "", `**Handoffs:** ${counts || "none"}`];
  if (ctx.pauseState) {
    lines.push(
      `**Pause:** enabled — ${ctx.pauseState.reason ?? "no reason"} (scope: ${ctx.pauseState.scope ?? "unknown"})`,
    );
  } else {
    lines.push("**Pause:** not enabled");
  }
  lines.push(`**Mode:** ${ctx.detectedMode ?? "unspecified"}`, `**Uptime:** ${Math.floor(status.uptime / 1000)}s`);
  const intelligence = ctx.intelligence;
  if (intelligence) {
    lines.push(
      `**Intelligence:** cache ${intelligence.cacheHits}/${intelligence.cacheMisses} hit/miss (${intelligence.cacheBytes} B) · index ${intelligence.indexFiles} files / ${intelligence.indexSymbols} symbols (${intelligence.indexBytes} B) · bundles ${intelligence.bundlesBuilt} (${intelligence.bundleBytes} B)`,
    );
  }
  return lines;
}

function sectionAgents(ctx: TawassulContext, status: import("../../services/service-index.ts").SystemStatus): string[] {
  const lines = ["## 👥 Agent performance", ""];
  for (const [agentId, s] of Object.entries(status.services)) {
    lines.push(`- **${agentId}**: ${s.status} — ${s.details}`);
  }
  const team = ctx.statsCollector?.getTeamStats(Object.keys(status.services));
  if (team) {
    lines.push(
      "",
      `**Team:** active ${team.activeAgents} · completed today ${team.completedToday} · success rate ${(team.successRate * 100).toFixed(0)}%`,
    );
  }
  return lines;
}

function sectionDiscussions(ctx: TawassulContext): string[] {
  const lines = ["## 💬 Discussions", ""];
  const state = ctx.discussionManager?.getFullState?.();
  const discussions = state?.discussions ?? [];
  if (discussions.length === 0) {
    lines.push("No active discussions.");
    return lines;
  }
  for (const d of discussions) {
    lines.push(`- **${d.id}** [${d.phase}] participants: ${d.participants.length} · proposals: ${d.proposals.length}`);
  }
  return lines;
}

function sectionTraining(ctx: TawassulContext): string[] {
  const lines = ["## 🎓 Training stats", ""];
  const stats = ctx.trainingEvaluator?.getStats?.();
  if (!stats) {
    lines.push("Training is unavailable.");
    return lines;
  }
  lines.push(
    `**Recordings:** ${stats.totalRecordings}`,
    `**Block rate:** ${(stats.blockRate * 100).toFixed(0)}%`,
    `**Last hour activity:** ${stats.lastHourActivity}`,
  );
  const topAgents = (stats.topAgents ?? []).slice(0, 3);
  if (topAgents.length > 0) {
    lines.push("", "**Most active:**", ...topAgents.map(([agent, n]) => `- ${agent}: ${n}`));
  }
  return lines;
}

export function buildDashboardTool(services: ServiceIndex, tawaCtx: TawassulContext): ToolDefinition {
  return tool({
    description: "Show a full session dashboard: system status, agent performance, discussions, and training stats.",
    args: {
      section: tool.schema
        .enum(["status", "agents", "discussions", "all"])
        .optional()
        .default("all")
        .describe("Dashboard section"),
      compact: tool.schema.boolean().optional().default(true).describe("Compact table view"),
    },
    async execute(args) {
      const section = (args.section ?? "all") as DashboardSection;
      const compact = Boolean(args.compact ?? true);
      const cacheKey = `${section}:${compact}`;

      let lines: string[];
      const status = services.getStatus();

      if (section === "all") {
        lines = [
          ...sectionStatus(tawaCtx, status),
          "",
          ...sectionAgents(tawaCtx, status),
          "",
          ...sectionDiscussions(tawaCtx),
          "",
          ...sectionTraining(tawaCtx),
        ];
      } else if (section === "status") {
        lines = sectionStatus(tawaCtx, status);
      } else if (section === "agents") {
        lines = sectionAgents(tawaCtx, status);
      } else {
        lines = sectionDiscussions(tawaCtx);
      }

      if (compact) {
        lines = lines.filter((l) => !l.startsWith("- ") || l.startsWith("- **"));
      }

      return { title: "Dashboard", output: cached(cacheKey, lines).join("\n") };
    },
  });
}