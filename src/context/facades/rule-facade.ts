import type { TawassulContext } from "../../context-class.ts";
import type { FetchResult } from "../../context/model-utils.ts";
import { buildModelsInjectionText as buildInjection } from "../../context/build-models-text.ts";
import { logger } from "../../utils/logger.ts";

export async function ruleBuildModelsInjectionText(ctx: TawassulContext, serverUrl?: string): Promise<string> {
  const result = await ctx.modelCache.fetch(ctx.modelManager, false, serverUrl);
  if (!result.serverReachable) {
    logger.warn(
      "⚠️ Could not reach the local server — the models shown are only the defaults (may not include all custom models).",
    );
  }
  return buildInjection(result);
}
export async function ruleFetchAllAvailableModels(
  ctx: TawassulContext,
  force = false,
  serverUrl?: string,
): Promise<FetchResult> {
  return ctx.modelCache.fetch(ctx.modelManager, force, serverUrl);
}