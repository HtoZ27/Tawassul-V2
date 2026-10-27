import { t } from "../translations.ts";
import type { HandoffEntry } from "../context.ts";
import { logger } from "../utils/logger.ts";

export const HOST_SHUTDOWN_CAP_MS = 10_000;
export const DISPOSE_BUDGET_MS = 7_500;

export interface DisposeContext {
  handoffs: HandoffEntry[];
  detectDroppedHandoffs: () => void;
  destroy: () => Promise<void>;
}

export type DisposeOutcome = "completed" | "timed-out";

export async function disposeWithinBudget(
  destroy: () => Promise<void>,
  budgetMs: number = DISPOSE_BUDGET_MS,
): Promise<DisposeOutcome> {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    await destroy();
    return "completed";
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DisposeOutcome>((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), budgetMs);
    const handle = timer as unknown as { unref?: () => void };
    handle.unref?.();
  });
  try {
    return await Promise.race([destroy().then(() => "completed" as const), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createDisposeHook(ctx: DisposeContext, options: { budgetMs?: number } = {}) {
  return async (): Promise<void> => {
    try {
      const allHandoffs = ctx.handoffs instanceof Map ? [...ctx.handoffs.values()] : ctx.handoffs;
      const pending = allHandoffs.filter((h) => h.status === "pending").length;
      const active = allHandoffs.filter((h) => h.status === "accepted").length;
      if (pending > 0 || active > 0) {
        logger.warn(t("disposeWarning", { p: String(pending), a: String(active) }));
      }
      const budgetMs = options.budgetMs ?? DISPOSE_BUDGET_MS;
      const outcome = await disposeWithinBudget(ctx.destroy, budgetMs);
      if (outcome === "timed-out") {
        logger.warn(`[tawassul] dispose exceeded ${budgetMs}ms; releasing before the host shutdown cap`);
      }
    } catch (e) {
      logger.warn("[tawassul] dispose hook error:", e);
    }
  };
}
