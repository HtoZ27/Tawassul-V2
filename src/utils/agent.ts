
export function cfgPriority(agent: string): number {
  const a = normalizeName(agent);
  if (a === "analyst" || a === "architect") return 1;
  if (a === "dev") return 2;
  return 3;
}


export function normalizeAgentName(name: string): string {
  return normalizeName(name);
}


import { ALL_AGENTS } from "../core/agent-data.ts";
import { KNOWN_MODEL_SUFFIXES, getAllProviderModelTokens } from "../core/model-registry.ts";
import { normalizeName } from "./name-utils.ts";
import { logger } from "./logger.ts";

const AGENT_ROLE_MAP: Record<string, string> = {};
for (const agent of ALL_AGENTS) {
  AGENT_ROLE_MAP[agent.name.toLowerCase()] = agent.name.toLowerCase();
}

const REGISTERED_DYNAMIC_AGENTS: Set<string> = new Set();

export function registerDynamicRoles(names: readonly string[]): void {
  for (const name of names) {
    const normalized = normalizeName(name);
    if (normalized !== "") REGISTERED_DYNAMIC_AGENTS.add(normalized);
  }
}

export function unregisterDynamicRoles(names: readonly string[]): void {
  for (const name of names) REGISTERED_DYNAMIC_AGENTS.delete(normalizeName(name));
}

export function resetDynamicRoles(): void {
  REGISTERED_DYNAMIC_AGENTS.clear();
}


export function resolveRole(agent: string): string | null {
  const normalized = normalizeAgentName(agent);
  
  if (AGENT_ROLE_MAP[normalized]) return AGENT_ROLE_MAP[normalized];
  
  
  const dashIdx = normalized.indexOf("-");
  if (dashIdx > 0) {
    const base = normalized.slice(0, dashIdx);
    const suffix = normalized.slice(dashIdx + 1);
    if (AGENT_ROLE_MAP[base] && (KNOWN_MODEL_SUFFIXES.has(suffix) || getAllProviderModelTokens().has(suffix) || REGISTERED_DYNAMIC_AGENTS.has(normalized)))
      return AGENT_ROLE_MAP[base];
  }
  return null;
}


const UNREGISTERED_AGENT_WARNED: Set<string> = new Set();
const MAX_UNREGISTERED_WARNS = 48;

export function isManagedAgent(agent?: string): boolean {
  if (!agent || agent === "undefined") return true;
  const managed = resolveRole(agent) !== null;
  if (!managed && !UNREGISTERED_AGENT_WARNED.has(agent) && UNREGISTERED_AGENT_WARNED.size < MAX_UNREGISTERED_WARNS) {
    UNREGISTERED_AGENT_WARNED.add(agent);
    logger.warn(`[tawassul] unregistered agent name passed through governance boundary — isManagedAgent=false`, {
      agent,
    });
  }
  return managed;
}
