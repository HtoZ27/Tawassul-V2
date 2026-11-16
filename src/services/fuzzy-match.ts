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

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const COMMON_TYPO_ENTRIES = Object.freeze(Object.entries(COMMON_TYPOS));
const COMMON_TYPOS_REGEX = new RegExp(COMMON_TYPO_ENTRIES.map(([typo]) => escapeRegExp(typo)).join("|"), "i");

export const MIN_FUZZY_KEYWORD_LENGTH = 4;

export interface FuzzyMatchResult {
  matched: string;
  type: "exact" | "typo" | "fuzzy";
  confidence: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWord(padded: string, phrase: string): boolean {
  return padded.includes(` ${phrase} `);
}

export function containsWholePhrase(input: string, phrase: string): boolean {
  const normalized = normalizeText(input);
  if (!normalized) return false;
  const target = normalizeText(phrase);
  if (!target) return false;
  return containsWord(` ${normalized} `, target);
}

export function fuzzyMatch(input: string, keywords: string[], maxDistance: number = 1): FuzzyMatchResult | null {
  const normalized = normalizeText(input);
  if (!normalized) return null;
  const padded = ` ${normalized} `;

  for (const kw of keywords) {
    const phrase = normalizeText(kw);
    if (!phrase) continue;
    if (containsWord(padded, phrase)) {
      return { matched: kw, type: "exact", confidence: 1.0 };
    }
  }

  if (COMMON_TYPOS_REGEX.test(normalized)) {
    for (const [typo, correct] of COMMON_TYPO_ENTRIES) {
      if (containsWord(padded, typo) && keywords.some((kw) => normalizeText(kw) === normalizeText(correct))) {
        return { matched: correct, type: "typo", confidence: 0.9 };
      }
    }
  }

  const words = normalized.split(" ").filter((word) => word.length >= MIN_FUZZY_KEYWORD_LENGTH);
  if (words.length === 0 || words.length > 50) return null;

  let bestMatch: FuzzyMatchResult | null = null;
  let bestDistance = maxDistance + 1;

  for (const kw of keywords) {
    const kwLower = normalizeText(kw);
    if (kwLower.length < MIN_FUZZY_KEYWORD_LENGTH) continue;
    for (const word of words) {
      if (Math.abs(word.length - kwLower.length) > maxDistance) continue;
      const dist = levenshtein(word, kwLower, maxDistance);
      if (dist < bestDistance && dist <= maxDistance) {
        bestDistance = dist;
        bestMatch = {
          matched: kw,
          type: "fuzzy",
          confidence: Math.max(0.5, 1.0 - dist * 0.2),
        };
      }
    }
  }

  return bestMatch;
}
