
import type { TawassulContext } from "../../context-class.ts";
import { setLanguage } from "../../translations.ts";
import { initAutoSweep, stopAutoSweep, resetAllState } from "../../hooks/validation-pipeline.ts";
import { resetModelCache } from "../../hooks/guards/shared.ts";
import { logger } from "../../utils/logger.ts";
import { safeCatch } from "../../utils/safe-catch.ts";

export async function lifecycleInit(ctx: TawassulContext): Promise<void> {
  ctx.ensureConfig();
  if (ctx.configManager.config.language) setLanguage(ctx.configManager.config.language);
  await lifecycleLoadConflictDataset(ctx);
  await ctx.lifecycleManager.init();
  ctx.seedCapabilities();
  ctx.memoryWatchdog.start();
  if (ctx.pipelineState) initAutoSweep(ctx.pipelineState);
}

export async function lifecycleDestroy(ctx: TawassulContext): Promise<void> {
  if (ctx.pipelineState) stopAutoSweep(ctx.pipelineState);
  safeCatch(
    () => {
      resetAllState(ctx.pipelineState, ctx.rateLimiter);
    },
    undefined,
    "resetAllState on destroy",
  );
  safeCatch(
    () => {
      resetModelCache();
    },
    undefined,
    "resetModelCache on destroy",
  );
  await ctx.lifecycleManager.destroy();
}

async function lifecycleLoadConflictDataset(ctx: TawassulContext): Promise<void> {
  try {
    const mod = await import("../../conflict-resolver/dataset.json", { with: { type: "json" } });
    const data = mod.default || mod;
    if (Array.isArray(data.scenarios))
      for (const s of data.scenarios)
        ctx.conflictLearner.recordOutcome(
          "dataset-" + s.expectedAction,
          {
            action: s.expectedAction as import("../../conflict-resolver/types.ts").RuleDecision["action"],
            reason: s.rationale,
            confidence: 0.8,
          },
          true,
          "system",
        );
  } catch (e) {
    logger.warn("Failed to load conflict dataset:", e);
  }
}
