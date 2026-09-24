import type { ToolContext } from "../tool.ts";
import { tool } from "../tool.ts";
import { t } from "../translations.ts";

export function buildHelpTool() {
  return tool({
    description: "Show help for available tools — each tool has a built-in description in its definition",
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
      return {
        output: approved
          ? "✅ User approved the implementation."
          : "❌ User rejected the implementation. Please revise.",
      };
    },
  });
}
