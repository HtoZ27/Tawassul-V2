export interface ParsedTask {
  agent: string;
  task: string;
  context?: string;
  files?: string[];
  mode?: string;
}

export function parseTask(input: string): ParsedTask | null {
  if (!input || typeof input !== "string") return null;

  const trimmed = input.trim();

  const agentMatch = trimmed.match(/^(?:@?(\w+(?:-\w+)*))\s*[:-]\s*(.+)/s);
  if (agentMatch) {
    return {
      agent: agentMatch[1]!,
      task: agentMatch[2]!.trim(),
    };
  }

  if (trimmed.startsWith("@")) {
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx > 0) {
      return {
        agent: trimmed.slice(1, spaceIdx),
        task: trimmed.slice(spaceIdx + 1).trim(),
      };
    }
  }

  return { agent: "unknown", task: trimmed };
}
