
import {
  effect,
  ps,
  detectTawaCalls,
  cognitiveEffectsApplier,
  proxyAgentRoutingStage,
  normalizeName,
} from "./shared.ts";
import { logger } from "../../utils/logger.ts";

export const tawaCallDetectorEffect = effect("tawa-call-detector", (ctx, input, output) => {
  if (!input.sessionID) return;
  const caller = normalizeName(input.agent);
  if (!caller) return;
  const tawaFields = detectTawaCalls(output.args);
  if (tawaFields) {
    ps(ctx).recordTawaCallEntry(input.sessionID, {
      caller,
      tool: input.tool,
      fields: tawaFields,
      blocked: false,
      timestamp: Date.now(),
    });
    
    logger.warn(
      `[tawassul] 🚨 Tawa call detected: agent="${caller}" tool="${input.tool}" fields=[${tawaFields.join(",")}] session="${input.sessionID}"`,
    );
  }
});

export const cognitiveEffectsEffect = effect("cognitive-effects", cognitiveEffectsApplier);

export const proxyRoutingEffect = effect("proxy-routing", proxyAgentRoutingStage);

export const agentMatcherRoutingEffect = effect("agent-matcher-routing", async (ctx, input, output) => {
  if (input.tool !== "task") return;
  const taskText = ((Array.isArray(output.args?.desc) ? output.args?.desc[0] : output.args?.desc) ||
    output.args?.prompt ||
    "") as string;
  if (taskText && ctx.agentMatcher) {
    try {
      const best = ctx.agentMatcher.findBestAgent({
        task: taskText,
        specializations: [],
        requireAvailability: true,
        
        
        excludeAgents: [...(input.agent ? [input.agent] : []), "tawa", "@tawa"],
      });
      if (best) {
        logger.debug(`Agent Matcher: recommends ${best.agent} (score: ${(best.score * 100).toFixed(0)}%)`);
        
        
        if (
          ctx.configManager?.config.routing?.applyAgentMatcherSuggestion &&
          !output.args?.subagent &&
          !output.args?.agent
        ) {
          output.args = output.args ?? {};
          output.args.subagent = best.agent;
          logger.info(`[tawassul] agent-matcher-routing applied -> ${best.agent}`);
        }
      }
    } catch (e) {
      logger.debug("[tawassul] agent-matcher-routing skipped:", (e as Error)?.message ?? e);
    }
  }
});
