
import { TimeoutError } from "../utils/errors.ts";
import { logger } from "../utils/logger.ts";

export interface SandboxOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxMemoryMB?: number;
}

export async function sandbox<T>(fn: (signal: AbortSignal) => Promise<T>, options?: SandboxOptions): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 30000;
  const signal = options?.signal;

  if (options?.maxMemoryMB) {
    logger.warn(`تنبيه: maxMemoryMB=${options.maxMemoryMB} غير مفعل — يتطلب vm module`);
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new TimeoutError(`Plugin sandbox timeout after ${timeoutMs}ms`, { timeoutMs }));
      }
    }, timeoutMs);
    timer.unref?.();

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        settled = true;
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          }
        },
        { once: true },
      );
    }

    (async () => {
      try {
        const result = await fn(signal ?? new AbortController().signal);
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          if (err instanceof Error) {
            (err as { phase?: string }).phase = "sandbox";
          }
          reject(err);
        }
      }
    })();
  });
}

export function classifySandboxError(err: unknown): "timeout" | "aborted" | "execution" | "unknown" {
  if (err instanceof TimeoutError) return "timeout";
  if (err instanceof DOMException && err.name === "AbortError") return "aborted";
  if (err instanceof Error) return "execution";
  return "unknown";
}

export type SandboxErrorCategory = ReturnType<typeof classifySandboxError>;

export function isSandboxError(err: unknown, category?: SandboxErrorCategory): boolean {
  const c = classifySandboxError(err);
  if (category) return c === category;
  return c !== "unknown";
}
