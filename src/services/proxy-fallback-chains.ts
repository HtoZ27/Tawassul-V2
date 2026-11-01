import { RETIRED_MODEL_IDS } from "../core/model-registry.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { resolveRole } from "../utils/agent.ts";

export const FREE_FALLBACK_MODEL = "google/gemini-flash-lite-latest";

export const FALLBACK_CHAINS: Record<string, string[]> = {
  tawa: ["opencode/big-pickle", FREE_FALLBACK_MODEL, "opencode/mimo-v2.6-flash-free"],
  dev: [
    "nvidia/deepseek-ai/deepseek-v4.1-flash",
    FREE_FALLBACK_MODEL,
    "opencode/mimo-v2.6-flash-free",
    "opencode/big-pickle",
  ],
  analyst: [
    FREE_FALLBACK_MODEL,
    "nvidia/deepseek-ai/deepseek-v4.1-flash",
    "opencode/mimo-v2.6-flash-free",
    "opencode/big-pickle",
  ],
  tester: [
    "opencode/mimo-v2.6-flash-free",
    FREE_FALLBACK_MODEL,
    "nvidia/deepseek-ai/deepseek-v4.1-flash",
    "opencode/big-pickle",
  ],
  reviewer: ["opencode/big-pickle", FREE_FALLBACK_MODEL, "nvidia/deepseek-ai/deepseek-v4.1-flash"],
  architect: ["opencode/big-pickle", FREE_FALLBACK_MODEL, "opencode/mimo-v2.6-flash-free"],
  designer: ["opencode/big-pickle", FREE_FALLBACK_MODEL, "opencode/mimo-v2.6-flash-free"],
  doc: ["opencode/big-pickle", FREE_FALLBACK_MODEL, "nvidia/deepseek-ai/deepseek-v4.1-flash"],
};

export function getFallbackChain(role: string): string[] {
  const chain = FALLBACK_CHAINS[role] || FALLBACK_CHAINS.dev!;
  const free = chain.indexOf(FREE_FALLBACK_MODEL);
  if (free === 0 || free === 1) return chain;
  const primary = chain.filter((model) => model !== FREE_FALLBACK_MODEL);
  return [primary[0] ?? FREE_FALLBACK_MODEL, FREE_FALLBACK_MODEL, ...primary.slice(1)];
}

export function getDynamicFallbackChainForRole(
  role: string,
  ctx?: { dynamicAgents: readonly string[]; agentModelMap: Record<string, string> },
): string[] {
  const base = getFallbackChain(role);
  if (!ctx || !ctx.dynamicAgents || !ctx.agentModelMap) return base;
  const seen = new Set<string>(base);
  const extra: string[] = [];
  for (const name of ctx.dynamicAgents) {
    const belongs = name === role || name.startsWith(`${role}-`) || name.startsWith(`${role}_`);
    if (!belongs) continue;
    const key = name.toLowerCase();
    const model = ctx.agentModelMap[key] ?? ctx.agentModelMap[name];
    if (!model || seen.has(model) || RETIRED_MODEL_IDS.has(model)) continue;
    extra.push(model);
    seen.add(model);
  }
  return extra.length > 0 ? [...base, ...extra] : base;
}

export const DYNAMIC_MODEL_SENTINEL = "dynamic";

export function defaultAgentModelForRole(role: string): string {
  return getFallbackChain(role)[0] ?? getFallbackChain("dev")[0] ?? "google/gemini-flash-lite-latest";
}

export interface RetiredPinReassignment {
  name: string;
  oldModel: string;
  newModel: string;
}

export function sweepRetiredModelPins(agentModelMap: Record<string, string>): RetiredPinReassignment[] {
  const reassigned: RetiredPinReassignment[] = [];
  for (const [name, model] of Object.entries(agentModelMap)) {
    if (typeof model !== "string" || !RETIRED_MODEL_IDS.has(model)) continue;
    const role = resolveRole(name) ?? name;
    const chain = getFallbackChain(role);
    const healthy = chain.find((m) => !RETIRED_MODEL_IDS.has(m)) ?? defaultAgentModelForRole(role);
    if (healthy && healthy !== model) {
      agentModelMap[name] = healthy;
      reassigned.push({ name, oldModel: model, newModel: healthy });
    }
  }
  return reassigned;
}

export function buildDynamicFallbackChain(available: Array<{ id: string; source: string }>, _role: string): string[] {
  const userPreferred: string[] = [];
  const previouslySuccessful: string[] = [];
  const freeModels: string[] = [];
  const otherAvailable: string[] = [];

  for (const model of available) {
    if (model.source === "user preference") userPreferred.push(model.id);
    else if (model.source === "previously successful") previouslySuccessful.push(model.id);
    else if (model.source === "free") freeModels.push(model.id);
    else if (model.source === "linked provider") otherAvailable.push(model.id);
  }

  return [...userPreferred, ...previouslySuccessful, ...freeModels, ...otherAvailable];
}

export function resolveFallbackAgent(
  failedAgent: string,
  opts: { availableAgents?: string[]; agentModelMap?: Record<string, string>; dynamicAgents?: readonly string[] },
): string | null {
  const map = opts.agentModelMap ?? {};
  const failed = normalizeName(failedAgent);
  let role: string;
  try {
    role = resolveRole(failed) ?? failed;
  } catch {
    role = failed;
  }
  const normAvailable = (opts.availableAgents ?? [])
    .map((a) => normalizeName(a))
    .filter((a) => a && a !== failed && a !== "tawa" && a !== "addagent");
  const chain = getDynamicFallbackChainForRole(role, {
    dynamicAgents: opts.dynamicAgents ?? normAvailable,
    agentModelMap: map,
  });
  const candidates = normAvailable.filter((a) => {
    try {
      return resolveRole(a) === role;
    } catch {
      return false;
    }
  });
  if (candidates.length === 0) return null;
  const preferredModel = chain.find((m) => !RETIRED_MODEL_IDS.has(m)) ?? chain[0];
  for (const c of candidates) {
    if (map[c] === preferredModel) return c;
  }
  const failedModel = map[failed];
  for (const c of candidates) {
    if (failedModel && map[c] !== failedModel) return c;
  }
  return candidates[0] ?? null;
}