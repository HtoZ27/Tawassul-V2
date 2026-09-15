



import { readFileSync } from "node:fs";
import type { EventHub } from "./event-hub.ts";
import type { TimerManagerLike } from "../types/timer-types.ts";
import { logger } from "../utils/logger.ts";


export const MIN_FREE_SYSTEM_MEMORY_MB = 1500;


export const LOW_SYSTEM_HYSTERESIS_MB = 500;


export const EMERGENCY_TERMINATION_MS = 5000;


export interface MemoryReading {
  rssMB: number;
  memAvailableMB: number | null;
}

export type MemoryProbe = () => MemoryReading;

export function defaultProbe(): MemoryReading {
  let rssMB = 0;
  let memAvailableMB: number | null = null;
  try {
    rssMB = process.memoryUsage().rss / 1024 / 1024;
  } catch {
    /* rss not available */
  }
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf8");
    const m = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo);
    if (m) memAvailableMB = Number(m[1]) / 1024;
  } catch {
    /* /proc/meminfo not available (non-linux) */
  }
  return { rssMB, memAvailableMB };
}


export class PauseGate {
  private blocked = false;

  block(): void {
    this.blocked = true;
  }

  unblock(): void {
    this.blocked = false;
  }

  isBlocked(): boolean {
    return this.blocked;
  }
}

export class MemoryWatchdog {
  private thresholdMB: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private eventHub: EventHub | null;
  private timers: TimerManagerLike | null;
  private probe: MemoryProbe;
  private terminate: () => void;
  private terminationTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastCheck = 0;
  private _lastUsageMB = 0;
  private _lastMemAvailableMB: number | null = null;

  
  readonly gate = new PauseGate();

  constructor(
    thresholdMB: number = 512,
    eventHub?: EventHub,
    timers?: TimerManagerLike,
    probe: MemoryProbe = defaultProbe,
    terminate: () => void = () => {
      
      
      if (typeof process !== "undefined" && process.env.VITEST) return;
      process.kill(process.pid, "SIGTERM");
    },
  ) {
    this.thresholdMB = thresholdMB;
    this.eventHub = eventHub ?? null;
    this.timers = timers ?? null;
    this.probe = probe;
    this.terminate = terminate;
  }

  start(signal?: AbortSignal): void {
    if (this.interval) return;
    
    
    
    
    if (typeof process !== "undefined" && process.env.VITEST) {
      logger.debug("MemoryWatchdog: not started under VITEST (unit tests drive tiers via probes)");
      return;
    }
    const fn = () => {
      if (signal?.aborted) {
        this.stop();
        return;
      }
      this.evaluate();
    };
    this.interval = this.timers
      ? this.timers.setInterval(fn, 10000)
      : (() => {
          const t = setInterval(fn, 10000);
          if (t?.unref) t.unref();
          return t;
        })();
    signal?.addEventListener("abort", () => this.stop(), { once: true });
  }

  private emit(e: Parameters<EventHub["emit"]>[0]): void {
    this.eventHub?.emit(e);
  }

  private scheduleTermination(): void {
    if (this.terminationTimer) return;
    const run = () => {
      this.terminationTimer = null;
      this.terminate();
    };
    if (this.timers) {
      this.terminationTimer = this.timers.setTimeout(run, EMERGENCY_TERMINATION_MS);
    } else {
      const t = setTimeout(run, EMERGENCY_TERMINATION_MS);
      t?.unref?.();
      this.terminationTimer = t;
    }
  }

  private cancelTermination(): void {
    if (this.terminationTimer) {
      if (this.timers) this.timers.clear(this.terminationTimer);
      else clearTimeout(this.terminationTimer);
      this.terminationTimer = null;
    }
  }

  private evaluate(): void {
    try {
      const { rssMB, memAvailableMB } = this.probe();
      this._lastCheck = Date.now();
      this._lastUsageMB = rssMB;
      this._lastMemAvailableMB = memAvailableMB;
      const limit = this.thresholdMB;
      const lowSystem = memAvailableMB != null && memAvailableMB < MIN_FREE_SYSTEM_MEMORY_MB;
      const breached = rssMB > limit;
      const heavy = rssMB > limit * 1.5;
      const emergency = rssMB > limit * 2;
      
      
      
      const systemHealthy =
        memAvailableMB == null || memAvailableMB >= MIN_FREE_SYSTEM_MEMORY_MB + LOW_SYSTEM_HYSTERESIS_MB;
      const shouldBlock = heavy || lowSystem;
      const shouldUnblock = !shouldBlock && !breached && systemHealthy;

      if (breached || lowSystem) {
        
        this.emit({
          type: "PERFORMANCE_DEGRADED",
          agent: "system",
          metric: "rssMemoryMB",
          value: rssMB,
        });
        this.emit({
          type: "CACHE_CLEANUP_REQUESTED",
          agent: "system",
          metric: "rssMemoryMB",
          value: rssMB,
        });
        if (shouldBlock) {
          this.gate.block();
        }
        if (emergency) {
          this.emit({
            type: "MEMORY_EMERGENCY",
            agent: "system",
            metric: "rssMemoryMB",
            value: rssMB,
            thresholdMB: this.thresholdMB,
          });
          this.scheduleTermination();
        } else {
          this.cancelTermination();
        }
      } else if (shouldUnblock) {
        
        
        this.gate.unblock();
        this.cancelTermination();
        this.emit({
          type: "MEMORY_RECOVERED",
          agent: "system",
          metric: "rssMemoryMB",
          value: rssMB,
        });
      } else {
        
        
        this.cancelTermination();
      }

      if (typeof globalThis.gc === "function" && process.env.TAWASSUL_EAGER_GC === "1") {
        try {
          globalThis.gc();
        } catch {
          /* gc not available */
        }
      }
    } catch {
      // memory check not available
    }
  }

  getStatus(): {
    running: boolean;
    lastCheck: number;
    lastUsageMB: number;
    thresholdMB: number;
    lastMemAvailableMB: number | null;
    heavyToolsBlocked: boolean;
    terminationPending: boolean;
  } {
    return {
      running: this.interval !== null,
      lastCheck: this._lastCheck,
      lastUsageMB: this._lastUsageMB,
      thresholdMB: this.thresholdMB,
      lastMemAvailableMB: this._lastMemAvailableMB,
      heavyToolsBlocked: this.gate.isBlocked(),
      terminationPending: this.terminationTimer !== null,
    };
  }

  stop(): void {
    if (this.interval) {
      if (this.timers) this.timers.clear(this.interval);
      else clearInterval(this.interval);
      this.interval = null;
    }
    this.cancelTermination();
  }
}
