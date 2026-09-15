import { ALL_AGENTS } from "../agent-templates.ts";
import { AGENTS_DEFAULT } from "../context/constants.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { MODEL_ALIASES, MODEL_ID_TO_SUFFIX } from "../services/proxy-models.ts";
import { expandAllSuffixToken, stripLeadingVerb } from "./agent-add-helpers.ts";
import type { TawassulContext } from "../context.ts";
import { t } from "../translations.ts";

export const KICK_EXAMPLE_KEYS = ["kickExample1", "kickExample2", "kickExample3", "kickExample4"] as const;
export function kickExamplesText(): string {
  return KICK_EXAMPLE_KEYS.map((k) => t(k)).join("\n");
}
export function kickHelpText(): string {
  return t("kickHelp") + "\n" + kickExamplesText();
}

export type KickResult = {
  removed: string[];
  alreadyDeleted: string[];
  protected_: string[];
  notFound: string[];
};

export function parseKickInput(input: string): string[] | null {
  const WILDCARD = new Set(["*", "all"]);
  input = stripLeadingVerb(input);
  const mEn = input.match(/^([@\w\s*/\-.\u0600-\u06FF]+?)\s+with\s+model\s+(.+?)\s+from\s+([\w\s.-]+)$/i);
  if (mEn) {
    let specs = mEn[1]!
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((s) => normalizeName(s));
    const modelRawEn = mEn[2]!.trim().replace(/\s+/g, "-").toLowerCase();
    const providerEn = mEn[3]!.trim().replace(/\s+/g, "-").toLowerCase();
    const aliasEn = MODEL_ALIASES[modelRawEn] ?? null;
    const fullEn = aliasEn ?? (modelRawEn.includes("/") ? modelRawEn : `${providerEn}/${modelRawEn}`);
    const suffixEn = MODEL_ID_TO_SUFFIX[fullEn] ?? fullEn.split("/").pop() ?? modelRawEn;
    if (specs.length === 1) {
      const first = specs[0]!;
      if (WILDCARD.has(first.toLowerCase())) {
        specs = ALL_AGENTS.filter((a) => a.name !== "tawa").map((a) => normalizeName(`${a.name}-${suffixEn}`));
      } else {
        const tagged = expandAllSuffixToken(
          first,
          ALL_AGENTS.map((a) => a.name),
        );
        if (tagged) specs = tagged.map((n) => normalizeName(n));
      }
    }
    return specs;
  }
  return null;
}

export function isProtected(ctx: TawassulContext, tag: string): boolean {
  const normalized = normalizeName(tag);
  if ((ctx.config.team ?? []).includes(normalized)) return true;
  if ((AGENTS_DEFAULT as readonly string[]).some((a) => normalizeName(a) === normalized)) return true;
  return false;
}

export function classifyRemove(ctx: TawassulContext, spec: string): "removed" | "not-found" | "protected" {
  const tag = `@${spec}`;
  const normalized = normalizeName(spec);
  if (isProtected(ctx, tag)) return "protected";
  if (ctx.dynamicAgents.includes(normalized)) return "removed";
  if (ctx.agentManager.hasConfigAgent(normalized)) return "removed";
  return "not-found";
}