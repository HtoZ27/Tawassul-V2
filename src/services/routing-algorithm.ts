import { matchRole, ALL_KEYWORDS, ROLE_FROM_KEYWORD } from "./stem.ts";
import { fuzzyMatch } from "./fuzzy-match.ts";
import { normalizeName } from "../utils/name-utils.ts";
import {
  SIZE_KEYWORDS,
  COMPLEX_PHRASES_REGEX,
  DETAILED_PHRASES_REGEX,
  ALL_OF_PLURAL_REGEX,
  SAFETY_PATTERNS,
} from "./routing-sizes.ts";
import { buildGuidance } from "./routing-guidance.ts";
import type { Lang } from "../translations.ts";

export type { Lang };

export interface RoutingResult {
  role: string | null;
  size: "small" | "medium" | "complex" | null;
  isDirectRouting: boolean;
  directAgent: string | null;
  warnings: string[];
  guidance: string;
  lang: Lang;
  confidence: number;
  confidenceReason: string;
  action: "auto-record" | "auto-handoff" | "auto-status" | "auto-pause" | "none";
}

export function detectLanguage(_text: string): Lang {
  return "en";
}

export function analyzeMessage(text: string): RoutingResult {
  const lower = text.toLowerCase();
  const warnings: string[] = [];
  const lang = detectLanguage(text);

  const mentionMatch = lower.match(/@(\w[\w-]*)/);
  const directAgent = mentionMatch ? normalizeName(mentionMatch[1] ?? "") || null : null;
  const isDirectRouting = !!directAgent && directAgent !== "tawa";

  let role: string | null = null;
  let matchType: "keyword" | "none" | "fuzzy" | "exact" | null = null;

  const algo = matchRole(text);
  if (algo.role) {
    role = algo.role;
    matchType = algo.matchType;
  }

  if (!role && text.length < 200 && lang === "en") {
    const fuzzy = fuzzyMatch(text, ALL_KEYWORDS, 1);
    if (fuzzy) {
      const r = ROLE_FROM_KEYWORD[fuzzy.matched];
      if (r) {
        role = r;
        matchType = "fuzzy";
      }
    }
  }

  if (!role && directAgent) {
    const knownRoles = ["dev", "tester", "reviewer", "architect", "analyst", "designer", "doc"];
    if (knownRoles.includes(directAgent)) {
      role = directAgent;
      matchType = "exact";
    }
  }

  let size: "small" | "medium" | "complex" | null = null;

  if (COMPLEX_PHRASES_REGEX.test(lower) || DETAILED_PHRASES_REGEX.test(lower) || ALL_OF_PLURAL_REGEX.test(lower)) {
    size = "complex";
  }

  if (!size) {
    const votes: Record<string, number> = { small: 0, medium: 0, complex: 0 };
    for (const [keyword, s] of Object.entries(SIZE_KEYWORDS)) {
      if (lower.includes(keyword)) votes[s] = (votes[s] ?? 0) + 1;
    }
    const best = (Object.entries(votes).sort((a, b) => b[1] - a[1])[0] ?? []) as [string, number];
    if (best[1] > 0) size = best[0] as "small" | "medium" | "complex";
  }

  if (!size) {
    const wordCount = text.split(/\s+/).length;
    size = wordCount < 10 ? "small" : wordCount < 50 ? "medium" : "complex";
  }

  for (const pattern of SAFETY_PATTERNS) {
    if (pattern.test(lower)) {
      warnings.push(`Sensitive content detected: "${pattern.source}".`);
    }
  }

  const { confidence, confidenceReason } = calculateConfidence(role, matchType, isDirectRouting, size, text);
  const action = determineAction(confidence, role, size, isDirectRouting);
  const guidance = buildGuidance(role, size, directAgent, warnings);

  return { role, size, isDirectRouting, directAgent, warnings, guidance, lang, confidence, confidenceReason, action };
}

function calculateConfidence(
  role: string | null,
  matchType: "keyword" | "none" | "fuzzy" | "exact" | null,
  isDirectRouting: boolean,
  size: "small" | "medium" | "complex" | null,
  text: string,
): { confidence: number; confidenceReason: string } {
  if (!role) {
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 3) {
      return { confidence: 0.1, confidenceReason: "Message too short for reliable routing" };
    }
    return { confidence: 0.2, confidenceReason: "No role keywords detected — manual routing needed" };
  }

  if (isDirectRouting) {
    return { confidence: 0.95, confidenceReason: "Direct @mention routing — user explicitly specified agent" };
  }

  let baseConfidence: number;
  let reason: string;

  switch (matchType) {
    case "exact":
      baseConfidence = 0.9;
      reason = "Exact keyword match";
      break;
    case "keyword":
      baseConfidence = 0.8;
      reason = "English keyword match";
      break;
    case "fuzzy":
      baseConfidence = 0.6;
      reason = "Fuzzy match — possible typo correction";
      break;
    default:
      baseConfidence = 0.3;
      reason = "Low confidence match";
  }

  if (size && baseConfidence > 0.5) {
    baseConfidence = Math.min(1.0, baseConfidence + 0.05);
    reason += " + clear size detection";
  }

  return { confidence: baseConfidence, confidenceReason: reason };
}

function determineAction(
  confidence: number,
  role: string | null,
  size: "small" | "medium" | "complex" | null,
  isDirectRouting: boolean,
): RoutingResult["action"] {
  if (confidence >= 0.8 && role && size === "complex" && !isDirectRouting) {
    return "auto-handoff";
  }
  if (confidence >= 0.8 && role) {
    return "auto-record";
  }
  if (confidence >= 0.5) {
    return "auto-status";
  }
  return "none";
}