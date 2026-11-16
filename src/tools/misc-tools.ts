import type { ToolContext } from "../tool.ts";
import { tool } from "../tool.ts";
import { t } from "../translations.ts";
import { ASK_UNAVAILABLE } from "../services/ask-channel.ts";

export function buildHelpTool() {
  return tool({
    description: "Tawassul help: overview, ledgers, state. Agent changes use addagent and kick, not files.",
    args: {},
    async execute() {
      return { title: "ℹ️ Help", output: t("helpOverview") };
    },
  });
}

export function buildReviewTool() {
  return tool({
    description: "Requests user review of multi-agent work before proceeding with implementation",
    args: {
      agents: tool.schema.array(tool.schema.string()).describe("List of agents that participated in the task"),
      summary: tool.schema.string().describe("A summary of what was found or done"),
    },
    async execute(args, cctx: ToolContext) {
      if (!cctx.ask) {
        return { output: "❌ Review requires an interactive session (no ask() available)." };
      }
      const approved = await cctx.ask(
        `## 🔍 Review Required — Review Gate\n### Work Summary\n${args.summary}\n\n### Participating agents\n${args.agents.map((a) => `- ${a}`).join("\n")}\n\n---\n**Do you approve this implementation?**`,
        { type: "confirm", default: false },
      );
      if (approved === ASK_UNAVAILABLE) {
        return {
          output:
            "❌ Review gate could not reach the user — the question channel is at capacity, so no approval was assumed. Answer the pending question and retry.",
        };
      }
      return {
        output:
          approved === true
            ? "✅ User approved the implementation."
            : "❌ User rejected the implementation. Please revise.",
      };
    },
  });
}
