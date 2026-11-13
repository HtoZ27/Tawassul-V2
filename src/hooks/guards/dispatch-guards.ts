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
import { remaining, checkCap, assignTier } from "../../services/iteration-budget.ts";
import { analyzeEffort } from "../../services/effort-analyzer.ts";
import { TASK_TOOL_NAMES, GENERAL_REPORT_ONLY_CALLERS } from "../../security-policy.ts";
import { t } from "../../translations.ts";
import { logger } from "../../utils/logger.ts";
import { resolveRole } from "../../utils/agent.ts";
import { allowedTaskTargetsText } from "./shared/task-targets.ts";
import { REPORT_PATH_CLAUSE, hasReportPathSentinel, type RoutingMode } from "../routing.ts";
import { getUsageLedger } from "../../services/usage-ledger.ts";
import { INJECTION_BUDGETS } from "../../services/injection-budget.ts";

const REPORT_CLAUSE_BYTES = Buffer.byteLength(REPORT_PATH_CLAUSE, "utf8");
if (REPORT_CLAUSE_BYTES > INJECTION_BUDGETS.r1) {
  logger.warn(`[tawassul] the report path clause is ${REPORT_CLAUSE_BYTES} B, over the ${INJECTION_BUDGETS.r1} B budget`);
}

export const callDepthGuard = guard("call-depth", (ctx, input, output) => {
  if (input.tool !== "task" || !input.sessionID) return null;
  if (isRootLikeAgent(input.agent)) return null;
  const targets = extractTaskTargets(output.args);
  if (targetsAreExploreOrGeneral(targets)) {
    if (ps(ctx).getExemptCallCount(input.sessionID) < ps(ctx).MAX_EXEMPT_CALLS) return null;
  }
  const state = ps(ctx);
  const currentDepth = (state.callDepth.get(input.sessionID) ?? 0) + 1;
  if (currentDepth > MAX_CALL_DEPTH) {
    return `🚫 Call depth exceeded: cannot exceed ${MAX_CALL_DEPTH} levels of nested calls. Return your result to your caller so it can decide the next step.`;
  }
  const subagentCount = state.pendingAgentLocks.get(input.sessionID)?.size ?? 0;
  const tokens = getUsageLedger()?.sessionSnapshot(input.sessionID)?.billable ?? 0;
  const cap = checkCap(input.agent ?? "", currentDepth, subagentCount, tokens);
  return cap ? `🚫 ${cap}. Return your result to your caller instead of opening another branch.` : null;
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
  const allowedTargets = allowedTaskTargetsText(input.agent);
  const advice = allowedTargets
    ? `@tawa reads results and decides the next dispatch. Complete what you can, call ${allowedTargets} with task(), and return your result to your caller.`
    : `@tawa reads results and decides the next dispatch. Complete what you can, and return your result to your caller.`;
  return `🚫 Agent "${input.agent}" cannot invoke @tawa. ${advice}`;
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
      return `🚫 Call loop: agent "${agent}" was called twice in the same chain. Return your result to your caller instead of repeating the call.`;
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
      return `🚫 Call loop: agent "${target}" was called twice in the same chain (via handoff). Return your result to your caller instead of repeating the handoff.`;
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
    ? `🚫 Exceeded the maximum number of task() calls: ${MAX_TOTAL_TASKS}. Return your result to your caller instead of opening another branch.`
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
    if (SecurityPolicy.checkDeletedAgent(target)) continue;
    const targetRole = resolveRole(target) ?? target;
    if (callerRole && callerRole === targetRole)
      return `🚫 Agent "${input.agent}" cannot dispatch to "${target}" — same specialty "${callerRole}". Return your result to your caller for distribution.`;
  }
  return null;
});

export const taskToolAuthorizationGuard = guard("task-tool-authorization", (_ctx, input, output) => {
  if (input.tool !== "task") return null;
  const caller = getCurrentAgent(input);
  if (isRootLikeAgent(input.agent) || caller === TAWA_AGENT) return null;
  const callerRole = resolveRole(caller) ?? caller;
  const targets = extractTaskTargets(output.args);
  const allowed = TASK_PERMISSIONS[callerRole];
  const allowedText = allowed ? allowed.map((target) => `@${target}`).join(" or ") : "";
  if (!TAWASSUL_ROLES.includes(callerRole) || !allowed) {
    return `🚫 Agent "${input.agent}" cannot use task() in this session. Return your result to your caller for any other agent.`;
  }
  if (targets.length === 0) {
    return `🚫 Agent "${input.agent}" must name a target: ${allowedText}.`;
  }
  if (!targets.every((t) => allowed.includes(t))) {
    return `🚫 Agent "${input.agent}" may only call ${allowedText} with task(). Return your result to your caller for any other agent.`;
  }

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
      return `🚫 Forbidden: agent "${agent}" is deleted from the system. Return what you have to your caller; it will choose a live agent.`;
  }
  return null;
});

export const circuitBreakerGuard = guard("circuit-breaker", (ctx, input, output) => {
  if (!TASK_TOOL_NAMES.includes(input.tool) || !input.agent) return null;
  for (const agent of getDispatchTargets(input, output)) {
    if (ctx.circuitBreaker?.evaluate(agent) === "OPEN") {
      return msg("agentUnavailable", "en", { agent });
    }
  }
  return null;
});

export const budgetGuard = guard("iteration-budget", (_ctx, input, output) => {
  if (!TASK_TOOL_NAMES.includes(input.tool) || !input.agent) return null;
  const targets = getDispatchTargets(input, output);
  const desc = output.args?.desc;
  if (typeof desc === "string" && desc.length > 0) {
    const tier = analyzeEffort(desc).thinking_effort ?? "moderate";
    for (const agent of targets) assignTier(agent, input.sessionID, tier);
  }
  for (const agent of targets) {
    if (remaining(agent, input.sessionID) <= 0) {
      return `🚫 Agent "${agent}" is out of budget. Return your result to your caller so it can decide the next step.`;
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

export const recordDispatchPromptEffect = effect("record-dispatch-prompt", (ctx, input, output) => {
  if (input.tool !== "task" || !input.sessionID) return;
  const state = ps(ctx);
  const sessionID = input.sessionID;
  const mode: RoutingMode = state.routing.get(sessionID)?.mode ?? "normal";
  const args = output.args as Record<string, unknown>;
  const keys = ["prompt", "desc", "description"] as const;
  let key: (typeof keys)[number] | null = null;
  for (const candidate of keys) {
    const value = args[candidate];
    if (typeof value === "string" && value.trim().length > 0) {
      key = candidate;
      break;
    }
    if (Array.isArray(value) && value.some((item) => typeof item === "string" && item.trim().length > 0)) {
      key = candidate;
      break;
    }
  }
  if (!key) return;
  const value = args[key];
  if (typeof value === "string") {
    state.recordDispatchPrompt(sessionID, value, mode);
    if (mode === "tawa" && !hasReportPathSentinel(value)) {
      args[key] = `${value}${REPORT_PATH_CLAUSE}`;
      getUsageLedger()?.recordInjection({ sessionID, source: "r1", bytes: REPORT_CLAUSE_BYTES });
    }
    return;
  }
  if (Array.isArray(value)) {
    let injectedBytes = 0;
    const injected = value.map((item) => {
      if (typeof item !== "string" || item.trim().length === 0) return item;
      state.recordDispatchPrompt(sessionID, item, mode);
      if (mode !== "tawa" || hasReportPathSentinel(item)) return item;
      injectedBytes += REPORT_CLAUSE_BYTES;
      return `${item}${REPORT_PATH_CLAUSE}`;
    });
    args[key] = injected;
    if (injectedBytes > 0) getUsageLedger()?.recordInjection({ sessionID, source: "r1", bytes: injectedBytes });
  }
});
