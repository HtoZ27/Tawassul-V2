import type { IndexSnapshot, SymbolKind, SymbolRecord } from "./types.ts";

export type SymbolHit = { path: string; symbol: SymbolRecord };

function normalizePath(path: string): string {
  return path.split("\\").join("/").replace(/^\.\//, "");
}

export function findSymbol(snapshot: IndexSnapshot, name: string, kind?: SymbolKind): SymbolHit[] {
  const hits: SymbolHit[] = [];
  for (const [path, record] of Object.entries(snapshot.files)) {
    for (const symbol of record.symbols) {
      if (symbol.name !== name) continue;
      if (kind && symbol.kind !== kind) continue;
      hits.push({ path, symbol });
    }
  }
  return hits.sort((a, b) => a.path.localeCompare(b.path) || a.symbol.startLine - b.symbol.startLine);
}

export function symbolsInFile(snapshot: IndexSnapshot, path: string): SymbolRecord[] {
  return snapshot.files[normalizePath(path)]?.symbols ?? [];
}

export function dependents(snapshot: IndexSnapshot, path: string): string[] {
  return [...(snapshot.reverse[normalizePath(path)] ?? [])].sort();
}

export function dependentsClosure(snapshot: IndexSnapshot, path: string, maxDepth = 8): string[] {
  const start = normalizePath(path);
  const seen = new Set<string>();
  const result: string[] = [];
  let frontier = [start];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const importer of dependents(snapshot, current)) {
        if (importer === start || seen.has(importer)) continue;
        seen.add(importer);
        result.push(importer);
        next.push(importer);
      }
    }
    frontier = next;
  }
  return result;
}

export function filesByLang(snapshot: IndexSnapshot, lang: string): string[] {
  return Object.entries(snapshot.files)
    .filter(([, record]) => record.lang === lang)
    .map(([path]) => path)
    .sort();
}
