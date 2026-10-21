

import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { logger } from "../../utils/logger.ts";
import { withTimeout } from "../../utils/with-timeout.ts";
import { TimeoutError } from "../../utils/errors.ts";
import { isIsolationActiveSync } from "../isolation.ts";
import type { BackgroundJob, BackgroundTaskResult, BackgroundCoordinatorConfig, BackgroundEvent } from "./types.js";
import type { TimerManagerLike } from "../../types/timer-types.ts";
import {
  BackgroundCoordinatorConfigSchema,
  BackgroundJobSchema,
  generateJobId,
  calculateNextRun,
  BUILTIN_JOBS,
} from "./types.js";




export type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";


export interface Job<T = unknown> {
  id: string;
  state: JobState;
  payload: T;
  result?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  signal?: AbortSignal;
}



export class BackgroundCoordinator {
  private jobs: Map<string, BackgroundJob> = new Map();
  private results: BackgroundTaskResult[] = [];
  private config: BackgroundCoordinatorConfig;
  private storagePath: string;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _ticking = false;
  private eventListeners: Array<(event: BackgroundEvent) => void> = [];
  private jobHandlers: Map<string, () => Promise<BackgroundTaskResult>> = new Map();
  private activeControllers: Map<string, AbortController> = new Map();
  private runPipeline?: (input: {
    tool: string;
    agent: string;
    args: Record<string, unknown>;
  }) => Promise<{ allowed: boolean }>;

  
  private boardJobs: Map<string, Job> = new Map();
  private boardQueue: string[] = [];
  private boardRunning = new Set<string>();
  private boardResolvers = new Map<string, (job: Job) => void>();
  private maxConcurrentJobs: number;
  private timers: TimerManagerLike | null = null;

  constructor(config?: Partial<BackgroundCoordinatorConfig>, timers?: TimerManagerLike) {
    this.config = BackgroundCoordinatorConfigSchema.parse(config || {});
    this.maxConcurrentJobs = this.config.maxConcurrentJobs;
    this.storagePath = this.config.storagePath.replace("~", process.env.HOME || "~");
    this.timers = timers ?? null;

    
    for (const jobDef of BUILTIN_JOBS) {
      const now = new Date().toISOString();
      const job: BackgroundJob = {
        ...jobDef,
        id: generateJobId(),
        status: "pending",
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
        nextRunAt: jobDef.schedule ? calculateNextRun(jobDef.schedule).toISOString() : undefined,
      };
      this.jobs.set(job.id, job);
    }
  }

  
  start(): void {
    if (this.intervalId) return;

    
    
    
    const period = this.config.checkIntervalMs + Math.floor(Math.random() * this.config.checkIntervalMs * 0.1);
    this.intervalId = this.timers
      ? this.timers.setInterval(() => {
        if (this._ticking) return;
        this._ticking = true;
        Promise.resolve(this.tick())
          .catch((e) => logger.error("[background-coordinator] tick failed:", e))
          .finally(() => {
            this._ticking = false;
          });
      }, period)
      : setInterval(() => {
        if (this._ticking) return;
        this._ticking = true;
        Promise.resolve(this.tick())
          .catch((e) => logger.error("[background-coordinator] tick failed:", e))
          .finally(() => {
            this._ticking = false;
          });
      }, period);
    if (this.intervalId?.unref) this.intervalId.unref();

    logger.info(`[background-coordinator] Started with ${this.jobs.size} jobs`);
  }

  
  stop(): void {
    if (this.intervalId) {
      if (this.timers) this.timers.clear(this.intervalId);
      else clearInterval(this.intervalId);
      this.intervalId = null;
    }

    
    for (const controller of this.activeControllers.values()) {
      controller.abort(new DOMException("Background coordinator stopped", "AbortError"));
    }
    this.activeControllers.clear();

    logger.info("[background-coordinator] Stopped");
  }

  
  private async tick(): Promise<void> {
    const now = new Date();

    this.emitEvent({
      type: "scheduler_tick",
      payload: { jobsCount: this.jobs.size },
      source: "background-coordinator",
      timestamp: now.toISOString(),
    });

    
    for (const job of this.jobs.values()) {
      if (job.status === "running" || job.status === "cancelled" || job.status === "paused") {
        continue;
      }

      if (job.nextRunAt && new Date(job.nextRunAt) <= now) {
        await this.runJob(job.id);
      }
    }
  }

  
  createJob(
    name: string,
    type: BackgroundJob["type"],
    options?: {
      description?: string;
      agentId?: string;
      schedule?: BackgroundJob["schedule"];
      priority?: number;
      maxAttempts?: number;
      metadata?: Record<string, unknown>;
      handler?: () => Promise<BackgroundTaskResult>;
    },
  ): BackgroundJob {
    const now = new Date().toISOString();

    const job: BackgroundJob = {
      id: generateJobId(),
      name,
      description: options?.description,
      agentId: options?.agentId,
      type,
      schedule: options?.schedule,
      priority: options?.priority || 3,
      status: "pending",
      attemptCount: 0,
      maxAttempts: options?.maxAttempts || 3,
      createdAt: now,
      updatedAt: now,
      nextRunAt: options?.schedule ? calculateNextRun(options?.schedule).toISOString() : undefined,
      metadata: options?.metadata,
    };

    this.jobs.set(job.id, job);
    this.trimJobs();

    
    if (options?.handler) {
      this.jobHandlers.set(job.id, options.handler);
    }

    this.emitEvent({
      type: "job_created",
      payload: { jobId: job.id, name: job.name, type: job.type },
      source: "background-coordinator",
      timestamp: now,
    });

    return job;
  }

  
  async runJob(jobId: string): Promise<BackgroundTaskResult | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    if (job.status === "running") return null;

    const handler = this.jobHandlers.get(jobId);
    if (!handler) {
      job.status = "failed";
      job.lastError = `No handler registered for job: ${job.name}`;
      job.updatedAt = new Date().toISOString();
      logger.warn(`[background-coordinator] No handler for job: ${job.name}`);
      return null;
    }

    
    job.status = "running";
    job.attemptCount++;
    job.updatedAt = new Date().toISOString();

    this.emitEvent({
      type: "job_started",
      payload: { jobId: job.id, name: job.name, attempt: job.attemptCount },
      source: "background-coordinator",
      timestamp: new Date().toISOString(),
    });

    const startTime = Date.now();
    let result: BackgroundTaskResult;

    const controller = new AbortController();
    this.activeControllers.set(jobId, controller);

    try {
      
      if (!this.runPipeline) {
        throw new Error("Blocked: no governance gateway");
      }

      const pipelineResult = await this.runPipeline({
        tool: "background-job",
        agent: job.agentId || "unknown",
        args: {},
      });
      if (!pipelineResult.allowed) {
        throw new Error("Blocked: governance pipeline rejected");
      }

      result = await withTimeout(() => handler(), {
        timeoutMs: this.config.jobTimeoutMs,
        signal: controller.signal,
      });
      
      if (controller.signal.aborted) {
        throw new DOMException(`Job ${jobId} aborted`, "AbortError");
      }
      result.executedAt = new Date().toISOString();

      job.status = "completed";
      job.lastRunAt = result.executedAt;
      job.lastOutput = result.output;
      job.lastError = undefined;

      
      if (job.schedule) {
        job.nextRunAt = calculateNextRun(job.schedule, result.executedAt).toISOString();
      } else if (job.type === "one_shot") {
        job.status = "completed";
      }

      this.emitEvent({
        type: "job_completed",
        payload: { jobId: job.id, name: job.name, durationMs: result.durationMs },
        source: "background-coordinator",
        timestamp: result.executedAt,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      
      if ((this.jobs.get(jobId)?.status ?? job.status) !== "cancelled") {
        job.status = job.attemptCount >= job.maxAttempts ? "failed" : "pending";
        job.lastError = errorMsg;
        job.updatedAt = new Date().toISOString();

        
        if (job.status === "pending" && job.schedule) {
          job.nextRunAt = calculateNextRun(job.schedule).toISOString();
        }
      }

      result = {
        jobId,
        success: false,
        error: errorMsg,
        durationMs: Date.now() - startTime,
        executedAt: new Date().toISOString(),
      };

      this.emitEvent({
        type: "job_failed",
        payload: { jobId: job.id, name: job.name, error: errorMsg, attempt: job.attemptCount },
        source: "background-coordinator",
        timestamp: result.executedAt,
      });
    }

    
    this.results.push(result);
    this.trimResults();
    this.activeControllers.delete(jobId);

    return result;
  }

  
  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.status = "cancelled";
    job.updatedAt = new Date().toISOString();

    const controller = this.activeControllers.get(jobId);
    if (controller) {
      controller.abort(new DOMException(`Job ${jobId} cancelled`, "AbortError"));
      this.activeControllers.delete(jobId);
    }

    this.emitEvent({
      type: "job_cancelled",
      payload: { jobId: job.id, name: job.name },
      source: "background-coordinator",
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  
  pauseJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "running") return false;

    job.status = "paused";
    job.updatedAt = new Date().toISOString();

    this.emitEvent({
      type: "job_paused",
      payload: { jobId: job.id, name: job.name },
      source: "background-coordinator",
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  
  resumeJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "paused") return false;

    job.status = "pending";
    job.updatedAt = new Date().toISOString();

    if (job.schedule) {
      job.nextRunAt = calculateNextRun(job.schedule).toISOString();
    }

    this.emitEvent({
      type: "job_resumed",
      payload: { jobId: job.id, name: job.name },
      source: "background-coordinator",
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  
  registerHandler(jobId: string, handler: () => Promise<BackgroundTaskResult>): void {
    this.jobHandlers.set(jobId, handler);
  }

  
  setRunPipeline(
    pipeline: (input: { tool: string; agent: string; args: Record<string, unknown> }) => Promise<{ allowed: boolean }>,
  ): void {
    this.runPipeline = pipeline;
  }

  
  getJob(jobId: string): BackgroundJob | null {
    return this.jobs.get(jobId) || null;
  }

  
  getAllJobs(): BackgroundJob[] {
    return Array.from(this.jobs.values());
  }

  
  getJobsByStatus(status: BackgroundJob["status"]): BackgroundJob[] {
    return Array.from(this.jobs.values()).filter((j) => j.status === status);
  }

  
  getResults(jobId?: string): BackgroundTaskResult[] {
    if (jobId) {
      return this.results.filter((r) => r.jobId === jobId);
    }
    return [...this.results];
  }

  
  private trimJobs(): void {
    if (this.jobs.size <= this.config.maxJobs) return;

    const sorted = Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const toKeep = sorted.slice(0, this.config.maxJobs);
    this.jobs.clear();
    for (const job of toKeep) {
      this.jobs.set(job.id, job);
    }
  }

  
  private trimResults(): void {
    if (this.results.length <= this.config.maxResultHistory) return;

    this.results = this.results.slice(-this.config.maxResultHistory);
  }

  
  async persist(): Promise<void> {
    
    if (isIsolationActiveSync()) return;
    try {
      const dir = dirname(this.storagePath);
      try {
        await access(dir, constants.F_OK);
      } catch {
        await mkdir(dir, { recursive: true });
      }

      const data = {
        version: "1.0.0",
        persistedAt: new Date().toISOString(),
        jobs: Array.from(this.jobs.values()),
        results: this.results.slice(-100),
        board: {
          jobs: Array.from(this.boardJobs.entries()),
          queue: this.boardQueue,
          running: Array.from(this.boardRunning),
        },
      };

      await writeFile(this.storagePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error("[background-coordinator] Failed to persist:", error);
    }
  }

  
  async load(): Promise<void> {
    try {
      await access(this.storagePath, constants.F_OK);
    } catch {
      return;
    }

    try {
      const raw = await readFile(this.storagePath, "utf-8");
      const data = JSON.parse(raw);

      if (data.jobs && Array.isArray(data.jobs)) {
        for (const job of data.jobs) {
          const parsed = BackgroundJobSchema.safeParse(job);
          if (!parsed.success) {
            logger.warn(`[background-coordinator] Skipping invalid job (${job?.id ?? "?"}): ${parsed.error.message}`);
            continue;
          }
          
          if (!this.jobs.has(parsed.data.id)) {
            this.jobs.set(parsed.data.id, parsed.data);
          }
        }
      }

      if (data.results && Array.isArray(data.results)) {
        this.results = data.results;
      }

      if (data.board && Array.isArray(data.board.jobs)) {
        this.boardJobs = new Map(data.board.jobs);
        this.boardQueue = data.board.queue ?? [];
        this.boardRunning = new Set(data.board.running ?? []);
        
        for (const job of this.boardJobs.values()) {
          if (job.state === "running") {
            job.state = "failed";
            job.error = "lost on restart";
            job.completedAt = Date.now();
          }
        }
      }

      logger.info(`[background-coordinator] Loaded ${this.jobs.size} jobs`);
    } catch (error) {
      logger.error("[background-coordinator] Failed to load:", error);
    }
  }

  
  onEvent(listener: (event: BackgroundEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  
  private emitEvent(event: BackgroundEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error("[background-coordinator] Event listener error:", error);
      }
    }
  }

  
  getStats(): {
    totalJobs: number;
    runningJobs: number;
    pendingJobs: number;
    completedJobs: number;
    failedJobs: number;
    totalResults: number;
  } {
    const jobs = Array.from(this.jobs.values());

    return {
      totalJobs: jobs.length,
      runningJobs: jobs.filter((j) => j.status === "running").length,
      pendingJobs: jobs.filter((j) => j.status === "pending").length,
      completedJobs: jobs.filter((j) => j.status === "completed").length,
      failedJobs: jobs.filter((j) => j.status === "failed").length,
      totalResults: this.results.length,
    };
  }

  
  clear(): void {
    this.jobs.clear();
    this.results = [];
    this.jobHandlers.clear();
    this.runPipeline = undefined;
    this.boardJobs.clear();
    this.boardQueue = [];
    this.boardRunning.clear();
    this.boardResolvers.clear();
  }

  
  isEnabled(): boolean {
    return this.config.enabled;
  }

  
  isRunning(): boolean {
    return this.intervalId !== null;
  }

  

  
  enqueue<T>(id: string, payload: T, signal?: AbortSignal): Job<T> {
    const job: Job<T> = { id, state: "queued", payload, createdAt: Date.now(), signal };
    this.boardJobs.set(id, job);
    this.boardQueue.push(id);
    this.dispatchBoard();
    return job;
  }

  
  get(id: string): Job | undefined {
    return this.boardJobs.get(id);
  }

  
  all(): Job[] {
    return Array.from(this.boardJobs.values());
  }

  
  async waitFor(id: string, timeoutMs = 30000): Promise<Job> {
    const job = this.boardJobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    if (job.state === "completed" || job.state === "failed" || job.state === "cancelled") return job;

    if (job.signal?.aborted) {
      this.fail(id, "Job cancelled via signal");
      return this.boardJobs.get(id)!;
    }

    return new Promise((resolve, reject) => {
      this.boardResolvers.set(id, resolve);
      const timer = setTimeout(() => {
        this.boardResolvers.delete(id);
        reject(new TimeoutError(`Job ${id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      if (job.signal) {
        job.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            this.boardResolvers.delete(id);
            this.fail(id, "Job cancelled via signal");
            resolve(this.boardJobs.get(id)!);
          },
          { once: true },
        );
      }
    });
  }

  private dispatchBoard(): void {
    while (this.boardRunning.size < this.maxConcurrentJobs && this.boardQueue.length > 0) {
      const id = this.boardQueue.shift()!;
      const job = this.boardJobs.get(id);
      if (!job) continue;
      if (job.signal?.aborted) {
        job.state = "failed";
        job.error = "cancelled before start";
        job.completedAt = Date.now();
        this.notifyBoard(id);
        continue;
      }
      job.state = "running";
      job.startedAt = Date.now();
      this.boardRunning.add(id);
    }
  }

  private notifyBoard(id: string): void {
    const resolve = this.boardResolvers.get(id);
    if (resolve) {
      this.boardResolvers.delete(id);
      resolve(this.boardJobs.get(id)!);
    }
  }

  
  complete(id: string, result: unknown): void {
    const job = this.boardJobs.get(id);
    if (!job || job.state !== "running") return;
    job.state = "completed";
    job.result = result;
    job.completedAt = Date.now();
    this.boardRunning.delete(id);
    this.notifyBoard(id);
    this.dispatchBoard();
  }

  
  fail(id: string, error: string): void {
    const job = this.boardJobs.get(id);
    if (!job) return;
    job.state = "failed";
    job.error = error;
    job.completedAt = Date.now();
    this.boardRunning.delete(id);
    this.notifyBoard(id);
    this.dispatchBoard();
  }

  
  cancel(id: string): void {
    const job = this.boardJobs.get(id);
    if (!job || job.state === "completed" || job.state === "failed") return;
    job.state = "cancelled";
    job.completedAt = Date.now();
    this.boardRunning.delete(id);
    this.notifyBoard(id);
    const idx = this.boardQueue.indexOf(id);
    if (idx >= 0) this.boardQueue.splice(idx, 1);
  }

  
  stats(): { queued: number; running: number; completed: number; failed: number; cancelled: number } {
    const s = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const job of this.boardJobs.values()) s[job.state]++;
    return s;
  }
}



let instance: BackgroundCoordinator | null = null;

export function getBackgroundCoordinator(config?: Partial<BackgroundCoordinatorConfig>, timers?: TimerManagerLike): BackgroundCoordinator {
  if (!instance) {
    instance = new BackgroundCoordinator(config, timers);
  }
  return instance;
}

export function resetBackgroundCoordinator(): void {
  if (instance) {
    instance.stop();
    instance.clear();
    instance = null;
  }
}
