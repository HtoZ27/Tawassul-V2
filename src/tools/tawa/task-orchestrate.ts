import { tool } from "../../tool.ts";
import { t } from "../../translations.ts";
import type { ToolDefinition } from "../../tool.ts";
import type { TaskOrchestrator } from "../../services/task-orchestrator.ts";
import type { StrategyDispatcher } from "../../services/strategy-dispatcher.ts";
import type { TawassulContext } from "../../context-class.ts";
import type { AgentResult } from "../../types/plan.types.ts";

export function buildTaskOrchestrateTool(
  tawaCtx: TawassulContext,
  taskOrchestrator: TaskOrchestrator,
  strategyDispatcher: StrategyDispatcher,
): ToolDefinition {
  return tool({
    description: "Orchestrate and dispatch complex tasks across agents using the task orchestrator.",
    args: {
      task: tool.schema.string().describe("The task description to decompose and dispatch"),
      mode: tool.schema.enum(["auto", "parallel", "swarm", "moa"]).optional().default("auto").describe("Dispatch mode"),
    },
    async execute(args, context) {
      const task = String(args.task || "").trim();
      if (!task) {
        return { title: "Task Orchestrate", output: t("twSpecifyTask") };
      }
      const mode = args.mode ?? "auto";

      const subtasks = taskOrchestrator.decompose(task);
      const parallelId = `orchestrate-${Date.now()}`;
      const dispatched: { id: string; to: string; ok: boolean; error?: string }[] = [];

      for (const st of subtasks) {
        const results: AgentResult[] = await strategyDispatcher.dispatch(st, mode);
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

      const failed = dispatched.filter((d) => !d.ok);
      const lines = dispatched.map(
        (d) => `- **${d.id}** → ${d.to}: ${d.ok ? t("twDistributed") : t("twFailed", { err: d.error ?? "" })}`,
      );
      return {
        title: "Task Orchestrate",
        output: [
          `## 📋 Task Orchestration — ${dispatched.length} task(s)`,
          ``,
          `**Task:** ${task}`,
          `**Mode:** ${mode}`,
          `**Parallel group:** ${parallelId}`,
          ``,
          ...lines,
          ``,
          failed.length > 0 ? t("twOrchestrateFailed", { count: String(failed.length) }) : t("twOrchestratedVia"),
        ].join("\n"),
        metadata: { parallelId, mode, dispatched: dispatched.map((d) => d.id) },
      };
    },
  });
}
