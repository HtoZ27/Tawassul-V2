import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { logger } from "../../utils/logger.ts";
import { projectStatePath } from "../../utils/state-paths.ts";
import type { DirStamp, FileRecord, FileStamp, IndexSnapshot } from "./types.ts";

export const INDEX_SUBDIR = "project-index";
export const SNAPSHOT_FILE = "snapshot.json";
export const MAX_INDEX_BYTES = 24 * 1024 * 1024;

export function snapshotPath(baseDir: string): string {
  return projectStatePath(baseDir, `${INDEX_SUBDIR}/${SNAPSHOT_FILE}`);
}

export function emptySnapshot(projectKey: string, projectRoot: string): IndexSnapshot {
  const snapshot: IndexSnapshot = {
    schemaVersion: 1,
    projectKey,
    projectRoot,
    revision: "",
    generatedAt: Date.now(),
    files: {},
    dirs: {},
    reverse: {},
    stats: { files: 0, symbols: 0, edges: 0, bytes: 0 },
  };
  snapshot.revision = revisionOf(snapshot);
  return snapshot;
}

export function revisionOf(snapshot: IndexSnapshot): string {
  const files = Object.values(snapshot.files)
    .map((record) => `${record.stamp.path}:${record.stamp.mtimeMs}:${record.stamp.size}`)
    .sort();
  const dirs = Object.values(snapshot.dirs)
    .map((stamp) => `${stamp.path}:${stamp.mtimeMs}`)
    .sort();
  return createHash("sha256").update(JSON.stringify({ files, dirs })).digest("hex");
}

export function refreshSnapshot(snapshot: IndexSnapshot): IndexSnapshot {
  let symbols = 0;
  let edges = 0;
  for (const record of Object.values(snapshot.files)) {
    symbols += record.symbols.length;
    edges += record.imports.length;
  }
  snapshot.stats.files = Object.keys(snapshot.files).length;
  snapshot.stats.symbols = symbols;
  snapshot.stats.edges = edges;
  snapshot.revision = revisionOf(snapshot);
  return snapshot;
}

function isStamp(value: unknown): value is FileStamp {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const stamp = value as Record<string, unknown>;
  return (
    typeof stamp.path === "string" &&
    typeof stamp.mtimeMs === "number" &&
    Number.isFinite(stamp.mtimeMs) &&
    typeof stamp.size === "number" &&
    Number.isFinite(stamp.size)
  );
}

function isRecord(value: unknown): value is FileRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    isStamp(record.stamp) &&
    typeof record.lang === "string" &&
    typeof record.lines === "number" &&
    typeof record.hash === "string" &&
    Array.isArray(record.symbols) &&
    Array.isArray(record.imports)
  );
}

function isDirStamp(value: unknown): value is DirStamp {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const stamp = value as Record<string, unknown>;
  return typeof stamp.path === "string" && typeof stamp.mtimeMs === "number" && Number.isFinite(stamp.mtimeMs);
}

function sanitizeReverse(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const reverse: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(entry)) continue;
    const importers = entry.filter((item): item is string => typeof item === "string");
    if (importers.length > 0) reverse[key] = [...new Set(importers)].sort();
  }
  return reverse;
}

export function loadSnapshot(baseDir: string, projectKey: string, projectRoot: string): IndexSnapshot {
  const file = snapshotPath(baseDir);
  if (!existsSync(file)) return emptySnapshot(projectKey, projectRoot);
  try {
    if (statSync(file).size > MAX_INDEX_BYTES) return emptySnapshot(projectKey, projectRoot);
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptySnapshot(projectKey, projectRoot);
    const raw = parsed as Record<string, unknown>;
    if (raw.schemaVersion !== 1 || raw.projectKey !== projectKey) return emptySnapshot(projectKey, projectRoot);
    const files: Record<string, FileRecord> = {};
    if (raw.files && typeof raw.files === "object" && !Array.isArray(raw.files)) {
      for (const [path, record] of Object.entries(raw.files as Record<string, unknown>)) {
        if (!isRecord(record)) continue;
        if (record.stamp.path !== path) record.stamp.path = path;
        files[path] = record;
      }
    }
    const dirs: Record<string, DirStamp> = {};
    if (raw.dirs && typeof raw.dirs === "object" && !Array.isArray(raw.dirs)) {
      for (const [path, stamp] of Object.entries(raw.dirs as Record<string, unknown>)) {
        if (!isDirStamp(stamp)) continue;
        if (stamp.path !== path) stamp.path = path;
        dirs[path] = stamp;
      }
    }
    const snapshot: IndexSnapshot = {
      schemaVersion: 1,
      projectKey,
      projectRoot: typeof raw.projectRoot === "string" ? raw.projectRoot : projectRoot,
      revision: typeof raw.revision === "string" ? raw.revision : "",
      generatedAt: typeof raw.generatedAt === "number" ? raw.generatedAt : Date.now(),
      files,
      dirs,
      reverse: sanitizeReverse(raw.reverse),
      stats: { files: 0, symbols: 0, edges: 0, bytes: 0 },
    };
    return refreshSnapshot(snapshot);
  } catch {
    return emptySnapshot(projectKey, projectRoot);
  }
}

export function saveSnapshot(baseDir: string, snapshot: IndexSnapshot): boolean {
  const file = snapshotPath(baseDir);
  refreshSnapshot(snapshot);
  snapshot.generatedAt = Date.now();
  const probe = JSON.stringify({ ...snapshot, stats: { ...snapshot.stats, bytes: 0 } });
  const bytes = Buffer.byteLength(probe);
  if (bytes > MAX_INDEX_BYTES) return false;
  snapshot.stats.bytes = bytes;
  const text = JSON.stringify(snapshot);
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, file);
    return true;
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {}
    logger.warn("[tawassul] project index write failed:", e);
    return false;
  }
}

export function resolveIndexPath(baseDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(baseDir, path);
}
