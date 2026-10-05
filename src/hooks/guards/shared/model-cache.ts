import { getModelPreferences } from "../../../services/proxy-selector.ts";
import { fetchAllAvailableModels, getPortCacheGen } from "../../../context/model-utils.ts";
import { logger } from "../../../utils/logger.ts";

interface CacheSlot {
  available: Array<{ id: string; source: string }>;
  ts: number;
  gen: number;
  negUntil: number;
}

let slot: CacheSlot | null = null;
let inflight: { gen: number; epoch: number; promise: Promise<Array<{ id: string; source: string }>> } | null = null;
let epoch = 0;

const MODELS_CACHE_TTL_MS = 60_000;
const NEGATIVE_CACHE_TTL_MS = 30_000;

function storeNegative(gen: number): Array<{ id: string; source: string }> {
  logger.warn(`[tawassul] model list fetch failed - serving short negative for ${NEGATIVE_CACHE_TTL_MS / 1000}s`);
  slot = { available: [], ts: Date.now(), gen, negUntil: Date.now() + NEGATIVE_CACHE_TTL_MS };
  return [];
}

function startFetch(epochAtStart: number): Promise<Array<{ id: string; source: string }>> {
  let prefs: { agentModelMap?: Record<string, string>; modelChoices?: Record<string, string> };
  try {
    prefs = getModelPreferences();
  } catch {
    return Promise.resolve(storeNegative(getPortCacheGen()));
  }
  return fetchAllAvailableModels(
    {
      agentModelMap: prefs.agentModelMap,
      modelChoices: prefs.modelChoices,
      failedModels: {},
    },
    undefined,
  ).then(
    (result) => {
      if (epochAtStart !== epoch) return result.available;
      if (!result.serverReachable) return storeNegative(getPortCacheGen());
      slot = { available: result.available, ts: Date.now(), gen: getPortCacheGen(), negUntil: 0 };
      return result.available;
    },
    () => {
      if (epochAtStart !== epoch) return [];
      return storeNegative(getPortCacheGen());
    },
  );
}

export function getAvailableModelsCached(
  cacheKey?: string,
  signal?: AbortSignal,
): Promise<Array<{ id: string; source: string }>> {
  void cacheKey;
  const now = Date.now();
  const gen = getPortCacheGen();
  if (slot && slot.gen === gen) {
    if (slot.negUntil > 0) {
      if (now < slot.negUntil) return Promise.resolve(slot.available);
    } else if (now - slot.ts < MODELS_CACHE_TTL_MS) {
      return Promise.resolve(slot.available);
    }
  }
  if (signal?.aborted) {
    logger.debug("[tawassul] model cache: caller already aborted - serving [] without fetch");
    return Promise.resolve([]);
  }
  if (!inflight || inflight.gen !== gen || inflight.epoch !== epoch) {
    const epochAtStart = epoch;
    const promise = startFetch(epochAtStart).finally(() => {
      if (inflight && inflight.gen === gen && inflight.epoch === epochAtStart) inflight = null;
    });
    inflight = { gen, epoch: epochAtStart, promise };
  }
  const shared = inflight.promise;
  if (!signal) return shared;
  return new Promise<Array<{ id: string; source: string }>>((resolve) => {
    if (signal.aborted) {
      resolve([]);
      return;
    }
    const onAbort = () => {
      logger.debug("[tawassul] model cache: caller aborted - serving [] without touching shared fetch");
      resolve([]);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    shared.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve([]);
      },
    );
  });
}

export function resetModelCache(cacheKey?: string): void {
  void cacheKey;
  slot = null;
  epoch++;
  inflight = null;
}

export function getModelListProvenance(): {
  ageMs: number;
  gen: number;
  negative: boolean;
  stale: boolean;
} | null {
  if (!slot || slot.gen !== getPortCacheGen()) return null;
  if (slot.negUntil > 0) {
    if (Date.now() >= slot.negUntil) return null;
    return { ageMs: Date.now() - slot.ts, gen: slot.gen, negative: true, stale: false };
  }
  const ageMs = Date.now() - slot.ts;
  return { ageMs, gen: slot.gen, negative: false, stale: ageMs >= MODELS_CACHE_TTL_MS };
}
