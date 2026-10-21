import { appendFile, mkdir, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { logger } from "../utils/logger.ts";
import { quietValue, QUIET_LEDGER_FLUSH_MS } from "../utils/quiet.ts";
import { isIsolationActiveSync } from "./isolation.ts";
import type { TimerManagerLike } from "../types/timer-types.ts";

export interface LedgerEntry {
  timestamp: string;
  type: "handoff_created" | "handoff_completed" | "handoff_cancelled" | "handoff_redirected" | "handoff_failed";
  handoffId: string;
  from: string;
  to: string;
  task: string;
  
  acceptanceCriteria?: string[];
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  metadata?: Record<string, unknown>;
}

export class HandoffLedger {
  private ledgerPath: string;
  private buffer: LedgerEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirReady: Promise<void>;
  private disposed = false;
  private static readonly FLUSH_INTERVAL_MS = 5000;
  private timers: TimerManagerLike | null;

  constructor(baseDir: string, timers?: TimerManagerLike) {
    this.ledgerPath = resolve(baseDir, "handoff-ledger.jsonl");
    this.dirReady = this.ensureDir();
    this.timers = timers ?? null;
  }

  private async ensureDir(): Promise<void> {
    const dir = dirname(this.ledgerPath);
    try {
      await access(dir);
    } catch {
      await mkdir(dir, { recursive: true, mode: 0o700 });
    }
  }

  append(entry: Omit<LedgerEntry, "timestamp">): void {
    if (this.disposed) return;
    this.buffer.push({ ...entry, timestamp: new Date().toISOString() });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.disposed) return;
    const runFlush = () => {
      this.flush().catch((e) => logger.warn("[tawassul] handoff ledger flush failed:", e));
    };
    const delay = quietValue(QUIET_LEDGER_FLUSH_MS, HandoffLedger.FLUSH_INTERVAL_MS);
    this.flushTimer = this.timers
      ? this.timers.setTimeout(runFlush, delay)
      : (() => {
          const t = setTimeout(runFlush, delay);
          if (t?.unref) t.unref();
          return t;
        })();
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      if (this.timers) this.timers.clear(this.flushTimer);
      else clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;
    
    
    if (isIsolationActiveSync()) {
      this.buffer = [];
      return;
    }
    await this.dirReady;
    const batch = this.buffer;
    this.buffer = [];
    try {
      const lines = batch.map((e) => JSON.stringify(e)).join("\n") + "\n";
      await appendFile(this.ledgerPath, lines, { mode: 0o600 });
    } catch (e) {
      this.buffer = [...batch, ...this.buffer];
      logger.warn("[tawassul] handoff ledger flush failed, keeping buffer for retry:", e);
      this.scheduleFlush();
      throw e;
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.flushTimer) {
      if (this.timers) this.timers.clear(this.flushTimer);
      else clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}
