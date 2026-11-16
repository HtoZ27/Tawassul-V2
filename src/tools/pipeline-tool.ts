import { tool } from "../tool.ts";
import type { HandoffEntry } from "../context/types.ts";
import type { ToolDefinition } from "../tool.ts";
import { normalizeName } from "../utils/name-utils.ts";

export function buildFastTrackTool(createHandoff: (entry: HandoffEntry) => string): ToolDefinition {
  return tool({
    description: [
      "Create a handoff directly and quickly, skipping the normal pipeline.",
      "",
      "═══ USAGE ═══",
      '  fasttrack(to: "@dev", task: "Fix the null pointer bug",',
      '    context: "The issue is in main.ts:42", files: ["src/main.ts"])',
    ].join("\n"),
    args: {
      to: tool.schema.string().describe("Target agent"),
      task: tool.schema.string().describe("Task description"),
      context: tool.schema.string().describe("Context for the handoff"),
      files: tool.schema.array(tool.schema.string()).optional().describe("Relevant files"),
      from: tool.schema.string().optional().describe("Source agent (defaults to caller)"),
    },
    async execute(args, cctx) {
      const normalizedTo = normalizeName(args.to);
      const normalizedFrom = normalizeName(args.from ?? cctx.agent);
      const id = createHandoff({
        id: "",
        from: normalizedFrom,
        to: normalizedTo,
        task: args.task,
        context: args.context,
        files: args.files ?? [],
        timestamp: new Date().toISOString(),
        status: "pending",
      });
      return `✅ Fast-track handoff ${id} created: ${normalizedFrom} → ${normalizedTo}: ${args.task}`;
    },
  });
}
