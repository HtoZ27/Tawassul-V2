

import type { HandoffEntry } from "../context/types.ts";
import type { FeatureIndex } from "./feature-index.ts";
import { evaluateGates, canCloseFeature } from "./quality-gate-manager.ts";
import type { GateContext } from "./quality-gate-manager.ts";
import type {
  TaskPhase,
  ClosurePhase,
  TransitionPhase,
  PipelineDefinition,
  PhaseResult,
  TransitionResult,
} from "./pipeline.ts";
import { StateMachine } from "../core/state-machine.ts";
import { logger } from "../utils/logger.ts";
import { t } from "../translations.ts";



interface TransitionContext {
  pipeline: PipelineDefinition;
  phaseResults: Partial<Record<TaskPhase, PhaseResult>>;
  taskId: string;
  handoffs: HandoffEntry[];
  featureId?: string;
  featureIndex?: FeatureIndex;
}

interface TransitionRule {
  check: (ctx: TransitionContext) => boolean;
  failMessage: string;
  requiredActions: string[];
}



export function buildPipelineStateMachine(pipeline: PipelineDefinition): StateMachine<TransitionPhase> {
  const sm = new StateMachine<TransitionPhase>(pipeline.phases[0] ?? "analysis");

  for (let i = 0; i < pipeline.phases.length - 1; i++) {
    const from = pipeline.phases[i]!;
    const to = pipeline.phases[i + 1]!;
    sm.addTransition({ from, to });
  }
  if (pipeline.closurePhases) {
    for (let i = 0; i < pipeline.closurePhases.length - 1; i++) {
      const from = pipeline.closurePhases[i]! as TransitionPhase;
      const to = pipeline.closurePhases[i + 1]! as TransitionPhase;
      sm.addTransition({ from, to });
    }
  }

  return sm;
}



const TRANSITION_RULES: Record<string, TransitionRule> = {
  "analysis→planning": {
    check: (ctx) => {
      const r = ctx.phaseResults.analysis;
      if (!r || r.status !== "completed") return false;
      return (r.completeness ?? 0) >= 0.7;
    },
    get failMessage() {
      return t("ptAnalysisIncomplete");
    },
    get requiredActions() {
      return [t("ptAnalysisNeed70"), t("ptAnalysisScope")];
    },
  },
  "analysis→execution": {
    check: (ctx) => {
      const r = ctx.phaseResults.analysis;
      if (!r || r.status !== "completed") return false;
      if (ctx.pipeline.effort !== "shallow") return false;
      return (r.completeness ?? 0) >= 0.5;
    },
    get failMessage() {
      return t("ptAnalysisExecShallowOnly");
    },
    get requiredActions() {
      return [t("ptEnsureShallow"), t("ptNeed50")];
    },
  },
  "planning→execution": {
    check: (ctx) => {
      const r = ctx.phaseResults.planning;
      if (!r || r.status !== "completed") return false;
      return r.output?.approved === true;
    },
    get failMessage() {
      return t("ptPlanNotApproved");
    },
    get requiredActions() {
      return [t("ptReviewPlan"), t("ptPlanHasTasks"), t("ptUseArchitect")];
    },
  },
  "execution→testing": {
    check: (ctx) => {
      const r = ctx.phaseResults.execution;
      if (!r || r.status !== "completed") return false;
      return (r.filesChanged ?? []).length > 0;
    },
    get failMessage() {
      return t("ptExecNoFiles");
    },
    get requiredActions() {
      return [t("ptDoChanges"), t("ptVerifyExec"), t("ptAnalyticalWarn")];
    },
  },
  "testing→completed": {
    check: (ctx) => {
      const r = ctx.phaseResults.testing;
      if (!r || r.status !== "completed") return false;
      const outputStatus = r.output?.status as string | undefined;
      if (outputStatus !== "pass") return false;
      const passed = (r.output?.passed as number) ?? 1;
      const failed = (r.output?.failed as number) ?? 0;
      const total = (r.output?.total as number) ?? passed + failed;
      const gateCtx: GateContext = {
        featureId: ctx.featureId,
        featureIndex: ctx.featureIndex,
        handoffs: ctx.handoffs,
        testResult: { passed, failed, total },
        phases: { completed: [r.phase], total: ctx.pipeline.phases },
      };
      return evaluateGates(gateCtx, ["tests-pass", "feature-indexed"]).every((g) => g.passed);
    },
    get failMessage() {
      return t("ptTestsNotPassed");
    },
    get requiredActions() {
      return [t("ptEnsurePassed"), t("ptRecordFeature")];
    },
  },
  "testing→execution": {
    check: (ctx) => {
      const r = ctx.phaseResults.testing;
      if (!r || r.status !== "completed") return false;
      const outputStatus = r.output?.status as string | undefined;
      return outputStatus === "major" || outputStatus === "failed";
    },
    get failMessage() {
      return t("ptTestsNotFailed");
    },
    get requiredActions() {
      return [t("ptAnalyzeFailures"), t("ptReturnExec"), t("ptRetestAfterFix")];
    },
  },
  "completed→closed": {
    check: (ctx) => {
      const feature = ctx.featureId && ctx.featureIndex ? ctx.featureIndex.getById(ctx.featureId) : undefined;
      let structuralCoverageResult: GateContext["structuralCoverageResult"] = undefined;
      let contractVerification: GateContext["contractVerification"] = undefined;
      try {
        const raw = feature?.metadata?.["structuralCoverageResult"];
        if (raw) structuralCoverageResult = JSON.parse(raw);
      } catch (e) {
        logger.debug("Failed to parse structuralCoverageResult:", e);
      }
      try {
        const raw = feature?.metadata?.["contractVerification"];
        if (raw) contractVerification = JSON.parse(raw);
      } catch (e) {
        logger.debug("Failed to parse contractVerification:", e);
      }
      const gateCtx: GateContext = {
        featureId: ctx.featureId,
        featureIndex: ctx.featureIndex,
        handoffs: ctx.handoffs,
        structuralCoverageResult,
        contractVerification,
      };
      const report = canCloseFeature(gateCtx, [
        "all-handoffs-completed",
        "feature-indexed",
        "no-regressions",
        "regression-tests-exist",
        "structural-coverage",
        "behavioral-contracts",
        "evaluation-report-exists",
        "all-issues-covered",
        "no-critical-unresolved",
      ]);
      if (!report.allPassed) return false;
      if (ctx.featureId && ctx.featureIndex) {
        const f = ctx.featureIndex.getById(ctx.featureId);
        if (f && f.status !== "closed") ctx.featureIndex.transitionTo(ctx.featureId, "closed");
      }
      return true;
    },
    get failMessage() {
      return t("ptCannotClose");
    },
    get requiredActions() {
      return [
        t("ptCompleteHandoffs"),
        t("ptEnsureIndexed"),
        t("ptHandleRegress"),
        t("ptAddRegressTests"),
        t("ptNeedStructural"),
        t("ptNeedBehavioral"),
        t("ptRunEval"),
        t("ptFixOpen"),
        t("ptFixCritical"),
      ];
    },
  },
};




export function canTransition(
  from: TransitionPhase,
  to: TransitionPhase,
  context: TransitionContext,
): TransitionResult {
  
  const sm = buildPipelineStateMachine(context.pipeline);
  if (!sm.canTransition(to)) {
    return {
      allowed: false,
      reason: t("ptTransitionDenied", { from, to }),
      get requiredActions() {
        return [t("ptFinishFirst", { from }), t("ptFollowOrder")];
      },
    };
  }

  
  const ruleKey = `${from}→${to}`;
  const rule = TRANSITION_RULES[ruleKey];
  if (rule && !rule.check(context)) {
    return { allowed: false, reason: rule.failMessage, requiredActions: rule.requiredActions };
  }
  return { allowed: true, reason: t("ptTransitionPassed", { from, to }), requiredActions: [] };
}


export function getNextPhase(current: TransitionPhase, pipeline: PipelineDefinition): TransitionPhase | null {
  const phases = pipeline.phases;
  const currentIndex = phases.indexOf(current as TaskPhase);

  if (currentIndex !== -1) {
    const nextIndex = currentIndex + 1;
    if (nextIndex < phases.length) return phases[nextIndex]!;
    if (pipeline.closurePhases?.length) return pipeline.closurePhases[0] as TransitionPhase;
    return null;
  }

  if (pipeline.closurePhases) {
    const closureIndex = pipeline.closurePhases.indexOf(current as ClosurePhase);
    if (closureIndex !== -1) {
      const nextIndex = closureIndex + 1;
      if (nextIndex < pipeline.closurePhases.length) return pipeline.closurePhases[nextIndex] as TransitionPhase;
      return null;
    }
  }
  return null;
}


export function buildTransitionContext(params: {
  pipeline: PipelineDefinition;
  phaseResults?: Partial<Record<TaskPhase, PhaseResult>>;
  taskId?: string;
  handoffs?: HandoffEntry[];
}): TransitionContext {
  return {
    pipeline: params.pipeline,
    phaseResults: params.phaseResults ?? {},
    taskId: params.taskId ?? "unknown",
    handoffs: params.handoffs ?? [],
  };
}
