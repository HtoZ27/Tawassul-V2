

import type { TawassulContext } from "../context.ts";
import type { ToolDefinition } from "../tool.ts";
import { TAWASSUL_TOOL_NAMES } from "../tool-names.ts";
import type { ServiceFactoryResult } from "./service-factory.ts";
import { ServiceIndex } from "../services/service-index.ts";
import { resolveRuntimeStateDir } from "../utils/path-resolver.ts";
import { getImageRouter } from "../services/image-router/index.ts";
import {
  buildDiscussionTool,
  buildProposeTool,
  buildVoteTool,
  buildDivideTool,
  buildEvidenceTool,
} from "../discussion/index.ts";
import {
  buildPauseTool,
  buildResumeTool,
  buildPanicTool,
  buildOverrideTool,
  buildHandoffTool,
  buildRecordTool,
  buildAddAgentTool,
  buildKickTool,
  buildCheckTool,
  buildHelpTool,
  buildStatusTool,
  buildReportTool,
  buildReviewTool,
  buildBatchReadTool,
  buildSmartGrepTool,
  buildReadSymbolTool,
  buildProjectMapTool,
  buildQualityReportTool,
  buildGitDiffTool,
  buildDependencyMapTool,
  buildAstQueryTool,
  buildFastTrackTool,
  buildEvaluationReportTool,
  buildCodeStateTool,
  buildWebTool,
  buildImageGenTool,
  buildDirectResponseTool,
  buildShowBoardTool,
  buildCheckpointTool,
  buildSelfHealTool,
  buildMoaTool,
  buildTaskOrchestrateTool,
  buildImageRouteTool,
  buildDashboardTool,
  buildHealthTool,
  buildTimelineTool,
  buildGoalTool,
  buildThreadTool,
  buildTaskControlTool,
} from "../tools/index.ts";
import type { HandoffEntry } from "../context/types.ts";
import type { MemoryEntry } from "../conflict-resolver/types.ts";

export interface ToolRegistryResult {
  tools: Record<string, ToolDefinition>;
}

export type ToolSurfaceAvailability = {
  timeline: boolean;
  goal: boolean;
  checkpoint: boolean;
  evidence: boolean;
};

export function toolSurfaceAvailability(
  services: ServiceFactoryResult | undefined,
  discussionManager: { getEvidenceManager(): unknown } | undefined,
): ToolSurfaceAvailability {
  return {
    timeline: !!services?.timelineStore,
    goal: !!services?.goalStore,
    checkpoint: !!services?.checkpointManager,
    evidence: !!discussionManager?.getEvidenceManager(),
  };
}

export function registeredToolNames(
  services: ServiceFactoryResult | undefined,
  discussionManager?: { getEvidenceManager(): unknown },
): ReadonlySet<string> {
  const availability = toolSurfaceAvailability(services, discussionManager);
  const names = new Set(TAWASSUL_TOOL_NAMES);
  if (!availability.timeline) names.delete("timeline");
  if (!availability.goal) names.delete("goal");
  if (!availability.checkpoint) names.delete("checkpoint");
  if (!availability.evidence) names.delete("evidence");
  return names;
}

export function registryToolNames(tools: Record<string, ToolDefinition>): ReadonlySet<string> {
  return new Set(Object.keys(tools));
}

export function assertToolSurface(actual: Iterable<string>, declared: ReadonlySet<string>): void {
  const registered = new Set(actual);
  const missing = [...declared].filter((name) => !registered.has(name)).sort();
  const extra = [...registered].filter((name) => !declared.has(name)).sort();
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `[tawassul] tool surface mismatch: missing=[${missing.join(",")}] extra=[${extra.join(",")}]`,
    );
  }
}


export function buildToolRegistry(
  tawaCtx: TawassulContext,
  services: ServiceFactoryResult | undefined,
): ToolRegistryResult {
  const serviceIndex = new ServiceIndex(tawaCtx.eventHub, {
    storageDir: resolveRuntimeStateDir(tawaCtx.stateDir, tawaCtx.scope),
    ...(services
      ? {
          taskOrchestrator: services.taskOrchestrator,
          resultEngine: services.resultEngine,
          selfHealEngine: services.selfHealEngine,
          missionBoard: services.missionBoard,
          strategyDispatcher: services.strategyDispatcher,
          trustScore: services.trustScore,
          costTracker: services.costTracker,
        }
      : {}),
  });
  const discussionManager = tawaCtx.discussionManager;
  const availability = toolSurfaceAvailability(services, discussionManager);

  const rawTools: Record<string, ToolDefinition> = {
    discussion: buildDiscussionTool(
      (id) => discussionManager.getDiscussion(id),
      (input) => discussionManager.collectErrors(input),
      () => discussionManager.save(),
    ),
    propose: buildProposeTool(
      (id) => discussionManager.getDiscussion(id),
      (id, p) => discussionManager.proposeSolution(id, p),
    ),
    vote: buildVoteTool(
      (id) => discussionManager.getDiscussion(id),
      (id, v) => discussionManager.vote(id, v),
    ),
    divide: buildDivideTool(
      (id) => discussionManager.getDiscussion(id),
      (id, t) => discussionManager.divideTasks(id, t),
    ),
    panic: buildPanicTool(() => {
      const result = tawaCtx.clearAllState();
      tawaCtx.rateLimiter.resetRateLimiters();
      return result;
    }, tawaCtx.stateDir),
    override: buildOverrideTool(tawaCtx, services?.handoffService),
    handoff: buildHandoffTool(tawaCtx),
    record: buildRecordTool(tawaCtx),
    thread: buildThreadTool(tawaCtx),
    addagent: buildAddAgentTool(tawaCtx),
    kick: buildKickTool(tawaCtx),
    check: buildCheckTool(tawaCtx),
    help: buildHelpTool(),
    status: buildStatusTool(tawaCtx),
    report: buildReportTool(tawaCtx),
    evaluationreport: buildEvaluationReportTool(tawaCtx),
    codestate: buildCodeStateTool(tawaCtx),
    web: buildWebTool(),
    imagegen: buildImageGenTool(),
    directresponse: buildDirectResponseTool(),
    review: buildReviewTool(),
    batchread: buildBatchReadTool(tawaCtx),
    smartgrep: buildSmartGrepTool(tawaCtx),
    readsymbol: buildReadSymbolTool(tawaCtx),
    projectmap: buildProjectMapTool(tawaCtx),
    qualityreport: buildQualityReportTool(tawaCtx),
    gitdiff: buildGitDiffTool(tawaCtx),
    depmap: buildDependencyMapTool(tawaCtx),
    astquery: buildAstQueryTool(tawaCtx),
    
    show_board: buildShowBoardTool(serviceIndex),
    self_heal: buildSelfHealTool(services?.selfHealEngine ?? serviceIndex.selfHealEngine),
    moa: buildMoaTool(
      tawaCtx,
      services?.taskOrchestrator ?? serviceIndex.taskOrchestrator,
      services?.strategyDispatcher ?? serviceIndex.strategyDispatcher,
    ),
    task_control: buildTaskControlTool(),
    task_orchestrate: buildTaskOrchestrateTool(
      tawaCtx,
      services?.taskOrchestrator ?? serviceIndex.taskOrchestrator,
      services?.strategyDispatcher ?? serviceIndex.strategyDispatcher,
    ),
    image_route: buildImageRouteTool(services?.imageRouter ?? getImageRouter(), () => tawaCtx.getAgents()),
    dashboard: buildDashboardTool(serviceIndex, tawaCtx),
    health: buildHealthTool(tawaCtx),
    ...(availability.timeline && services?.timelineStore
      ? { timeline: buildTimelineTool(services.timelineStore) }
      : {}),
    ...(availability.goal && services?.goalStore ? { goal: buildGoalTool(services.goalStore) } : {}),
    fasttrack: buildFastTrackTool((entry: HandoffEntry) => {
      const id = tawaCtx.nextHandoffId();
      entry.id = id;
      tawaCtx.handoffs.set(entry.id, entry);
      return id;
    }),
    pause: buildPauseTool(
      () => tawaCtx.pauseState,
      (state) => {
        tawaCtx.pauseState = state;
      },
      () => [...tawaCtx.handoffs.values()],
      (newHandoffs) => {
        tawaCtx.handoffs.clear();
        for (const h of newHandoffs as HandoffEntry[]) tawaCtx.handoffs.set(h.id, h);
      },
      () => tawaCtx.saveState(),
      (entry) => tawaCtx.sharedMemory.addWarning(entry as Omit<MemoryEntry, "id" | "timestamp" | "decayFactor">),
    ),
    resume: buildResumeTool(
      () => tawaCtx.pauseState,
      (state) => {
        tawaCtx.pauseState = state;
      },
      () => [...tawaCtx.handoffs.values()],
      (newHandoffs) => {
        tawaCtx.handoffs.clear();
        for (const h of newHandoffs as HandoffEntry[]) tawaCtx.handoffs.set(h.id, h);
      },
      () => tawaCtx.saveState(),
      (entry) => tawaCtx.sharedMemory.addDecision(entry),
    ),
  };

  
  if (availability.checkpoint && services?.checkpointManager) {
    rawTools.checkpoint = buildCheckpointTool(services.checkpointManager);
  }
  const evidenceManager = discussionManager.getEvidenceManager();
  if (availability.evidence && evidenceManager) {
    rawTools.evidence = buildEvidenceTool((id) => discussionManager.getDiscussion(id), evidenceManager);
  }

  const registeredTools: Record<string, ToolDefinition> = {};
  for (const [name, toolDef] of Object.entries(rawTools)) {
    registeredTools[name] = toolDef;
  }

  return {
    tools: registeredTools,
  };
}
