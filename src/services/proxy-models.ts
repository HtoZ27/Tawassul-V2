



import { MODEL_CATALOG } from "../core/model-registry.ts";

export {
  MODEL_ALIASES,
  MODEL_ID_TO_SUFFIX,
  KNOWN_MODEL_SUFFIXES,
  resolveModelAlias,
  getUserFacingModelName,
  getAllModelDisplayNames,
} from "../core/model-registry.ts";

const idForSuffix = (suffix: string): string => MODEL_CATALOG.find((m) => m.suffix === suffix)!.id;


export const MODEL_PRIORITY: Record<string, string> = {
  simple: idForSuffix("pickle"),
  medium: idForSuffix("pickle"),
  complex: idForSuffix("pickle"),
};

export { MODEL_CATALOG };
