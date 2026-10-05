

import { logger } from "../utils/logger.ts";



const DEBUG = process.env.TAWASSUL_DEBUG === "1";
const DLQ_MAX_RETRIES = 3;
const DLQ_MAX_SIZE = 1000;
const DLQ_TTL_MS = 5 * 60 * 1000; 
const EMIT_AND_WAIT_TIMEOUT_MS = 5000;
const MAX_PENDING_MICROTASKS = 1000;

import type { TimerManagerLike } from "../types/timer-types.ts";
import type { ChainCtx, ReflectionFact } from "./chain-ctx.ts";





export type DlqEntry = {
  eventName: string;
  data: unknown;
  error: string;
  timestamp: number;
  retryCount: number;
  listenerId: symbol;
};

export type TawassulEvent =
  | { type: "PLUGIN_READY" }
  | { type: "AGENT_FAILED"; agent: string; reason: string }
  | { type: "AGENT_SUCCESS"; agent: string; outputLength?: number; durationMs?: number }
  | { type: "TASK_STARTED"; agent: string; taskId: string }
  | { type: "TASK_COMPLETED"; agent: string; taskId: string; durationMs?: number }
  | { type: "AGENT_STUCK"; agent: string; reason: string }
  | { type: "AGENT_RECOVERED"; agent: string }
  | { type: "AGENT_AUTO_PAUSED"; agent: string; reason: string }
  | { type: "CIRCUIT_OPEN"; component: string }
  | { type: "CIRCUIT_CLOSED"; component: string }
  | { type: "DISCUSSION_STARTED"; discussionId: string }
  | { type: "DISCUSSION_VOTE_CAST"; discussionId: string; vote: string }
  | { type: "DISCUSSION_RESOLVED"; discussionId: string; resolution: string }
  | { type: "PERFORMANCE_DEGRADED"; agent: string; metric: string; value: number }
  | { type: "STATE_SAVING"; payload: { type?: string } }
  | { type: "STATE_SAVED"; payload: { type?: string } }
  | { type: "STATE_SAVE_FAILED"; payload: { error: unknown; type?: string } }
  | { type: "STATE_LOCK_LOST"; payload: { type?: string } }
  | {
      type: "SAVE_CONFLICT_DETECTED";
      payload: {
        attempt: number;
        sessionId: string;
        baseRevision: number;
        currentRevision: number;
        outcome: "conflict" | "rebased" | "exhausted";
      };
    }
  | { type: "CRITICAL_ERROR"; data: unknown }
  | { type: "EVALUATION_RECORDED"; featureId: string; reportId: string; issueCount: number }
  | { type: "ISSUE_RESOLVED"; featureId: string; issueId: string; resolvedBy: string }
  | { type: "MEMORY_EMERGENCY"; agent: string; metric: string; value: number; thresholdMB: number }
  | { type: "MEMORY_RECOVERED"; agent: string; metric: string; value: number }
  | { type: "CACHE_CLEANUP_REQUESTED"; agent: string; metric: string; value: number }
  | { type: "TASK_DECOMPOSED"; taskId: string; subtaskCount: number }
  | { type: "SUBTASK_STARTED"; subtaskId: string; agent: string }
  | { type: "SUBTASK_COMPLETED"; subtaskId: string; agent: string; status: string }
  | { type: "EXECUTION_FINISHED"; taskId: string; status: string; chain?: ChainCtx }
  | { type: "RESULTS_COLLECTED"; taskId: string; resultCount: number }
  | { type: "REPORT_MERGED"; reportId: string; qualityScore: number }
  | { type: "FAILURE_ANALYZED"; taskId: string; rootCause: string; category: string }
  | { type: "HEAL_ATTEMPTED"; taskId: string; success: boolean; redirectTo?: string }
  | { type: "ROLLBACK_EXECUTED"; sessionId: string; reason?: string }
  | { type: "CHECKPOINT_CREATED"; taskId: string; snapshotId: string }
  | { type: "CHECKPOINT_RESTORED"; snapshotId: string }
  | { type: "BOARD_CREATED"; boardId: string; name: string }
  | { type: "TASK_STATUS_CHANGED"; boardId: string; taskId: string; from: string; to: string; sessionId?: string }
  | { type: "TASK_BLOCKED"; boardId: string; taskId: string; reason: string }
  | { type: "CONSENT_EXPIRED"; sessionID: string; tool: string; key: string }
  // P0.6 — frame-only events (payloads filled in by their P1-P3 consumers)
  | {
      type: "ELICITATION_RESOLVED";
      chainId: string;
      taskId: string;
      ambiguityScore: number;
      selectedOption: string;
      requestedBy: string;
      chain?: ChainCtx;
    }
  | {
      type: "RECEIPT_SIGNED";
      chainId: string;
      handoffId: string;
      acceptanceCriteria: string[];
      acknowledgedBy: string;
      at: string;
      chain?: ChainCtx;
    }
  | { type: "CHAIN_REFLECTED"; chainId: string; taskId: string; facts: ReflectionFact[]; chain?: ChainCtx }
  | {
      type: "QUORUM_RESOLVED";
      chainId: string;
      discussionId: string;
      winner: string;
      quorumReached: boolean;
      adrId: string;
      chain?: ChainCtx;
    }
  // P2.1 — ToolOutputBoundary: critical tool output quarantined (not injected)
  | { type: "TOOL_OUTPUT_QUARANTINED"; tool: string; agent: string; patterns: string[]; snippet: string };


export type EventPayloadByType = {
  [E in TawassulEvent as E["type"]]: Omit<E, "type">;
};

export type DefaultEventMap = EventPayloadByType;






interface ListenerEntry {
  
  id: symbol;
  
  callback: (...args: unknown[]) => void | Promise<void>;
  
  priority: number;
  
  once: boolean;
  
  original: (...args: unknown[]) => void | Promise<void>;
}

const WILDCARD = "*";
const DEFAULT_MAX_LISTENERS = 50;






export class EventHub<T extends Record<string, unknown> = DefaultEventMap> {
  
  private _maxListeners = DEFAULT_MAX_LISTENERS;

  
  get maxListeners(): number {
    return this._maxListeners;
  }

  set maxListeners(value: number) {
    this._maxListeners = value;
  }

  
  
  private listeners = new Map<string, ListenerEntry[]>();

  
  private _pendingEmits = 0;
  
  private _backlog: Array<{ type: string; data: unknown; results: Array<Promise<void>> }> = [];
  
  private _slotWaiters: Array<() => void> = [];

  
  private _deadLetterQueue: DlqEntry[] = [];
  private _drainTimer: ReturnType<typeof setInterval> | null = null;
  private _timers: TimerManagerLike | null;
  private _metrics: { increment: (name: string, delta?: number) => void } | null;

  constructor(timers?: TimerManagerLike, metrics?: { increment: (name: string, delta?: number) => void }) {
    this._timers = timers ?? null;
    this._metrics = metrics ?? null;
  }

  
  startDlqDrain(intervalMs = 60_000): void {
    if (this._drainTimer) return;
    if (this._timers) {
      this._drainTimer = this._timers.setInterval(() => this._drainExpired(), intervalMs);
    } else {
      this._drainTimer = setInterval(() => this._drainExpired(), intervalMs);
      if (this._drainTimer?.unref) this._drainTimer.unref();
    }
  }

  stopDlqDrain(): void {
    if (this._drainTimer) {
      if (this._timers) this._timers.clear(this._drainTimer);
      else clearInterval(this._drainTimer);
      this._drainTimer = null;
    }
  }

  
  private _ensureDlqDrainStarted(): void {
    if (!this._drainTimer) this.startDlqDrain();
  }

  private _drainExpired(): void {
    const now = Date.now();
    const entries = this._deadLetterQueue;
    const before = entries.length;
    this._deadLetterQueue = entries.filter((e) => now - e.timestamp < DLQ_TTL_MS);
    const removed = before - this._deadLetterQueue.length;
    if (removed > 0 && DEBUG) {
      logger.debug(`DLQ auto-drain: removed ${removed} expired entries`);
    }
    
    
    if (this._deadLetterQueue.length > 0) {
      void this.retryDlq().catch((e) => logger.error("DLQ periodic retry failed:", e));
    }
    if (this._deadLetterQueue.length >= DLQ_MAX_SIZE * 0.8) {
      logger.warn(
        `EventHub DLQ at ${this._deadLetterQueue.length}/${DLQ_MAX_SIZE} — persistent listener failures or sustained back-pressure`,
      );
    }
  }

  
  
  on<K extends keyof T>(event: K & string, callback: (payload: T[K]) => void | Promise<void>, priority?: number): void;
  
  on(event: string, callback: (event: TawassulEvent) => void | Promise<void>, priority?: number): void;
  
  on(
    event: typeof WILDCARD,
    callback: (eventName: string, data: unknown) => void | Promise<void>,
    priority?: number,
  ): void;
  
  on(event: string, callback: (...args: any[]) => void | Promise<void>, priority = 0): void {
    this._addListener(event, callback as (...args: unknown[]) => void | Promise<void>, false, priority);
  }

  
  
  once<K extends keyof T>(
    event: K & string,
    callback: (payload: T[K]) => void | Promise<void>,
    priority?: number,
  ): void;
  once(event: string, callback: (event: TawassulEvent) => void | Promise<void>, priority?: number): void;
  once(
    event: typeof WILDCARD,
    callback: (eventName: string, data: unknown) => void | Promise<void>,
    priority?: number,
  ): void;
  
  once(event: string, callback: (...args: any[]) => void | Promise<void>, priority = 0): void {
    this._addListener(event, callback as (...args: unknown[]) => void | Promise<void>, true, priority);
  }

  
  
  emit<K extends keyof T>(event: K & string, payload: T[K]): void;
  
  emit(event: TawassulEvent): void;
  emit(eventOrName: string | TawassulEvent, payload?: unknown): void {
    let type: string;
    let data: unknown;

    if (typeof eventOrName === "string") {
      
      type = eventOrName;
      data = payload ?? {};
    } else {
      
      type = eventOrName.type;
      data = eventOrName;
    }

    const results: Array<Promise<void>> = [];

    
    this._fireListeners(type, data, results);

    
    if (type !== WILDCARD) {
      this._fireListeners(WILDCARD, data, results, type);
    }

    if (DEBUG) logger.debug(`Event emitted: ${type}`);

    
    
    if (results.length > 0) {
      if (this._pendingEmits < MAX_PENDING_MICROTASKS) {
        this._dispatchBatch(results);
      } else if (this._backlog.length < MAX_PENDING_MICROTASKS) {
        this._backlog.push({ type, data, results });
      } else {
        this._dropToDlq(type, data, results, "back-pressure drop (queue full)");
      }
    }
  }

  
  private _dispatchBatch(results: Array<Promise<void>>): void {
    this._pendingEmits++;
    queueMicrotask(() => {
      Promise.allSettled(results)
        .catch((e) => logger.error(`Unhandled async error:`, e))
        .finally(() => {
          this._pendingEmits--;
          this._drainBacklog();
        });
    });
  }

  
  private _drainBacklog(): void {
    while (this._pendingEmits < MAX_PENDING_MICROTASKS && this._backlog.length > 0) {
      const next = this._backlog.shift();
      if (!next) break;
      this._dispatchBatch(next.results);
    }
    while (this._slotWaiters.length > 0 && this._pendingEmits < MAX_PENDING_MICROTASKS) {
      this._slotWaiters.shift()?.();
    }
  }

  
  private _dropToDlq(type: string, data: unknown, results: Array<Promise<void>>, reason: string): void {
    this._metrics?.increment("eventhub.backpressure.drop");
    logger.warn(`EventHub back-pressure: dropped ${results.length} async listener(s) for "${type}"`);
    for (let i = 0; i < results.length; i++) {
      this._deadLetterQueue.push({
        eventName: type,
        data,
        error: reason,
        timestamp: Date.now(),
        retryCount: 0,
        listenerId: Symbol("dropped"),
      });
    }
    if (this._deadLetterQueue.length > DLQ_MAX_SIZE)
      this._deadLetterQueue.splice(0, this._deadLetterQueue.length - DLQ_MAX_SIZE);
  }

  
  async emitAndWait<K extends keyof T>(event: K & string, payload: T[K], timeoutMs?: number): Promise<void>;
  async emitAndWait(event: TawassulEvent, timeoutMs?: number): Promise<void>;
  async emitAndWait(eventOrName: string | TawassulEvent, payload?: unknown, timeoutMs?: number): Promise<void> {
    let type: string;
    let data: unknown;

    if (typeof eventOrName === "string") {
      type = eventOrName;
      data = payload ?? {};
    } else {
      type = eventOrName.type;
      data = eventOrName;
    }

    const results: Array<Promise<void>> = [];

    this._fireListeners(type, data, results);

    if (type !== WILDCARD) {
      this._fireListeners(WILDCARD, data, results, type);
    }

    if (results.length > 0) {
      const slotDeadline = Date.now() + (timeoutMs ?? EMIT_AND_WAIT_TIMEOUT_MS);
      while (this._pendingEmits >= MAX_PENDING_MICROTASKS) {
        if (Date.now() >= slotDeadline) {
          logger.warn("[tawassul] emitAndWait slot wait timed out — dropping emit (stuck listener?)");
          this._metrics?.increment("eventhub.slotwait.timeout");
          return;
        }
        await new Promise<void>((resolve) => {
          this._slotWaiters.push(resolve);
          const timer = setTimeout(
            () => {
              const idx = this._slotWaiters.indexOf(resolve);
              if (idx !== -1) this._slotWaiters.splice(idx, 1);
              resolve();
            },
            Math.max(0, slotDeadline - Date.now()),
          );
          queueMicrotask(() => {
            if (this._pendingEmits < MAX_PENDING_MICROTASKS) {
              const idx = this._slotWaiters.indexOf(resolve);
              if (idx !== -1) this._slotWaiters.splice(idx, 1);
              clearTimeout(timer);
              resolve();
            }
          });
        });
      }
      this._pendingEmits++;
      try {
        const effectiveTimeout = timeoutMs ?? EMIT_AND_WAIT_TIMEOUT_MS;
        const abortController = new AbortController();
        const allDone = Promise.allSettled(results);
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        
        
        
        
        
        
        let timedOut = false;
        const timedOutPromise = new Promise<void>((resolve) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            abortController.abort();
            resolve();
          }, effectiveTimeout);
          timeoutId?.unref?.();
        });
        try {
          await Promise.race([allDone, timedOutPromise]);
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
        if (timedOut) {
          logger.warn(
            `EventHub emitAndWait("${type}") timed out after ${effectiveTimeout}ms — ${results.length} listener(s) may not have completed`,
          );
          this._metrics?.increment("eventhub.emitwait.timeout");
        }
        abortController.abort();
      } finally {
        this._pendingEmits--;
        this._drainBacklog();
      }
    }
  }

  
  
  off(event: string, callback: (...args: unknown[]) => void | Promise<void>): void {
    this._removeListener(event, callback);
  }

  
  
  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  
  
  listenerCount(event?: string): number {
    if (!event) {
      let count = 0;
      for (const list of this.listeners.values()) {
        count += list.length;
      }
      return count;
    }
    return this.listeners.get(event)?.length ?? 0;
  }

  

  getDeadLetterQueue(): DlqEntry[] {
    return [...this._deadLetterQueue];
  }

  clearDlq(): void {
    this._deadLetterQueue = [];
  }

  async retryDlq(): Promise<{ retried: number; failed: number }> {
    
    
    
    
    const retryable = this._deadLetterQueue.filter((e) => e.listenerId.description !== "dropped");
    const heldBack = this._deadLetterQueue.length - retryable.length;
    this._deadLetterQueue =
      heldBack > 0 ? this._deadLetterQueue.filter((e) => e.listenerId.description === "dropped") : [];
    const entries = retryable;
    let retried = 0;
    let failed = 0;

    for (const entry of entries) {
      entry.retryCount++;
      if (entry.retryCount > DLQ_MAX_RETRIES) {
        logger.warn(`DLQ dropping "${entry.eventName}" after ${DLQ_MAX_RETRIES} retries: ${entry.error}`);
        failed++;
        continue;
      }

      
      const list = this.listeners.get(entry.eventName);
      if (!list) {
        retried++;
        continue;
      }

      
      const targetListener = list.find((l) => l.id === entry.listenerId);
      if (!targetListener) {
        
        retried++;
        continue;
      }

      let listenerFailed = false;
      try {
        const r = targetListener.callback(entry.data);
        if (r instanceof Promise) {
          await r.catch((e) => {
            logger.error(`DLQ retry error for ${entry.eventName}:`, e);

            listenerFailed = true;
          });
        }
      } catch (e) {
        logger.error(`DLQ retry error for ${entry.eventName}:`, e);
        listenerFailed = true;
      }

      if (listenerFailed) {
        this._deadLetterQueue.push(entry);
        this._ensureDlqDrainStarted();
        failed++;
      } else {
        retried++;
      }
    }
    return { retried, failed };
  }

  

  
  shutdown(): void {
    this.stopDlqDrain();
    this.listeners.clear();
    this._deadLetterQueue = [];
    this._maxListeners = DEFAULT_MAX_LISTENERS;
  }

  

  
  private _addListener(
    event: string,
    callback: (...args: unknown[]) => void | Promise<void>,
    once: boolean,
    priority: number,
  ): void {
    const list = this.listeners.get(event) || [];
    const id = Symbol("listener");
    const entry: ListenerEntry = { id, callback, priority, once, original: callback };

    
    if (list.length >= this._maxListeners) {
      logger.warn(
        `Max listeners (${this._maxListeners}) reached for event "${event}". ` +
          `Possible memory leak. Increase maxListeners or remove unused listeners.`,
      );
    }

    
    let insertIdx = list.length;
    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i];
      if (item && item.priority >= entry.priority) {
        insertIdx = i + 1;
        break;
      }
      if (i === 0) {
        insertIdx = 0;
      }
    }
    list.splice(insertIdx, 0, entry);
    this.listeners.set(event, list);
  }

  
  private _removeListener(event: string, callbackOrId: ((...args: unknown[]) => void | Promise<void>) | symbol): void {
    const list = this.listeners.get(event);
    if (!list) return;

    const filtered =
      typeof callbackOrId === "symbol"
        ? list.filter((e) => e.id !== callbackOrId)
        : list.filter((e) => e.original !== callbackOrId);
    if (filtered.length === 0) {
      this.listeners.delete(event);
    } else {
      this.listeners.set(event, filtered);
    }
  }

  
  private _fireListeners(
    event: string,
    data: unknown,
    results: Array<Promise<void>>,
    
    originalType?: string,
  ): void {
    const list = this.listeners.get(event);
    if (!list) return;

    
    for (const entry of [...list]) {
      
      if (entry.once) {
        this._removeListener(event, entry.id);
      }

      const args =
        event === WILDCARD
          ? [originalType ?? event, data] 
          : [data]; 

      try {
        const result = entry.callback(...args);
        if (result instanceof Promise) {
          results.push(
            result.catch((e) => {
              const msg = e instanceof Error ? e.message : String(e);
              logger.error(`Async listener error for ${event}:`, e);
              if (event === WILDCARD) return;
              this._deadLetterQueue.push({
                eventName: originalType ?? event,
                data,
                error: msg,
                timestamp: Date.now(),
                retryCount: 0,
                listenerId: entry.id,
              });
              if (this._deadLetterQueue.length > DLQ_MAX_SIZE) this._deadLetterQueue.shift();
              this._ensureDlqDrainStarted();
              this._metrics?.increment("eventhub.dlq.added");
            }),
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`Listener error for ${event}:`, e);
        
        if (event !== WILDCARD) {
          this._deadLetterQueue.push({
            eventName: originalType ?? event,
            data,
            error: msg,
            timestamp: Date.now(),
            retryCount: 0,
            listenerId: entry.id,
          });
          this._ensureDlqDrainStarted();
          this._metrics?.increment("eventhub.dlq.added");
        }
        
        if (this._deadLetterQueue.length > DLQ_MAX_SIZE) {
          this._deadLetterQueue.shift();
        }
      }
    }
  }
}
