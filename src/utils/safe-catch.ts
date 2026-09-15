

import { logger } from "./logger.ts";


export function safeCatch<T>(fn: () => T, defaultValue: T, context?: string): T {
  try {
    return fn();
  } catch (e) {
    if (context) {
      logger.debug(`[safeCatch] ${context}:`, e);
    }
    return defaultValue;
  }
}
