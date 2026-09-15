

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { TimerManagerLike } from "../types/timer-types.ts";
import { isIsolationActiveSync } from "./isolation.ts";

const DEFAULT_SAVE_INTERVAL_MS = 60 * 60 * 1000; 

export class MetricsCollector {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private filePath: string | null = null;
  private _periodicTimer: ReturnType<typeof setInterval> | null = null;
  public readonly initPromise: Promise<void>;
  private static MAX_COUNTERS = 500;
  private static MAX_GAUGES = 500;

  constructor(filePath?: string) {
    if (filePath) {
      this.filePath = filePath;
      
      
      this.initPromise = Promise.resolve();
    } else {
      this.initPromise = Promise.resolve();
    }
  }

  increment(name: string, delta = 1): void {
    if (!this.counters.has(name) && this.counters.size >= MetricsCollector.MAX_COUNTERS) {
      const firstKey = this.counters.keys().next().value;
      if (firstKey) this.counters.delete(firstKey);
    }
    this.counters.set(name, (this.counters.get(name) ?? 0) + delta);
  }

  decrement(name: string, delta = 1): void {
    if (!this.counters.has(name) && this.counters.size >= MetricsCollector.MAX_COUNTERS) {
      const firstKey = this.counters.keys().next().value;
      if (firstKey) this.counters.delete(firstKey);
    }
    this.counters.set(name, (this.counters.get(name) ?? 0) - delta);
  }

  gauge(name: string, value: number): void {
    if (!this.gauges.has(name) && this.gauges.size >= MetricsCollector.MAX_GAUGES) {
      const firstKey = this.gauges.keys().next().value;
      if (firstKey) this.gauges.delete(firstKey);
    }
    this.gauges.set(name, value);
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.counters) out[`counter.${k}`] = v;
    for (const [k, v] of this.gauges) out[`gauge.${k}`] = v;
    return out;
  }

  toJSON(): string {
    return JSON.stringify(this.snapshot());
  }

  loadFromJSON(json: string): void {
    try {
      const data = JSON.parse(json) as Record<string, number>;
      this.counters.clear();
      this.gauges.clear();
      for (const [k, v] of Object.entries(data)) {
        if (k.startsWith("counter.")) this.counters.set(k.slice(8), v);
        else if (k.startsWith("gauge.")) this.gauges.set(k.slice(6), v);
      }
    } catch {
      /* ignore malformed JSON */
    }
  }

  async saveToDisk(): Promise<void> {
    if (!this.filePath) return;
    
    if (isIsolationActiveSync()) return;
    try {
      const dir = dirname(this.filePath);
      await mkdir(dir, { recursive: true });
      await writeFile(this.filePath, this.toJSON());
    } catch {
      /* ignore write errors */
    }
  }

  startPeriodicSave(timers: TimerManagerLike, intervalMs = DEFAULT_SAVE_INTERVAL_MS): void {
    this.stopPeriodicSave(timers);
    this._periodicTimer = timers.setInterval(() => void this.saveToDisk(), intervalMs) as ReturnType<
      typeof setInterval
    >;
  }

  stopPeriodicSave(timers: TimerManagerLike): void {
    if (this._periodicTimer) {
      timers.clear(this._periodicTimer);
      this._periodicTimer = null;
    }
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
  }
}
