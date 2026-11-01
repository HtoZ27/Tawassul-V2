

import { SharedMemorySchema, AgentRatingSchema } from "../validation.ts";
import { isFreeOfPrototypePollution } from "../context/migration.ts";
import type { AgentRating } from "../context/types.ts";
import type { TawaOrchestratorContext } from "../core/service-context.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { logger } from "../utils/logger.ts";
import { MAX_DYNAMIC_AGENTS_DEFAULT } from "../context/constants.ts";
import { walReplay, loadFeatureIndex } from "./state-loader.ts";


export async function loadAllState(ctx: TawaOrchestratorContext): Promise<void> {
  if (!ctx.persistDir) return;

  const result = await ctx.stateManager.loadFromFile(
    {
      records: ctx.records,
      handoffs: [...ctx.handoffs.values()],
      recSeq: ctx.recSeq,
      hoffSeq: ctx.hoffSeq,
      agentErrors: {},
      agentRatings: {},
      dynamicAgents: [],
      agentModelMap: {},
    },
    ctx.sessionManager.getSessionId(),
  );

  await walReplay(ctx.persistDir, result);

  
  ctx.handoffs.clear();
  for (const h of result.handoffs) {
    ctx.handoffs.set(h.id, h);
  }
  ctx.recSeq = result.recSeq;
  ctx.hoffSeq = result.hoffSeq;

  
  ctx.errorManager.loadFrom(result.agentErrors);
  ctx.errorManager.decayErrors();

  
  if (result.agentRatings && typeof result.agentRatings === "object" && !Array.isArray(result.agentRatings)) {
    if (isFreeOfPrototypePollution(result.agentRatings)) {
      const validated: Record<string, AgentRating> = {};
      for (const [agent, rating] of Object.entries(result.agentRatings)) {
        const parsed = AgentRatingSchema.safeParse(rating);
        if (parsed.success) validated[normalizeName(agent)] = parsed.data as AgentRating;
        else logger.warn(`load: skipping invalid agentRating for ${agent}`);
      }
      ctx.ratingManager.agentRatings = validated;
    } else {
      logger.warn("BLOCKED: prototype pollution in agentRatings — using defaults");
    }
  }

  ctx.capabilityTracker.restore(result.capabilities ?? []);

  
  
  
  ctx.agentManager.dynamicAgents = [
    ...new Set((result.dynamicAgents ?? []).map((n) => normalizeName(n)).filter(Boolean)),
  ];
  const normalizedModelMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(result.agentModelMap ?? {})) {
    normalizedModelMap[normalizeName(k)] = v;
  }
  ctx.modelManager.agentModelMap = normalizedModelMap;

  
  try {
    await ctx.modelManager.loadTawaPrefsFile();
  } catch (e) {
    logger.warn("loadTawaPrefsFile failed", e);
  }

  
  await restoreSharedMemory(ctx, result);

  
  await restoreDiscussions(ctx, result);

  
  await restoreEvidence(ctx, result);

  
  await restoreTrainingEvaluator(ctx, result);

  
  await restorePauseState(ctx, result);

  
  await restoreSeenAgents(ctx, result);

  
  enforceStateLimitsAfterLoad(ctx);

  logger.debug(
    `State loaded: ${ctx.handoffs.size} handoffs, ${ctx.records.length} records, ${Object.keys(ctx.errorManager.agentErrors).length} agents with errors`,
  );

  
  const loadedFi = await loadFeatureIndex(ctx.persistDir);
  if (loadedFi) ctx.featureIndex = loadedFi;
}


async function restoreSharedMemory(ctx: TawaOrchestratorContext, result: Record<string, unknown>): Promise<void> {
  if (!result.sharedMemory) return;
  try {
    const sm = ctx.sharedMemory.get();
    const parsed = SharedMemorySchema.safeParse(result.sharedMemory);
    if (!parsed.success) {
      logger.warn("SharedMemory restore failed validation, using defaults");
      return;
    }
    const smData = parsed.data;
    if (smData.decisions) sm.decisions = smData.decisions;
    if (smData.learnings) sm.learnings = smData.learnings;
    if (smData.warnings) sm.warnings = smData.warnings;
    if (smData.handoffHistory) sm.handoffHistory = smData.handoffHistory;
    if (smData.agentContext) {
      for (const [k, v] of Object.entries(smData.agentContext)) {
        sm.agentContext[normalizeName(k)] = v;
      }
    }
    if (smData.fileContext) Object.assign(sm.fileContext, smData.fileContext);
    for (const agent of Object.keys(sm.agentContext)) {
      if (sm.agentContext[agent]?.currentTask) {
        delete sm.agentContext[agent].currentTask;
      }
    }
  } catch (e) {
    logger.warn("SharedMemory restore failed:", e);
  }
}


async function restoreDiscussions(ctx: TawaOrchestratorContext, result: Record<string, unknown>): Promise<void> {
  if (!result.discussions || !Array.isArray(result.discussions)) return;
  try {
    const discSeq = typeof result.discussionSeq === "number" ? result.discussionSeq : 0;
    ctx.discussionManager.loadFromState(
      result.discussions.map((d: unknown) => d as import("../discussion/discussion.ts").Discussion),
      discSeq,
    );
  } catch (e) {
    logger.warn("Discussions restore failed:", e);
  }
}


async function restoreEvidence(ctx: TawaOrchestratorContext, result: Record<string, unknown>): Promise<void> {
  if (!result.evidencedDiscussions || !Array.isArray(result.evidencedDiscussions)) return;
  try {
    const em = ctx.discussionManager.getEvidenceManager();
    em?.loadFromState(
      result.evidencedDiscussions.map(
        (d: unknown) => d as import("../discussion/evidence-types.ts").EvidencedDiscussion,
      ),
    );
    em?.setSeqCounters({
      seqReceipt: (result.evidenceSeqReceipt as number) ?? 0,
      seqClaim: (result.evidenceSeqClaim as number) ?? 0,
      seqVerification: (result.evidenceSeqVerification as number) ?? 0,
      seqChallenge: (result.evidenceSeqChallenge as number) ?? 0,
    });
  } catch (e) {
    logger.warn("Evidenced discussions restore failed:", e);
  }
}


async function restoreTrainingEvaluator(ctx: TawaOrchestratorContext, result: Record<string, unknown>): Promise<void> {
  if (!result.trainingEvaluator) return;
  try {
    ctx.trainingEvaluator.restoreFrom(
      result.trainingEvaluator as Parameters<typeof ctx.trainingEvaluator.restoreFrom>[0],
    );
  } catch (e) {
    logger.warn("Training evaluator restore failed:", e);
  }
}


async function restorePauseState(ctx: TawaOrchestratorContext, result: Record<string, unknown>): Promise<void> {
  if (!result.pauseState) return;
  try {
    ctx.pauseState = result.pauseState as import("../tools/index.ts").PauseState;
  } catch (e) {
    logger.warn("Pause state restore failed:", e);
  }
}


async function restoreSeenAgents(ctx: TawaOrchestratorContext, result: Record<string, unknown>): Promise<void> {
  if (!result.seenAgents || typeof result.seenAgents !== "object") return;
  try {
    ctx.seenAgents.clear();
    for (const [k, v] of Object.entries(result.seenAgents)) {
      if (Array.isArray(v)) {
        ctx.seenAgents.set(k, new Set(v));
      }
    }
  } catch (e) {
    logger.warn("SeenAgents restore failed:", e);
  }
}


function enforceStateLimitsAfterLoad(ctx: TawaOrchestratorContext): void {
  const _maxHandoffs = ctx.agentManager.getMaxHandoffs();
  const _maxRecords = ctx.agentManager.getMaxRecords();
  const _maxDynamicAgents = ctx.config?.maxDynamicAgents ?? MAX_DYNAMIC_AGENTS_DEFAULT;
  const handoffsArray = [...ctx.handoffs.values()];
  ctx.stateManager.enforceStateLimits(
    {
      records: ctx.records,
      handoffs: handoffsArray,
      recSeq: ctx.recSeq,
      hoffSeq: ctx.hoffSeq,
      agentErrors: ctx.errorManager.agentErrors,
      agentRatings: ctx.ratingManager.agentRatings,
      dynamicAgents: ctx.agentManager.dynamicAgents,
      agentModelMap: ctx.modelManager.agentModelMap,
    },
    _maxHandoffs,
    _maxRecords,
    50,
    50,
    50,
    _maxDynamicAgents,
    50,
    ctx.seenAgents,
  );
  
  ctx.handoffs.clear();
  for (const h of handoffsArray) ctx.handoffs.set(h.id, h);
}
