import { TimeoutError } from "./errors.ts";

export interface TimeoutOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

export async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, options: TimeoutOptions): Promise<T> {
  const { timeoutMs, signal: externalSignal } = options;
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(new TimeoutError(`Timed out after ${timeoutMs}ms`, { timeoutMs })),
    timeoutMs,
  );

  const onExternalAbort = () => {
    controller.abort(externalSignal?.reason ?? new DOMException("Aborted", "AbortError"));
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      throw externalSignal.reason ?? new DOMException("Aborted", "AbortError");
    }
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs = 10000, timeoutMs, shouldRetry } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (timeoutMs) {
        return await withTimeout((_signal) => fn(attempt), { timeoutMs });
      }
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (shouldRetry && !shouldRetry(err, attempt)) throw err;
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
