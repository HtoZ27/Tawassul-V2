import type { CacheEntry } from "./types.ts";

export class ByteLru {
  private readonly map = new Map<string, CacheEntry>();
  private byteTotal = 0;

  constructor(readonly maxBytes: number) {}

  get bytes(): number {
    return this.byteTotal;
  }

  get size(): number {
    return this.map.size;
  }

  peek(key: string): CacheEntry | undefined {
    return this.map.get(key);
  }

  touch(key: string): CacheEntry | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(entry: CacheEntry): void {
    const previous = this.map.get(entry.key);
    if (previous) {
      this.byteTotal -= previous.bytes;
      this.map.delete(entry.key);
    }
    this.map.set(entry.key, entry);
    this.byteTotal += entry.bytes;
  }

  delete(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.byteTotal -= entry.bytes;
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.byteTotal = 0;
  }

  values(): CacheEntry[] {
    return [...this.map.values()];
  }
}
