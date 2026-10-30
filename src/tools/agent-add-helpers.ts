import { ALL_AGENTS } from "../agent-templates.ts";
import { ROLE_NAMES } from "../core/agent-data.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { resolveModelAlias, MODEL_ALIASES, MODEL_CATALOG, KNOWN_MODEL_SUFFIXES } from "../services/proxy-models.ts";
import { getProviderModelTokens, MODEL_ID_TO_SUFFIX } from "../core/model-registry.ts";
import { buildCapabilitySummary } from "../core/capability-summary.ts";
import { isGeneratedVariant } from "../core/variant-names.ts";
import { levenshtein } from "../core/nlp.ts";
import { DELETED_AGENTS } from "../security-policy.ts";
import { getAllowedToolsForRole } from "../role-matrix.ts";
import { t } from "../translations.ts";

export const BASE_ROLE_NAMES: ReadonlySet<string> = new Set(ALL_AGENTS.map((a) => a.name));

export const SPECIALIZATIONS = ALL_AGENTS.filter((a) => a.name !== "tawa").map((a) => a.name);

export const OPCODE_BUILTIN_AGENTS: ReadonlySet<string> = new Set([
  "build",
  "plan",
  "general",
  "explore",
  "scout",
  "compaction",
  "title",
  "summary",
]);

export function examplesText(): string {
  return [t("addagentExample1"), t("addagentExample2"), t("addagentExample3"), t("addagentExample4")].join("\n");
}

export function stripLeadingVerb(s: string): string {
  return s.trim().replace(/^(?:add|remove|delete)[\s]+/i, "");
}

export function isVariantName(spec: string): boolean {
  return isGeneratedVariant(normalizeName(spec), SPECIALIZATIONS);
}

export function parseCompoundSpec(spec: string): { base: string; suffix: string } | null {
  const idx = spec.indexOf("-");
  if (idx < 1 || idx >= spec.length - 1) return null;
  const base = spec.slice(0, idx);
  const suffix = spec.slice(idx + 1);
  if (!SPECIALIZATIONS.includes(base)) return null;
  return { base, suffix };
}

export function expandAllSuffixToken(token: string, bases: readonly string[]): string[] | null {
  const m = token.match(/^all-([^\s]+)$/i);
  if (!m) return null;
  const tag = m[1]!;
  if (!tag || tag.startsWith("-") || tag === ".") return null;
  return bases.filter((b) => b !== "tawa").map((b) => `${b}-${tag}`);
}

export function agentConfigFor(spec: string, fullModel: string): Record<string, unknown> | null {
  const compound = parseCompoundSpec(spec);
  const templateName = compound ? compound.base : spec;
  const template = ALL_AGENTS.find((a) => a.name === templateName && a.name !== "tawa");
  if (!template) return null;
  const label = compound ? (ROLE_NAMES[compound.base] ?? compound.base) : template.description;
  const capSuffix = buildCapabilitySummary(template.permissions);
  const permission: Record<string, string | Record<string, string>> = {
    edit: template.permissions.edit,
    bash: template.permissions.bash,
    external_directory: template.permissions.external_directory ?? "deny",
    webfetch: template.permissions.webfetch ?? "allow",
    websearch: template.permissions.websearch ?? "allow",
    task: template.permissions.task ?? { "*": "deny", explore: "allow", general: "allow" },
    handoff: { "*": "deny", explore: "allow", general: "allow" },
  };
  for (const tool of getAllowedToolsForRole(templateName)) {
    if (tool === "handoff" || tool === "task") continue;
    permission[tool] = "allow";
  }
  return {
    description: `${label} — ${fullModel}${capSuffix}`,
    model: fullModel,
    mode: "subagent",
    permission,
  };
}

export function findClosest(input: string, candidates: string[]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  const maxDist = Math.max(1, Math.floor(input.length / 3));
  for (const c of candidates) {
    const d = levenshtein(input.toLowerCase(), c.toLowerCase(), maxDist);
    if (d < bestDist && d <= maxDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

export interface ParsedAddInput {
  specs: string[];
  model: string;
  derived: Record<string, string>;
}

export function deriveVariantSpec(spec: string, model: string, provider = ""): { tag: string; from: string } | null {
  const n = normalizeName(spec);
  if (n === "tawa" || !SPECIALIZATIONS.includes(n)) return null;
  const m = model.toLowerCase();
  const candidates = [
    provider ? `${provider.toLowerCase()}/${m}` : "",
    m,
    m.includes("/") ? m.split("/").slice(1).join("-") : "",
  ];
  for (const c of candidates) {
    const short = c ? MODEL_ID_TO_SUFFIX[c] : undefined;
    if (short) return { tag: `${n}-${short}`, from: spec };
  }
  const slugRaw = m.includes("/") ? m.split("/").slice(1).join("-") : m;
  const slug = slugRaw
    .replace(/_/g, "-")
    .replace(/\/+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return null;
  return { tag: `${n}-${slug}`, from: spec };
}

function applyBareDerivation(
  specs: string[],
  model: string,
  provider: string,
): { specs: string[]; derived: Record<string, string> } {
  const derived: Record<string, string> = {};
  const out = specs.map((s) => {
    const d = deriveVariantSpec(s, model, provider);
    if (d) {
      derived[d.tag] = d.from;
      return d.tag;
    }
    return s;
  });
  return { specs: out, derived };
}

export function parseAddInput(input: string): ParsedAddInput | null {
  const WILDCARD = new Set(["*", "all"]);
  input = stripLeadingVerb(input);
  const matchEn = input.match(/^([\w\s*/\-.\u0600-\u06FF]+?)\s+with\s+model\s+(.+?)\s+from\s+([\w\s.-]+)$/i);
  if (matchEn) {
    const raw = matchEn[2]!.trim().replace(/\s+/g, "-");
    const provider = matchEn[3]!.trim().replace(/\s+/g, "-").replace(/-+$/, "");
    const alias = MODEL_ALIASES[raw.toLowerCase()];
    let specs = matchEn[1]!.trim().split(/\s+/).filter(Boolean);
    if (specs.length === 1) {
      const first = specs[0]!;
      if (WILDCARD.has(first.toLowerCase())) {
        specs = ALL_AGENTS.filter((a) => a.name !== "tawa").map((a) => a.name);
      } else {
        const tagged = expandAllSuffixToken(first, SPECIALIZATIONS);
        if (tagged) specs = tagged;
      }
    }
    const model = (alias ?? (raw.includes("/") ? raw : `${provider}/${raw}`)).toLowerCase();
    const { specs: finalSpecs, derived } = applyBareDerivation(specs, model, provider);
    return { specs: finalSpecs, model, derived };
  }
  return null;
}

export function validateAddInput(specs: string[], model: string): string | null {
  if (!resolveModelAlias(model)) {
    const aliases = Object.keys(MODEL_ALIASES).join(", ");
    if (model.includes("/")) {
      return t("addagentUnknownModel", { model }) + `\n💡 ${t("addagentAvailableModels", { aliases })}`;
    }
    const allCandidates = [...Object.keys(MODEL_ALIASES), ...MODEL_CATALOG.map((m) => m.id)];
    const suggestion = findClosest(model, allCandidates);
    if (suggestion) {
      return t("addagentModelDidYouMean", { model, suggestion });
    }
    return t("addagentUnknownModel", { model }) + `\n💡 ${t("addagentAvailableModels", { aliases })}`;
  }
  for (const spec of specs) {
    const normalized = normalizeName(spec);
    if (normalized === "tawa") {
      if (specs.length !== 1) {
        return t("addagentTawaPrefixBlocked");
      }
      continue;
    }
    if (normalized.startsWith("tawa")) {
      return t("addagentTawaPrefixBlocked");
    }
    if (OPCODE_BUILTIN_AGENTS.has(normalized)) {
      return t("addagentReservedName", { spec });
    }
    if (DELETED_AGENTS.has(normalized)) {
      return t("addagentDeletedAgent", { spec });
    }
    const compound = parseCompoundSpec(spec);
    if (compound) {
      const suffixLower = compound.suffix.toLowerCase();
      const providerOf = model.includes("/") ? model.split("/")[0]!.toLowerCase() : "";
      const governed =
        KNOWN_MODEL_SUFFIXES.has(suffixLower) ||
        (providerOf !== "" && getProviderModelTokens(providerOf).has(suffixLower));
      if (!governed) {
        return t("addagentCompoundInvalidSuffix", {
          spec,
          suffix: compound.suffix,
          available: [...KNOWN_MODEL_SUFFIXES].sort().join(", "),
        });
      }
      continue;
    }
    const dashIdx = spec.indexOf("-");
    if (dashIdx > 0 && dashIdx < spec.length - 1) {
      const base = spec.slice(0, dashIdx);
      if (!SPECIALIZATIONS.includes(base)) {
        const sug = findClosest(base, SPECIALIZATIONS) || "";
        return t("addagentCompoundInvalidBase", { spec, base, suggestion: sug, available: SPECIALIZATIONS.join(", ") });
      }
      continue;
    }
    if (!SPECIALIZATIONS.includes(spec)) {
      const suggestion = findClosest(spec, SPECIALIZATIONS);
      if (suggestion) {
        return t("addagentSpecDidYouMean", { spec, suggestion, available: SPECIALIZATIONS.join(", ") });
      }
      return t("addagentUnknownSpec", { spec, available: SPECIALIZATIONS.join(", ") });
    }
  }
  return null;
}
