
import { proxyAgentRoutingStage } from "./guards/shared.ts";
import { combinedStage } from "./guards/shared.ts";
import type { ValidationStage } from "./tool-execute-types.ts";
import {
  isTawassulTool,
  setMaxCallDepth,
  setMaxTotalTasks,
  detectTawaCalls,
  targetsAreExploreOrGeneral,
  getTaskAgents,
  resetModelCache,
  type Ctx,
  type Input,
  type StageOutput,
} from "./guards/shared.ts";
import type { PipelineState } from "./PipelineState.ts";
import { logger } from "../utils/logger.ts";
import { isManagedAgent } from "../utils/agent.ts";
import { normalizeToolName } from "../utils/name-utils.ts";
import { escapeGoalText } from "../services/prompt-sanitizer.ts";
import { scanText } from "./guards/threat_patterns.ts";
import { permissionGuard, rosterBoundaryDeleteGuard, checkRosterBoundaryDelete } from "./guards/permission-guard.ts";

import {
  firstResponseGuard,
  pauseStateGuard,
  agentAutoPauseGuard,
  planModeGuard,
  phaseGatingGuard,
  riskGatingGuard,
  tawassulToolPermissionsGuard,
  securityPolicyGuard,
  tawaRoutingEnforcementGuard,
  speculativeDispatchGuard,
  cognitiveBlockerGuard,
} from "./guards/resource-guards.ts";
import { skillGateGuard, setSkillGateEnabled } from "./guards/skill-gate-guard.ts";
import { consentGateGuard, setConsentGateEnabled } from "./guards/consent-gate-guard.ts";
import { requiresConsent } from "./guards/shared/limits.ts";
import { cacheSafeGuard } from "./guards/cache-safe-guard.ts";
import { taskRejectionGuard } from "./guards/task-rejection-guard.ts";
import {
  taskToolAuthorizationGuard,
  callDepthGuard,
  selfCallGuard,
  tawaRedirectGuard,
  sessionRequiredGuard,
  internalDuplicateGuard,
  crossCallDuplicateGuard,
  handoffDuplicateGuard,
  totalTaskLimitGuard,
  sameRoleDistributionGuard,
  deletedAgentGuard,
  circuitBreakerGuard,
  budgetGuard,
  rateLimitGuard,
  commitCallDepthEffect,
} from "./guards/dispatch-guards.ts";
import {
  proxyRoutingEffect,
  agentMatcherRoutingEffect,
  tawaCallDetectorEffect,
  cognitiveEffectsEffect,
} from "./guards/tawa-guards.ts";


export const initAutoSweep = (ps: PipelineState) => ps.initAutoSweep();
export const stopAutoSweep = (ps: PipelineState) => ps.stopAutoSweep();


const threatPatternStage = {
  name: "threatPatternDetection",
  check: async (_ctx: Ctx, _input: Input, output: StageOutput) => {
    const prompt = typeof output.args?.prompt === "string" ? output.args.prompt : "";
    const context = typeof output.args?.context === "string" ? output.args.context : "";
    const threats = [...scanText(prompt), ...scanText(context)];
    if (threats.length > 0) {
      logger.warn(`[tawassul] threatPatternStage: ${threats.length} threat(s) detected`);
    }
    return true;
  },
};


const INJECTION_PATTERN = /<script|javascript:|on\w+\s*=|<iframe|<object|<embed|<form|data:text\/html/i;

const promptSanitizationStage = {
  name: "promptSanitization",
  check: async (_ctx: Ctx, _input: Input, output: StageOutput) => {
    
    if (typeof output.args?.prompt === "string" && INJECTION_PATTERN.test(output.args.prompt)) {
      output.args.prompt = escapeGoalText(output.args.prompt);
    }
    if (typeof output.args?.context === "string" && INJECTION_PATTERN.test(output.args.context)) {
      output.args.context = escapeGoalText(output.args.context);
    }
    return true;
  },
};


export const VALIDATION_PIPELINE = [
  combinedStage("security-checks", [threatPatternStage, promptSanitizationStage]),
  combinedStage("content-checks", [cacheSafeGuard, taskRejectionGuard]),
  combinedStage("resource-checks", [
    firstResponseGuard,
    pauseStateGuard,
    agentAutoPauseGuard,
    planModeGuard,
    phaseGatingGuard,
    riskGatingGuard,
  ]),
  taskToolAuthorizationGuard,
  agentMatcherRoutingEffect,
  proxyRoutingEffect,
  combinedStage("depth-checks", [callDepthGuard, sessionRequiredGuard]),
  tawaCallDetectorEffect,
  combinedStage("redirect-checks", [selfCallGuard, tawaRedirectGuard]),
  combinedStage("duplicate-checks", [internalDuplicateGuard, crossCallDuplicateGuard, handoffDuplicateGuard]),
  combinedStage("limit-checks", [totalTaskLimitGuard, sameRoleDistributionGuard, tawassulToolPermissionsGuard]),
  combinedStage("enforcement-checks", [
    securityPolicyGuard,
    tawaRoutingEnforcementGuard,
    speculativeDispatchGuard,
    cognitiveBlockerGuard,
    permissionGuard,
  ]),
  cognitiveEffectsEffect,
  consentGateGuard,
  combinedStage("agent-guards", [deletedAgentGuard, circuitBreakerGuard]),
  combinedStage("rate-checks", [budgetGuard, rateLimitGuard]),
  commitCallDepthEffect,
];





export const DISCUSSION_TOOLS_SET = new Set(["discussion", "propose", "vote", "divide", "evidence"]);
export const DISCUSSION_PIPELINE = [
  combinedStage("security-checks", [threatPatternStage]),
  pauseStateGuard,
  combinedStage("limit-checks", [tawassulToolPermissionsGuard]),
  combinedStage("enforcement-checks", [securityPolicyGuard]),
  consentGateGuard,
  combinedStage("agent-guards", [deletedAgentGuard]),
  combinedStage("rate-checks", [budgetGuard, rateLimitGuard]),
];

export {
  isTawassulTool,
  setMaxCallDepth,
  setMaxTotalTasks,
  detectTawaCalls,
  targetsAreExploreOrGeneral,
  getTaskAgents,
  proxyAgentRoutingStage,
};
export { setSkillGateEnabled, setConsentGateEnabled };

let _memoryLogCounter = 0;
export const incrementMemoryLogCounter = () => ++_memoryLogCounter;
export const resetMemoryLogCounter = () => {
  _memoryLogCounter = 0;
};

export function logMemoryUsage(sessionId?: string): void {
  try {
    const usage = process.memoryUsage();
    logger.debug(
      `MEM (session=${sessionId ?? "default"}): RSS=${(usage.rss / 1024 / 1024).toFixed(1)}MB heap=${(usage.heapUsed / 1024 / 1024).toFixed(1)}MB`,
    );
  } catch (memErr) {
    logger.debug("[tawassul] memory telemetry unavailable", memErr);
  }
}

export const STAGE_TIMEOUT_MS = 5_000;
export const SIMPLE_PIPELINE_TIMEOUT_MS = 30_000;

const ESSENTIAL_STAGES = [
  combinedStage("security-checks", [threatPatternStage, promptSanitizationStage]),
  combinedStage("content-checks", [cacheSafeGuard, taskRejectionGuard]),
  combinedStage("resource-checks", [pauseStateGuard, agentAutoPauseGuard, planModeGuard]),
  taskToolAuthorizationGuard,
  tawaRedirectGuard,
  combinedStage("limit-checks", [tawassulToolPermissionsGuard]),
  combinedStage("enforcement-checks", [securityPolicyGuard, tawaRoutingEnforcementGuard, speculativeDispatchGuard, rosterBoundaryDeleteGuard]),
  combinedStage("agent-guards", [deletedAgentGuard, circuitBreakerGuard]),
  consentGateGuard,
  skillGateGuard,
  combinedStage("rate-checks", [budgetGuard, rateLimitGuard]),
];





const OPTIONAL_STAGE_NAMES = new Set(["rate-checks", "duplicate-checks", "limit-checks", "resource-checks"]);
function isPermissivePipeline(ctx: Ctx): boolean {
  try {
    const cfg = (ctx as unknown as { config?: { innovations?: Record<string, { enabled?: boolean }> } }).config;
    return cfg?.innovations?.permissivePipeline?.enabled === true;
  } catch {
    return false;
  }
}

export async function runPipeline(ctx: Ctx, input: Input, output: StageOutput): Promise<boolean> {
  input.tool = normalizeToolName(input.tool);

  
  
  
  
  
  
  
  if (input.agent && !isManagedAgent(input.agent)) {
    if (input.tool === "task" || input.tool === "handoff" || input.tool === "fasttrack") {
      const allowed = await tawaRedirectGuard.check(ctx, input, output);
      if (!allowed) {
        logger.warn(`[tawassul] Unmanaged actor "${input.agent}" blocked from redirecting dispatch to @tawa`);
        return false;
      }
    }
    if (input.tool === "edit" || input.tool === "write" || input.tool === "delete") {
      const rosterMsg = await checkRosterBoundaryDelete(
        input,
        output,
        `\n➡️ Official path: @addagent for add/remove — easier than hand-editing, no extra approval needed for add`,
      );
      if (rosterMsg) {
        logger.warn(`[tawassul] Unmanaged actor "${input.agent}" blocked from direct roster edit`);
        (output as Record<string, unknown>).blockingGuard = "roster-boundary-delete";
        return false;
      }
    }
    if (requiresConsent(input.tool, output.args ?? {})) {
      return await consentGateGuard.check(ctx, input, output);
    }
    return true;
  }

  const isTawaRelated = isTawassulTool(input.tool) || input.tool === "task" || input.tool === "handoff";

  
  
  
  
  
  
  
  
  if (!input.agent && !isTawaRelated) {
    return true;
  }
  
  
  
  
  
  
  const needsOverallConsentBudget = requiresConsent(input.tool, output.args ?? {});
  
  
  
  const isDiscussionTool = DISCUSSION_TOOLS_SET.has(normalizeToolName(input.tool));
  const stages = isDiscussionTool ? DISCUSSION_PIPELINE : isTawaRelated ? VALIDATION_PIPELINE : ESSENTIAL_STAGES;

  
  
  if (isTawaRelated && !needsOverallConsentBudget) {
    for (const stage of stages) {
      if (!(await checkStageWithTimeout(stage, ctx, input, output))) return false;
    }
    return true;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const stagesRun = runStages(stages, ctx, input, output);
    stagesRun.catch((e: unknown) => {
      logger.warn(
        `[tawassul] simple pipeline rejected after the timeout decided - recorded, absorbed:`,
        e instanceof Error ? e.message : String(e),
      );
      try {
        logger.audit("STAGE_REJECTED_AFTER_TIMEOUT", {
          stage: "simple-pipeline",
          error: e instanceof Error ? e.message : String(e),
        });
      } catch (auditErr) {
        logger.debug("[tawassul] audit sink unavailable for STAGE_REJECTED_AFTER_TIMEOUT", auditErr);
      }
    });
    return await Promise.race([
      stagesRun,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => {
          logger.warn(
            `[tawassul] essential pipeline timed out after ${SIMPLE_PIPELINE_TIMEOUT_MS}ms — blocking (fail-closed)`,
          );
          resolve(false);
        }, SIMPLE_PIPELINE_TIMEOUT_MS);
        timer!.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runStages(
  stages: readonly ValidationStage[],
  ctx: Ctx,
  input: Input,
  output: StageOutput,
): Promise<boolean> {
  const permissive = isPermissivePipeline(ctx);
  for (const stage of stages) {
    const ok = await stage.check(ctx, input, output);
    if (!ok) {
      if (permissive && OPTIONAL_STAGE_NAMES.has(stage.name)) {
        logger.warn(`[tawassul] permissivePipeline: stage "${stage.name}" would block — warn only (continuing)`);
        continue;
      }
      return false;
    }
  }
  return true;
}

async function checkStageWithTimeout(
  stage: ValidationStage,
  ctx: Ctx,
  input: Input,
  output: StageOutput,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const stageRun = stage.check(ctx, input, output);
    stageRun.catch((e: unknown) => {
      logger.warn(
        `[tawassul] pipeline stage "${stage.name}" rejected after the timeout decided - recorded, absorbed:`,
        e instanceof Error ? e.message : String(e),
      );
      try {
        logger.audit("STAGE_REJECTED_AFTER_TIMEOUT", {
          stage: stage.name,
          error: e instanceof Error ? e.message : String(e),
        });
      } catch (auditErr) {
        logger.debug("[tawassul] audit sink unavailable for STAGE_REJECTED_AFTER_TIMEOUT", auditErr);
      }
    });
    const result = await Promise.race([
      stageRun,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => {
          logger.warn(
            `[tawassul] pipeline stage "${stage.name}" timed out after ${STAGE_TIMEOUT_MS}ms — blocking (fail-closed)`,
          );
          resolve(false);
        }, STAGE_TIMEOUT_MS);
        timer!.unref?.();
      }),
    ]);
    if (!result && isPermissivePipeline(ctx) && OPTIONAL_STAGE_NAMES.has(stage.name)) {
      logger.warn(`[tawassul] permissivePipeline: stage "${stage.name}" would block — warn only (continuing)`);
      return true;
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}




export function resetAllState(ps?: PipelineState, rl?: { resetRateLimiters: () => void }): void {
  ps?.resetAll();
  if (rl) rl.resetRateLimiters();
  _memoryLogCounter = 0;
  resetModelCache();
}
