import { tool } from "../tool.ts";

const SIMPLE_QUESTION_PATTERNS = [
  /^(why|what|who|when|where|how|is|are|can|could|would|do|does)\b/i,
  /define|explain|describe|what is|tell me|meaning of/i,
  /^(yes|no|ok|thanks|thank you)$/i,
];

const COMPLEX_KEYWORDS = [
  "build",
  "develop",
  "implement",
  "write code",
  "create",
  "edit",
  "bash",
  "execute",
  "run command",
  "test",
  "deploy",
  "architecture",
  "design",
  "refactor",
  "migrate",
  "analyse",
  "deep",
  "multi-file",
  "multiple files",
];

export function buildDirectResponseTool() {
  return tool({
    description:
      "Allow @tawa to respond directly without delegating to task(). Used for simple questions that only need read/grep/glob. Complex tasks (edit/bash/deep analysis) must use task().",
    args: {
      response: tool.schema.string().describe("The direct response to the user"),
      requiresTask: tool.schema
        .boolean()
        .default(false)
        .describe("Set to true if this question actually needs a task() delegation"),
    },
    async execute(args) {
      return {
        output: args.response,
        requiresTask: args.requiresTask,
      };
    },
  });
}

export { SIMPLE_QUESTION_PATTERNS, COMPLEX_KEYWORDS };