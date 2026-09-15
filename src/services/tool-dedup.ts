


import type { DedupSignature, DedupResult } from "../context/priority-types.ts";
import { RetentionCache } from "./retention.ts";

const DEFAULT_WINDOW_MS = 30_000;
const MAX_CALLS_PER_WINDOW = 3;
const DEDUP_CACHE_SIZE = 500;
const FUZZY_HASH_PREFIX = 6;
const MIN_FUZZY_HASH_LEN = 8;

const MERGEABLE_TOOLS = new Set(["read", "grep", "glob", "ls", "batchread", "smartgrep"]);
const SKIP_TOOLS = new Set(["bash", "edit", "write", "task"]);


type DedupCacheEntry = { id: string; createdAt: number; calls: DedupSignature[] };

export class ToolDeduplicator {
  private cache: RetentionCache<DedupCacheEntry>;
  private sessionIndex: Map<string, Set<string>> = new Map(); 
  private windowMs: number;
  private maxCallsPerWindow: number;

  readonly metrics = { totalChecks: 0, totalMerged: 0, totalSkipped: 0, totalThrottled: 0, totalFuzzyMatches: 0 };

  constructor(windowMs?: number, maxCalls?: number) {
    this.windowMs = windowMs ?? DEFAULT_WINDOW_MS;
    this.maxCallsPerWindow = maxCalls ?? MAX_CALLS_PER_WINDOW;
    this.cache = new RetentionCache<DedupCacheEntry>({
      maxEntries: DEDUP_CACHE_SIZE,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000, // freshness handled by window filtering below
      cleanupIntervalMs: 0,
      onEvict: (key) => {
        for (const [sid, keys] of this.sessionIndex) {
          keys.delete(key);
          if (keys.size === 0) this.sessionIndex.delete(sid);
        }
      },
    });
  }

  private buildKey(sig: DedupSignature): string {
    return `${sig.sessionId}:${sig.agent}:${sig.tool}`;
  }

  private findAllInSession(sig: DedupSignature): DedupSignature[] {
    const results: DedupSignature[] = [];
    const now = sig.timestamp;
    const sessionKeys = this.sessionIndex.get(sig.sessionId);
    if (!sessionKeys) return results;
    for (const key of sessionKeys) {
      const calls = this.cache.peek(key)?.calls;
      if (!calls) continue;
      for (const c of calls) {
        if (c.tool === sig.tool && c.argsHash === sig.argsHash && now - c.timestamp < this.windowMs) {
          results.push(c);
        }
      }
    }
    results.sort((a, b) => a.timestamp - b.timestamp);
    return results;
  }

  private findFuzzyMatch(sig: DedupSignature): DedupSignature | undefined {
    if (sig.argsHash.length < MIN_FUZZY_HASH_LEN) return undefined;
    const now = sig.timestamp;
    const sigFuzzy = sig.argsHash.slice(0, FUZZY_HASH_PREFIX);
    const sessionKeys = this.sessionIndex.get(sig.sessionId);
    if (!sessionKeys) return undefined;
    for (const key of sessionKeys) {
      const calls = this.cache.peek(key)?.calls;
      if (!calls) continue;
      for (const c of calls) {
        if (c.tool === sig.tool && now - c.timestamp < this.windowMs) {
          const cFuzzy = c.argsHash.slice(0, FUZZY_HASH_PREFIX);
          if (cFuzzy === sigFuzzy && c.argsHash !== sig.argsHash) {
            return c;
          }
        }
      }
    }
    return undefined;
  }

  private store(key: string, calls: DedupSignature[], now: number): void {
    this.cache.put(key, { id: key, createdAt: now, calls }, now);
    const sKeys = this.sessionIndex.get(calls[0]!.sessionId) ?? new Set();
    sKeys.add(key);
    this.sessionIndex.set(calls[0]!.sessionId, sKeys);
  }

  check(sig: DedupSignature): DedupResult {
    this.metrics.totalChecks++;
    const key = this.buildKey(sig);
    const calls = this.cache.get(key)?.calls ?? [];
    const now = sig.timestamp;
    const recent = calls.filter((c) => now - c.timestamp < this.windowMs);

    const duplicates = this.findAllInSession(sig);
    const fuzzyMatch = this.findFuzzyMatch(sig);

    if (duplicates.length === 0 && !fuzzyMatch) {
      recent.push(sig);
      this.store(key, recent, now);
      return { isDuplicate: false, strategy: "pass", reason: "First call" };
    }

    const firstDupe = duplicates[0] ?? undefined;
    const bestMatch = firstDupe ?? fuzzyMatch;

    if (!bestMatch) {
      recent.push(sig);
      this.store(key, recent, now);
      return { isDuplicate: false, strategy: "pass", reason: "First call" };
    }

    if (fuzzyMatch && !firstDupe) {
      this.metrics.totalFuzzyMatches++;
    }

    if (MERGEABLE_TOOLS.has(sig.tool)) {
      this.metrics.totalMerged++;
      return {
        isDuplicate: true,
        strategy: "merge",
        reason: `Mergeable tool ${sig.tool} — reuse cached result from ${bestMatch.agent}`,
        mergeWithId: `${bestMatch.tool}:${bestMatch.argsHash}`,
      };
    }

    if (SKIP_TOOLS.has(sig.tool)) {
      if (duplicates.length >= this.maxCallsPerWindow) {
        this.metrics.totalSkipped++;
        return {
          isDuplicate: true,
          strategy: "skip",
          reason: `Blocked: ${sig.tool} called ${duplicates.length}x within ${this.windowMs / 1000}s window`,
        };
      }
    }

    if (duplicates.length >= this.maxCallsPerWindow) {
      this.metrics.totalThrottled++;
      return {
        isDuplicate: true,
        strategy: "throttle",
        reason: `Throttled: ${sig.tool} rate limit exceeded`,
      };
    }

    recent.push(sig);
    this.store(key, recent, now);
    return { isDuplicate: false, strategy: "pass", reason: "Within rate limit" };
  }

  clear(): void {
    this.cache.clear();
    this.sessionIndex.clear();
  }
}
