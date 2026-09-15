import type { MessageUpdatedContext } from "./message-updated-types.ts";
import { logger } from "../utils/logger.ts";

export async function injectTawaGuidance(
  ctx: MessageUpdatedContext,
  output: {
    message: { role: string; text?: string; [key: string]: unknown };
    parts: { type: string; text?: string; [key: string]: unknown }[];
  },
): Promise<void> {
  const modelsText = await ctx.buildModelsInjectionText();
  if (modelsText && Array.isArray(output.parts)) {
    output.parts.push({
      type: "text" as const,
      text: `\n\n${modelsText}`,
    });
  }

  
  
  
  try {
    const predEnabled = (ctx.config as unknown as { innovations?: Record<string, { enabled?: boolean }> })?.innovations
      ?.predictiveRouter?.enabled;
    if (predEnabled === false) return;
    const taskText = typeof output.message?.text === "string" ? output.message.text : "";
    const router = ctx.predictiveRouter;
    const agents = ctx.getAgents?.() ?? [];
    if (taskText && router && typeof router.predict === "function" && agents.length > 0) {
      const decision = router.predict({ taskDescription: taskText, availableAgents: agents });
      const top = [...(decision.allPredictions ?? [])].sort(
        (a, b) => (b.successProbability ?? 0) - (a.successProbability ?? 0),
      )[0];
      if (top && top.agent && top.agent !== "unknown") {
        
        const sampleSize = (top as { sampleSize?: number }).sampleSize ?? 0;
        const text =
          sampleSize < 6
            ? `\n\n💡 **توجيه مقترح:** الوكيل الأنسب لهذه المهمة هو **${top.agent}** — وكيل مرشّح (بيانات قليلة، ${sampleSize} عينة).`
            : `\n\n💡 **توجيه مقترح:** الوكيل الأنسب لهذه المهمة هو **${top.agent}** (احتمال النجاح ≈ ${Math.round((top.successProbability ?? 0) * 100)}%).`;
        output.parts.push({
          type: "text" as const,
          text,
        });
      }
    }
  } catch (e) {
    logger.debug("[tawassul] predictiveRouter.predict skipped:", (e as Error)?.message ?? e);
  }
}
