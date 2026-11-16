



import { normalizeName } from "../utils/name-utils.ts";


class Mutex {
  private locked = false;
  private queue: Array<(release: () => void) => void> = [];

  lock(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(() => this.release());
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) next(() => this.release());
    else this.locked = false;
  }
}


class KeyedMutex {
  private mutexes = new Map<string, Mutex>();

  getOrCreate(key: string): Mutex {
    let m = this.mutexes.get(key);
    if (!m) {
      m = new Mutex();
      this.mutexes.set(key, m);
    }
    return m;
  }

  clear(): void {
    this.mutexes.clear();
  }
}

export interface TransactionRecord {
  readonly id: string;
  state: "pending" | "committed" | "aborted" | "completed";
  readonly version: number;
  readonly createdAt: number;
  completedAt: number | null;
  readonly agentId: string;
}

export interface TransactionContext {
  readonly version: number;
  readonly signal: AbortSignal;
  readonly record: TransactionRecord;
  readonly data: Map<string, unknown>;
}

export type TransactionFn<T> = (ctx: TransactionContext) => Promise<T>;

export interface TransactionOptions {
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface TransactionResult<T> {
  readonly success: boolean;
  readonly result?: T;
  readonly record: TransactionRecord;
  readonly error?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class AgentTransactionManager {
  private versions = new Map<string, number>();
  private activeTransactions = new Map<string, TransactionRecord>();
  
  private mutex = new KeyedMutex();
  private seq = 0;

  readonly metrics = { totalExecuted: 0, totalCommitted: 0, totalAborted: 0, totalCasFailures: 0 };

  
  incrementVersion(agentId: string): number {
    const key = normalizeName(agentId);
    const current = this.versions.get(key) ?? 0;
    const next = current + 1;
    this.versions.set(key, next);
    return next;
  }

  getVersion(agentId: string): number {
    return this.versions.get(normalizeName(agentId)) ?? 0;
  }

  async execute<T>(agentId: string, fn: TransactionFn<T>, options?: TransactionOptions): Promise<TransactionResult<T>> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const version = this.incrementVersion(agentId);
    const abortController = new AbortController();

    const record: TransactionRecord = {
      id: `TX-${++this.seq}-${agentId}`,
      state: "pending",
      version,
      createdAt: Date.now(),
      completedAt: null,
      agentId,
    };
    this.activeTransactions.set(record.id, record);

    
    const lockKey = this.buildLockKey(agentId);
    const unlock = await this.mutex.getOrCreate(lockKey).lock();

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        abortController.abort();
        reject(new Error(`Transaction ${record.id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      if (timer?.unref) timer.unref();
      abortController.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    });

    try {
      const result = (await Promise.race([
        fn({ version, signal: abortController.signal, record, data: new Map() }),
        timeoutPromise,
      ])) as T;
      record.state = "completed";
      record.completedAt = Date.now();
      this.metrics.totalExecuted++;
      this.metrics.totalCommitted++;
      return { success: true, result, record };
    } catch (e) {
      record.state = "aborted";
      record.completedAt = Date.now();
      this.metrics.totalExecuted++;
      this.metrics.totalAborted++;
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, record, error: msg };
    } finally {
      unlock();
      this.activeTransactions.delete(record.id);
    }
  }

  async compareAndSwap<T>(
    agentId: string,
    expectedVersion: number,
    fn: TransactionFn<T>,
    options?: TransactionOptions,
  ): Promise<TransactionResult<T>> {
    const currentVersion = this.versions.get(normalizeName(agentId)) ?? 0;
    if (currentVersion !== expectedVersion) {
      this.metrics.totalCasFailures++;
      return {
        success: false,
        record: {
          id: `TX-FAIL-${agentId}`,
          state: "aborted",
          version: currentVersion,
          createdAt: Date.now(),
          completedAt: Date.now(),
          agentId,
        },
        error: `CAS failed: expected version ${expectedVersion}, current ${currentVersion}`,
      };
    }
    return this.execute(agentId, fn, options);
  }

  private buildLockKey(agentId: string): string {
    return normalizeName(agentId);
  }

  
  async executeWithOrderedLocks<T>(
    agentIds: string[],
    fn: (ctxs: TransactionContext[]) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<TransactionResult<T>> {
    if (agentIds.length === 0) {
      return {
        success: false,
        record: {
          id: "TX-EMPTY",
          state: "aborted",
          version: 0,
          createdAt: Date.now(),
          completedAt: Date.now(),
          agentId: "",
        },
        error: "No agents specified",
      };
    }

    const sorted = [...new Set(agentIds)].sort();
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(
        () => reject(new Error(`executeWithOrderedLocks timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      if (timeoutTimer?.unref) timeoutTimer.unref();
    });

    const clearTimer = () => {
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }
    };

    
    const unlocks: Array<() => void> = [];
    for (const id of sorted) {
      const unlock = await this.mutex.getOrCreate(this.buildLockKey(id)).lock();
      unlocks.push(unlock);
    }

    
    try {
      const result = await Promise.race([
        (async () => {
          clearTimer();
          const version = this.incrementVersion(sorted[0]!);
          const abortController = new AbortController();
          const record: TransactionRecord = {
            id: `TX-LOCKED-${++this.seq}-${sorted.join(",")}`,
            state: "pending",
            version,
            createdAt: Date.now(),
            completedAt: null,
            agentId: sorted[0]!,
          };
          this.activeTransactions.set(record.id, record);

          try {
            const contexts: TransactionContext[] = sorted.map((id) => ({
              version: this.incrementVersion(id),
              signal: abortController.signal,
              record,
              data: new Map(),
            }));
            const res = await fn(contexts);
            record.state = "completed";
            record.completedAt = Date.now();
            this.metrics.totalExecuted++;
            this.metrics.totalCommitted++;
            return { success: true, result: res, record } as TransactionResult<T>;
          } catch (e) {
            record.state = "aborted";
            record.completedAt = Date.now();
            this.metrics.totalExecuted++;
            this.metrics.totalAborted++;
            const msg = e instanceof Error ? e.message : String(e);
            return { success: false, record, error: msg } as TransactionResult<T>;
          } finally {
            this.activeTransactions.delete(record.id);
          }
        })(),
        timeoutPromise,
      ]);
      return result;
    } catch (e) {
      clearTimer();
      const msg = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        record: {
          id: "TX-LOCKED-FAIL",
          state: "aborted",
          version: 0,
          createdAt: Date.now(),
          completedAt: Date.now(),
          agentId: "",
        },
        error: msg,
      };
    } finally {
      clearTimer();
      
      for (let i = unlocks.length - 1; i >= 0; i--) unlocks[i]!();
    }
  }

  getActiveTransactions(): TransactionRecord[] {
    const result: TransactionRecord[] = [];
    for (const [, record] of this.activeTransactions) {
      if (record.state === "pending") result.push(record);
    }
    return result;
  }

  dispose(): void {
    this.versions.clear();
    this.activeTransactions.clear();
    this.mutex.clear();
    this.seq = 0;
  }
}
