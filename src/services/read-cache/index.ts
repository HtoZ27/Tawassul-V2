import { statSync } from "node:fs";
import type { DirStamp, FileStamp } from "../project-index/types.ts";
import { ByteLru } from "./lru.ts";
import { HARD_TTL_MS, MAX_ENTRY_BYTES, SOFT_TTL_MS, evaluatePolicy, readCacheEnabled, readCacheMaxBytes } from "./policy.ts";
import type { CacheEntry, CacheStats, CacheTool } from "./types.ts";

export type ReadCacheOptions = {
  projectKey: string;
  enabled?: boolean;
  maxBytes?: number;
};

export type ComputeInput<T> = {
  tool: CacheTool;
  args: unknown;
  files: FileStamp[];
  dirs: DirStamp[];
  compute: () => T | Promise<T>;
};

export type ComputeResult<T> = { value: T; cached: boolean };

export class ReadCacheService {
  readonly projectKey: string;
  private readonly enabledFlag: boolean;
  private readonly lru: ByteLru;
  private hits = 0;
  private misses = 0;
  private bypasses = 0;
  private evictions = 0;

  constructor(options: ReadCacheOptions) {
    this.projectKey = options.projectKey;
    this.enabledFlag = options.enabled ?? readCacheEnabled();
    this.lru = new ByteLru(options.maxBytes ?? readCacheMaxBytes());
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  get bytes(): number {
    return this.lru.bytes;
  }

  stats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      bypasses: this.bypasses,
      evictions: this.evictions,
      entries: this.lru.size,
      bytes: this.lru.bytes,
      enabled: this.enabledFlag,
    };
  }

  evictAll(): number {
    const removed = this.lru.size;
    this.lru.clear();
    return removed;
  }

  async getOrCompute<T>(input: ComputeInput<T>): Promise<ComputeResult<T>> {
    if (!this.enabledFlag) {
      this.bypasses += 1;
      return { value: await input.compute(), cached: false };
    }
    const decision = evaluatePolicy({
      tool: input.tool,
      args: input.args,
      projectKey: this.projectKey,
      files: input.files,
      dirs: input.dirs,
      enabled: this.enabledFlag,
    });
    if (!decision.cacheable) {
      this.bypasses += 1;
      return { value: await input.compute(), cached: false };
    }
    const entry = this.lru.peek(decision.key);
    if (entry && this.validate(entry)) {
      entry.lastHitAt = Date.now();
      this.lru.touch(decision.key);
      this.hits += 1;
      return { value: entry.value as T, cached: true };
    }
    if (entry) this.lru.delete(decision.key);
    this.misses += 1;
    const value = await input.compute();
    const encoded = JSON.stringify(value);
    const bytes = encoded === undefined ? 0 : Buffer.byteLength(encoded);
    if (bytes <= MAX_ENTRY_BYTES) {
      const now = Date.now();
      this.lru.set({
        key: decision.key,
        tool: input.tool,
        value,
        bytes,
        createdAt: now,
        lastHitAt: now,
        files: input.files.map((stamp) => ({ ...stamp })),
        dirs: input.dirs.map((stamp) => ({ ...stamp })),
      });
      this.cleanup();
    }
    return { value, cached: false };
  }

  private validate(entry: CacheEntry): boolean {
    for (const stamp of entry.files) {
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(stamp.path);
      } catch {
        return false;
      }
      if (!stat.isFile() || stat.mtimeMs !== stamp.mtimeMs || stat.size !== stamp.size) return false;
    }
    for (const stamp of entry.dirs) {
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(stamp.path);
      } catch {
        return false;
      }
      if (!stat.isDirectory() || stat.mtimeMs !== stamp.mtimeMs) return false;
    }
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const entry of this.lru.values()) {
      if (now - entry.createdAt > HARD_TTL_MS) {
        this.lru.delete(entry.key);
        this.evictions += 1;
      }
    }
    if (this.lru.bytes <= this.lru.maxBytes) return;
    for (const entry of this.lru.values()) {
      if (this.lru.bytes <= this.lru.maxBytes) break;
      if (now - entry.lastHitAt > SOFT_TTL_MS) {
        this.lru.delete(entry.key);
        this.evictions += 1;
      }
    }
    for (const entry of this.lru.values()) {
      if (this.lru.bytes <= this.lru.maxBytes) break;
      this.lru.delete(entry.key);
      this.evictions += 1;
    }
  }
}
