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
import { allowedTaskTargetsText } from "./shared/task-targets.ts";
import { defaultRoutingRecord } from "../routing.ts";

export const firstResponseGuard = guard("first-response-guard", (ctx, input) => {
  if (!input.agent || !input.sessionID) return null;
  const agent = getCurrentAgent(input);
  if (!agent || agent === "tawa") return null;
  const record = ctx.pipelineState?.routing.get(input.sessionID);
  const preferred = record?.preferredAgent ?? record?.directAgent ?? null;
  if (preferred && normalizeName(agent) === normalizeName(preferred)) return null;
  if (TASK_TOOL_NAMES.includes(input.tool) && !ps(ctx).hasAgentResponded(input.sessionID, agent))
    return `🚫 Agent "${input.agent}" has not produced their analysis yet. Produce your analysis first, then dispatch.`;
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
  const record = ctx.pipelineState?.routing.get(input.sessionID ?? "") ?? defaultRoutingRecord();
  const routed = record.source === "classified" && (record.mode === "tawa" || record.mode === "explicit");
  if (!routed || isTawaAgent(input.agent) || (ps(ctx).callDepth.get(input.sessionID ?? "") ?? 0) !== 0) return null;
  if (input.tool !== "edit" && input.tool !== "write" && input.tool !== "bash") return null;
  const targets = allowedTaskTargetsText(input.agent);
  const hint = targets ? ` You may call ${targets} for reconnaissance.` : "";
  return `🚫 bash, edit, and write are blocked while this request is routed. Use your read tools first.${hint}`;
});

export const speculativeDispatchGuard = guard("speculative-dispatch", (ctx, input) => {
  const agentName = normalizeName(input.agent);
  if (isRootLikeAgent(input.agent) || (ps(ctx).callDepth.get(input.sessionID ?? "") ?? 0) !== 0) return null;
  const record = ctx.pipelineState?.routing.get(input.sessionID ?? "") ?? defaultRoutingRecord();
  const preferred = record.preferredAgent ?? record.directAgent ?? null;
  if (preferred) {
    if (agentName === preferred) return null;
    return input.tool === "edit" || input.tool === "write" || input.tool === "bash"
      ? `🚫 This routing is for @${preferred} — use task(desc: '${preferred}') instead of using this tool directly.`
      : null;
  }
  if (record.source === "classified" && record.mode === "explicit") {
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
