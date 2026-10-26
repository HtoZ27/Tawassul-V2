import { logger } from "../utils/logger.ts";
import type { ToolContext } from "../tool.ts";
import type { V2Context, V2Registration, V2ToolContext } from "./types.ts";

export const ASK_ACTION = "tawassul.ask";

interface PermissionEvaluation {
  action?: string;
  effect?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export async function registerAskPermission(ctx: V2Context): Promise<V2Registration | undefined> {
  const hook = ctx.permission?.hook;
  if (!hook || !ctx.permission?.assert) return undefined;
  try {
    return await hook("evaluate", (raw) => {
      const evaluation = raw as PermissionEvaluation;
      if (evaluation.action !== ASK_ACTION) return;
      evaluation.effect = "ask";
      const title = evaluation.metadata?.title;
      if (typeof title === "string" && title.length > 0) evaluation.message = title;
    });
  } catch (e) {
    logger.warn("[tawassul] v2 ask: permission evaluate hook registration failed — ask disabled:", e);
    return undefined;
  }
}

export function createAskBridge(
  ctx: V2Context,
  context: V2ToolContext,
  enabled: boolean,
): ToolContext["ask"] {
  if (!enabled) return undefined;
  const assert = ctx.permission?.assert;
  if (!assert) return undefined;
  return async (title, options) => {
    if (options.type !== "confirm") {
      logger.error(
        `[tawassul] v2 ask: ${options.type} elicitation has no host bridge; failing closed instead of assuming an answer`,
      );
      throw new Error(
        `[tawassul] ${options.type} questions cannot be delivered on this host; no answer was assumed`,
      );
    }
    try {
      await assert({
        sessionID: context.sessionID,
        agent: context.agent,
        action: ASK_ACTION,
        resources: [title.slice(0, 200)],
        metadata: { title, default: options.default },
        source: { type: "tool", messageID: context.messageID, id: context.id },
      });
      return true;
    } catch (e) {
      logger.info(
        `[tawassul] v2 ask rejected for ${context.sessionID}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  };
}
