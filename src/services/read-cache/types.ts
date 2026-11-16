import type { DirStamp, FileStamp } from "../project-index/types.ts";

export type CacheTool = "depmap" | "batchread";

export type CacheEntry = {
  key: string;
  tool: CacheTool;
  value: unknown;
  bytes: number;
  createdAt: number;
  lastHitAt: number;
  files: FileStamp[];
  dirs: DirStamp[];
};

export type CacheStats = {
  hits: number;
  misses: number;
  bypasses: number;
  evictions: number;
  entries: number;
  bytes: number;
  enabled: boolean;
};

export type CacheDecision =
  | { cacheable: true; key: string }
  | { cacheable: false; reason: string };
