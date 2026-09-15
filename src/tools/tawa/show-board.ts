import { tool } from "../../tool.ts";
import type { ToolDefinition } from "../../tool.ts";
import { toolScopeOnlyHint } from "../../utils/text-utils.ts";
import type { ServiceIndex } from "../../services/service-index.ts";

type BoardFilter = "all" | "active" | "backlog" | "completed" | "failed" | "blocked";

const FILTER_STATUSES: Record<Exclude<BoardFilter, "all">, string[]> = {
  active: ["ready", "in_progress", "review"],
  backlog: ["backlog"],
  completed: ["done"],
  failed: ["failed"],
  blocked: ["blocked"],
};

export function buildShowBoardTool(services: ServiceIndex): ToolDefinition {
  return tool({
    description: [
      "Show the mission board with task status, agent health, and system status.",
      toolScopeOnlyHint("Mission boards live ONLY behind this tool", "them"),
    ].join("\n"),
    args: {
      filter: tool.schema
        .enum(["all", "active", "backlog", "completed", "failed", "blocked"])
        .optional()
        .default("all")
        .describe("Filter by status"),
    },
    async execute(args) {
      const filter = (args.filter ?? "all") as BoardFilter;
      const lines: string[] = ["## Mission Board", ""];
      const status = services.getStatus();

      if (filter === "all") {
        for (const [agentId, s] of Object.entries(status.services)) {
          lines.push(`- **${agentId}**: ${s.status} — ${s.details}`);
        }
        const boards = services.missionBoard.getAllBoards();
        let totalTasks = 0;
        for (const board of boards) {
          const boardLines: string[] = [];
          for (const [col, tasks] of Object.entries(board.columns)) {
            for (const t of tasks) {
              totalTasks++;
              boardLines.push(`  - **${t.id}** [${col}] ${t.description} (${t.agent})`);
            }
          }
          if (boardLines.length > 0) {
            lines.push(`### ${board.name} (${board.boardId})`, ...boardLines, "");
          }
        }
        if (totalTasks === 0) lines.push("No tasks on boards");
        lines.push("", `Uptime: ${Math.floor(status.uptime / 1000)}s`);
        return {
          title: "Mission Board",
          output: lines.join("\n"),
        };
      }

      const wanted = FILTER_STATUSES[filter];
      const boards = services.missionBoard.getAllBoards();
      let matches = 0;
      for (const board of boards) {
        const boardLines: string[] = [];
        for (const [col, tasks] of Object.entries(board.columns)) {
          if (!wanted.includes(col)) continue;
          for (const t of tasks) {
            matches++;
            boardLines.push(`  - **${t.id}** [${col}] ${t.description} (${t.agent})`);
          }
        }
        if (boardLines.length > 0) {
          lines.push(`### ${board.name} (${board.boardId})`, ...boardLines, "");
        }
      }
      if (matches === 0) lines.push(`No tasks with status "${filter}"`);
      return {
        title: "Mission Board",
        output: lines.join("\n"),
      };
    },
  });
}
