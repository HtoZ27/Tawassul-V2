import { statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { computeTextRelevance, tokenize } from "../../lib/classifier.ts";
import type { ProjectIndexService } from "../project-index/index.ts";
import type { FileStamp } from "../project-index/types.ts";
import {
  MAX_DECLARED_FILES,
  MAX_EDGE_ITEMS,
  MAX_FILE_ITEMS,
  MAX_MISSING_ITEMS,
  MAX_SYMBOL_ITEMS,
} from "./types.ts";
import type { ContextItem } from "./types.ts";

export type FeatureIndexLike = {
  getAll(): Array<{ name: string; description: string; tags: string[]; files: string[] }>;
  getByFile(file: string): Array<{ name: string; description: string; tags: string[]; files: string[] }>;
};

export type PlannerDeps = {
  index: ProjectIndexService;
  featureIndex?: FeatureIndexLike;
};

export type PlannerInput = {
  task: string;
  declaredFiles: string[];
  projectRoot: string;
};

export type PlannerResult = {
  items: ContextItem[];
  missing: string[];
  truncated: boolean;
};

type FileCandidate = {
  abs: string;
  display: string;
  score: number;
  reasons: string[];
  declared: boolean;
};

type ExistingCandidate = {
  candidate: FileCandidate;
  stamp: FileStamp;
};

const MAX_REASONS = 3;
const MAX_REASON_CHARS = 120;

function normalizePath(value: string): string {
  return value
    .split("\\")
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "");
}

function displayFor(projectRoot: string, abs: string, fallback: string): string {
  const rel = normalizePath(relative(projectRoot, abs));
  if (rel.length === 0 || rel === ".." || rel.startsWith("../")) return normalizePath(fallback);
  return rel;
}

function pushCandidate(
  map: Map<string, FileCandidate>,
  abs: string,
  display: string,
  score: number,
  reason: string,
  declared = false,
): void {
  const cleaned = reason.trim().slice(0, MAX_REASON_CHARS);
  if (cleaned.length === 0) return;
  const existing = map.get(abs);
  if (!existing) {
    map.set(abs, { abs, display, score, reasons: [cleaned], declared });
    return;
  }
  existing.score = Math.max(existing.score, score);
  existing.declared = existing.declared || declared;
  if (existing.reasons.length < MAX_REASONS && !existing.reasons.includes(cleaned)) {
    existing.reasons.push(cleaned);
  }
}

function statCandidate(candidate: FileCandidate): FileStamp | null {
  try {
    const stat = statSync(candidate.abs);
    if (!stat.isFile()) return null;
    return { path: candidate.display, mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

export function planTaskContext(input: PlannerInput, deps: PlannerDeps): PlannerResult {
  const snapshot = deps.index.snapshot();
  const baseDir = deps.index.baseDir;
  const projectRoot = input.projectRoot;
  const task = input.task;
  const tokens = [...new Set(tokenize(task))];
  const tokenSet = new Set(tokens);
  const candidates = new Map<string, FileCandidate>();

  for (const raw of input.declaredFiles.slice(0, MAX_DECLARED_FILES)) {
    const normalized = normalizePath(raw);
    if (normalized.length === 0) continue;
    const abs = isAbsolute(raw) ? raw : resolve(projectRoot, normalized);
    pushCandidate(candidates, abs, displayFor(projectRoot, abs, normalized), 1000, "declared in the task text", true);
  }

  const indexByAbs = new Map<string, { rel: string; record: (typeof snapshot.files)[string] }>();
  for (const [rel, record] of Object.entries(snapshot.files)) {
    indexByAbs.set(resolve(baseDir, rel), { rel, record });
    const abs = resolve(baseDir, rel);
    const display = displayFor(projectRoot, abs, rel);
    const pathText = normalizePath(rel).replace(/[/._-]+/g, " ");
    const pathScore = computeTextRelevance(task, pathText);
    if (pathScore > 0) {
      pushCandidate(candidates, abs, display, 20 + Math.round(80 * pathScore), "path terms match the task");
    }
    for (const symbol of record.symbols) {
      const exact = tokenSet.has(symbol.name.toLowerCase());
      const relevance = Math.max(computeTextRelevance(task, symbol.name), exact ? 1 : 0);
      if (relevance <= 0) continue;
      pushCandidate(
        candidates,
        abs,
        display,
        80 + Math.round(120 * relevance),
        `defines "${symbol.name}" named in the task`,
      );
    }
  }

  const features = deps.featureIndex?.getAll() ?? [];
  for (const feature of features) {
    const relevance = computeTextRelevance(task, `${feature.name} ${feature.description}`, feature.tags);
    if (relevance <= 0) continue;
    for (const raw of feature.files) {
      const normalized = normalizePath(raw);
      if (normalized.length === 0) continue;
      const abs = isAbsolute(raw) ? raw : resolve(projectRoot, normalized);
      pushCandidate(
        candidates,
        abs,
        displayFor(projectRoot, abs, normalized),
        100 + Math.round(120 * relevance),
        `feature "${feature.name}" matches the task`,
      );
    }
  }

  for (const candidate of [...candidates.values()]) {
    const matches = deps.featureIndex?.getByFile(candidate.display) ?? [];
    for (const feature of matches) {
      pushCandidate(
        candidates,
        candidate.abs,
        candidate.display,
        Math.max(candidate.score, 40),
        `feature "${feature.name}" covers this file`,
      );
    }
  }

  const matched = [...candidates.values()].filter((candidate) => candidate.declared || candidate.score >= 80);
  for (const candidate of matched) {
    const entry = indexByAbs.get(candidate.abs);
    if (!entry) continue;
    for (const edge of entry.record.imports) {
      if (!edge.to) continue;
      const abs = resolve(baseDir, edge.to);
      pushCandidate(
        candidates,
        abs,
        displayFor(projectRoot, abs, edge.to),
        55,
        `imported by ${candidate.display}`,
      );
    }
    for (const importer of deps.index.dependents(entry.rel)) {
      const abs = resolve(baseDir, importer);
      pushCandidate(
        candidates,
        abs,
        displayFor(projectRoot, abs, importer),
        45,
        `imports ${candidate.display}`,
      );
    }
  }

  const existing: ExistingCandidate[] = [];
  const missing: string[] = [];
  for (const candidate of candidates.values()) {
    const stamp = statCandidate(candidate);
    if (stamp) existing.push({ candidate, stamp });
    else missing.push(candidate.display);
  }
  existing.sort((a, b) => b.candidate.score - a.candidate.score || a.candidate.display.localeCompare(b.candidate.display));

  const files = existing.slice(0, MAX_FILE_ITEMS);
  let truncated = existing.length > files.length;
  const missingUnique = [...new Set(missing)].sort();
  const missingKept = missingUnique.slice(0, MAX_MISSING_ITEMS);
  if (missingUnique.length > missingKept.length) truncated = true;

  const items: ContextItem[] = files.map(({ candidate, stamp }) => ({
    kind: "file",
    path: candidate.display,
    stamp,
    reason: candidate.reasons.join("; "),
    score: candidate.score,
  }));

  const symbolCandidates: Array<Extract<ContextItem, { kind: "symbol" }>> = [];
  const takenByRel = new Map<string, string>();
  for (const entry of files) {
    const indexed = indexByAbs.get(entry.candidate.abs);
    if (indexed) takenByRel.set(indexed.rel, entry.candidate.display);
  }

  for (const { candidate, stamp } of files) {
    const entry = indexByAbs.get(candidate.abs);
    if (!entry) continue;
    const fresh = entry.record.stamp.mtimeMs === stamp.mtimeMs && entry.record.stamp.size === stamp.size;
    if (!fresh) continue;
    for (const symbol of entry.record.symbols) {
      const exact = tokenSet.has(symbol.name.toLowerCase());
      const relevance = Math.max(computeTextRelevance(task, symbol.name), exact ? 1 : 0);
      if (relevance <= 0 && !(candidate.declared && symbol.exported)) continue;
      const score = relevance > 0 ? 50 + Math.round(100 * relevance) : 10;
      const reason = relevance > 0 ? `symbol "${symbol.name}" matches the task` : "exported symbol in the declared file";
      symbolCandidates.push({
        kind: "symbol",
        path: candidate.display,
        name: symbol.name,
        symbolKind: symbol.kind,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        reason,
        score,
      });
    }
  }
  symbolCandidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.path.localeCompare(b.path) ||
      a.name.localeCompare(b.name) ||
      a.startLine - b.startLine,
  );
  const symbols = symbolCandidates.slice(0, MAX_SYMBOL_ITEMS);
  if (symbolCandidates.length > symbols.length) truncated = true;

  const edgeCandidates: Array<Extract<ContextItem, { kind: "edge" }>> = [];
  for (const { candidate, stamp } of files) {
    const entry = indexByAbs.get(candidate.abs);
    if (!entry) continue;
    const fresh = entry.record.stamp.mtimeMs === stamp.mtimeMs && entry.record.stamp.size === stamp.size;
    if (!fresh) continue;
    for (const edge of entry.record.imports) {
      if (!edge.to) continue;
      const target = takenByRel.get(edge.to);
      if (!target) continue;
      edgeCandidates.push({
        kind: "edge",
        from: candidate.display,
        to: target,
        reason: `${candidate.display} imports ${target}`,
        score: 30,
      });
    }
  }
  edgeCandidates.sort((a, b) => b.score - a.score || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const edges = edgeCandidates.slice(0, MAX_EDGE_ITEMS);
  if (edgeCandidates.length > edges.length) truncated = true;

  for (const symbol of symbols) items.push(symbol);
  for (const edge of edges) items.push(edge);

  return { items, missing: missingKept, truncated };
}
