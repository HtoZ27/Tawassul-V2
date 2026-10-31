import { resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import { realpath, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { t } from "../translations.ts";
import { lruSet } from "../utils/bounded-map.ts";
import { getMessageContent } from "../utils/format.ts";
import { analyzeMessage as analyzeMessageFallback } from "../services/routing-algorithm.ts";
import {
  analyzeEffort as analyzeEffortFallback,
  isComplexEffort as isComplexEffortFallback,
  isComplexTask as isComplexTaskFallback,
} from "../services/effort-analyzer.ts";
import {
  runElicitationGate as runElicitationGateFallback,
  buildOptions as buildOptionsFallback,
} from "../services/elicitation-gate.ts";
import {
  formatAskPrompt as formatAskPromptFallback,
  isAskInjection as isAskInjectionFallback,
} from "../services/ask-channel-parse.ts";
import {
  getPipeline as getPipelineFallback,
  describePipeline as describePipelineFallback,
} from "../services/pipeline-phases.ts";
import { logger } from "../utils/logger.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { translateError } from "../lib/conversational.ts";
import { activatePack } from "../services/context-pack/index.ts";
import { getSessionBridge } from "../v2/session-bridge.ts";

import type { DispatchTask } from "../services/parallel-dispatcher.ts";

import type { MessageUpdatedContext } from "./message-updated-types.ts";
import type { MessageUpdatedServiceClients } from "./message-updated-types.ts";
import { getRole } from "./get-role.ts";
import { injectTawaGuidance } from "./message-updated-tawa.ts";
import { injectAutoStatus, injectPerformanceAlerts } from "./message-updated-status.ts";
import {
  classifyMessagePriority as classifyMessagePriorityFallback,
  estimateTokens as estimateTokensFallback,
} from "../services/message-priority.ts";
import { estimateContextUsage as estimateContextUsageFallback } from "../services/context-nudges.ts";
import { takeCopilotDigest as takeCopilotDigestFallback } from "../services/goal-auto.ts";
import type { EffortAnalysis } from "../services/effort-analyzer.ts";
import type { ElicitationAsk } from "../services/elicitation-gate.ts";
import { isValidMessageId } from "../lib/tool-schema-injection.ts";
import { DEFAULT_PRICING_MODELS } from "../services/cost-transparency/types.ts";
import type { ScoredContextEntry } from "../context/priority-types.ts";

export const TAWA_MENTION_REGEX = /(?:^|\s|[\W])@tawa\b|(?<![\p{L}])tawa(?![\p{L}])/iu;

export const EXPLICIT_DISPATCH_REGEX =
  /\bdispatch\b|\bdistribute\b|\bdelegate\b|\bhand[ -]?off\b|send[\s\S]{0,25}to agents|assign[\s\S]{0,25}to agents|route[\s\S]{0,25}to agents/iu;

export const DISPATCH_QA_IN_ROOT = false;

function resolveServiceClients(clients?: MessageUpdatedServiceClients): Required<MessageUpdatedServiceClients> {
  return {
    analyzeMessage: clients?.analyzeMessage ?? analyzeMessageFallback,
    analyzeEffort: clients?.analyzeEffort ?? analyzeEffortFallback,
    isComplexTask: clients?.isComplexTask ?? isComplexTaskFallback,
    isComplexEffort: clients?.isComplexEffort ?? isComplexEffortFallback,
    runElicitationGate: clients?.runElicitationGate ?? runElicitationGateFallback,
    buildOptions: clients?.buildOptions ?? buildOptionsFallback,
    formatAskPrompt: clients?.formatAskPrompt ?? formatAskPromptFallback,
    isAskInjection: clients?.isAskInjection ?? isAskInjectionFallback,
    getPipeline: clients?.getPipeline ?? getPipelineFallback,
    describePipeline: clients?.describePipeline ?? describePipelineFallback,
    classifyMessagePriority: clients?.classifyMessagePriority ?? classifyMessagePriorityFallback,
    estimateTokens: clients?.estimateTokens ?? estimateTokensFallback,
    estimateContextUsage: clients?.estimateContextUsage ?? estimateContextUsageFallback,
    takeCopilotDigest: clients?.takeCopilotDigest ?? takeCopilotDigestFallback,
  };
}

export type { MessageUpdatedServiceClients } from "./message-updated-types.ts";

const DEFAULT_CONTEXT_MAX_TOKENS = 128000;

const PRICING_MAX_TOKENS: Map<string, number> = new Map();
for (const pm of DEFAULT_PRICING_MODELS) {
  PRICING_MAX_TOKENS.set(pm.id, pm.maxContextTokens);
  PRICING_MAX_TOKENS.set(pm.model, pm.maxContextTokens);
  PRICING_MAX_TOKENS.set(`${pm.provider}/${pm.model}`, pm.maxContextTokens);
}

export function resolveMaxContextTokens(
  model: { providerID?: string; modelID?: string } | undefined,
  agentModelMap: Record<string, string> | undefined,
  agent: string | undefined,
): number {
  const envOverride = Number(process.env.TAWASSUL_MAX_CONTEXT_TOKENS);
  if (Number.isInteger(envOverride) && envOverride > 0) return envOverride;
  const candidates: string[] = [];
  if (model?.modelID) candidates.push(model.modelID);
  if (model?.providerID && model?.modelID) candidates.push(`${model.providerID}/${model.modelID}`);
  if (agent && agentModelMap) {
    const mapped = agentModelMap[normalizeName(agent)];
    if (mapped) {
      candidates.push(mapped);
      const modelPart = mapped.slice(mapped.indexOf("/") + 1);
      if (modelPart) candidates.push(modelPart);
    }
  }
  for (const c of candidates) {
    const exact = PRICING_MAX_TOKENS.get(c);
    if (exact) return exact;
    const lower = c.toLowerCase();
    for (const [key, max] of PRICING_MAX_TOKENS) {
      if (key.toLowerCase() === lower) return max;
    }
  }
  return DEFAULT_CONTEXT_MAX_TOKENS;
}

const parkedMessages = new Map<string, { content: string; effort: EffortAnalysis; at: number }>();
const MAX_PARKED = 100;
const PARKED_TTL_MS = 300_000;
function parkMessage(sessionID: string, content: string, effort: EffortAnalysis | null): void {
  if (!effort) return;
  const now = Date.now();
  for (const [k, v] of parkedMessages) {
    if (now - v.at > PARKED_TTL_MS) parkedMessages.delete(k);
  }
  lruSet(parkedMessages, sessionID, { content, effort, at: now }, { cap: MAX_PARKED });
}

function detectTawaMention(ctx: MessageUpdatedContext, content: string): void {
  ctx.userMentionedTawa = false;
  ctx.directRoutingAgent = null;
  ctx.userExplicitDispatch = false;
  if (TAWA_MENTION_REGEX.test(content)) {
    ctx.userMentionedTawa = true;
  }
  if (EXPLICIT_DISPATCH_REGEX.test(content)) {
    ctx.userExplicitDispatch = true;
  }
}

const BASE_AGENT_NAMES = new Set([
  "dev",
  "tester",
  "reviewer",
  "architect",
  "analyst",
  "designer",
  "doc",
  "tawa",
  "addagent",
]);
function detectDirectRouting(ctx: MessageUpdatedContext, content: string): void {
  const svc = resolveServiceClients(ctx.serviceClients);
  const routing = svc.analyzeMessage(content);
  if (routing.isDirectRouting && routing.directAgent) {
    const name = normalizeName(routing.directAgent);
    const registered = new Set((ctx.getAgents?.() ?? []).map((a) => normalizeName(a)));
    if (BASE_AGENT_NAMES.has(name) || registered.has(name)) {
      ctx.directRoutingAgent = name;
    }
  }
  (ctx as unknown as { _lastRouting?: ReturnType<MessageUpdatedServiceClients["analyzeMessage"]> })._lastRouting =
    routing;
}

function injectRoutingGuidance(
  ctx: MessageUpdatedContext,
  output: { parts: { type: string; text?: string; [key: string]: unknown }[] },
  agent?: string,
): void {
  const routing = (ctx as unknown as { _lastRouting?: ReturnType<MessageUpdatedServiceClients["analyzeMessage"]> })
    ._lastRouting;
  if (!routing || !Array.isArray(output?.parts)) return;
  if (routing.warnings.length > 0) {
    output.parts.push({
      type: "text" as const,
      text: `\n\n⚠️ **Security Warning**\n${routing.warnings.join("\n")}`,
    });
  }
  const explicitIntent = ctx.userMentionedTawa || ctx.directRoutingAgent !== null || ctx.userExplicitDispatch === true;
  if (routing.guidance && explicitIntent && agent) {
    output.parts.push({
      type: "text" as const,
      text: `\n\n💡 ${routing.guidance}`,
    });
  }
}

function buildDispatchPlan(ctx: MessageUpdatedContext, content: string, effort: EffortAnalysis | null): void {
  const svc = resolveServiceClients(ctx.serviceClients);
  if (!effort || !svc.isComplexEffort(effort, content)) return;
  const dispatchTasks: DispatchTask[] = [
    {
      id: `TASK-${Date.now()}`,
      description: content,
      context: content,
      files: [],
      dependencies: [],
      preferredRole: effort.role ?? undefined,
      specializations: effort.specializations ?? [],
      estimatedComplexity: effort.thinking_effort === "deep" ? "complex" : "medium",
    },
  ];
  const plan = ctx.parallelDispatcher?.buildPlan(dispatchTasks);
  if (!plan || plan.batches.length === 0) return;
  {
    logger.debug(
      `Parallel Dispatcher: plan built with ${plan.totalTasks} tasks, ${plan.estimatedParallelGroups} parallel groups`,
    );
  }
}

function setupDynamicPipeline(ctx: MessageUpdatedContext, content: string, effort: EffortAnalysis | null): void {
  const svc = resolveServiceClients(ctx.serviceClients);
  if (!effort?.thinking_effort) return;
  const newPipeline = svc.getPipeline(effort.thinking_effort);
  const current = ctx.pipelineManager?.getPipeline();
  if (
    current &&
    JSON.stringify(current.phases) === JSON.stringify(newPipeline.phases) &&
    current.effort === newPipeline.effort
  )
    return;

  ctx.pipelineManager?.setPipeline(newPipeline, `task-${ctx.sessionId}-${Date.now()}`);
  const handoffsMap = ctx.handoffs instanceof Map ? ctx.handoffs : new Map(ctx.handoffs.map((h) => [h.id, h]));
  ctx.pipelineManager?.setHandoffsRef(handoffsMap);
  logger.debug(`Pipeline: ${svc.describePipeline(newPipeline)}`);
  try {
    const featureName = content.slice(0, 80).replace(/\s+/g, " ").trim() || `Task ${ctx.sessionId}`;
    const featureEntry = ctx.featureIndex.register({
      name: featureName,
      description: content.slice(0, 500),
      tags: effort?.specializations ?? [],
    });
    ctx.pipelineManager?.setFeatureId(featureEntry.id);
    logger.debug(`Feature registered: ${featureEntry.id} — "${featureName}"`);
  } catch (e) {
    logger.warn("[tawassul] Feature registration failed:", e);
  }
}

async function handleFirstTimeAgent(
  ctx: MessageUpdatedContext,
  input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } },
  output: {
    message: { role: string; text?: string; [key: string]: unknown };
    parts: { type: string; text?: string; [key: string]: unknown }[];
  },
  agentTag: string,
  realPluginRoot: string,
): Promise<void> {
  const sessionSeen = ctx.seenAgents.get(input.sessionID)!;
  const normalizedAgent = normalizeName(agentTag);
  if (ctx.onboardedAgents.has(normalizedAgent)) {
    sessionSeen.add(agentTag);
    return;
  }
  ctx.onboardedAgents.add(normalizedAgent);
  sessionSeen.add(agentTag);

  if (normalizeName(agentTag) !== "tawa" || !Array.isArray(output?.parts)) return;

  await injectTawaGuidance(ctx, output);

  const knowledgeDir = resolve(ctx.directory, "knowledge");
  let realKnowledgeDir: string;
  try {
    realKnowledgeDir = await realpath(knowledgeDir);
  } catch {
    realKnowledgeDir = knowledgeDir;
  }
  if (!realKnowledgeDir.startsWith(realPluginRoot + sep) && realKnowledgeDir !== realPluginRoot) return;

  const criticalRulesPath = resolve(knowledgeDir, "critical-rules.md");
  let realCriticalPath: string;
  try {
    realCriticalPath = await realpath(criticalRulesPath);
  } catch {
    realCriticalPath = resolve(criticalRulesPath);
  }
  if (!realCriticalPath.startsWith(realPluginRoot + sep) && realCriticalPath !== realPluginRoot) return;

  try {
    const criticalRules = await readFile(criticalRulesPath, "utf-8");
    if (criticalRules)
      output.parts.push({
        type: "text" as const,
        text: `\n\n## 📜 Critical Rules\n${criticalRules}`,
      });
  } catch (e) {
    logger.warn(`[message-updated] failed to load critical rules from ${criticalRulesPath}:`, e);
  }
}

async function acceptHandoffs(
  ctx: MessageUpdatedContext,
  agentTag: string,
  output: { parts: { type: string; text?: string; [key: string]: unknown }[] },
  sessionID: string,
): Promise<void> {
  const handoffsIterable = ctx.handoffs instanceof Map ? ctx.handoffs.values() : ctx.handoffs;
  for (const h of handoffsIterable) {
    if (h.status !== "pending" || normalizeName(h.to) !== normalizeName(agentTag)) continue;
    h.status = "accepted";
    if (!h.acknowledgedBy) {
      h.acknowledgedBy = agentTag;
      h.acknowledgedAt = new Date().toISOString();
      if (!h.acceptanceCriteria || h.acceptanceCriteria.length === 0) {
        h.acceptanceCriteria = ["The delegated task is completed as described"];
      }
      const activeChain = (
        ctx as MessageUpdatedContext & { chainCtx?: import("../services/chain-ctx.ts").ChainCtx | null }
      ).chainCtx;
      const emitFn = (
        ctx as MessageUpdatedContext & { emitWithChain?: (type: string, payload: Record<string, unknown>) => void }
      ).emitWithChain;
      const emitFallback = (ctx as MessageUpdatedContext & { elicitationEmit?: (e: unknown) => void }).elicitationEmit;
      const receipt: Record<string, unknown> = {
        chainId: activeChain?.chainId ?? h.id,
        handoffId: h.id,
        acceptanceCriteria: h.acceptanceCriteria,
        acknowledgedBy: agentTag,
        at: h.acknowledgedAt,
      };
      if (emitFn) {
        emitFn("RECEIPT_SIGNED", receipt);
      } else if (emitFallback) {
        emitFallback({ type: "RECEIPT_SIGNED", ...receipt });
      }
    }
    ctx.recordHandoffAccepted(agentTag, h.id);
    ctx.updateLastActive(agentTag);
    await ctx.saveState();

    let packActive = false;
    let packReason: string | undefined;
    if (h.contextPackDigest) {
      const activation = await activatePack({
        worktree: ctx.directory,
        sessionID,
        digest: h.contextPackDigest,
        readMessages: async () => {
          const bridge = getSessionBridge();
          if (!bridge) return [];
          try {
            return await bridge.context({ sessionID });
          } catch {
            return [];
          }
        },
      });
      packActive = activation.ok;
      packReason = activation.reason;
    }

    if (!packActive && h.contextPackDigest && Array.isArray(output?.parts)) {
      output.parts.push({
        type: "text" as const,
        text: `⚠️ Portable context pack ${h.contextPackDigest.slice(0, 16)} is unavailable (${packReason ?? "unknown"}); the checkpoint below is the fallback.`,
      });
    }

    if (!packActive && h.checkpoint && Array.isArray(output?.parts)) {
      const cp = h.checkpoint;
      const summary = [
        t("continuationTitle", { id: h.id }),
        "",
        t("continuationFrom", { agent: h.from }),
        "",
        t("continuationSectionCompleted"),
        ...cp.completed.map((c) => `- ${c}`),
        "",
        t("continuationSectionRemaining"),
        ...cp.remaining.map((r) => `- ${r}`),
        "",
        t("continuationSectionFiles"),
        ...cp.filesChanged.map((f) => `- \`${f}\``),
        cp.decisions.length > 0
          ? ["", t("continuationSectionDecisions"), ...cp.decisions.map((d) => `- **${d.title}**: ${d.detail}`)].join(
              "\n",
            )
          : "",
        "",
        t("continuationReadCheckpoint"),
      ]
        .filter(Boolean)
        .join("\n");
      output.parts.push({ type: "text" as const, text: summary });
    }
  }
}

function injectModeAndStatus(
  ctx: MessageUpdatedContext,
  input: { sessionID: string; agent?: string },
  output: {
    message: { role: string; text?: string; [key: string]: unknown };
    parts: { type: string; text?: string; [key: string]: unknown }[];
  },
  role: string,
): void {
  if (!input.agent && Array.isArray(output?.parts) && ctx.detectedMode) {
    output.parts.push({
      type: "text" as const,
      text:
        ctx.detectedMode === "plan"
          ? `🔵 **Plan mode** active — agents are read-only. Switch to **Build** (Tab) for implementation.`
          : `🟢 **Build mode** active — agents have full access.`,
    });
  }

  if (!input.agent && Array.isArray(output?.parts) && role === "user") {
    injectPerformanceAlerts(ctx, output);
    injectAutoStatus(ctx, output, getMessageContent(output).toLowerCase());
  }
}

function injectContextEngine(
  ctx: MessageUpdatedContext,
  input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } },
  output: {
    message: { role: string; text?: string; [key: string]: unknown };
    parts: { type: string; text?: string; [key: string]: unknown }[];
  },
  role: string,
): void {
  const priorityIndex = ctx.priorityIndex;
  const contextNudgeManager = ctx.contextNudgeManager;
  const svc = resolveServiceClients(ctx.serviceClients);

  if (priorityIndex && role && input.agent) {
    const content = getMessageContent(output);
    const priorityResult = svc.classifyMessagePriority(content, "chat.message", input.agent);
    const entry: ScoredContextEntry = {
      id: `msg-${input.sessionID}-${Date.now()}`,
      priority: priorityResult.priority,
      score: priorityResult.score,
      tokens: svc.estimateTokens(content),
      protected: priorityResult.priority === "critical" || priorityResult.priority === "pinned",
      agent: input.agent,
      timestamp: Date.now(),
      type: "message",
      dependsOn: [],
    };
    priorityIndex.insert(entry);
  }

  if (contextNudgeManager && role === "user") {
    const content = getMessageContent(output);
    const msgTokens = svc.estimateTokens(content);
    const stats = priorityIndex?.getStats();
    const maxTokens = resolveMaxContextTokens(input.model, ctx.agentModelMap, input.agent);
    const usedTokens = stats?.totalTokens ?? msgTokens;
    const usage = svc.estimateContextUsage(usedTokens, 0, 0, 0, maxTokens);
    const nudge = contextNudgeManager.evaluate(usage);
    if (nudge) {
      const pct = Math.round(usage.percentage * 100);
      const chatInjection =
        (ctx.config?.innovations?.contextNudges as { chatInjection?: boolean } | undefined)?.chatInjection === true;
      if (chatInjection && Array.isArray(output?.parts)) {
        output.parts.push({
          type: "text" as const,
          text: `\n\n_${nudge.message}_`,
        });
      } else {
        logger.info(
          `[tawassul] Context nudge (${nudge.severity}): ${pct}% (${usedTokens}/${maxTokens} tokens) — ${nudge.message}`,
        );
      }
    }
  }
}

function normalizeInjectedParts(
  input: { sessionID: string; messageID?: string },
  parts: { type: string; text?: string; [key: string]: unknown }[] | undefined,
  fallbackMessageID?: string,
): void {
  if (!Array.isArray(parts)) return;
  const messageID = isValidMessageId(input.messageID)
    ? input.messageID
    : isValidMessageId(fallbackMessageID)
      ? fallbackMessageID
      : (parts.find((p) => isValidMessageId(p?.messageID))?.messageID as string | undefined);
  if (!messageID) {
    const unowned = parts.filter(
      (p) =>
        p?.type === "text" &&
        !(
          typeof p.id === "string" &&
          p.id.startsWith("prt") &&
          typeof p.sessionID === "string" &&
          typeof p.messageID === "string"
        ),
    );
    if (unowned.length > 0) {
      logger.error(
        `[tawassul] normalizeInjectedParts: no msg_* owner for ${unowned.length} injected part(s) in session=${input.sessionID} — dropping them`,
      );
      const drop = new Set(unowned);
      const kept = parts.filter((p) => !drop.has(p));
      parts.length = 0;
      parts.push(...kept);
    }
    return;
  }
  parts.forEach((p) => {
    if (p?.type !== "text") return;
    if (
      typeof p.id === "string" &&
      p.id.startsWith("prt") &&
      typeof p.sessionID === "string" &&
      typeof p.messageID === "string"
    )
      return;
    p.sessionID = input.sessionID;
    p.messageID = messageID;
    p.id = `prt_${randomUUID().replace(/-/g, "")}`;
  });
}

export function createMessageUpdatedHook(ctx: MessageUpdatedContext) {
  const svc = resolveServiceClients(ctx.serviceClients);
  const pluginRoot = resolve(ctx.directory);
  let realPluginRoot: string;
  try {
    realPluginRoot = realpathSync(pluginRoot);
  } catch {
    realPluginRoot = pluginRoot;
  }

  const concordanceInjected = new Set<string>();

  const MAX_CONCORDANCE_SESSIONS = 512;
  function markConcordanceInjected(sessionID: string) {
    if (concordanceInjected.size >= MAX_CONCORDANCE_SESSIONS) {
      const oldest = [...concordanceInjected].slice(0, 128);
      for (const id of oldest) concordanceInjected.delete(id);
    }
    concordanceInjected.add(sessionID);
  }

  return async (
    input: { sessionID: string; messageID?: string; agent?: string; model?: { providerID: string; modelID: string } },
    output: {
      message: { role: string; text?: string; [key: string]: unknown };
      parts: { type: string; text?: string; [key: string]: unknown }[];
    },
  ) => {
    try {
      if (svc.isAskInjection(output)) {
        logger.debug(`[tawassul] Skipping self-injected (ASK_MARKER) message ${input.sessionID}`);
        return;
      }
      const role = getRole(input as Record<string, unknown>, output);
      const modeEnv = process?.env?.OPENCODE_MODE;
      if (modeEnv === "plan" || modeEnv === "build") ctx.detectedMode = modeEnv;

      let effort: EffortAnalysis | null = null;

      if (role === "user") {
        const handoffCount = ctx.handoffs instanceof Map ? ctx.handoffs.size : ctx.handoffs.length;
        logger.debug(`User message: session=${input.sessionID} handoffs=${handoffCount} records=${ctx.records.length}`);

        const hasActiveHandoff =
          ctx.handoffs instanceof Map
            ? [...ctx.handoffs.values()].some((h) => h.status === "pending" || h.status === "accepted")
            : ctx.handoffs.some((h) => h.status === "pending" || h.status === "accepted");
        ctx.userIntervened = hasActiveHandoff;
        if (hasActiveHandoff) {
          logger.debug(`User intervention detected — ${handoffCount} active handoffs`);
        }

        const p = ctx.pipelineState;
        if (p) {
          p.resetCallDepth(input.sessionID);
          p.resetAgentResponded(input.sessionID);
        }

        const content = getMessageContent(output);

        const askChannel = (
          ctx as MessageUpdatedContext & { askChannel?: import("../services/ask-channel.ts").AskChannel }
        ).askChannel;
        const isRootUserMessage = role === "user" && !input.agent;
        if (askChannel && isRootUserMessage) {
          askChannel.noteSession(input.sessionID);
        }
        let consumedAnswer: import("../services/ask-channel.ts").AskReply | undefined;
        let consumedKind: import("../services/ask-channel.ts").AskKind | undefined;
        if (askChannel && isRootUserMessage) {
          const resolved = askChannel.onUserMessage(input.sessionID, content);
          if (resolved.consumed) {
            consumedAnswer = resolved.answer;
            consumedKind = resolved.kind;
            if (resolved.kind?.type === "select" && consumedAnswer !== undefined) {
              const record = (
                ctx as MessageUpdatedContext & {
                  recordDecision?: (c: string, o?: { tags?: string[]; importance?: "low" | "medium" | "high" }) => void;
                }
              ).recordDecision;
              record?.(`User confirmed dispatch choice for "${content}": "${String(consumedAnswer)}"`, {
                tags: ["user", "decision", "elicitation"],
                importance: "medium",
              });
            }
          }
        }

        detectTawaMention(ctx, content);
        detectDirectRouting(ctx, content);
        effort = svc.analyzeEffort(content);
        const elicitationAsk = (ctx as MessageUpdatedContext & { elicitationAsk?: ElicitationAsk }).elicitationAsk;
        const elicitationEmit = (ctx as MessageUpdatedContext & { elicitationEmit?: (e: unknown) => void })
          .elicitationEmit;
        let dispatchContent =
          consumedKind?.type === "select" && consumedAnswer !== undefined ? String(consumedAnswer) : content;
        const alreadyAnswered = consumedAnswer !== undefined;
        if (alreadyAnswered) parkedMessages.delete(input.sessionID);
        let gateDeferred = false;
        const onDeferredTimeout = () => {
          const parked = parkedMessages.get(input.sessionID);
          if (!parked) return;
          parkedMessages.delete(input.sessionID);
          logger.debug(
            `[message-updated] deferred timeout — re-dispatching original content in session=${input.sessionID}`,
          );
          buildDispatchPlan(ctx, parked.content, parked.effort);
          setupDynamicPipeline(ctx, parked.content, parked.effort);
        };
        const explicitDispatchIntent =
          ctx.userMentionedTawa || ctx.directRoutingAgent !== null || ctx.userExplicitDispatch === true;
        if (
          elicitationAsk &&
          !alreadyAnswered &&
          isRootUserMessage &&
          explicitDispatchIntent &&
          content.trim() &&
          DISPATCH_QA_IN_ROOT
        ) {
          try {
            const gateResult = await svc.runElicitationGate(effort, content, {
              ask: elicitationAsk,
              channel: (ctx as MessageUpdatedContext & { askChannel?: import("../services/ask-channel.ts").AskChannel })
                .askChannel,
              sessionID: input.sessionID,
              emit: (...args: unknown[]) => elicitationEmit?.(args[0] as { type: string }),
              chain: (ctx as MessageUpdatedContext & { chainCtx?: import("../services/chain-ctx.ts").ChainCtx | null })
                .chainCtx,
              onTimeout: onDeferredTimeout,
            });
            if (gateResult.selected) {
              dispatchContent = gateResult.option;
              parkedMessages.delete(input.sessionID);
              const record = (
                ctx as MessageUpdatedContext & {
                  recordDecision?: (c: string, o?: { tags?: string[]; importance?: "low" | "medium" | "high" }) => void;
                }
              ).recordDecision;
              record?.(`User confirmed dispatch choice for "${content}": "${gateResult.option}"`, {
                tags: ["user", "decision", "elicitation"],
                importance: "medium",
              });
            } else if (gateResult.reason === "deferred") {
              parkMessage(input.sessionID, content, effort);
              gateDeferred = true;
              if (Array.isArray(output?.parts) && effort) {
                output.parts.push({
                  type: "text" as const,
                  text: `\n${svc.formatAskPrompt(effort.action_hint || "Request unspecified — choose from options:", {
                    type: "select",
                    options: svc.buildOptions(effort, content),
                  })}`,
                });
              }
            }
          } catch (err) {
            logger.warn(`[tawassul] elicitation gate failed, proceeding with original content:`, err);
          }
        }
        if (gateDeferred) {
          injectRoutingGuidance(
            ctx,
            output as unknown as { parts: { type: string; text?: string; [key: string]: unknown }[] },
            input.agent,
          );
          logger.debug(`[message-updated] deferred — parked user message in session=${input.sessionID}`);
          return;
        }
        buildDispatchPlan(ctx, dispatchContent, effort);
        setupDynamicPipeline(ctx, dispatchContent, effort);
        injectRoutingGuidance(
          ctx,
          output as unknown as { parts: { type: string; text?: string; [key: string]: unknown }[] },
          input.agent,
        );
      }

      if (input.agent) {
        const agentTag = normalizeName(input.agent);

        if (input.sessionID && role === "assistant" && output?.parts) {
          const hasText = output.parts.some((p) => p.type === "text" && (p.text?.trim()?.length ?? 0) > 0);
          if (hasText) ctx.pipelineState?.markAgentResponded(input.sessionID, agentTag);
        }

        if (input.model) {
          const key = normalizeName(agentTag);
          const modelId = `${input.model.providerID}/${input.model.modelID}`;
          delete ctx.agentModelMap[key];
          ctx.agentModelMap[key] = modelId;
        }

        if (!ctx.seenAgents.has(input.sessionID)) ctx.seenAgents.set(input.sessionID, new Set());

        await handleFirstTimeAgent(ctx, input, output, agentTag, realPluginRoot);

        await acceptHandoffs(ctx, agentTag, output, input.sessionID);
      }

      injectModeAndStatus(ctx, input, output, role);
      injectContextEngine(ctx, input, output, role);

      if (role === "assistant" && Array.isArray(output?.parts)) {
        const copilot = svc.takeCopilotDigest?.(input.sessionID);
        if (copilot) {
          output.parts.push({
            type: "text" as const,
            text: `\n\n### 🎯 COPILOT — Goal Ledger\n${copilot}`,
          });
        }
      }

      if (
        (role === "assistant" || role === "user") &&
        !input.agent &&
        input.sessionID &&
        Array.isArray(output?.parts) &&
        !concordanceInjected.has(input.sessionID)
      ) {
        if (ctx.concordanceText) {
          output.parts.push({
            type: "text" as const,
            text: ctx.concordanceText,
          });
        }
      }
    } catch (e) {
      const errorMsg = translateError({ error: "unknown", lang: "en", reason: String(e) });
      logger.warn("[tawassul] chat.message hook error:", errorMsg);
    } finally {
      normalizeInjectedParts(input, output?.parts, output?.message?.id as string | undefined);
      if (
        input.sessionID &&
        Array.isArray(output?.parts) &&
        !concordanceInjected.has(input.sessionID) &&
        output.parts.some((p) => typeof p.text === "string" && p.text.includes("System Concordance"))
      ) {
        markConcordanceInjected(input.sessionID);
      }
    }
  };
}
