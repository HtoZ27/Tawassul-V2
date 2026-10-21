

import { logger } from "../utils/logger.ts";
import { quietValue, QUIET_AUTO_SAVE_INTERVAL_MS } from "../utils/quiet.ts";

const AUTO_SAVE_INTERVAL_MS = 15 * 60 * 1000; 
const RETRY_DELAY_MS = 200;
const MAX_RETRIES = 10;

import type { TimerManagerLike } from "../types/timer-types.ts";

export class AutoSaveManager {
  private interval: ReturnType<typeof setInterval> | null = null;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private disposed = false;
  private timers: TimerManagerLike | null;

  constructor(
    private onSave: () => Promise<void>,
    timers?: TimerManagerLike,
  ) {
    this.timers = timers ?? null;
  }

  start(signal?: AbortSignal): void {
    if (this.interval) return;
    const fn = () => {
      if (this.disposed || signal?.aborted) {
        this.stop();
        return;
      }
      this.triggerSave();
    };
    const base = quietValue(QUIET_AUTO_SAVE_INTERVAL_MS, AUTO_SAVE_INTERVAL_MS);
    const period = base + Math.floor(Math.random() * base * 0.1);
    this.interval = this.timers
      ? this.timers.setInterval(fn, period)
      : (() => {
          const t = setInterval(fn, period);
          if (t?.unref) t.unref();
          return t;
        })();
    signal?.addEventListener("abort", () => this.stop(), { once: true });
  }

  private triggerSave(): void {
    this.onSave()
      .then(() => (this.retryCount = 0))
      .catch((e) => {
        logger.warn("autoSave failed:", e);
        this.scheduleRetry();
      });
  }

  private scheduleRetry(): void {
    if (this.disposed) return;
    if (this.retryCount >= MAX_RETRIES) {
      logger.warn("autoSave retry limit reached, skipping");
      this.retryCount = 0;
      return;
    }
    this.retryCount++;
    const delay = RETRY_DELAY_MS * Math.pow(2, this.retryCount - 1);
    const fn = () => {
      this.retryTimeout = null;
      this.triggerSave();
    };
    this.retryTimeout = this.timers
      ? this.timers.setTimeout(fn, delay)
      : (() => {
          const t = setTimeout(fn, delay);
          if (t?.unref) t.unref();
          return t;
        })();
  }

  
  requestRetry(): void {
    this.scheduleRetry();
  }

  resetRetryCount(): void {
    this.retryCount = 0;
  }

  stop(): void {
    if (this.interval) {
      if (this.timers) this.timers.clear(this.interval);
      else clearInterval(this.interval);
      this.interval = null;
    }
    if (this.retryTimeout) {
      if (this.timers) this.timers.clear(this.retryTimeout);
      else clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    this.retryCount = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }
}
