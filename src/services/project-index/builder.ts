import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { getAstService } from "../ast-service.ts";
import type { FileRecord, FileStamp, ImportEdge, IndexSnapshot, SymbolKind, SymbolRecord } from "./types.ts";

const IMPORT_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const INDEX_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx"];

const KIND_MAP: Record<string, SymbolKind> = {
  function_declaration: "function",
  function: "function",
  class_declaration: "class",
  class: "class",
  interface_declaration: "interface",
  interface: "interface",
  type_alias_declaration: "type",
  type: "type",
  enum_declaration: "enum",
  enum: "enum",
  method_definition: "method",
  method: "method",
  lexical_declaration: "variable",
  variable_declaration: "variable",
  variable: "variable",
};

export function relativeIndexPath(baseDir: string, absPath: string): string {
  const rel = relative(baseDir, absPath);
  return (rel.length > 0 ? rel : ".").split(sep).join("/");
}

export function absoluteIndexPath(baseDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(baseDir, path);
}

export function languageFor(path: string): string {
  const ext = extname(path).toLowerCase();
  return ext.length > 1 ? ext.slice(1) : "text";
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split("\n").length;
}

export function shellRecord(stamp: FileStamp): FileRecord {
  return {
    stamp,
    lang: languageFor(stamp.path),
    lines: 0,
    hash: "",
    symbols: [],
    imports: [],
  };
}

function normalizeStamp(baseDir: string, stamp: FileStamp): FileStamp {
  return {
    path: relativeIndexPath(baseDir, stamp.path),
    mtimeMs: stamp.mtimeMs,
    size: stamp.size,
  };
}

function normalizeDir(baseDir: string, stamp: { path: string; mtimeMs: number }): { path: string; mtimeMs: number } {
  return { path: relativeIndexPath(baseDir, stamp.path), mtimeMs: stamp.mtimeMs };
}

function unlinkReverse(snapshot: IndexSnapshot, record: FileRecord): void {
  for (const edge of record.imports) {
    if (!edge.to) continue;
    const importers = snapshot.reverse[edge.to];
    if (!importers) continue;
    const next = importers.filter((item) => item !== record.stamp.path);
    if (next.length > 0) snapshot.reverse[edge.to] = next;
    else delete snapshot.reverse[edge.to];
  }
}

function linkReverse(snapshot: IndexSnapshot, record: FileRecord): void {
  for (const edge of record.imports) {
    if (!edge.to) continue;
    const importers = snapshot.reverse[edge.to] ?? [];
    if (!importers.includes(record.stamp.path)) importers.push(record.stamp.path);
    snapshot.reverse[edge.to] = [...new Set(importers)].sort();
  }
}

function mapSymbols(content: string, structure: { symbols: Array<{ name: string; kind: string; startLine: number; endLine: number }> } | null): SymbolRecord[] {
  if (!structure) return [];
  const lines = content.split("\n");
  const symbols: SymbolRecord[] = [];
  for (const symbol of structure.symbols) {
    const kind = KIND_MAP[symbol.kind];
    if (!kind) continue;
    const line = lines[symbol.startLine] ?? "";
    symbols.push({
      name: symbol.name,
      kind,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      exported: /\bexport\b/.test(line),
    });
  }
  return symbols;
}

function resolveImportTarget(baseDir: string, fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const candidate = resolve(dirname(fromFile), specifier);
  for (const ext of IMPORT_EXTENSIONS) {
    const path = candidate + ext;
    try {
      if (statSync(path).isFile()) return relativeIndexPath(baseDir, path);
    } catch {}
  }
  for (const ext of INDEX_EXTENSIONS) {
    const path = resolve(candidate, `index${ext}`);
    try {
      if (statSync(path).isFile()) return relativeIndexPath(baseDir, path);
    } catch {}
  }
  return null;
}

function mapImports(
  baseDir: string,
  fromFile: string,
  imports: Array<{ source: string }>,
): ImportEdge[] {
  const from = relativeIndexPath(baseDir, fromFile);
  const seen = new Set<string>();
  const edges: ImportEdge[] = [];
  for (const item of imports) {
    const to = resolveImportTarget(baseDir, fromFile, item.source);
    const key = `${item.source}|${to ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, specifier: item.source, to });
  }
  return edges;
}

export function applyTree(
  snapshot: IndexSnapshot,
  baseDir: string,
  files: FileStamp[],
  dirs: Array<{ path: string; mtimeMs: number }>,
): boolean {
  let changed = false;
  for (const dir of dirs) {
    const stamp = normalizeDir(baseDir, dir);
    const current = snapshot.dirs[stamp.path];
    if (current && current.mtimeMs === stamp.mtimeMs) continue;
    snapshot.dirs[stamp.path] = stamp;
    changed = true;
  }
  for (const file of files) {
    const stamp = normalizeStamp(baseDir, file);
    const current = snapshot.files[stamp.path];
    if (current && current.stamp.mtimeMs === stamp.mtimeMs && current.stamp.size === stamp.size) continue;
    if (current) unlinkReverse(snapshot, current);
    snapshot.files[stamp.path] = shellRecord(stamp);
    changed = true;
  }
  return changed;
}

export type ApplyFileResult = { record: FileRecord; changed: boolean; parsed: boolean };

export async function applyFile(
  snapshot: IndexSnapshot,
  baseDir: string,
  absPath: string,
): Promise<ApplyFileResult | null> {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(absPath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const stamp = normalizeStamp(baseDir, { path: absPath, mtimeMs: stat.mtimeMs, size: stat.size });
  const current = snapshot.files[stamp.path];
  if (current && current.stamp.mtimeMs === stamp.mtimeMs && current.stamp.size === stamp.size && current.hash.length > 0) {
    return { record: current, changed: false, parsed: false };
  }
  let content: string;
  try {
    content = readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  const structure = await getAstService().getStructure(absPath, content);
  const record: FileRecord = {
    stamp,
    lang: languageFor(absPath),
    lines: countLines(content),
    hash: hashContent(content),
    symbols: mapSymbols(content, structure),
    imports: mapImports(baseDir, absPath, structure?.imports ?? []),
  };
  if (current) unlinkReverse(snapshot, current);
  snapshot.files[stamp.path] = record;
  linkReverse(snapshot, record);
  return { record, changed: true, parsed: true };
}

export function applyImports(
  snapshot: IndexSnapshot,
  baseDir: string,
  absPath: string,
  edges: ImportEdge[],
): boolean {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(absPath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const stamp = normalizeStamp(baseDir, { path: absPath, mtimeMs: stat.mtimeMs, size: stat.size });
  const current = snapshot.files[stamp.path];
  const changedStamp = !current || current.stamp.mtimeMs !== stamp.mtimeMs || current.stamp.size !== stamp.size;
  const from = relativeIndexPath(baseDir, absPath);
  const seen = new Set<string>();
  const normalized: ImportEdge[] = [];
  for (const edge of edges) {
    const to = edge.to ? relativeIndexPath(baseDir, edge.to) : null;
    const key = `${edge.specifier}|${to ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ from, specifier: edge.specifier, to });
  }
  if (current) unlinkReverse(snapshot, current);
  const record = changedStamp || !current ? shellRecord(stamp) : current;
  record.stamp = stamp;
  record.imports = normalized;
  if (changedStamp) {
    record.symbols = [];
    record.hash = "";
    record.lines = 0;
  }
  snapshot.files[stamp.path] = record;
  linkReverse(snapshot, record);
  return true;
}

export function applyStamps(snapshot: IndexSnapshot, baseDir: string, paths: string[]): boolean {
  let changed = false;
  for (const absPath of paths) {
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(absPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const stamp = normalizeStamp(baseDir, { path: absPath, mtimeMs: stat.mtimeMs, size: stat.size });
    const current = snapshot.files[stamp.path];
    if (current && current.stamp.mtimeMs === stamp.mtimeMs && current.stamp.size === stamp.size) continue;
    if (current) unlinkReverse(snapshot, current);
    snapshot.files[stamp.path] = shellRecord(stamp);
    changed = true;
  }
  return changed;
}
