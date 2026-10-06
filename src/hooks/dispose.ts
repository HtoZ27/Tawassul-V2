

import { t } from "../translations.ts";
import type { HandoffEntry } from "../context.ts";
import { logger } from "../utils/logger.ts";



export interface DisposeContext {
  handoffs: HandoffEntry[];
  detectDroppedHandoffs: () => void;
  
  destroy: () => Promise<void>;
}



export function createDisposeHook(ctx: DisposeContext) {
  return async () => {
    try {
      const allHandoffs = ctx.handoffs instanceof Map ? [...ctx.handoffs.values()] : ctx.handoffs;
      const pending = allHandoffs.filter((h) => h.status === "pending").length;
      const active = allHandoffs.filter((h) => h.status === "accepted").length;
      if (pending > 0 || active > 0) {
        logger.warn(t("disposeWarning", { p: String(pending), a: String(active) }));
      }
      
      try {
        await ctx.destroy();
      } catch (e) {
        logger.warn("[tawassul] destroy failed:", e);
      }

    } catch (e) {
      logger.warn("[tawassul] dispose hook error:", e);
    }
  };
}
