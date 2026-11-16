

export const BURST_WINDOW_MS = 1000;
export const BURST_MAX = 3;
export const CONCURRENT_MAX = 10;
export const SLIDING_WINDOW_MS = 60000;
export const SLIDING_MAX = 20;
export const BACK_TO_BURST_AFTER_MS = 30000;
export const SAFETY_RELEASE_MS = 60000; 

import { logger } from "../utils/logger.ts";
import type { TimerManagerLike } from "../types/timer-types.ts";

export type AgentRateLimit = {
  burst: { windowMs: number; max: number; calls: number[] };
  concurrent: { max: number; current: number; safetyTimers: Map<string, ReturnType<typeof setTimeout>> };
  
  sliding: { windowMs: number; max: number; tokens: number; lastRefill: number };
  lastViolation: number;
  lastCleanup: number;
  lastActivity: number;
};

export class RateLimiter {
  private agents: Map<string, AgentRateLimit> = new Map();
  
  private activeSlots: Map<string, string[]> = new Map();
  private static MAX_AGENTS = 100;
  private static MAX_ACTIVE_SLOTS = 200;
  private timers: TimerManagerLike | null;

  constructor(timers?: TimerManagerLike) {
    this.timers = timers ?? null;
  }

  
  private refillSliding(limit: AgentRateLimit, now: number): void {
    const dt = now - limit.sliding.lastRefill;
    if (dt > 0) {
      const added = (dt / limit.sliding.windowMs) * limit.sliding.max;
      limit.sliding.tokens = Math.min(limit.sliding.max, limit.sliding.tokens + added);
      limit.sliding.lastRefill = now;
    }
  }

  private gc(limit: AgentRateLimit, now: number): void {
    if (now - limit.lastCleanup > Math.min(limit.burst.windowMs, limit.sliding.windowMs) / 2) {
      limit.burst.calls = limit.burst.calls.filter((t) => now - t < limit.burst.windowMs);
      this.refillSliding(limit, now);
      limit.lastCleanup = now;
    }
    if (this.activeSlots.size > RateLimiter.MAX_ACTIVE_SLOTS) {
      const keys = [...this.activeSlots.keys()];
      const excess = keys.length - RateLimiter.MAX_ACTIVE_SLOTS;
      for (let i = 0; i < excess; i++) this.activeSlots.delete(keys[i]!);
    }
  }

  private cfg(): {
    burstMax: number;
    burstWindowMs: number;
    concurrentMax: number;
    slidingMax: number;
    slidingWindowMs: number;
    backToBurstAfterMs: number;
    safetyReleaseMs: number;
  } {
    return {
      burstMax: this._configOverrides?.burstMax ?? BURST_MAX,
      burstWindowMs: this._configOverrides?.burstWindowMs ?? BURST_WINDOW_MS,
      concurrentMax: this._configOverrides?.concurrentMax ?? CONCURRENT_MAX,
      slidingMax: this._configOverrides?.slidingMax ?? SLIDING_MAX,
      slidingWindowMs: this._configOverrides?.slidingWindowMs ?? SLIDING_WINDOW_MS,
      backToBurstAfterMs: this._configOverrides?.backToBurstAfterMs ?? BACK_TO_BURST_AFTER_MS,
      safetyReleaseMs: this._configOverrides?.safetyReleaseMs ?? SAFETY_RELEASE_MS,
    };
  }

  getOrCreateRateLimit(agent: string): AgentRateLimit {
    const c = this.cfg();
    let limit = this.agents.get(agent);
    if (!limit) {
      if (this.agents.size >= RateLimiter.MAX_AGENTS) {
        
        let lruKey: string | undefined;
        let lruTime = Infinity;
        for (const [k, v] of this.agents) {
          if (v.lastActivity < lruTime) {
            lruTime = v.lastActivity;
            lruKey = k;
          }
        }
        if (lruKey) {
          const evictedLimit = this.agents.get(lruKey);
          if (evictedLimit) {
            for (const timer of evictedLimit.concurrent.safetyTimers.values()) {
              if (this.timers) this.timers.clear(timer);
              else clearTimeout(timer);
            }
            evictedLimit.concurrent.safetyTimers.clear();
          }
          this.agents.delete(lruKey);
          
          
          
          this.activeSlots.delete(lruKey);
        }
      }
      limit = {
        burst: { windowMs: c.burstWindowMs, max: c.burstMax, calls: [] },
        concurrent: { max: c.concurrentMax, current: 0, safetyTimers: new Map() },
        sliding: { windowMs: c.slidingWindowMs, max: c.slidingMax, tokens: c.slidingMax, lastRefill: Date.now() },
        lastViolation: 0,
        lastCleanup: Date.now(),
        lastActivity: Date.now(),
      };
      this.agents.set(agent, limit);
    }
    return limit;
  }

  removeAgent(agent: string): void {
    
    
    
    for (const k of [...this.agents.keys()]) {
      if (k === agent || k.startsWith(`${agent}:`)) {
        const limit = this.agents.get(k)!;
        for (const timer of limit.concurrent.safetyTimers.values()) {
          clearTimeout(timer);
        }
        limit.concurrent.safetyTimers.clear();
        this.agents.delete(k);
      }
    }
    
    
    for (const k of [...this.activeSlots.keys()]) {
      if (k === agent || k.startsWith(`${agent}:`)) {
        this.activeSlots.delete(k);
      }
    }
  }

  checkRateLimit(agent: string, provider: string, model: string): boolean {
    const now = Date.now();
    const key = `${agent}:${provider}:${model}`;
    const limit = this.getOrCreateRateLimit(key);
    this.gc(limit, now);
    limit.lastActivity = now;

    const c = this.cfg();

    
    limit.burst.calls = limit.burst.calls.filter((t) => now - t < limit.burst.windowMs);
    if (limit.burst.calls.length >= limit.burst.max) {
      limit.lastViolation = now; 
      logger.warn(
        `Rate limit (burst) exceeded for ${key}. Active bursts: ${limit.burst.calls.length}/${limit.burst.max}`,
      );
      return false;
    }

    
    if (limit.concurrent.current >= limit.concurrent.max) {
      limit.lastViolation = now; 
      logger.warn(
        `Rate limit (concurrent) exceeded for ${key}. Active concurrent: ${limit.concurrent.current}/${limit.concurrent.max}`,
      );
      return false;
    }

    
    this.refillSliding(limit, now);
    if (limit.sliding.tokens < 1) {
      limit.lastViolation = now; 
      logger.warn(
        `Rate limit (sliding) exceeded for ${key}. Sliding tokens: ${limit.sliding.tokens.toFixed(2)}/${limit.sliding.max}`,
      );
      return false;
    }
    limit.sliding.tokens -= 1;

    limit.burst.calls.push(now);
    limit.concurrent.current++;

    
    
    
    const slots = this.activeSlots.get(key) || [];
    slots.push(key);
    this.activeSlots.set(key, slots);

    const safetyCallback = () => {
      if (limit.concurrent.current > 0) {
        limit.concurrent.current--;
        limit.concurrent.safetyTimers.delete(key);
        
        const currentSlots = this.activeSlots.get(key);
        if (currentSlots) {
          const filtered = currentSlots.filter((k) => k !== key);
          if (filtered.length > 0) {
            this.activeSlots.set(key, filtered);
          } else {
            this.activeSlots.delete(key);
          }
        }
        logger.warn(
          `⚠️ Safety release for ${key} after ${c.safetyReleaseMs}ms timeout. Remaining concurrent: ${limit.concurrent.current}`,
        );
      }
    };
    const safetyTimer = this.timers
      ? this.timers.setTimeout(safetyCallback, c.safetyReleaseMs)
      : (() => {
          const t = setTimeout(safetyCallback, c.safetyReleaseMs);
          if (t?.unref) t.unref();
          return t;
        })();
    limit.concurrent.safetyTimers.set(key, safetyTimer);

    return true;
  }

  releaseConcurrent(agent: string, provider: string, model: string): void {
    
    const key = `${agent}:${provider}:${model}`;
    const slots = this.activeSlots.get(key);
    let targetKey: string;
    if (slots && slots.length > 0) {
      targetKey = slots.shift() as string;
      if (slots.length === 0) this.activeSlots.delete(key);
    } else {
      targetKey = key;
    }
    const limit = this.agents.get(key);
    if (limit && limit.concurrent.current > 0) {
      
      const timer = limit.concurrent.safetyTimers.get(key);
      if (timer) {
        if (this.timers) this.timers.clear(timer);
        else clearTimeout(timer);
        limit.concurrent.safetyTimers.delete(key);
      }
      limit.concurrent.current--;
    } else if (!limit) {
      
      logger.debug(`releaseConcurrent: agent ${targetKey} already evicted, cleaning slot`);
      const remaining = slots?.filter((s) => s !== targetKey);
      if (remaining && remaining.length > 0) {
        this.activeSlots.set(key, remaining);
      } else {
        this.activeSlots.delete(key);
      }
    }
  }

  getStats(
    agent: string,
  ): { burst: number; concurrent: number; sliding: number; lastViolation: number; pendingTimers: number } | null {
    
    let burst = 0,
      concurrent = 0,
      sliding = 0,
      pendingTimers = 0;
    let lastViolation = 0,
      found = false;
    for (const [k, limit] of this.agents) {
      if (k === agent || k.startsWith(`${agent}:`)) {
        found = true;
        burst += limit.burst.calls.length;
        concurrent += limit.concurrent.current;
        sliding += Math.floor(limit.sliding.tokens);
        pendingTimers += limit.concurrent.safetyTimers.size;
        lastViolation = Math.max(lastViolation, limit.lastViolation);
      }
    }
    if (!found) return null;
    return { burst, concurrent, sliding, lastViolation, pendingTimers };
  }

  resetRateLimiters(): void {
    
    for (const [, limit] of this.agents) {
      for (const timer of limit.concurrent.safetyTimers.values()) {
        if (this.timers) this.timers.clear(timer);
        else clearTimeout(timer);
      }
      limit.concurrent.safetyTimers.clear();
    }
    this.agents.clear();
    this.activeSlots.clear();
  }

  applyConfig(cfg?: {
    burstMax?: number;
    burstWindowMs?: number;
    concurrentMax?: number;
    slidingMax?: number;
    slidingWindowMs?: number;
    backToBurstAfterMs?: number;
    safetyReleaseMs?: number;
  }): void {
    if (!cfg) return;
    this._configOverrides = cfg;
    const c = this.cfg();
    for (const [, limit] of this.agents) {
      limit.burst.max = c.burstMax;
      limit.burst.windowMs = c.burstWindowMs;
      limit.concurrent.max = c.concurrentMax;
      limit.sliding.max = c.slidingMax;
      limit.sliding.windowMs = c.slidingWindowMs;
    }
  }

  private _configOverrides?: {
    burstMax?: number;
    burstWindowMs?: number;
    concurrentMax?: number;
    slidingMax?: number;
    slidingWindowMs?: number;
    backToBurstAfterMs?: number;
    safetyReleaseMs?: number;
  };
}
