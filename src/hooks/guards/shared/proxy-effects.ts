
import { logger } from "../../../utils/logger.ts";
import { resolveRole } from "../../../utils/agent.ts";
import { selectModelForTask, selectModelForTaskDynamic } from "../../../services/proxy-selector.ts";
import { getFallbackChain, buildDynamicFallbackChain } from "../../../services/proxy-fallback-chains.ts";
import { getTaskVector } from "../../task-vector.ts";
import { isTawaAgent, normalizeName } from "./normalize.ts";
import { getAvailableModelsCached, getModelListProvenance } from "./model-cache.ts";
import { warnThrottled } from "./warn-throttle.ts";
import { recordFetchWait } from "./fetch-wait-metrics.ts";
import type { Ctx, Input, StageOutput } from "./types.ts";




function safeBreaker(ctx: Ctx): {
  isOpen(m: string): boolean;
  openModels(): Set<string>;
} {
  const cb = ctx.circuitBreaker as { evaluate?(m: string): unknown; getAllStates?(): unknown } | undefined;
  return {
    isOpen(m: string): boolean {
      try {
        return cb?.evaluate?.(m) === "OPEN";
      } catch {
        return false; 
      }
    },
    openModels(): Set<string> {
      try {
        const states = (cb?.getAllStates?.() ?? []) as Array<{ state?: string; agent?: string }>;
        return new Set(states.filter((s) => s.state === "OPEN").map((s) => String(s.agent)));
      } catch {
        return new Set();
      }
    },
  };
}


function announceModelFallback(
  target: string,
  configuredModel: string | undefined,
  actualModel: string,
  reason: string,
): void {
  if (!configuredModel || configuredModel === "default/default" || configuredModel === actualModel) return;
  const msg = `[tawassul] MODEL_FALLBACK: ${target} ⇒ ${actualModel} (configured ${configuredModel} — ${reason})`;
  logger.warn(msg);
  try {
    logger.audit("MODEL_FALLBACK", { target, from: configuredModel, to: actualModel, reason });
  } catch (auditErr) {
    logger.debug("[tawassul] MODEL_FALLBACK audit sink unavailable", auditErr);
  }
}

export async function proxyAgentRoutingStage(ctx: Ctx, input: Input, output: StageOutput): Promise<void> {
  if (input.tool !== "task") return;
  if (!isTawaAgent(input.agent)) return;
  const targetAgents: string[] = [];
  const add = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach(add);
      return;
    }
    if (typeof v === "string" && v.trim()) targetAgents.push(normalizeName(v));
  };
  add(output.args?.subagent);
  add(output.args?.agent);
  for (const target of targetAgents) {
    if (!target) continue;
    
    
    const existingModel = output.args?.model;
    const hasExplicit = typeof existingModel === "string" && existingModel.trim() !== "";
    if (hasExplicit) break;

    const configuredModel = ctx.getAgentModel(target);
    const breaker = safeBreaker(ctx);
    const configuredUsable =
      !!configuredModel && configuredModel !== "default/default" && !breaker.isOpen(configuredModel);
    if (configuredUsable) {
      (output.args as Record<string, unknown>).model = configuredModel!;
      break;
    }

    
    
    const substitutionReason =
      configuredModel && configuredModel !== "default/default" ? "circuit OPEN / unavailable" : "no configured model";

    
    const p = ctx.pipelineState;
    if (p) {
      const chain = p.dispatchChain.get(input.sessionID);
      if (chain && chain.length > 0) {
        const targetBaseRole = resolveRole(target) ?? target;
        let chainApplied = false;
        for (const chainAgent of chain) {
          if (chainAgent === target || chainAgent === "tawa") continue;
          const chainBaseRole = resolveRole(chainAgent) ?? chainAgent;
          if (chainBaseRole === targetBaseRole) {
            const chainModel = ctx.getAgentModel(chainAgent);
            if (chainModel && chainModel !== "default/default" && !breaker.isOpen(chainModel)) {
              (output.args as Record<string, unknown>).model = chainModel;
              announceModelFallback(
                target,
                configuredModel,
                chainModel,
                `${substitutionReason}; same-role reuse from ${chainAgent}`,
              );
              chainApplied = true;
              break;
            }
          }
        }
        if (chainApplied) break;
      }
    }
    const baseRole = resolveRole(target) ?? target;
    const MODEL_FETCH_TIMEOUT = 3000;
    let modelTimer: ReturnType<typeof setTimeout> | undefined;
    const fetchController = new AbortController();
    const waitStart = Date.now();
    const availableModels = await Promise.race([
      getAvailableModelsCached(ctx.sessionId, fetchController.signal),
      new Promise<never[]>((resolve) => {
        modelTimer = setTimeout(() => {
          const prov = getModelListProvenance();
          const ageNote =
            prov === null
              ? "no cached list"
              : `cached list age ${prov.ageMs}ms, gen ${prov.gen}${prov.negative ? " (short-negative window)" : ""}${prov.stale ? " (stale)" : ""}`;
          warnThrottled(
            "proxy-fetch-timeout",
            60_000,
            `[tawassul] proxyAgentRouting: getAvailableModels timed out after ${MODEL_FETCH_TIMEOUT}ms - aborting loser, falling back to static selection (${ageNote})`,
          );
          fetchController.abort();
          resolve([]);
        }, MODEL_FETCH_TIMEOUT);
      }),
    ]).finally(() => {
      if (modelTimer) clearTimeout(modelTimer);
      recordFetchWait(Date.now() - waitStart);
    });
    const prompt = typeof output.args?.prompt === "string" ? output.args.prompt : "";
    const fileCount = Array.isArray(output.args?.files) ? (output.args.files as unknown[]).length : 0;
    let finalModel =
      availableModels.length > 0
        ? selectModelForTaskDynamic({ description: prompt, fileCount }, availableModels, baseRole)
        : selectModelForTask({ description: prompt, fileCount });
    {
      const openModels = breaker.openModels();
      if (openModels.has(finalModel)) {
        const chain =
          availableModels.length > 0
            ? buildDynamicFallbackChain(availableModels, baseRole)
            : getFallbackChain(baseRole);
        const healthy = chain.find((m) => !openModels.has(m));
        if (healthy) finalModel = healthy;
      }
      if (availableModels.length > 0 && !availableModels.some((m) => m.id === finalModel)) {
        finalModel = availableModels.find((m) => !openModels.has(m.id))?.id ?? finalModel;
      }
    }
    (output.args as Record<string, unknown>).model = finalModel;
    
    
    announceModelFallback(target, configuredModel, finalModel, substitutionReason);
    break;
  }
}

export async function cognitiveEffectsApplier(ctx: Ctx, input: Input, output: StageOutput): Promise<void> {
  const isTawa = normalizeName(input.agent) === "tawa";
  if (input.tool !== "task" || !isTawa) return;
  const desc = output.args?.desc;
  const subagent = output.args?.subagent;
  const rawDescs = Array.isArray(desc) ? desc : [desc];
  const descs = rawDescs.filter((s): s is string => typeof s === "string");
  const combinedVector: Record<string, number> = {};
  for (const d of descs) {
    const v = getTaskVector(d);
    for (const [k, val] of Object.entries(v)) combinedVector[k] = (combinedVector[k] ?? 0) + val;
  }
  const active = Object.values(combinedVector).filter((v) => v > 0).length;
  ctx.chainActive = active > 1;
  ctx.chainStepsRemaining = active > 1 ? active : 0;
  const isParallel = (Array.isArray(desc) && desc.length > 1) || (Array.isArray(subagent) && subagent.length > 1);
  if (isParallel) {
    ctx.chainActive = false;
    ctx.chainStepsRemaining = 0;
  }
}
