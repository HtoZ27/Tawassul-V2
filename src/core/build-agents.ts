
import { ALL_AGENTS } from "./agent-data.ts";
import { generateAgentMd } from "./render-agent.ts";

export function buildAgentsMdDefault(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const agent of ALL_AGENTS) {
    result[`@${agent.name}`] = generateAgentMd(agent);
  }
  return result;
}
