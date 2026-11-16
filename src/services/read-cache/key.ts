import { createHash } from "node:crypto";
import type { DirStamp, FileStamp } from "../project-index/types.ts";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const body = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",");
  return `{${body}}`;
}

export type CacheKeyInput = {
  tool: string;
  args: unknown;
  projectKey: string;
  files: FileStamp[];
  dirs: DirStamp[];
};

export function computeCacheKey(input: CacheKeyInput): string {
  const files = [...input.files]
    .map((stamp) => ({ path: stamp.path, mtimeMs: stamp.mtimeMs, size: stamp.size }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.mtimeMs - b.mtimeMs || a.size - b.size);
  const dirs = [...input.dirs]
    .map((stamp) => ({ path: stamp.path, mtimeMs: stamp.mtimeMs }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.mtimeMs - b.mtimeMs);
  const payload = canonicalJson({
    tool: input.tool,
    args: input.args,
    projectKey: input.projectKey,
    files,
    dirs,
  });
  return createHash("sha256").update(payload).digest("hex");
}
