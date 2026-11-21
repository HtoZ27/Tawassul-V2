import { RETIRED_MODEL_IDS } from "../core/model-registry.ts";
import { parseModelTarget } from "./model-failover.ts";
import {
  DYNAMIC_MODEL_SENTINEL,
  FREE_FALLBACK_MODEL,
  getFallbackChain,
} from "./proxy-fallback-chains.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { resolveRole } from "../utils/agent.ts";
import type { AgentModelRef } from "../context/types.ts";

export function resolveAgentModelRef(
  agent: string,
  agentModelMap: Record<string, string>,
  configuredModel?: string,
): AgentModelRef {
  const key = normalizeName(agent);
  for (const raw of [configuredModel, agentModelMap[key], agentModelMap[agent]]) {
    if (typeof raw === "string" && raw.trim().length > 0) {
      const parsed = parseModelTarget(raw);
      if (parsed && raw !== DYNAMIC_MODEL_SENTINEL && !RETIRED_MODEL_IDS.has(raw)) return parsed;
    }
  }
  let role = key;
  try {
    role = resolveRole(key) ?? key;
  } catch {
    role = key;
  }
  const chain = getFallbackChain(role);
  const head = chain.find((model) => model !== DYNAMIC_MODEL_SENTINEL && !RETIRED_MODEL_IDS.has(model));
  return parseModelTarget(head ?? FREE_FALLBACK_MODEL) ?? { providerID: "default", modelID: "default" };
}

export type ModelComparison = "same" | "different" | "unknown";

export function compareAgentModels(
  implementer: AgentModelRef | undefined,
  reviewer: AgentModelRef | undefined,
): ModelComparison {
  if (!implementer || !reviewer) return "unknown";
  return implementer.providerID === reviewer.providerID && implementer.modelID === reviewer.modelID
    ? "same"
    : "different";
}

export function reviewerIndependenceFails(entry: {
  implementer?: AgentModelRef;
  reviewer?: AgentModelRef;
}): boolean {
  return compareAgentModels(entry.implementer, entry.reviewer) === "same";
}
