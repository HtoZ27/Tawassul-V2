import { tool } from "../../tool.ts";
import { t } from "../../translations.ts";
import type { ToolDefinition } from "../../tool.ts";
import type { TaskOrchestrator } from "../../services/task-orchestrator.ts";
import type { StrategyDispatcher } from "../../services/strategy-dispatcher.ts";
import { MOA_AGENTS } from "../../services/strategy-dispatcher.ts";
import type { TawassulContext } from "../../context-class.ts";
import type { AgentResult } from "../../types/plan.types.ts";
import { normalizeName } from "../../utils/name-utils.ts";

export function buildMoaTool(
  tawaCtx: TawassulContext,
  taskOrchestrator: TaskOrchestrator,
  strategyDispatcher: StrategyDispatcher,
): ToolDefinition {
  return tool({
    description: "Execute a task using Mixture of Agents (MoA) strategy for high-accuracy results.",
    args: {
      task: tool.schema.string().describe("The task for MoA execution"),
      agents: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Specific agents to use (default: @dev, @tester, @analyst)"),
    },
    async execute(args, context) {
      const task = String(args.task || "").trim();
      if (!task) {
        return { title: "MoA", output: t("twSpecifyTask") };
      }

      const subtasks = taskOrchestrator.decompose(task);
      const available = new Set(tawaCtx.getAgents().map(normalizeName));
      const requested = ((args.agents as string[] | undefined) ?? MOA_AGENTS).map(normalizeName);
      const pool = requested.filter((a) => a !== "tawa" && available.has(a));
      const roles = pool.length > 0 ? pool : ["dev"];

      const parallelId = `moa-${Date.now()}`;
      const dispatched: { id: string; to: string; ok: boolean; error?: string }[] = [];

      for (const st of subtasks) {
        const results: AgentResult[] = await strategyDispatcher.dispatch(st, "moa", roles);
        for (const r of results) {
          dispatched.push({
            id: st.id,
            to: r.agentId,
            ok: !r.error,
            error: r.error,
          });
        }
      }

      tawaCtx.updateLastActive(context.agent);
      await tawaCtx.saveState();

      const lines = dispatched.map(
        (d) => `- **${d.id}** → ${d.to}: ${d.ok ? t("twDistributed") : t("twFailed", { err: d.error ?? "" })}`,
      );
      return {
        title: "MoA Result",
        output: [
          `## 🧠 MoA Execution — ${subtasks.length} subtask(s) × ${roles.length} expert(s)`,
          ``,
          `**Task:** ${task}`,
          `**Agents:** ${roles.join(", ")}`,
          `**Parallel group:** ${parallelId}`,
          ``,
          ...lines,
          ``,
          t("twDispatchedVia"),
        ].join("\n"),
        metadata: { parallelId, dispatched: dispatched.map((d) => d.id), agents: roles },
      };
    },
  });
}
