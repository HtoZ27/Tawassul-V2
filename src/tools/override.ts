import { tool } from "../tool.ts";
import type { TawassulContext } from "../context.ts";
import { t } from "../translations.ts";
import type { HandoffService } from "../services/handoff-service.ts";
import { normalizeName } from "../utils/name-utils.ts";

export function buildOverrideTool(ctx: TawassulContext, handoffService?: HandoffService) {
  return tool({
    description: [
      "Override — correct routing or handoff decisions made by the system.",
      "Use exactly ONE action per call:",
      "• REDIRECT — send a pending handoff to a different agent. Required: handoffId, to. Optional: reason.",
      "• CANCEL — cancel a pending handoff. Required: handoffId. Optional: reason.",
      "• FORCE-COMPLETE — mark a handoff as completed. Required: handoffId, force: true. Optional: reason.",
      "• REROUTE — tell the system which agent should handle the current message. Required: to. Optional: reason.",
      "You can ALWAYS use this tool — even during pause.",
      "The system learns from your overrides to improve future routing.",
    ].join("\n"),
    args: {
      handoffId: tool.schema.string().optional().describe("Handoff ID to redirect/cancel/force-complete (e.g. H-001)"),
      to: tool.schema.string().optional().describe("Target agent (for redirect/reroute)"),
      force: tool.schema.boolean().optional().describe("Force-complete a handoff (use with handoffId)"),
      reason: tool.schema.string().optional().describe("Why you are overriding (helps the system learn)"),
    },
    async execute(args, cctx) {
      const handoffId = typeof args.handoffId === "string" ? args.handoffId : undefined;
      const to = typeof args.to === "string" ? args.to : undefined;
      const force = args.force === true;
      const reason = typeof args.reason === "string" ? args.reason : undefined;

      if (handoffId && to && !force) {
        const targetAgent = normalizeName(to);
        if (targetAgent === "tawa" && normalizeName(cctx.agent) !== "tawa") {
          return {
            output: `🚫 Redirecting a handoff to @tawa is forbidden. Results return to the caller. Redirect it to a registered agent, or complete your work and return the result.`,
          };
        }

        const h = ctx.handoffs.get(handoffId);
        if (!h) return { output: t("handoffNotFound", { id: handoffId }) };
        if (h.status === "completed") return { output: t("handoffAlreadyComplete", { id: handoffId }) };
        if (h.status !== "pending") {
          return { output: `❌ Handoff ${handoffId} has status "${h.status}" — can only redirect pending handoffs.` };
        }

        const oldTo = h.to;
        if (!handoffService) {
          return { output: "❌ HandoffService is unavailable. Cannot redirect." };
        }
        const result = await handoffService.redirectHandoff(handoffId, to, cctx.agent);
        if (!result.success) {
          return { output: `❌ ${result.message}` };
        }
        return {
          title: `🔄 ${handoffId} redirected: ${oldTo} → ${to}`,
          output: [
            `✅ **${handoffId} redirected**`,
            `**From:** ${oldTo} → **To:** ${to}`,
            reason ? `**Reason:** ${reason}` : "",
            "",
            t("ovLearning"),
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { handoff: result.handoff, override: "redirect", reason },
        };
      }

      if (handoffId && force) {
        if (normalizeName(cctx.agent) === "tawa") {
          return {
            output:
              '⛔ @tawa is not allowed to force-complete. Use override(handoffId: "' +
              handoffId +
              '", to: "<a registered agent>") to redirect instead.',
          };
        }
        const h = ctx.handoffs.get(handoffId);
        if (!h) return { output: t("handoffNotFound", { id: handoffId }) };
        if (h.status === "completed") return { output: t("handoffAlreadyComplete", { id: handoffId }) };
        if (h.status === "cancelled") {
          return { output: `❌ Handoff ${handoffId} is cancelled — cannot force-complete a cancelled handoff.` };
        }
        if (normalizeName(h.from) !== normalizeName(cctx.agent) && normalizeName(cctx.agent) !== "analyst") {
          return {
            output: `⛔ Force-complete is only allowed by the originating agent (${h.from}) or @analyst. You are: ${cctx.agent}`,
          };
        }

        if (!handoffService) {
          return { output: "❌ HandoffService is unavailable. Cannot force-complete." };
        }
        const result = await handoffService.completeHandoff(handoffId, cctx.agent);
        if (!result.success) {
          return { output: `❌ ${result.message}` };
        }
        return {
          title: `✅ ${handoffId} force-completed`,
          output: [
            `✅ **${handoffId} force-completed**`,
            `**Task:** ${h.task}`,
            reason ? `**Reason:** ${reason}` : "",
            "",
            t("ovLearning"),
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { handoff: result.handoff, override: "force-complete", reason },
        };
      }

      if (handoffId && !to && !force) {
        const h = ctx.handoffs.get(handoffId);
        if (!h) return { output: t("handoffNotFound", { id: handoffId }) };
        if (h.status === "completed") return { output: t("handoffAlreadyComplete", { id: handoffId }) };
        if (h.status !== "pending") {
          return { output: `❌ Handoff ${handoffId} has status "${h.status}" — can only cancel pending handoffs.` };
        }

        if (!handoffService) {
          return { output: "❌ HandoffService is unavailable. Cannot cancel." };
        }
        const result = await handoffService.cancelHandoff(handoffId, cctx.agent);
        if (!result.success) {
          return { output: `❌ ${result.message}` };
        }
        return {
          title: `🚫 ${handoffId} cancelled`,
          output: [
            `✅ **${handoffId} cancelled**`,
            `**Task:** ${h.task}`,
            reason ? `**Reason:** ${reason}` : "",
            "",
            t("ovLearning"),
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { handoff: h, override: "cancel", reason },
        };
      }

      if (!handoffId && to) {
        const targetAgent = normalizeName(to);
        if (targetAgent === "tawa" && normalizeName(cctx.agent) !== "tawa") {
          return { output: `🚫 Preferred reroute to @tawa is forbidden. Name a registered agent instead.` };
        }
        ctx.directRoutingAgent = targetAgent;
        ctx.updateLastActive(cctx.agent);
        ctx.saveState();

        return {
          title: `🔄 Reroute preference set: ${to}`,
          output: [
            `✅ **Preferred routing set**`,
            `**Preferred agent:** ${to}`,
            reason ? `**Reason:** ${reason}` : "",
            "",
            "💡 The system will use this preference in upcoming messages.",
            "💡 You can use this tool at any time to change the routing.",
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { reroute: true, to, reason },
        };
      }

      return {
        output: [
          "❌ **Invalid override usage**",
          "",
          "You must specify one of:",
          "- `handoffId` + `to` → to redirect a handoff",
          "- `handoffId` + `force: true` → to force-complete a handoff",
          "- `handoffId` alone → to cancel a handoff",
          "- `to` alone → to change the preferred routing",
          "",
          "Examples:",
          '  override(handoffId: "H-001", to: "@dev")',
          '  override(handoffId: "H-001")',
          '  override(to: "@designer")',
        ].join("\n"),
      };
    },
  });
}