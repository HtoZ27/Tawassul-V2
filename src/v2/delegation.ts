export function toolNameToV1(tool: string): string {
  if (tool === "subagent") return "task";
  if (tool === "shell") return "bash";
  return tool;
}

export function subagentArgsToV1(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const out = { ...(args as Record<string, unknown>) };
  if (out.subagent === undefined && typeof out.agent === "string") {
    out.subagent = out.agent;
    delete out.agent;
  }
  return out;
}

export function v1ArgsToSubagent(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const out = { ...(args as Record<string, unknown>) };
  if (out.agent === undefined && out.subagent !== undefined) {
    out.agent = out.subagent;
  }
  return out;
}

export function isTaskTool(tool: string): boolean {
  return tool === "subagent" || tool === "task";
}