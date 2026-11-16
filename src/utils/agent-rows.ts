import { normalizeName } from "./name-utils.ts";

export interface AgentRowSplit {
  mentionable: string[];
  dynamicOnly: string[];
}

export function splitAgentRows(
  agents: readonly string[],
  dynamicAgents: readonly string[],
  configKeys: readonly string[],
): AgentRowSplit {
  const config = new Set(configKeys.map((name) => normalizeName(name)));
  const dynamics = new Set(dynamicAgents.map((name) => normalizeName(name)));
  const mentionable: string[] = [];
  const dynamicOnly: string[] = [];
  const seen = new Set<string>();
  for (const name of agents) {
    const key = normalizeName(name);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    if (config.has(key)) {
      mentionable.push(name.startsWith("@") ? name : `@${key}`);
    } else if (dynamics.has(key) && !name.startsWith("@")) {
      dynamicOnly.push(key);
    } else {
      mentionable.push(name);
    }
  }
  for (const key of dynamics) {
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    if (config.has(key)) mentionable.push(`@${key}`);
    else dynamicOnly.push(key);
  }
  return { mentionable, dynamicOnly };
}
