
import type { FetchResult } from "../context/model-utils.ts";
import { fetchAllAvailableModels, getPortCacheGen } from "../context/model-utils.ts";
import { setModelPreferences } from "../services/proxy-selector.ts";

const MODELS_CACHE_TTL_MS = 60_000;

export class ModelCache {
  private _cache: FetchResult | null = null;
  private _ts = 0;
  private _gen = 0;

  async fetch(
    modelManager: { agentModelMap: Record<string, string>; tawaPreferences: { modelChoices: Record<string, string>; failedModels: Record<string, { model: string; error: string; failedAt: string }> } },
    force = false,
    serverUrl?: string,
  ): Promise<FetchResult> {
    const now = Date.now();
    const currentGen = getPortCacheGen();
    if (!force && this._cache && this._gen === currentGen && (now - this._ts) < MODELS_CACHE_TTL_MS) {
      return this._cache;
    }
    const result = await fetchAllAvailableModels(
      {
        agentModelMap: modelManager.agentModelMap,
        modelChoices: modelManager.tawaPreferences.modelChoices,
        failedModels: modelManager.tawaPreferences.failedModels,
      },
      serverUrl,
    );
    setModelPreferences(modelManager.agentModelMap, modelManager.tawaPreferences.modelChoices);
    if (getPortCacheGen() === currentGen) {
      this._cache = result;
      this._ts = now;
      this._gen = currentGen;
    }
    return result;
  }
}
