



import { readFile, mkdir, readdir } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../utils/logger.ts";
import { atomicWriteFile } from "../utils/atomic.ts";

export type SagaState = "PENDING" | "EXECUTING" | "COMPLETED" | "COMPENSATING" | "COMPENSATED" | "FAILED";

export interface SagaStep<C> {
  name: string;
  execute: (context: C) => Promise<void>;
  compensate: (context: C) => Promise<void>;
}

export interface SagaTransaction<C> {
  transactionId: string;
  sagaName: string;
  state: SagaState;
  steps: SagaStep<C>[];
  completedSteps: string[];
  error: string | null;
  startedAt: number;
  completedAt: number | null;
  compensatedAt: number | null;
  
  taskId?: string;
}

export interface SagaResumePoint {
  phase: string;
  taskId: string;
  remainingTasks: string[];
}


export interface SagaJournalRecord {
  transactionId: string;
  sagaName: string;
  state: SagaState;
  completedSteps: string[];
  taskId?: string;
  error: string | null;
  startedAt: number;
  updatedAt: number;
}

export interface ResumeResult {
  recovered: boolean;
  success: boolean;
  failedStep: string | null;
}

const MAX_TRANSACTIONS = 200;
const SAGAS_DIR = "sagas";

function highestJournalSeq(dir: string): number {
  let best = 0;
  try {
    for (const file of readdirSync(dir)) {
      const match = /^SAGA-(\d+)\.json$/.exec(file);
      if (!match) continue;
      const seq = Number(match[1]);
      if (Number.isFinite(seq) && seq > best) best = seq;
    }
  } catch (e) {
    logger.debug(`[saga] journal scan skipped for ${dir}:`, e);
  }
  return best;
}

export function createJournalRecord(tx: {
  transactionId: string;
  sagaName: string;
  state: SagaState;
  completedSteps: string[];
  taskId?: string;
  error: string | null;
  startedAt: number;
}): SagaJournalRecord {
  return {
    transactionId: tx.transactionId,
    sagaName: tx.sagaName,
    state: tx.state,
    completedSteps: tx.completedSteps,
    taskId: tx.taskId,
    error: tx.error,
    startedAt: tx.startedAt,
    updatedAt: Date.now(),
  };
}

export class SagaCoordinator<C> {
  private _transactions: SagaTransaction<C>[] = [];
  private _sagaSeq = 0;
  private persistDir: string | null = null;
  
  private _journalQueue: Promise<unknown> = Promise.resolve();

  constructor(persistDir?: string) {
    if (persistDir) {
      this.persistDir = join(persistDir, SAGAS_DIR);
      this._sagaSeq = highestJournalSeq(this.persistDir);
    }
  }

  private nextSagaId(): string {
    this._sagaSeq++;
    return `SAGA-${String(this._sagaSeq).padStart(3, "0")}`;
  }

  private journalPath(transactionId: string): string {
    return this.persistDir ? join(this.persistDir, `${transactionId}.json`) : "";
  }

  
  private persist(tx: SagaTransaction<C>): Promise<void> | void {
    if (!this.persistDir) return;
    const record = createJournalRecord(tx);
    const write: Promise<void> = this._journalQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.persistDir!, { recursive: true });
        await atomicWriteFile(this.journalPath(tx.transactionId), JSON.stringify(record, null, 2), { backup: false });
      })
      .catch(async (err) => {
        
        
        
        
        
        if ((err as { code?: string })?.code === "ENOENT") {
          try {
            await mkdir(this.persistDir!, { recursive: true });
            await atomicWriteFile(this.journalPath(tx.transactionId), JSON.stringify(record, null, 2), { backup: false });
            return;
          } catch (retryErr) {
            logger.warn(`[saga] journal retry failed for ${tx.transactionId}:`, retryErr);
            return;
          }
        }
        logger.warn(`[saga] journal write failed for ${tx.transactionId}:`, err);
      });
    this._journalQueue = write;
    return write;
  }

  async readJournalRecord(transactionId: string): Promise<SagaJournalRecord | null> {
    if (!this.persistDir) return null;
    try {
      const data = await readFile(this.journalPath(transactionId), "utf-8");
      return JSON.parse(data) as SagaJournalRecord;
    } catch {
      return null;
    }
  }

  
  async flushJournal(): Promise<void> {
    await this._journalQueue;
  }

  async listJournalRecords(): Promise<SagaJournalRecord[]> {
    if (!this.persistDir) return [];
    try {
      const files = await readdir(this.persistDir);
      const reads = files
        .filter((f) => f.endsWith(".json"))
        .map((file) => this.readJournalRecord(file.replace(/\.json$/, "")));
      const results = await Promise.all(reads);
      return results.filter((r): r is SagaJournalRecord => r !== null);
    } catch {
      return [];
    }
  }

  createSaga(sagaName: string, steps: SagaStep<C>[], taskId?: string): SagaTransaction<C> {
    
    const existing = taskId ? this._transactions.find((t) => t.taskId === taskId) : undefined;
    const txId = existing?.transactionId && existing.state === "PENDING" ? existing.transactionId : this.nextSagaId();
    const tx: SagaTransaction<C> = {
      transactionId: txId,
      sagaName,
      state: "PENDING",
      steps,
      completedSteps: [],
      error: null,
      startedAt: Date.now(),
      completedAt: null,
      compensatedAt: null,
      taskId,
    };
    this._transactions.push(tx);
    if (this._transactions.length > MAX_TRANSACTIONS) {
      this._transactions = this._transactions.slice(-MAX_TRANSACTIONS);
    }
    this.persist(tx);
    logger.debug(`${tx.transactionId} "${sagaName}" created (${steps.length} steps)`);
    return tx;
  }

  async executeSaga(tx: SagaTransaction<C>, context: C): Promise<{ success: boolean; failedStep: string | null }> {
    tx.state = "EXECUTING";
    await this.persist(tx);
    logger.debug(`${tx.transactionId} "${tx.sagaName}" executing…`);

    for (const step of tx.steps) {
      
      if (tx.completedSteps.includes(step.name)) continue;
      try {
        await step.execute(context);
        tx.completedSteps.push(step.name);
        
        
        
        
        await this.persist(tx);
        logger.debug(`${tx.transactionId} step "${step.name}" OK`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        tx.error = `Step "${step.name}" failed: ${msg}`;
        logger.warn(`[saga] ${tx.transactionId} step "${step.name}" failed:`, e);

        await this._compensate(tx, context, step.name);
        await this.persist(tx);
        return { success: false, failedStep: step.name };
      }
    }

    tx.state = "COMPLETED";
    tx.completedAt = Date.now();
    await this.persist(tx);
    logger.debug(`${tx.transactionId} "${tx.sagaName}" completed`);
    return { success: true, failedStep: null };
  }

  
  async resumeSaga(steps: SagaStep<C>[], resumePoint: SagaResumePoint, context: C): Promise<ResumeResult> {
    if (!this.persistDir) return { recovered: false, success: false, failedStep: "no-persist-dir" };

    const records = await this.listJournalRecords();
    const target = records.find(
      (r) => r.taskId === resumePoint.taskId && r.state !== "COMPLETED" && r.state !== "COMPENSATED",
    );
    if (!target) return { recovered: false, success: true, failedStep: null };

    const skipped = new Set(target.completedSteps);
    if (skipped.size === 0) return { recovered: false, success: true, failedStep: null };

    const tx: SagaTransaction<C> = {
      transactionId: `${target.transactionId}-resumed`,
      sagaName: target.sagaName,
      state: "PENDING",
      steps,
      completedSteps: [...target.completedSteps],
      error: target.error,
      startedAt: target.startedAt,
      completedAt: null,
      compensatedAt: null,
      taskId: target.taskId,
    };
    this._transactions.push(tx);
    const result = await this.executeSaga(tx, context);
    return { recovered: true, success: result.success, failedStep: result.failedStep };
  }

  private async _compensate(tx: SagaTransaction<C>, context: C, fromStep: string): Promise<void> {
    tx.state = "COMPENSATING";
    logger.debug(`${tx.transactionId} compensating from step "${fromStep}"…`);

    const toUndo = [...tx.steps.filter((s) => tx.completedSteps.includes(s.name))].reverse();
    for (const step of toUndo) {
      try {
        await step.compensate(context);
        logger.debug(`${tx.transactionId} compensate "${step.name}" OK`);
      } catch (e) {
        logger.warn(`[saga] ${tx.transactionId} compensate "${step.name}" failed:`, e);
      }
    }

    if (tx.completedSteps.length === 0) {
      tx.state = "FAILED";
    } else {
      tx.state = "COMPENSATED";
      tx.compensatedAt = Date.now();
    }
    await this.persist(tx);
    logger.debug(`${tx.transactionId} "${tx.sagaName}" → ${tx.state}`);
  }

  getLog(): SagaTransaction<C>[] {
    return this._transactions;
  }

  latestSaga(): SagaTransaction<C> | undefined {
    return this._transactions[this._transactions.length - 1];
  }
}
