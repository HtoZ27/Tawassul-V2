import { logger } from "../../../utils/logger.ts";

const MAX_KEYS = 100;

interface Window {
  start: number;
  suppressed: number;
}

const windows = new Map<string, Window>();

export function warnThrottled(key: string, windowMs: number, msg: string, data?: unknown): void {
  const now = Date.now();
  const w = windows.get(key);
  if (w === undefined || now - w.start >= windowMs) {
    if (w !== undefined && w.suppressed > 0) {
      logger.warn(`[tawassul] (${key}) ${w.suppressed} similar warning(s) suppressed in the last window`);
    }
    windows.set(key, { start: now, suppressed: 0 });
    if (windows.size > MAX_KEYS) {
      const oldest = windows.keys().next().value;
      if (oldest !== undefined) windows.delete(oldest);
    }
    logger.warn(msg, data);
    return;
  }
  w.suppressed++;
}

export function warnThrottleSuppressed(key: string): number {
  return windows.get(key)?.suppressed ?? 0;
}

export function resetWarnThrottle(): void {
  windows.clear();
}
