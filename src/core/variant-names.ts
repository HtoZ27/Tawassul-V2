

import { MODEL_SUFFIX_MAP } from "./model-registry.ts";

export { MODEL_SUFFIX_MAP, RETIRED_MODEL_IDS, LEGACY_UNIFIED_HEAD } from "./model-registry.ts";


export function isGeneratedVariant(name: string, extendAgents: readonly string[]): boolean {
  const idx = name.indexOf("-");
  if (idx < 1 || idx >= name.length - 1) return false;
  const base = name.slice(0, idx);
  const suffix = name.slice(idx + 1);
  return extendAgents.includes(base) && suffix in MODEL_SUFFIX_MAP;
}

export function generatedVariantNames(bases: readonly string[]): string[] {
  return bases.flatMap((base) => Object.keys(MODEL_SUFFIX_MAP).map((suffix) => `${base}-${suffix}`));
}
