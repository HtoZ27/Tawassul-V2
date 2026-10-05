import {
  guard,
  effect,
  ps,
  getCurrentAgent,
  extractTaskTargets,
  targetsAreExploreOrGeneral,
  MAX_CALL_DEPTH,
  MAX_TOTAL_TASKS,
  getDispatchTargets,
  isNonRootCycle,
  getTaskAgents,
  TAWA_AGENT,
  TASK_PERMISSIONS,
  TAWASSUL_ROLES,
  SecurityPolicy,
  msg,
  isTawassulTool,
  normalizeName,
  isRootLikeAgent,
} from "./shared.ts";
import { remaining, checkCap } from "../../services/iteration-budget.ts";
import { TASK_TOOL_NAMES, GENERAL_REPORT_ONLY_CALLERS } from "../../security-policy.ts";
import { t } from "../../translations.ts";
import { logger } from "../../utils/logger.ts";
import { resolveRole } from "../../utils/agent.ts";

export const callDepthGuard = guard("call-depth", (ctx, input, output) => {
  if (input.tool !== "task" || !input.sessionID) return null;
  if (isRootLikeAgent(input.agent)) return null;
  const targets = extractTaskTargets(output.args);
  if (targetsAreExploreOrGeneral(targets)) {
    if (ps(ctx).getExemptCallCount(input.sessionID) < ps(ctx).MAX_EXEMPT_CALLS) return null;
  }
  const currentDepth = (ps(ctx).callDepth.get(input.sessionID) ?? 0) + 1;
  if (currentDepth > MAX_CALL_DEPTH) {
    return `🚫 Call depth exceeded: cannot exceed ${MAX_CALL_DEPTH} levels of nested calls. Try: use handoff instead of nested task(), or split the task into smaller parts.`;
  }
  return checkCap(input.agent ?? "", currentDepth, 0, 0);
});

export const selfCallGuard = guard("self-call", (_ctx, input, output) => {
  if (!TASK_TOOL_NAMES.includes(input.tool) || !input.agent) return null;
  const targets = getDispatchTargets(input, output);
  const caller = getCurrentAgent(input);
  return caller && targets.includes(caller)
    ? `🚫 Agent "${input.agent}" cannot ${input.tool === "task" ? "call" : "handoff"} itself.`
    : null;
});

export const tawaRedirectGuard = guard("tawa-redirect", (ctx, input, output) => {
  if (!TASK_TOOL_NAMES.includes(input.tool)) return null;
  if (!input.agent) return null;
  const caller = getCurrentAgent(input);
  if (isRootLikeAgent(input.agent) || caller === "tawa") return null;
  const targets = getDispatchTargets(input, output);
  const foundFields: string[] = [];
  if (targets.includes("tawa")) foundFields.push(...targets.filter((t) => t === "tawa"));
  const isT = (v: unknown) => normalizeName(v) === "tawa";
  if (isT(output.args?.model)) foundFields.push("model");
  if (isT(output.args?.type)) foundFields.push("type");
  if (Array.isArray(output.args?.type) && (output.args.type as unknown[]).some(isT)) foundFields.push("type[]");
  if (input.tool === "handoff" && typeof output.args?.parallelCopies === "number" && output.args.parallelCopies > 0)
    foundFields.push("parallelCopies⚠️");
  if (foundFields.length === 0) return null;
  const records = input.sessionID ? ps(ctx).getTawaCallers(input.sessionID) : undefined;
  if (records && records.length > 0) {
    const last = records[records.length - 1];
    if (last) last.blocked = true;
  }
  logger.warn(
    `[tawassul] 🚨 Tawa redirect blocked: agent="${input.agent}" tool="${input.tool}" fields=${JSON.stringify([...new Set(foundFields)])} session="${input.sessionID}"`,
  );
  return `🚫 Agent "${input.agent}" cannot redirect to @tawa. Complete the task yourself or use task() to another agent.`;
});

export const sessionRequiredGuard = guard("session-required", (_ctx, input) => {
  if (input.tool !== "task") return null;
  if (!input.sessionID) return "🚫 sessionID is required to call task(). Try: restart the session or contact the user.";
  return null;
});

export const internalDuplicateGuard = guard("internal-duplicate", (_ctx, input, output) => {
  if (input.tool !== "task" || !input.agent) return null;
  const { allRaw } = getTaskAgents(output);
  const seen = new Set<string>();
  for (const agent of allRaw) {
    if (agent && seen.has(agent))
      return `🚫 Internal duplicate: agent "${agent}" was called twice in the same call. Try: remove the duplicate from args.subagent.`;
    if (agent) seen.add(agent);
  }
  return null;
});

export const crossCallDuplicateGuard = guard("cross-call-duplicate", (ctx, input, output) => {
  if (input.tool !== "task" || !input.sessionID) return null;
  const { agents } = getTaskAgents(output);
  if (agents.size === 0) return null;
  for (const agent of agents) {
    const p = ps(ctx);
    if (isNonRootCycle(input.sessionID, agent, p))
      return `🚫 Call loop: agent "${agent}" was called twice in the same chain. Try: use different agents in the chain, or start a new task for the user.`;
    if (agent && !p.acquireAgentLock(input.sessionID, agent))
      return `🚫 Concurrent call: agent "${agent}" is currently being called in another request.`;
  }
  return null;
});

export const handoffDuplicateGuard = guard("handoff-duplicate", (ctx, input, output) => {
  if ((input.tool !== "handoff" && input.tool !== "fasttrack") || !input.sessionID) return null;
  const to = output.args?.to;
  if (typeof to === "string" && to.trim()) {
    const target = normalizeName(to);
    if (isNonRootCycle(input.sessionID, target, ps(ctx)))
      return `🚫 Call loop: agent "${target}" was called twice in the same chain (via handoff). Try: use different agents, or start a new task for the user.`;
  }
  return null;
});

export const totalTaskLimitGuard = guard("total-task-limit", (ctx, input, output) => {
  if (input.tool !== "task" || !input.sessionID) return null;
  const targets = extractTaskTargets(output.args);
  if (targetsAreExploreOrGeneral(targets)) {
    if (ps(ctx).getExemptCallCount(input.sessionID) < ps(ctx).MAX_EXEMPT_CALLS) return null;
  }
  const count = (ps(ctx).totalTaskCalls.get(input.sessionID) ?? 0) + 1;
  return count > MAX_TOTAL_TASKS
    ? `🚫 Exceeded the maximum number of task() calls: ${MAX_TOTAL_TASKS}. Try: use handoff for distribution, merge tasks, or start a new task for the user.`
    : null;
});

export const sameRoleDistributionGuard = guard("same-role-distribution", (_ctx, input, output) => {
  if (!TASK_TOOL_NAMES.includes(input.tool) || !input.agent) return null;
  const targets = getDispatchTargets(input, output);
  const caller = getCurrentAgent(input);
  if (isRootLikeAgent(input.agent) || caller === "tawa") return null;
  const callerRole = resolveRole(caller) ?? caller;
  for (const target of targets) {
    if (target === "tawa" || target === "explore" || target === "general") continue;
    const targetRole = resolveRole(target) ?? target;
    if (callerRole && callerRole === targetRole)
      return `🚫 Agent "${input.agent}" cannot dispatch to "${target}" — same specialty "${callerRole}". Use @tawa for distribution.`;
  }
  return null;
});

export const taskToolAuthorizationGuard = guard("task-tool-authorization", (_ctx, input, output) => {
  if (input.tool !== "task") return null;
  const caller = getCurrentAgent(input);
  if (isRootLikeAgent(input.agent) || caller === TAWA_AGENT) return null;
  const callerRole = resolveRole(caller) ?? caller;
  if (!TAWASSUL_ROLES.includes(callerRole))
    return `🚫 Agent "${input.agent}" cannot use task(). Distribution is via @tawa only.`;
  const targets = extractTaskTargets(output.args);
  if (targets.length === 0) return `🚫 Agent "${input.agent}" cannot use task(). Distribution is via @tawa only.`;
  const allowed = TASK_PERMISSIONS[callerRole];
  if (!allowed) return `🚫 Agent "${input.agent}" cannot use task(). Distribution is via @tawa only.`;
  if (!targets.every((t) => allowed.includes(t)))
    return `🚫 Agent "${input.agent}" cannot use task(). Distribution is via @tawa only.`;

  if (GENERAL_REPORT_ONLY_CALLERS.has(callerRole) && targets.includes("general")) {
    const CAVEAT = t("generalReportOnlyCaveat") + " [report-only]";
    const MARKER = "[report-only]";
    logger.warn(`[tawassul] GENERAL_REPORT_ONLY: ${caller} ⇒ general (report/results scope only)`);
    logger.audit("GENERAL_REPORT_ONLY", { agent: input.agent, callerRole, targets });
    const argsRec = output.args as Record<string, unknown>;
    let base = typeof argsRec.prompt === "string" ? argsRec.prompt : "";
    if (!base.trim() && typeof argsRec.description === "string") base = argsRec.description;
    if (!base.includes(MARKER)) {
      argsRec.prompt = base + CAVEAT;
    }
  }
  return null;
});

export const deletedAgentGuard = guard("deleted-agent", (_ctx, input, output) => {
  if (!TASK_TOOL_NAMES.includes(input.tool) || !input.agent) return null;
  for (const agent of getDispatchTargets(input, output)) {
    if (SecurityPolicy.checkDeletedAgent(agent))
      return `🚫 Forbidden: agent "${agent}" is deleted from the system. Try: use another agent from the same role (e.g. dev-pickle or dev-mimo).`;
  }
  return null;
});

export const circuitBreakerGuard = guard("circuit-breaker", (ctx, input, output) => {
  if (!TASK_TOOL_NAMES.includes(input.tool) || !input.agent) return null;
  for (const agent of getDispatchTargets(input, output)) {
    if (ctx.circuitBreaker?.evaluate(agent) === "OPEN") {
      const available = ctx.circuitBreaker
        .getAllStates()
        .filter((s) => s.state !== "OPEN")
        .map((s) => s.agent);
      return msg("agentUnavailable", "en", {
        agent,
        fallback: available.length > 0 ? available.join(", ") : "try again later",
      });
    }
  }
  return null;
});

export const budgetGuard = guard("iteration-budget", (_ctx, input, output) => {
  if (!TASK_TOOL_NAMES.includes(input.tool) || !input.agent) return null;
  for (const agent of getDispatchTargets(input, output)) {
    if (remaining(agent, input.sessionID) <= 0) {
      return `🚫 Agent "${agent}" is out of budget. Try again later or use another agent.`;
    }
  }
  return null;
});

export const rateLimitGuard = guard("rate-limit", (ctx, input) => {
  if (!isTawassulTool(input.tool)) return null;
  if (!ctx.rateLimiter) return null;
  const agentKey = normalizeName(input.agent || "user");
  const fullModel = ctx.getAgentModel(agentKey) || "default/default";
  const [provider, model] = fullModel.includes("/")
    ? [fullModel.split("/")[0] ?? "default", fullModel.split("/")[1] ?? fullModel]
    : ["default", fullModel];
  return ctx.rateLimiter.checkRateLimit(agentKey, provider, model)
    ? null
    : `⚠️ Rate limit exceeded for agent ${agentKey} (model: ${fullModel}). Please wait before making more requests.`;
});

export const commitCallDepthEffect = effect("commit-call-depth", (ctx, input, output) => {
  if (input.tool === "task" && input.sessionID) {
    const p = ps(ctx);
    const isRoot = isRootLikeAgent(input.agent);
    if (isRoot) {
      p.totalTaskCalls.set(input.sessionID, (p.totalTaskCalls.get(input.sessionID) ?? 0) + 1);
      return;
    }
    const targets = extractTaskTargets(output.args);
    if (targetsAreExploreOrGeneral(targets)) {
      const count = ps(ctx).incrementExemptCalls(input.sessionID);
      if (count <= ps(ctx).MAX_EXEMPT_CALLS) return;
    }
    p.callDepth.set(input.sessionID, (p.callDepth.get(input.sessionID) ?? 0) + 1);
    p.totalTaskCalls.set(input.sessionID, (p.totalTaskCalls.get(input.sessionID) ?? 0) + 1);
  }
});