import { KeywordTrie } from "../core/nlp.ts";
import englishKeywords from "../data/english-keywords.json" with { type: "json" };

const ENGLISH_KEYWORDS: Record<string, string> = englishKeywords as Record<string, string>;

const keywordTrie = new KeywordTrie();
for (const [word, role] of Object.entries(ENGLISH_KEYWORDS)) {
  keywordTrie.insert(word.toLowerCase(), role);
}

export interface RoleMatch {
  role: string | null;
  matchType: "keyword" | "fuzzy" | "none";
}

export function matchRole(text: string): RoleMatch {
  const lower = text.toLowerCase();

  const kwRole = keywordTrie.findKeyword(lower);
  if (kwRole) return { role: kwRole, matchType: "keyword" };

  return { role: null, matchType: "none" };
}

export const ALL_KEYWORDS = Object.keys(ENGLISH_KEYWORDS);

export const ROLE_FROM_KEYWORD: Record<string, string> = { ...ENGLISH_KEYWORDS };