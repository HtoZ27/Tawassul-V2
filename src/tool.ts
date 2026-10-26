import { z } from "zod";
import type { ASK_UNAVAILABLE } from "./services/ask-channel.ts";

export type ToolContext = {
  sessionID: string;
  messageID: string;
  agent: string;
  directory: string;
  worktree: string;
  abort: AbortSignal;
  metadata(input: { title?: string; metadata?: { [key: string]: unknown } }): void;
  ask?(
    title: string,
    options:
      | { type: "confirm"; default: boolean }
      | { type: "select"; options: string[] }
      | { type: "multiselect"; options: string[] },
  ): Promise<boolean | void | string | string[] | typeof ASK_UNAVAILABLE>;
};

export type ToolResult =
  | string
  | {
      title?: string;
      output: string;
      metadata?: { [key: string]: unknown };
    };

export function tool<Args extends z.ZodRawShape>(input: {
  description: string;
  args: Args;
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<ToolResult>;
}) {
  return input;
}

tool.schema = z;

export type ToolDefinition = ReturnType<typeof tool>;