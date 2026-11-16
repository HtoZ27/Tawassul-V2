



import { normalizeArabic, stemRoot } from "../core/nlp.ts";
import { SPECIALIZATIONS } from "../services/specializations.ts";
import { normalizeName } from "../utils/name-utils.ts";


export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .replace(/\s+/g, " ")
    .replace(/[^\w\s\u0600-\u06FF\u0660-\u0669\u00C0-\u024F]/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
}


export function computeTextRelevance(query: string, text: string, tags: string[] = []): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;

  const docTokens = tokenize(text);
  const allDocTerms = new Set([...docTokens, ...tags.map((t) => t.toLowerCase())]);
  if (allDocTerms.size === 0) return 0;

  
  const docNorms = new Map<string, string>();
  const docRoots = new Map<string, string>();
  for (const dt of allDocTerms) {
    const dNorm = normalizeArabic(dt);
    docNorms.set(dt, dNorm);
    docRoots.set(dt, stemRoot(dNorm));
  }
  
  let matches = 0;
  for (const qt of queryTokens) {
    const qNorm = normalizeArabic(qt);
    const qRoot = stemRoot(qNorm);
    for (const dt of allDocTerms) {
      const dNorm = docNorms.get(dt)!;
      const dRoot = docRoots.get(dt)!;
      if (qRoot === dRoot && qRoot.length > 2) {
        matches++;
        break;
      }
      if (qNorm === dNorm) {
        matches++;
        break;
      }
    }
  }

  
  
  const tf = matches / queryTokens.length;

  
  const docLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const phraseBoost = docLower.includes(queryLower) ? 0.2 : 0;

  return Math.min(1, tf + phraseBoost);
}






interface SpecKeywordEntry {
  n: string; 
  r: string; 
}

interface IdfCache {
  total: number;
  counts: Map<string, number>;
  rootsBySpec: Map<string, SpecKeywordEntry[]>;
  normalizedBySpec: Map<string, string[]>;
}





let _idfCache: IdfCache | null = null;

function getIdfCache(): IdfCache {
  if (_idfCache) return _idfCache;
  const total = Object.keys(SPECIALIZATIONS).length;
  const counts = new Map<string, number>();
  const rootsBySpec = new Map<string, SpecKeywordEntry[]>();
  const normalizedBySpec = new Map<string, string[]>();
  for (const [spec, def] of Object.entries(SPECIALIZATIONS)) {
    const entries: SpecKeywordEntry[] = [];
    const normalizedList: string[] = [];
    const seenTerms = new Set<string>();
    for (const keyword of def.keywords) {
      const n = normalizeArabic(keyword);
      const r = stemRoot(n);
      entries.push({ n, r });
      normalizedList.push(n);
      if (!seenTerms.has(r)) {
        seenTerms.add(r);
        counts.set(r, (counts.get(r) || 0) + 1);
      }
    }
    rootsBySpec.set(spec, entries);
    normalizedBySpec.set(spec, normalizedList);
  }
  _idfCache = { total, counts, rootsBySpec, normalizedBySpec };
  return _idfCache;
}

function computeTfIdfScore(
  textTokens: string[],
  textRoots: string[],
  specEntries: SpecKeywordEntry[],
  totalSpecCount: number,
  specTermCounts: Map<string, number>,
): number {
  let tf = 0;
  const matchedTerms = new Set<string>();

  
  const textJoined = textTokens.join(" ");

  for (const { n, r } of specEntries) {
    let matched = false;
    if (textJoined.includes(n)) {
      matched = true;
    } else {
      for (const root of textRoots) {
        if (root === r && root.length > 2) {
          matched = true;
          break;
        }
      }
    }

    if (matched && !matchedTerms.has(r)) {
      matchedTerms.add(r);
      tf += 1;
    }
  }

  
  const normalizedTf = specEntries.length > 0 ? tf / specEntries.length : 0;

  
  let totalIdf = 0;
  for (const term of matchedTerms) {
    const docsWithTerm = specTermCounts.get(term) || 1;
    totalIdf += Math.log(totalSpecCount / docsWithTerm);
  }
  const avgIdf = matchedTerms.size > 0 ? totalIdf / matchedTerms.size : 0;

  return normalizedTf * avgIdf;
}

export function classifyText(text: string, agent?: string): string[] {
  if (!text.trim()) return [];

  const normalized = normalizeArabic(text);
  const tokens = tokenize(normalized);
  const roots = tokens.map((t) => stemRoot(t)).filter(Boolean);

  
  const cache = getIdfCache();

  
  const scores: [string, number][] = [];
  for (const [spec] of Object.entries(SPECIALIZATIONS)) {
    const score = computeTfIdfScore(tokens, roots, cache.rootsBySpec.get(spec)!, cache.total, cache.counts);
    if (score > 0) scores.push([spec, score]);
  }

  
  if (scores.length === 0 && agent) {
    const agentClean = normalizeArabic(normalizeName(agent));
    for (const [spec, def] of Object.entries(SPECIALIZATIONS)) {
      for (const kwNormalized of cache.normalizedBySpec.get(spec) ?? def.keywords.map((k) => normalizeArabic(k))) {
        if (agentClean.includes(kwNormalized) || kwNormalized.includes(agentClean)) {
          scores.push([spec, 1]);
          break;
        }
      }
    }
  }

  return scores.sort((a, b) => b[1] - a[1]).map(([spec]) => spec);
}
