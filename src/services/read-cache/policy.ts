import type { DirStamp, FileStamp } from "../project-index/types.ts";
import { computeCacheKey } from "./key.ts";
import type { CacheDecision, CacheTool } from "./types.ts";

export const READ_CACHE_KILL_ENV = "TAWASSUL_READ_CACHE";
export const READ_CACHE_MB_ENV = "TAWASSUL_READ_CACHE_MB";
export const DEFAULT_MAX_BYTES = 48 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
export const MAX_STAMPED_PATHS = 256;
export const SOFT_TTL_MS = 10 * 60 * 1000;
export const HARD_TTL_MS = 60 * 60 * 1000;
export const DEPMAP_MAX_FILES = 300;
export const BATCHREAD_MAX_PATHS = 50;

export const NEVER_CACHED = new Set([
  "projectmap",
  "astquery",
  "readsymbol",
  "smartgrep",
  "read",
  "grep",
  "glob",
  "bash",
  "shell",
  "edit",
  "write",
  "apply_patch",
  "codestate",
  "handoff",
  "task_orchestrate",
]);

export function readCacheEnabled(): boolean {
  const raw = process.env[READ_CACHE_KILL_ENV]?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export function readCacheMaxBytes(): number {
  const raw = process.env[READ_CACHE_MB_ENV]?.trim();
  if (!raw) return DEFAULT_MAX_BYTES;
  const mb = Number.parseFloat(raw);
  if (!Number.isFinite(mb) || mb <= 0) return DEFAULT_MAX_BYTES;
  return Math.floor(mb * 1024 * 1024);
}

export function isCacheableTool(name: string): name is CacheTool {
  return name === "depmap" || name === "batchread";
}

export type PolicyInput = {
  tool: CacheTool;
  args: unknown;
  projectKey: string;
  files: FileStamp[];
  dirs: DirStamp[];
  enabled?: boolean;
};

export function evaluatePolicy(input: PolicyInput): CacheDecision {
  const enabled = input.enabled ?? readCacheEnabled();
  if (!enabled) return { cacheable: false, reason: "disabled" };
  const stamped = input.files.length + input.dirs.length;
  if (stamped > MAX_STAMPED_PATHS) return { cacheable: false, reason: "stamp-cap" };
  if (input.tool === "depmap" && input.files.length > DEPMAP_MAX_FILES) {
    return { cacheable: false, reason: "file-cap" };
  }
  if (input.tool === "batchread" && input.files.length > BATCHREAD_MAX_PATHS) {
    return { cacheable: false, reason: "path-cap" };
  }
  return {
    cacheable: true,
    key: computeCacheKey({
      tool: input.tool,
      args: input.args,
      projectKey: input.projectKey,
      files: input.files,
      dirs: input.dirs,
    }),
  };
}
