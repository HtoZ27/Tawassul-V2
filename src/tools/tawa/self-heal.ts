import { tool } from "../../tool.ts";
import { t } from "../../translations.ts";
import type { ToolDefinition } from "../../tool.ts";
import type { SelfHealEngine } from "../../services/self-heal-engine.ts";
import { normalizeName } from "../../utils/name-utils.ts";

export function buildSelfHealTool(selfHealEngine: SelfHealEngine): ToolDefinition {
  return tool({
    description: "Trigger self-healing for failed or degraded agents.",
    args: {
      agent: tool.schema.string().describe("Agent ID to heal (e.g. @dev, @analyst)"),
    },
    async execute(args) {
      const agent = normalizeName(args.agent);
      if (!agent) {
        return { title: "Self Heal", output: t("twSpecifyAgent") };
      }
      const healthy = selfHealEngine.isHealthy(agent);
      if (healthy) {
        return { title: "Self Heal", output: `Agent ${agent} is healthy. No healing needed.` };
      }
      try {
        const result = await selfHealEngine.heal({ component: agent, error: new Error("manual heal via self_heal") });
        return {
          title: "Self Heal",
          output: t("twHealResult", {
            agent,
            status: result.success ? t("twHealOk") : (result.reason ?? ""),
            action: result.action ?? "",
          }),
          metadata: { ...result },
        };
      } catch (e) {
        return {
          title: "Self Heal",
          output: t("twHealFail", { agent, err: (e as Error).message }),
          metadata: { error: String(e) },
        };
      }
    },
  });
}
