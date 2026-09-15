import {
  guard,
  ps,
  getCurrentAgent,
  normalizeName,
  PAUSE_BYPASS_TOOLS,
  checkPlanModeAllowed,
  canSpawnTask,
  SecurityPolicy,
  isTawaAgent,
  isTawassulTool,
  isRootLikeAgent,
} from "./shared.ts";
import { TASK_TOOL_NAMES } from "../../security-policy.ts";

export const firstResponseGuard = guard("first-response-guard", (ctx, input) => {
  if (!input.agent || !input.sessionID) return null;
  const agent = getCurrentAgent(input);
  if (!agent || agent === "tawa") return null;
  if (ctx.directRoutingAgent && normalizeName(agent) === normalizeName(ctx.directRoutingAgent)) return null;
  if (TASK_TOOL_NAMES.includes(input.tool) && !ps(ctx).hasAgentResponded(input.sessionID, agent))
    return `🚫 Agent "${input.agent}" has not produced their analysis yet. You must produce your analysis first before using ${input.tool}().`;
  return null;
});

export const pauseStateGuard = guard("pause-state", (ctx, input) =>
  ctx.pauseState?.active && !PAUSE_BYPASS_TOOLS.has(input.tool)
    ? `⏸️ System paused: "${ctx.pauseState.reason}". Use resume() to continue.`
    : null,
);

export const agentAutoPauseGuard = guard("agent-auto-pause", (ctx, input) =>
  ctx.healthTracker?.isAutoPaused && input.agent && ctx.healthTracker.isAutoPaused(input.agent)
    ? `⏸️ Agent "${input.agent}" is auto-paused (stuck). Use resume() to continue.`
    : null,
);

export const planModeGuard = guard("plan-mode", (ctx, input) => {
  if (ctx.detectedMode !== "plan") return null;
  const planCheck = checkPlanModeAllowed(input.tool);
  if (!planCheck.allowed) return planCheck.error ?? "🔵 Plan mode: tool not allowed";
  if (input.tool === "task" && input.sessionID && !canSpawnTask(input.sessionID))
    return "🔵 **Plan mode**: maximum 3 sub-agent spawns per session. Switch to **Build** mode for more.";
  return null;
});

export const phaseGatingGuard = guard("phase-gating", (ctx, input) => {
  const phaseConfig = ctx.pipelineManager?.getCurrentPhaseConfig?.();
  if (
    phaseConfig &&
    phaseConfig.allowWrite === false &&
    (input.tool === "edit" || input.tool === "write" || input.tool === "bash")
  )
    return `🎯 **Phase gating**: phase "${phaseConfig.phase}" is read-only. Complete the current phase or switch to a writable phase.`;
  return null;
});

export const riskGatingGuard = guard("risk-gating", (ctx, input) => {
  if (!ctx.discussionManager || !(input.tool === "edit" || input.tool === "write" || input.tool === "bash"))
    return null;
  const allDiscussions = ctx.discussionManager.getAllDiscussions();
  let maxRisk = 0;
  for (const d of allDiscussions) {
    if (
      typeof d === "object" &&
      d !== null &&
      "phase" in d &&
      typeof (d as Record<string, unknown>).phase === "string"
    ) {
      const discussion = d as { phase: string; result?: { tasks?: unknown[] } };
      if (discussion.result?.tasks) {
        const r = ctx.discussionManager.calculateRiskScore(discussion.result.tasks);
        if (r > maxRisk) maxRisk = r;
      }
    }
  }
  if (maxRisk > 0.7)
    return `⚠️ **Review Gate**: Risk is very high (${maxRisk.toFixed(2)}). Invoke review before proceeding with execution.`;
  return null;
});

export const tawaRoutingEnforcementGuard = guard("tawa-routing-enforcement", (ctx, input) => {
  const routed = ctx.userMentionedTawa || ctx.userExplicitDispatch === true;
  if (!routed || isTawaAgent(input.agent) || (ps(ctx).callDepth.get(input.sessionID ?? "") ?? 0) !== 0) return null;
  const why = ctx.userMentionedTawa ? "@tawa" : "dispatch command";
  return input.tool === "edit" || input.tool === "write" || input.tool === "bash"
    ? `🚫 The user mentioned ${why} — use task(desc: 'tawa') for dispatch instead of using this tool directly.`
    : null;
});

export const speculativeDispatchGuard = guard("speculative-dispatch", (ctx, input) => {
  const agentName = normalizeName(input.agent);
  if (isRootLikeAgent(input.agent) || (ps(ctx).callDepth.get(input.sessionID ?? "") ?? 0) !== 0) return null;
  if (ctx.directRoutingAgent) {
    if (agentName === ctx.directRoutingAgent) return null;
    return input.tool === "edit" || input.tool === "write" || input.tool === "bash"
      ? `🚫 This routing is for @${ctx.directRoutingAgent} — use task(desc: '${ctx.directRoutingAgent}') instead of using this tool directly.`
      : null;
  }
  if (ctx.userExplicitDispatch === true) {
    return input.tool === "edit" || input.tool === "write" || input.tool === "bash"
      ? "🚫 You requested dispatch via agents — use task() instead of using this tool directly."
      : null;
  }
  return null;
});

export const cognitiveBlockerGuard = guard("cognitive-blocker", (_ctx, input, output) => {
  if (input.tool !== "task" || !isTawaAgent(input.agent)) return null;
  const desc = output.args?.desc;
  const subagent = output.args?.subagent;
  const isParallel = (Array.isArray(desc) && desc.length > 1) || (Array.isArray(subagent) && subagent.length > 1);
  if (!isParallel) {
    const descVal = Array.isArray(desc) ? desc[0] : desc;
    const descStr = typeof descVal === "string" ? descVal : undefined;
    const typeStr = typeof output.args?.type === "string" ? output.args.type : undefined;
    const promptStr = typeof output.args?.prompt === "string" ? output.args.prompt : undefined;
    const routing = SecurityPolicy.validateTaskRouting({ desc: descStr, type: typeStr, prompt: promptStr });
    if (!routing.allowed) return routing.error ?? "🚫 Task routing blocked";
  }
  return null;
});

export const tawassulToolPermissionsGuard = guard("tawassul-tool-permissions", (_ctx, input) => {
  if (!isTawassulTool(input.tool)) return null;
  if (!input.agent || normalizeName(input.agent) === "undefined") return null;
  const result = SecurityPolicy.checkTawassulToolPermission(input.agent, input.tool);
  if (result.allowed) return null;
  return `${result.error}\n💡 Tip: check the "Allowed tools (tawassul)" section in the agent file to choose the correct tool.`;
});

export const securityPolicyGuard = guard("security-policy", (_ctx, input, output) => {
  const result = SecurityPolicy.enforce({ agent: input.agent ?? "unknown", tool: input.tool, args: output.args ?? {} });
  return result.allowed ? null : result.error;
});
