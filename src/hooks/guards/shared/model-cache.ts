
import { getModelPreferences } from "../../../services/proxy-selector.ts";
import { fetchAllAvailableModels } from "../../../context/model-utils.ts";

const _modelCaches = new Map<string, { cache: Array<{ id: string; source: string }>; ts: number }>();
const MODELS_CACHE_TTL_MS = 60_000;
export function getAvailableModelsCached(cacheKey?: string): Promise<Array<{ id: string; source: string }>> {
  const key = cacheKey ?? "default";
  const now = Date.now();
  const cached = _modelCaches.get(key);
  if (cached && now - cached.ts < MODELS_CACHE_TTL_MS) return Promise.resolve(cached.cache);
  try {
    const prefs = getModelPreferences();
    return fetchAllAvailableModels({
      agentModelMap: prefs.agentModelMap,
      modelChoices: prefs.modelChoices,
      failedModels: {},
    }).then((result) => {
      _modelCaches.set(key, { cache: result.available, ts: now });
      if (_modelCaches.size > 50) {
        const oldest = _modelCaches.keys().next().value;
        if (oldest) _modelCaches.delete(oldest);
      }
      return result.available;
    });
  } catch {
    return Promise.resolve([]);
  }
}
export function resetModelCache(cacheKey?: string): void {
  if (cacheKey) _modelCaches.delete(cacheKey);
  else _modelCaches.clear();
}
