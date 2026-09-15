import { levenshtein } from "../core/nlp.ts";

const COMMON_TYPOS: Record<string, string> = {
  dsign: "design",
  devlop: "develop",
  implmnt: "implement",
  documnt: "document",
  analys: "analyze",
  eval: "evaluate",
  projct: "project",
  arch: "architecture",
  alg: "algorithm",
  algo: "algorithm",
  algrthm: "algorithm",
  arr: "array",
  tbl: "table",
  sol: "solution",
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COMMON_TYPO_ENTRIES = Object.freeze(Object.entries(COMMON_TYPOS));
const COMMON_TYPOS_REGEX = new RegExp(COMMON_TYPO_ENTRIES.map(([typo]) => escapeRegExp(typo)).join("|"), "i");

export interface FuzzyMatchResult {
  matched: string;
  type: "exact" | "typo" | "fuzzy";
  confidence: number;
}

export function fuzzyMatch(input: string, keywords: string[], maxDistance: number = 1): FuzzyMatchResult | null {
  const lower = input.toLowerCase();

  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) {
      return { matched: kw, type: "exact", confidence: 1.0 };
    }
  }

  if (COMMON_TYPOS_REGEX.test(lower)) {
    for (const [typo, correct] of COMMON_TYPO_ENTRIES) {
      if (lower.includes(typo)) {
        if (keywords.some((kw) => kw.toLowerCase() === correct.toLowerCase())) {
          return { matched: correct, type: "typo", confidence: 0.9 };
        }
      }
    }
  }

  const words = lower.split(/[\s,;.!?]+/).filter((w) => w.length >= 2);
  if (words.length > 50) return null;

  let bestMatch: FuzzyMatchResult | null = null;
  let bestDistance = maxDistance + 1;

  const loweredKeywords = keywords.map((kw) => kw.toLowerCase());

  for (const word of words) {
    for (let ki = 0; ki < loweredKeywords.length; ki++) {
      const kwLower = loweredKeywords[ki]!;
      if (Math.abs(word.length - kwLower.length) > maxDistance) continue;

      const dist = levenshtein(word, kwLower, maxDistance);
      if (dist < bestDistance && dist <= maxDistance) {
        bestDistance = dist;
        bestMatch = {
          matched: keywords[ki]!,
          type: "fuzzy",
          confidence: Math.max(0.5, 1.0 - dist * 0.2),
        };
      }
    }
  }

  return bestMatch;
}
