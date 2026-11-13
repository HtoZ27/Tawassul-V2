
import { resetTaskCallCount } from "../services/plan-guard.ts";
import { logger } from "../utils/logger.ts";
import { normalizeName } from "../utils/name-utils.ts";
import type { TimerManagerLike } from "../types/timer-types.ts";
import {
  MIN_RING_PROMPT,
  RING_CAP,
  RING_TTL_MS,
  resolveRouting,
  type PromptRingEntry,
  type RoutingMode,
  type RoutingRecord,
} from "./routing.ts";

interface TawaCallRecord {
  caller: string;
  tool: string;
  fields: string[];
  blocked: boolean;
  timestamp: number;
}

export class PipelineState {
  readonly callDepth = new Map<string, number>();
  readonly totalTaskCalls = new Map<string, number>();
  readonly dispatchChain = new Map<string, string[]>();

  private readonly _tawaCallers = new Map<string, TawaCallRecord[]>();
  private readonly _agentResponded = new Map<string, boolean>();
  private readonly _concurrentLocks = new Map<string, number>();
  readonly pendingAgentLocks = new Map<string, Set<string>>();
  readonly sessionExemptCalls = new Map<string, number>();
  private readonly _budgetAdvisories = new Set<string>();
  readonly routing = new Map<string, RoutingRecord>();
  readonly promptRing: PromptRingEntry[] = [];
  private timers: TimerManagerLike | null = null;

  private readonly MAX_TAWA_CALLERS_PER_SESSION = 200;
  private readonly LOCK_TTL_MS = 5 * 60 * 1000;
  private readonly MAX_SESSIONS = 50;
  private readonly EVICT_BATCH = 10;
  readonly MAX_EXEMPT_CALLS = 20;

  private _autoSweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(timers?: TimerManagerLike) {
    this.timers = timers ?? null;
  }

  
  getTawaCallers(sessionId: string): TawaCallRecord[] {
    return this._tawaCallers.get(sessionId) ?? [];
  }

  resetTawaCallers(): void {
    this._tawaCallers.clear();
  }

  recordTawaCallEntry(sessionId: string, record: TawaCallRecord): void {
    const records = this._tawaCallers.get(sessionId) ?? [];
    if (records.length >= this.MAX_TAWA_CALLERS_PER_SESSION)
      records.splice(0, records.length - this.MAX_TAWA_CALLERS_PER_SESSION + 1);
    records.push(record);
    this._tawaCallers.set(sessionId, records);
  }

  
  private agentKey(sessionId: string, agent: string): string {
    return JSON.stringify([sessionId, normalizeName(agent)]);
  }
  private isKeyForSession(key: string, sessionId: string): boolean {
    try {
      const arr = JSON.parse(key) as [string, string];
      return Array.isArray(arr) && arr[0] === sessionId;
    } catch {
      return key.startsWith(`${sessionId}:`) || key === sessionId;
    }
  }
  markAgentResponded(sessionId: string, agent: string): void {
    this._agentResponded.set(this.agentKey(sessionId, agent), true);
  }

  hasAgentResponded(sessionId: string, agent: string): boolean {
    return this._agentResponded.get(this.agentKey(sessionId, agent)) === true;
  }

  resetAgentResponded(sessionId: string): void {
    for (const k of this._agentResponded.keys()) {
      if (this.isKeyForSession(k, sessionId)) this._agentResponded.delete(k);
    }
  }

  
  acquireAgentLock(sessionId: string, agent: string): boolean {
    const now = Date.now();
    
    
    
    const key = this.agentKey(sessionId, agent);
    const existing = this._concurrentLocks.get(key);
    if (existing !== undefined) {
      if (existing > now) return false;
      
      this._concurrentLocks.delete(key);
    }
    this._concurrentLocks.set(key, now + this.LOCK_TTL_MS);
    if (!this.pendingAgentLocks.has(sessionId)) this.pendingAgentLocks.set(sessionId, new Set());
    this.pendingAgentLocks.get(sessionId)!.add(normalizeName(agent));
    return true;
  }

  releaseAgentLock(sessionId: string, agent: string): void {
    this._concurrentLocks.delete(this.agentKey(sessionId, agent));
    const pending = this.pendingAgentLocks.get(sessionId);
    if (pending) {
      pending.delete(normalizeName(agent));
      if (pending.size === 0) this.pendingAgentLocks.delete(sessionId);
    }
  }

  
  getExemptCallCount(sessionId: string): number {
    return this.sessionExemptCalls.get(sessionId) ?? 0;
  }

  incrementExemptCalls(sessionId: string): number {
    const count = (this.sessionExemptCalls.get(sessionId) ?? 0) + 1;
    this.sessionExemptCalls.set(sessionId, count);
    return count;
  }

  resetSessionExemptCalls(sessionId: string): void {
    this.sessionExemptCalls.delete(sessionId);
  }

  markBudgetAdvisory(sessionId: string): boolean {
    if (this._budgetAdvisories.has(sessionId)) return false;
    this._budgetAdvisories.add(sessionId);
    return true;
  }

  resetBudgetAdvisory(sessionId: string): void {
    this._budgetAdvisories.delete(sessionId);
  }

  recordUserMessage(sessionId: string, content: string, directAgent: string | null = null): RoutingRecord {
    const now = Date.now();
    this.purgePromptRing(now);
    const record = resolveRouting(sessionId, content, {
      existing: this.routing.get(sessionId),
      directAgent,
      ring: this.promptRing,
      now,
    });
    this.routing.set(sessionId, record);
    return record;
  }

  recordDispatchPrompt(sessionId: string, prompt: string, mode: RoutingMode): void {
    const now = Date.now();
    this.purgePromptRing(now);
    if (prompt.trim().length < MIN_RING_PROMPT) return;
    this.promptRing.push({ dispatcherSessionID: sessionId, prompt, mode, at: now });
    const overflow = this.promptRing.length - RING_CAP;
    if (overflow <= 0) return;
    const dropped = this.promptRing.splice(0, overflow);
    logger.warn(`[routing] prompt ring evicted ${dropped.length} live entry(ies) at the ${RING_CAP}-entry bound`);
  }

  purgePromptRing(now = Date.now()): number {
    const before = this.promptRing.length;
    for (let i = this.promptRing.length - 1; i >= 0; i -= 1) {
      const entry = this.promptRing[i];
      if (!entry || now - entry.at > RING_TTL_MS) this.promptRing.splice(i, 1);
    }
    return before - this.promptRing.length;
  }

  recordOverridePreference(sessionId: string, agent: string): RoutingRecord {
    const existing = this.routing.get(sessionId);
    const record: RoutingRecord = {
      mode: existing?.mode ?? "normal",
      directAgent: existing?.directAgent ?? null,
      preferredAgent: agent,
      source: "override",
      latched: existing?.latched ?? false,
    };
    this.routing.set(sessionId, record);
    return record;
  }

  
  resetCallDepth(sessionId: string): void {
    this.callDepth.delete(sessionId);
    this.totalTaskCalls.delete(sessionId);
    this.dispatchChain.delete(sessionId);
    this.resetAgentResponded(sessionId);
    for (const key of [...this._concurrentLocks.keys()]) {
      if (this.isKeyForSession(key, sessionId)) this._concurrentLocks.delete(key);
    }
    this.pendingAgentLocks.delete(sessionId);
    this.resetSessionExemptCalls(sessionId);
    this.resetBudgetAdvisory(sessionId);
    resetTaskCallCount(sessionId);
  }

  private _lastSweepStaleSessions = 0;
  private readonly SWEEP_SESSION_INTERVAL_MS = 60_000;

  sweepStaleSessions(activeSessionId?: string): void {
    const now = Date.now();
    if (now - this._lastSweepStaleSessions < this.SWEEP_SESSION_INTERVAL_MS) return;
    this._lastSweepStaleSessions = now;
    
    
    
    
    
    const staleSessions = new Set<string>();
    const addSid = (key: string) => {
      try {
        const arr = JSON.parse(key) as [string, string];
        if (Array.isArray(arr) && typeof arr[0] === "string") {
          staleSessions.add(arr[0]);
          return;
        }
      } catch {
        void 0;
      }
      const sid = key.split(":")[0];
      if (sid) staleSessions.add(sid);
    };
    for (const k of this._agentResponded.keys()) addSid(k);
    for (const k of this.callDepth.keys()) addSid(k);
    for (const k of this.totalTaskCalls.keys()) addSid(k);
    for (const k of this.dispatchChain.keys()) addSid(k);
    for (const k of this._concurrentLocks.keys()) addSid(k);
    for (const k of this._tawaCallers.keys()) addSid(k);
    for (const k of this.sessionExemptCalls.keys()) addSid(k);
    for (const k of this._budgetAdvisories) addSid(k);
    for (const k of this.routing.keys()) addSid(k);
    if (staleSessions.size <= this.MAX_SESSIONS) return;

    const toEvict = Math.min(staleSessions.size - this.MAX_SESSIONS + this.EVICT_BATCH, staleSessions.size);
    let evicted = 0;
    for (const sessionId of staleSessions) {
      if (evicted >= toEvict) break;
      if (sessionId === activeSessionId) continue;
      this.callDepth.delete(sessionId);
      this.totalTaskCalls.delete(sessionId);
      this.dispatchChain.delete(sessionId);
      this._tawaCallers.delete(sessionId);
      for (const key of [...this._concurrentLocks.keys()]) {
        if (this.isKeyForSession(key, sessionId)) this._concurrentLocks.delete(key);
      }
      this.pendingAgentLocks.delete(sessionId);
      this.resetAgentResponded(sessionId);
      this.resetSessionExemptCalls(sessionId);
      this.resetBudgetAdvisory(sessionId);
      this.routing.delete(sessionId);
      for (let i = this.promptRing.length - 1; i >= 0; i -= 1) {
        if (this.promptRing[i]?.dispatcherSessionID === sessionId) this.promptRing.splice(i, 1);
      }
      resetTaskCallCount(sessionId);
      evicted++;
    }
  }

  
  initAutoSweep(signal?: AbortSignal): void {
    if (this._autoSweepTimer) return;
    const AUTO_SWEEP_INTERVAL_MS = 300_000;
    const fn = () => {
      if (signal?.aborted) {
        this.stopAutoSweep();
        return;
      }
      try {
        this.sweepStaleSessions();
      } catch (e) {
        logger.warn("[tawassul] auto-sweep failed:", e);
      }
    };
    this._autoSweepTimer = this.timers
      ? this.timers.setInterval(fn, AUTO_SWEEP_INTERVAL_MS)
      : (() => {
          const t = setInterval(fn, AUTO_SWEEP_INTERVAL_MS);
          if (t?.unref) t.unref();
          return t;
        })();
    signal?.addEventListener("abort", () => this.stopAutoSweep(), { once: true });
  }

  stopAutoSweep(): void {
    if (this._autoSweepTimer) {
      if (this.timers) this.timers.clear(this._autoSweepTimer);
      else clearInterval(this._autoSweepTimer);
      this._autoSweepTimer = null;
    }
  }

  
  resetAll(): void {
    this.stopAutoSweep();
    this.callDepth.clear();
    this.totalTaskCalls.clear();
    this.dispatchChain.clear();
    this._agentResponded.clear();
    this._concurrentLocks.clear();
    this.pendingAgentLocks.clear();
    this._tawaCallers.clear();
    this.sessionExemptCalls.clear();
    this._budgetAdvisories.clear();
    this.routing.clear();
    this.promptRing.length = 0;
  }
}




