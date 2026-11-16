import type { HandoffEntry } from "../context/types.ts";
import type { RetentionConfig } from "./retention.ts";
import { buildAutoCleanupPlan } from "./retention.ts";
import type { TimerManagerLike } from "../types/timer-types.ts";

export interface CleanupTarget {
  handoffs: HandoffEntry[];
  retainedHandoffs: HandoffEntry[];
  removedIds: string[];
}

export function cleanupHandoffs(handoffs: HandoffEntry[], config: RetentionConfig): CleanupTarget {
  const staleIds = new Set(buildAutoCleanupPlan(handoffs, config.maxAgeMs));
  const removedIds: string[] = [];

  let retained = handoffs.filter((h) => {
    if (staleIds.has(h.id)) {
      removedIds.push(h.id);
      return false;
    }
    return true;
  });

  if (retained.length > config.maxEntries) {
    const excess = retained.length - config.maxEntries;
    const sliceIds = retained.slice(0, excess).map((h) => h.id);
    removedIds.push(...sliceIds);
    retained = retained.slice(excess);
  }

  return { handoffs, retainedHandoffs: retained, removedIds };
}

export function schedulePeriodicCleanup(
  getHandoffs: () => HandoffEntry[],
  config: RetentionConfig,
  onRemoved?: (ids: string[]) => void,
  timers?: TimerManagerLike,
): () => void {
  const fn = () => {
    const handoffs = getHandoffs();
    const result = cleanupHandoffs(handoffs, config);
    if (result.removedIds.length > 0) {
      onRemoved?.(result.removedIds);
    }
  };
  const timer = timers
    ? timers.setInterval(fn, config.cleanupIntervalMs)
    : (() => {
        const t = setInterval(fn, config.cleanupIntervalMs);
        if (t?.unref) t.unref();
        return t;
      })();
  return () => {
    if (timers) timers.clear(timer);
    else clearInterval(timer);
  };
}
