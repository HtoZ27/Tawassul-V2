import { readFileSync, statSync } from "node:fs";

export interface ModelCatalogEntry {
  id: string;
  suffix?: string;
  aliases: string[];
  display: string;
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: "nvidia-nim/deepseek-ai/deepseek-v4-flash",
    suffix: "deep",
    aliases: ["deep"],
    display: "DeepSeek V4 Flash (NVIDIA)",
  },
  {
    id: "opencode/mimo-v2.6-flash-free",
    suffix: "mimo",
    aliases: ["mimo"],
    display: "Mimo v2.6 Flash (OpenCode)",
  },
  {
    id: "opencode/big-pickle",
    suffix: "pickle",
    aliases: ["pickle", "big-pickle"],
    display: "Big Pickle (OpenCode)",
  },
  {
    id: "google/gemini-flash-lite-latest",
    suffix: "gemini",
    aliases: ["gemini"],
    display: "Gemini (Google)",
  },
  {
    id: "nvidia-nim/minimaxai/minimax-m3",
    suffix: "minimax",
    aliases: ["minimax"],
    display: "MiniMax M3 (NVIDIA)",
  },
  {
    id: "nvidia-nim/nvidia/nemotron-3-ultra-550b-a55b",
    aliases: ["nemotron"],
    display: "Nemotron 3 Ultra (NVIDIA)",
  },
  {
    id: "opencode/muse-spark-1.2-contributor-free",
    aliases: ["muse-spark-1.2", "muse-spark-1.2-free", "muse-1.2"],
    display: "Muse Spark 1.2 (OpenCode)",
  },
  {
    id: "opencode/x-preview-f-free",
    suffix: "ox",
    aliases: ["ox", "ox-alpha", "x-preview-f-free"],
    display: "OX Alpha (OpenCode)",
  },
  {
    id: "opencode/ling-3.0-flash-fin-free",
    suffix: "ling",
    aliases: ["ling", "ling-3.0-flash", "ling-3.0-flash-fin-free"],
    display: "Ling 3.0 Flash (OpenCode Zen)",
  },
];

export const RETIRED_MODEL_IDS: ReadonlySet<string> = new Set([
  "opencode/deepseek-v4-flash-free",
  "opencode/nemotron-3-ultra-free",
  "opencode/ox-alpha-free",
  "opencode/muse-spark-1.2-free",
  "opencode/muse-spark-1.2-contributor-free",
  "opencode/muse-spark-1.3-contributor-free",
  "opencode/hy3-free",
  "opencode/mimo-v2.5-free",
  "cloudflare-workers-ai/@cf/moonshotai/kimi-k2.7-code",
]);

export const LEGACY_UNIFIED_HEAD = "google/gemini-flash-lite-latest";

export const MODEL_SUFFIX_MAP: Record<string, string> = Object.fromEntries(
  MODEL_CATALOG.filter((m) => m.suffix !== undefined).map((m) => [m.suffix!, m.id]),
);

export const MODEL_ID_TO_SUFFIX: Record<string, string> = Object.fromEntries(
  MODEL_CATALOG.filter((m) => m.suffix !== undefined).map((m) => [m.id, m.suffix!]),
);

export const MODEL_ALIASES: Record<string, string> = Object.fromEntries(
  MODEL_CATALOG.flatMap((m) => m.aliases.map((alias) => [alias, m.id])),
);

export const MODEL_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  MODEL_CATALOG.map((m) => [m.id, m.display]),
);

export const LEGACY_GOVERNED_SUFFIXES: readonly string[] = ["hy3", "kimi"];

export const KNOWN_MODEL_SUFFIXES: ReadonlySet<string> = new Set([
  ...Object.keys(MODEL_ALIASES),
  ...LEGACY_GOVERNED_SUFFIXES,
]);

interface ProviderTokenCache {
  path: string;
  mtimeMs: number;
  byProvider: Map<string, ReadonlySet<string>>;
}

let providerTokenCache: ProviderTokenCache | null = null;

function readProviderTokenCache(): Map<string, ReadonlySet<string>> {
  const home = process.env.HOME ?? "";
  const path = process.env.TAWASSUL_MODELS_JSON ?? (home !== "" ? `${home}/.cache/opencode/models.json` : "");
  if (path === "") return new Map();
  let mtimeMs: number;
  try {
    const st = statSync(path);
    if (!st.isFile()) return new Map();
    mtimeMs = st.mtimeMs;
  } catch {
    return new Map();
  }
  if (providerTokenCache !== null && providerTokenCache.path === path && providerTokenCache.mtimeMs === mtimeMs) {
    return providerTokenCache.byProvider;
  }
  const byProvider = new Map<string, ReadonlySet<string>>();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, { models?: Record<string, unknown> }>;
    for (const [provider, entry] of Object.entries(raw)) {
      const models = entry?.models;
      if (typeof models !== "object" || models === null) continue;
      const tokens = new Set<string>();
      for (const slug of Object.keys(models)) {
        const lower = slug.toLowerCase();
        tokens.add(lower);
        for (const part of lower.split(/[-_.]+/)) {
          if (part !== "") tokens.add(part);
        }
      }
      byProvider.set(provider.toLowerCase(), tokens);
    }
  } catch {
    return new Map();
  }
  providerTokenCache = { path, mtimeMs, byProvider };
  return byProvider;
}

export function getProviderModelTokens(provider: string): ReadonlySet<string> {
  return readProviderTokenCache().get(provider.trim().toLowerCase()) ?? new Set();
}

export function getAllProviderModelTokens(): ReadonlySet<string> {
  const union = new Set<string>();
  for (const tokens of readProviderTokenCache().values()) {
    for (const t of tokens) union.add(t);
  }
  return union;
}

export function resolveModelAlias(alias: string): string | null {
  const trimmed = alias.trim().toLowerCase();
  const fromAlias = MODEL_ALIASES[trimmed];
  if (fromAlias) return fromAlias;
  if (/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9.-]*)+$/i.test(trimmed)) return trimmed;
  return null;
}

export function getUserFacingModelName(modelId: string): string {
  const display = MODEL_DISPLAY_NAMES[modelId];
  if (display) return display;
  const short = modelId.split("/").pop() ?? modelId;
  return `Model ${short}`;
}

export function getAllModelDisplayNames(): string[] {
  return MODEL_CATALOG.map((m) => m.display);
}
