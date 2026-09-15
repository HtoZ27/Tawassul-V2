






import { secureRandom } from "../utils/crypto.ts";
import { logger } from "../utils/logger.ts";
import { normalizeName } from "../utils/name-utils.ts";

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

type CircuitEntry = {
  state: CircuitState;
  
  failureTimes: number[];
  openedAt: number | null;
  resetAt: number | null;
  threshold: number;
  resetMs: number;
  
  successStreak: number;
  
  openCycles: number;
};

const MAX_CIRCUITS = 200;
const MAX_BACKOFF_MS = 60000;

export class CircuitBreaker {
  private circuits: Map<string, CircuitEntry> = new Map();
  private defaultThreshold: number = 3;
  private defaultResetMs: number = 60000;
  private recoveryThreshold: number = 1;
  private emitOpen: ((event: { type: "CIRCUIT_OPEN"; component: string }) => void) | undefined;

  constructor(
    threshold?: number,
    resetMs?: number,
    emitOpen?: (event: { type: "CIRCUIT_OPEN"; component: string }) => void,
    recoveryThreshold?: number,
  ) {
    this.defaultThreshold = threshold ?? 3;
    this.defaultResetMs = resetMs ?? 60000;
    this.recoveryThreshold = recoveryThreshold ?? 1;
    this.emitOpen = emitOpen;
  }

  getState(agent: string): CircuitState {
    const entry = this.circuits.get(normalizeName(agent));
    if (!entry) return "CLOSED";
    return entry.state;
  }

  evaluate(agent: string): CircuitState {
    const entry = this.circuits.get(normalizeName(agent));
    if (!entry) return "CLOSED";

    
    if (entry.state === "OPEN" && entry.resetAt && Date.now() > entry.resetAt) {
      return "HALF_OPEN";
    }

    return entry.state;
  }

  recordFailure(agent: string): void {
    const entry = this.getOrCreate(agent);
    const now = Date.now();

    
    entry.failureTimes = entry.failureTimes.filter((t) => now - t <= entry.resetMs);

    
    if (entry.state === "OPEN" && entry.resetAt && now > entry.resetAt) {
      entry.state = "HALF_OPEN";
      entry.openedAt = null;
      entry.resetAt = null;
      entry.successStreak = 0;
    }

    
    if (entry.state === "HALF_OPEN") {
      entry.state = "OPEN";
      entry.openedAt = now;
      entry.failureTimes = [now];
      this.openWithBackoff(entry, now, agent);
      return;
    }

    entry.failureTimes.push(now);

    
    if (entry.failureTimes.length >= entry.threshold && entry.state !== "OPEN") {
      entry.state = "OPEN";
      entry.openedAt = now;
      this.openWithBackoff(entry, now, agent);
    }
  }

  recordSuccess(agent: string): void {
    const entry = this.circuits.get(normalizeName(agent));
    if (!entry) return;

    entry.successStreak++;
    
    entry.failureTimes = [];

    if (entry.state === "OPEN" || entry.state === "HALF_OPEN") {
      if (entry.successStreak >= this.recoveryThreshold) {
        entry.state = "CLOSED";
        entry.openedAt = null;
        entry.resetAt = null;
        entry.openCycles = 0;
        entry.successStreak = 0;
      }
    }
  }

  reset(agent: string): void {
    this.circuits.delete(normalizeName(agent));
  }

  resetAll(): void {
    this.circuits.clear();
  }

  getAllStates(): { agent: string; state: CircuitState; failureCount: number }[] {
    return [...this.circuits.entries()].map(([agent, entry]) => ({
      agent,
      state: this.evaluate(agent),
      failureCount: entry.failureTimes.length,
    }));
  }

  
  private openWithBackoff(entry: CircuitEntry, now: number, agent: string): void {
    entry.openCycles++;
    const baseBackoff = Math.min(entry.resetMs * Math.pow(1.5, entry.openCycles - 1), MAX_BACKOFF_MS);
    const jitter = baseBackoff * secureRandom();
    entry.resetAt = now + Math.max(0, jitter);
    this.emitOpen?.({ type: "CIRCUIT_OPEN", component: agent });
  }

  private getOrCreate(agent: string): CircuitEntry {
    const key = normalizeName(agent);
    let entry = this.circuits.get(key);
    if (!entry) {
      if (this.circuits.size >= MAX_CIRCUITS) {
        
        
        
        for (const [key, val] of this.circuits) {
          if (val.state === "CLOSED") {
            this.circuits.delete(key);
            logger.warn(`CircuitBreaker: evicted CLOSED circuit for "${key}" (cap ${MAX_CIRCUITS})`);
            break;
          }
        }
        
        if (this.circuits.size >= MAX_CIRCUITS) {
          logger.warn(`CircuitBreaker: all circuits protected — allowing temporary overflow (${this.circuits.size})`);
        }
      }
      entry = {
        state: "CLOSED",
        failureTimes: [],
        openedAt: null,
        resetAt: null,
        threshold: this.defaultThreshold,
        resetMs: this.defaultResetMs,
        successStreak: 0,
        openCycles: 0,
      };
      this.circuits.set(key, entry);
    }
    return entry;
  }
}
