import { ConfigError } from "../utils/errors.ts";


export interface ConfigLayer {
  [key: string]: unknown;
}

export interface ConfigOverlayOptions {
  
  layers: ConfigLayer[];
  
  requiredFields?: string[];
  
  environment?: string;
}

const BUILTIN_DEFAULTS: ConfigLayer = {
  maxAgents: 5,
  debug: false,
  logLevel: "info",
  timeoutMs: 30000,
  maxRetries: 3,
};

function deepMerge(target: ConfigLayer, source: ConfigLayer): ConfigLayer {
  const result: ConfigLayer = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof result[k] === "object" &&
      !Array.isArray(result[k])
    ) {
      result[k] = deepMerge(result[k] as ConfigLayer, v as ConfigLayer);
    } else {
      result[k] = v;
    }
  }
  return result;
}

export function applyOverlay(options: ConfigOverlayOptions): ConfigLayer {
  const { layers, requiredFields, environment } = options;
  let merged: ConfigLayer = { ...BUILTIN_DEFAULTS };

  for (const layer of layers) {
    merged = deepMerge(merged, layer);
  }

  if (environment) {
    for (const layer of layers) {
      const envOverlay = (layer as Record<string, unknown>)[`env:${environment}`] as ConfigLayer | undefined;
      if (envOverlay) {
        merged = deepMerge(merged, envOverlay);
      }
    }
  }

  if (requiredFields) {
    for (const field of requiredFields) {
      if (merged[field] === undefined || merged[field] === null) {
        throw new ConfigError(`الحقل المطلوب "${field}" غير موجود في أي طبقة`);
      }
    }
  }

  return merged;
}

export class ConfigOverlay {
  private merged: ConfigLayer;

  constructor(options: ConfigOverlayOptions) {
    this.merged = applyOverlay(options);
  }

  get<T>(key: string, fallback?: T): T | undefined {
    return (this.merged[key] as T) ?? fallback;
  }

  set(key: string, value: unknown): void {
    this.merged[key] = value;
  }

  toJSON(): ConfigLayer {
    return { ...this.merged };
  }
}
