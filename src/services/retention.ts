export interface RetentionConfig {
  maxEntries: number;
  maxAgeMs: number;
  cleanupIntervalMs: number;
  
  onEvict?: (key: string) => void;
}

export function withRetention<T extends { timestamp?: string; createdAt?: number }>(
  entries: T[],
  config: RetentionConfig,
): T[] {
  const now = Date.now();
  const ageCutoff = now - config.maxAgeMs;
  return entries
    .filter((e) => {
      const ts = e.timestamp ? new Date(e.timestamp).getTime() : (e.createdAt ?? now);
      return ts >= ageCutoff;
    })
    .slice(-config.maxEntries);
}


export class RetentionCache<T> {
  private entries = new Map<string, { value: T; ts: number }>();

  constructor(private config: RetentionConfig) {}

  private ageOf(ts: number): boolean {
    return Date.now() - ts <= this.config.maxAgeMs;
  }

  private evictStale(): void {
    const now = Date.now();
    const cutoff = now - this.config.maxAgeMs;
    for (const [key, entry] of this.entries) {
      if (entry.ts < cutoff) {
        this.entries.delete(key);
        this.config.onEvict?.(key);
      }
    }
  }

  
  put(key: string, value: T, ts: number = Date.now()): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, { value, ts });
    this.evictStale();
    while (this.entries.size > this.config.maxEntries) {
      
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.config.onEvict?.(oldest);
    }
  }

  
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (!this.ageOf(entry.ts)) {
      this.entries.delete(key);
      this.config.onEvict?.(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  has(key: string): boolean {
    const entry = this.entries.get(key);
    return entry !== undefined && this.ageOf(entry.ts);
  }

  
  peek(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (!this.ageOf(entry.ts)) {
      this.entries.delete(key);
      this.config.onEvict?.(key);
      return undefined;
    }
    return entry.value;
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  size(): number {
    return this.entries.size;
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  values(): T[] {
    return [...this.entries.values()].map((e) => e.value);
  }

  clear(): void {
    this.entries.clear();
  }
}

export function buildAutoCleanupPlan<T extends { id: string; status?: string; timestamp?: string; createdAt?: number }>(
  entries: T[],
  staleAgeMs: number,
): string[] {
  const now = Date.now();
  return entries
    .filter((e) => {
      if (e.status === "completed" || e.status === "cancelled" || e.status === "failed") {
        const ts = e.timestamp ? new Date(e.timestamp).getTime() : (e.createdAt ?? now);
        return now - ts > staleAgeMs;
      }
      return false;
    })
    .map((e) => e.id);
}

export const DEFAULT_RETENTION: RetentionConfig = {
  maxEntries: 1000,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  cleanupIntervalMs: 60 * 60 * 1000,
};
