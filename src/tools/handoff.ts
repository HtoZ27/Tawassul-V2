import { normalizeName } from "../utils/name-utils.ts";
import type { TawassulContext } from "../context.ts";
import type { ToolDefinition, ToolContext } from "../tool.ts";
import type { Checkpoint, HandoffEntry } from "../context/types.ts";
import { tool } from "../tool.ts";
import { t } from "../translations.ts";
import { evaluateRules } from "../conflict-resolver/rules.ts";
import type { RuleDecision } from "../conflict-resolver/types.ts";
import { explainDecision } from "../conflict-resolver/explainer.ts";
import { validateHandoffInput } from "../utils/validation.ts";
import { secureRandom } from "../utils/crypto.ts";
import { toolScopeOnlyHint } from "../utils/text-utils.ts";
import { ParallelAggregator } from "../services/parallel-aggregator.ts";
import { getFallbackChain } from "../services/proxy-fallback-chains.ts";
import { logger } from "../utils/logger.ts";
import { resolveRole } from "../utils/agent.ts";
import { MAX_PARALLEL_COPIES } from "../context/constants.ts";
import { attachPackToHandoff } from "../services/context-pack/index.ts";
import { resolveAgentModelRef } from "../services/model-refs.ts";
import { clearOwner, clearRunFlags } from "../services/continuity/owner.ts";

function buildAccumulatedContext(
  ctx: TawassulContext,
  targetAgent: string,
  newContext: string,
  _newCheckpoint: Checkpoint | undefined,
): string {
  const allCompleted = [...ctx.handoffs.values()].filter((h) => h.status === "completed" || h.status === "accepted");
  const isRelevanceRanked =
    ((ctx as unknown as { isInnovationOn?: (n: string) => boolean }).isInnovationOn?.("context.relevance-ranked") ??
      (ctx as unknown as { config?: { innovations?: Record<string, unknown> } }).config?.innovations?.[
        "context.relevance-ranked"
      ] ??
      (ctx as unknown as { config?: { innovations?: Record<string, unknown> } }).config?.innovations?.[
        "contextRelevanceRanked"
      ] ??
      true) === true;

  let recentHandoffs: typeof allCompleted;
  if (isRelevanceRanked && allCompleted.length > 5 && newContext.trim()) {
    const queryTokens = new Set(newContext.toLowerCase().split(/\s+/u).filter(Boolean));
    const scored = allCompleted.slice(-20).map((h, idx) => {
      const hTokens = new Set(`${h.task} ${h.context ?? ""}`.toLowerCase().split(/\s+/u).filter(Boolean));
      const inter = [...queryTokens].filter((t) => hTokens.has(t)).length;
      const union = new Set([...queryTokens, ...hTokens]).size || 1;
      const jaccard = inter / union;
      const recencyBoost = (idx + 1) / 20;
      return { h, score: jaccard * 0.8 + recencyBoost * 0.2 };
    });
    scored.sort((a, b) => b.score - a.score);
    const picked: typeof allCompleted = [];
    for (const { h } of scored) {
      if (picked.length >= 5) break;
      const isDuplicate = picked.some((p) => p.task === h.task);
      if (!isDuplicate) picked.push(h);
    }
    recentHandoffs = picked;
  } else {
    recentHandoffs = allCompleted.slice(-5);
  }

  const chainSummary = recentHandoffs
    .map((h) => `[${h.id}] ${h.from} → ${h.to}: ${h.task.substring(0, 100)}`)
    .join("\n");

  const decisions = recentHandoffs.flatMap((h) => h.checkpoint?.decisions ?? []).slice(-10);
  const decisionsText =
    decisions.length > 0
      ? `\n## Previous Decisions\n${decisions.map((d) => `- **${d.title}**: ${d.detail}`).join("\n")}`
      : "";

  const filesChanged = recentHandoffs.flatMap((h) => h.checkpoint?.filesChanged ?? []).slice(-15);
  const filesText =
    filesChanged.length > 0 ? `\n## Changed Files\n${filesChanged.map((f) => `- \`${f}\``).join("\n")}` : "";

  let evalText = "";
  try {
    const features = ctx.featureIndex.getAll();
    const evalSections: string[] = [];

    for (const feat of features.slice(-3)) {
      const reports = ctx.featureIndex.getEvaluationReports(feat.id);
      if (reports.length === 0) continue;

      const allIssues = reports.flatMap((r) => r.issues);
      const openIssues = allIssues.filter(
        (i) => i.status !== "resolved" && i.status !== "wont_fix" && i.status !== "duplicate",
      );
      const resolvedCount = allIssues.filter((i) => i.status === "resolved").length;

      const recentReports = reports.slice(-3);
      const evalSummary = recentReports
        .map((r) => `- round ${r.round}: ${r.issues.length} issues, ${r.recommendations.length} recommendations`)
        .join("\n");

      const coverageSummary =
        Object.keys(reports[reports.length - 1]?.coverageMap ?? {}).length > 0
          ? `${Object.keys(reports[reports.length - 1]!.coverageMap).length} areas covered`
          : "No coverage recorded";

      evalSections.push(
        `### ${feat.name} (${feat.id})`,
        `- **Open issues:** ${openIssues.length}`,
        `- **Resolved issues:** ${resolvedCount}`,
        `- **Latest evaluations:**`,
        evalSummary,
        `- **Coverage:** ${coverageSummary}`,
        openIssues.length > 0
          ? `- **Top open issues:**\n${openIssues
              .slice(0, 5)
              .map((i) => `  - [${i.severity}] ${i.description} (${i.category})`)
              .join("\n")}`
          : "",
      );
    }

    if (evalSections.length > 0) {
      evalText = `\n## 📋 Evaluations\n${evalSections.join("\n")}`;
    }
  } catch (e) {
    logger.warn(`handoff context: evaluations section dropped:`, e);
  }

  const sections: string[] = [];

  sections.push(
    ``,
    `## 🎯 Goals (live)`,
    `Project goals, items and DoD live behind the \`goal\` tool — read via \`goal(list: true)\` / \`goal(get: "G-xxx")\`. Never grep plugin files for goals.`,
  );

  if (recentHandoffs.length > 0) {
    sections.push(`## ⛓️ Chain Context (accumulated)`, ``, `**Previous deliveries:**`, chainSummary, decisionsText, filesText);
  }

  try {
    const forAgent = ctx.getMemoryForAgent(targetAgent);
    const memSections: string[] = [];
    const recentDecisions = forAgent.decisions
      .slice(-5)
      .map((d) => d.content)
      .filter((c) => typeof c === "string");
    if (recentDecisions.length > 0) {
      memSections.push(
        `\n## 🧠 Decision Memory (for ${targetAgent})\n${recentDecisions.map((d) => `- ${d}`).join("\n")}`,
      );
    }
    const recentLearnings = forAgent.learnings.slice(-5).filter((l) => typeof l.content === "string");
    if (recentLearnings.length > 0) {
      memSections.push(
        `\n## 📌 Learned Lessons (for ${targetAgent})\n${recentLearnings
          .slice(-3)
          .map((l) => `- ${String(l.content)}`)
          .join("\n")}`,
      );
    }
    if (memSections.length > 0) sections.push(...memSections);
  } catch (e) {
    logger.warn(`handoff context: memory sections dropped for ${targetAgent}:`, e);
  }

  if (evalText) sections.push(evalText);

  sections.push(``, `---`, `## 🆕 New Context (for ${targetAgent})`, newContext);

  return sections.join("\n");
}

function isCheckpoint(value: unknown): value is Checkpoint {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    Array.isArray(obj.completed) &&
    obj.completed.every((c): c is string => typeof c === "string") &&
    Array.isArray(obj.remaining) &&
    obj.remaining.every((r): r is string => typeof r === "string") &&
    Array.isArray(obj.filesChanged) &&
    obj.filesChanged.every((f): f is string => typeof f === "string") &&
    Array.isArray(obj.decisions) &&
    obj.decisions.every(
      (d): d is { title: string; detail: string } =>
        typeof d === "object" &&
        d !== null &&
        typeof (d as Record<string, unknown>).title === "string" &&
        typeof (d as Record<string, unknown>).detail === "string",
    )
  );
}

function asCheckpoint(value: unknown): Checkpoint | undefined {
  if (isCheckpoint(value)) return value;
  return undefined;
}

export function resolveRerouteModel(callerRole: string, currentModel?: string): string | undefined {
  const chain = getFallbackChain(callerRole);
  return chain.find((m) => m !== currentModel) ?? chain[0];
}

export function buildHandoffTool(ctx: TawassulContext): ToolDefinition {
  return tool({
    description: [
      "Handoff — pass tasks between agents, complete, undo, or rescue stalled ones.",
      toolScopeOnlyHint("Handoffs live ONLY behind this tool", "them"),
      "",
      "Exactly ONE action per call:",
      "• create — Required: to, task, context. Optional: files[], checkpoint, parallelCopies.",
      "  parallelCopies creates N copies to N different agents with the same task; each completes independently, results shown side by side.",
      "• completeHandoff — Required: completeHandoff (the handoff ID). Optional: result (summary of what was accomplished).",
      "• undo — Required: undo (the handoff ID); reverts an accepted handoff back to pending.",
      "• rescue — Required: rescue (handoff ID), to (new agent), context (reason); @analyst only.",
      "• helpRequest — Required: to, task, context, helpRequest: true.",
      "",
      "checkpoint (create only, when your context runs low): completed[], remaining[], filesChanged[], decisions[{title, detail}].",
      "",
      "RULES: context ≥ 5 words (required), ≥ 10 words (recommended). task ≥ 3 words (required), ≥ 5 words (recommended). files optional but recommended. DO NOT mix actions in one call.",
    ].join("\n"),
    args: {
      to: tool.schema.string().optional().describe("Target agent (@name)"),
      task: tool.schema.string().optional().describe("What needs to be done"),
      context: tool.schema.string().optional().describe("Context for the receiving agent"),
      files: tool.schema.array(tool.schema.string()).optional().describe("Files involved"),
      helpRequest: tool.schema.boolean().optional().describe("Request another agent to call a tool on your behalf"),
      parallelCopies: tool.schema
        .number()
        .int()
        .min(2)
        .max(MAX_PARALLEL_COPIES)
        .optional()
        .describe("Create N parallel copies to different agents (2-5)"),
      result: tool.schema.string().optional().describe("Result output when completing a handoff"),
      checkpoint: tool.schema
        .object({
          completed: tool.schema.array(tool.schema.string()).describe("What was completed so far"),
          remaining: tool.schema.array(tool.schema.string()).describe("What remains to finish the task"),
          filesChanged: tool.schema.array(tool.schema.string()).describe("Files that changed"),
          decisions: tool.schema
            .array(
              tool.schema.object({
                title: tool.schema.string(),
                detail: tool.schema.string(),
              }),
            )
            .describe("Decisions made along the way"),
        })
        .optional()
        .describe("Checkpoint for continuation — use when your context runs low"),
      completeHandoff: tool.schema.string().optional().describe("Handoff ID to mark completed (e.g. H-001)"),
      undo: tool.schema.string().optional().describe("Handoff ID to revert to pending"),
      rescue: tool.schema.string().optional().describe("Stalled handoff ID to force-reassign (e.g. H-003)"),
    },
    async execute(args: Record<string, unknown>, cctx: ToolContext) {
      if (args.completeHandoff) {
        const id = args.completeHandoff as string;
        const h = ctx.handoffs.get(id);
        if (!h) return { output: t("handoffNotFound", { id }) };
        if (h.status === "completed") return { output: t("handoffAlreadyComplete", { id }) };
        if (normalizeName(h.to) !== normalizeName(cctx.agent) && normalizeName(cctx.agent) !== "analyst") {
          return { output: t("handoffCompleteNoPermission", { id, to: h.to }) };
        }
        if (args.result) h.result = args.result as string;

        if (ctx.handoffService) {
          const result = await ctx.handoffService.completeHandoff(id, cctx.agent);
          if (!result.success) {
            return { output: result.message };
          }
        } else {
          h.status = "completed";
          const nf = normalizeName(h.from);
          ctx.agentErrors[nf] = Math.max(0, (ctx.agentErrors[nf] ?? 0) - 1);
          ctx.recordHandoffCompleted(h.to);
          if (h.task.startsWith("🆘 HELP:")) {
            ctx.recordHelpRequestFulfilled(cctx.agent);
          }
          ctx.updateLastActive(cctx.agent);
          ctx.saveState();
          ctx.statsCollector.recordHandoff(h.to, true, Date.now() - new Date(h.timestamp || Date.now()).getTime());
          ctx.gamification.recordAction(h.to, "completedHandoffs");
          ctx.sharedMemory.addHandoffRecord({
            id: h.id,
            from: h.from,
            to: h.to,
            task: h.task,
            timestamp: new Date().toISOString(),
            success: true,
            duration: 0,
          });
          await ctx.fileLocks.releaseAllForHandoff(h.id);
          ctx.taskPriority.removeFromQueue(h.id);
          clearRunFlags(h);
          await clearOwner(h.id);
        }

        const completionDecision = h.decision ?? { action: "allow", reason: "Handoff completed", confidence: 1 };
        ctx.conflictLearner.recordOutcome(
          h.decisionRuleId ?? "COMPLETE",
          completionDecision,
          completionDecision.action === "allow",
          h.to,
        );

        if (h.parallelId) {
          const aggregator = new ParallelAggregator();
          const aggregated = aggregator.aggregate([...ctx.handoffs.values()], h.parallelId);

          if (!aggregated.allDone) {
            return {
              title: `✅ ${id} completed — ${aggregated.completedCount}/${aggregated.totalCount}`,
              output: [
                t("handoffCompleted", { id, agent: cctx.agent }),
                ``,
                t("parGroupProgress", {
                  id: h.parallelId,
                  done: String(aggregated.completedCount),
                  total: String(aggregated.totalCount),
                }),
                t("parGroupWaiting", { count: String(aggregated.totalCount - aggregated.completedCount) }),
                aggregator.buildReport(aggregated),
              ].join("\n"),
              metadata: { handoff: h, parallelId: h.parallelId, aggregated: aggregator },
            };
          }

          const report = aggregator.buildReport(aggregated);
          try {
            ctx.trainingEvaluator.recordParallelEvaluation(
              aggregated.results.map((r) => ({
                agent: r.agent,
                role: "dev",
                prompt: r.task,
                output: r.result,
                sessionId: cctx.sessionID,
              })),
            );
          } catch {
          }
          return {
            title: `✅ ${id} completed — ${t("parallelGroupDone", { count: String(aggregated.totalCount) })}`,
            output: t("handoffCompleted", { id, agent: cctx.agent }) + report,
            metadata: {
              handoff: h,
              parallelComplete: true,
              parallelId: h.parallelId,
              siblingHandoffs: aggregated.results.map((x) => x.handoffId),
              bestAgent: aggregator.getBestAgent([...ctx.handoffs.values()], h.parallelId),
            },
          };
        }

        return {
          title: `✅ ${id} completed`,
          output: t("handoffCompleted", { id, agent: cctx.agent }),
          metadata: { handoff: h },
        };
      }

      if (args.rescue) {
        const rescueId = args.rescue as string;
        const original = ctx.handoffs.get(rescueId);
        if (!original) return { output: t("handoffRescueNotFound", { id: rescueId }) };
        if (original.status === "completed") return { output: t("handoffRescueAlreadyComplete", { id: rescueId }) };
        if (original.status === "pending") return { output: t("handoffRescuePending", { id: rescueId }) };
        if (original.status !== "accepted" && original.status !== "paused") {
          return { output: t("handoffRescueNotActive", { id: rescueId, status: original.status }) };
        }
        if (!args.to) return { output: t("handoffRescueRequiresTo", { id: rescueId }) };
        if (normalizeName(cctx.agent) !== "analyst") {
          return { output: t("handoffRescueNotAnalyst", { agent: cctx.agent }) };
        }

        const rescueTarget = normalizeName(args.to);
        if (rescueTarget === "tawa") {
          return { output: t("handoffRescueTawa") };
        }

        if (ctx.handoffService) {
          const closed = await ctx.handoffService.closeForRescue(original.id, cctx.agent);
          if (!closed.success) return { output: closed.message };
        } else {
          original.status = "closed";
          original.rescue = true;
          await ctx.fileLocks.releaseAllForHandoff(original.id);
          ctx.taskPriority.removeFromQueue(original.id);
          clearRunFlags(original);
          await clearOwner(original.id);
          ctx.updateLastActive(cctx.agent);
        }

        const agentModelMap = ctx.modelManager.agentModelMap;
        const rescueEntry = {
          id: ctx.nextHandoffId(),
          from: `🚑 ${cctx.agent} (rescue ${rescueId})`,
          to: normalizeName(args.to as string),
          task: `🚑 RESCUE: ${original.task}`,
          context: [
            t("rescueContextHeader", { from: original.from, id: rescueId }),
            ``,
            t("rescueOriginalTask", { task: original.task }),
            t("rescueOriginalContext", { context: original.context }),
            original.checkpoint && original.checkpoint.completed.length > 0
              ? t("rescueCompleted", { items: original.checkpoint.completed.join(", ") })
              : "",
            original.checkpoint && original.checkpoint.remaining.length > 0
              ? t("rescueRemaining", { items: original.checkpoint.remaining.join(", ") })
              : "",
            t("rescueReason", { reason: (args.context as string) || "unspecified" }),
            ``,
            t("rescueContinuation", { to: args.to as string, from: original.from }),
          ]
            .filter(Boolean)
            .join("\n"),
          files: original.files,
          checkpoint: original.checkpoint,
          timestamp: new Date().toISOString(),
          status: "pending",
          rescue: true,
          implementer: resolveAgentModelRef(cctx.agent, agentModelMap),
          reviewer: resolveAgentModelRef(args.to as string, agentModelMap),
        };
        ctx.handoffs.set(rescueEntry.id, rescueEntry as HandoffEntry);
        ctx.recordHandoffInitiated(cctx.agent, rescueEntry.context, rescueEntry.task, !!rescueEntry.checkpoint, false);
        ctx.updateLastActive(cctx.agent);
        ctx.saveState();

        return {
          title: `🚑 ${rescueEntry.id}: Rescue ${rescueId}`,
          output: [
            `## 🚑 Rescue Handoff ${rescueEntry.id}`,
            `**Rescued:** ${rescueId} (${original.from} → ${original.to})`,
            `**Reassigned to:** ${args.to}`,
            `**Task:** ${rescueEntry.task}`,
            ``,
            t("rescueOriginalClosed", { id: rescueId }),
            t("rescueNewCreated", { id: rescueEntry.id, agent: String(args.to) }),
            ``,
            rescueEntry.checkpoint
              ? [
                  t("rescueCheckpointFrom", { id: rescueId }),
                  ...(rescueEntry.checkpoint.completed || []).map((c: string) => `✅ ${c}`),
                  ...(rescueEntry.checkpoint.remaining || []).map((r: string) => `⏳ ${r}`),
                ]
                  .filter(Boolean)
                  .join("\n")
              : t("rescueNoCheckpoint"),
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { handoff: rescueEntry, rescued: rescueId },
        };
      }

      if (args.undo) {
        const id = args.undo as string;
        const h = ctx.handoffs.get(id);
        if (!h) return { output: t("handoffUndoNotFound", { id }) };
        if (h.status === "pending") return { output: t("handoffUndoAlreadyPending", { id }) };
        if (normalizeName(h.from) !== normalizeName(cctx.agent) && normalizeName(cctx.agent) !== "analyst") {
          return { output: t("handoffUndoNoPermission", { id, from: h.from }) };
        }
        if (ctx.handoffService) {
          const result = await ctx.handoffService.undoHandoff(id, cctx.agent);
          if (!result.success) return { output: result.message };
        } else {
          const wasCompleted = h.status === "completed";
          h.status = "pending";
          if (wasCompleted) {
            const nf = normalizeName(h.from);
            ctx.agentErrors[nf] = (ctx.agentErrors[nf] ?? 0) + 1;
            ctx.revertHandoffCompleted(h.to);
            const nt = normalizeName(h.to);
            const cap = ctx.config.agentModels?.[nt]?.capability || ctx.readAgentMd(nt)?.capability;
            if (cap) ctx.capabilityTracker.revertCapabilityUpdate(nt, cap, true);
            ctx.statsCollector.revertHandoff(nt, true);
            ctx.gamification.revertAction(nt, "completedHandoffs");
            const memory = ctx.sharedMemory.get();
            const idx = memory.handoffHistory.findIndex((r) => r.id === h.id);
            if (idx !== -1) memory.handoffHistory.splice(idx, 1);
          }
          await ctx.fileLocks.releaseAllForHandoff(h.id);
          ctx.taskPriority.removeFromQueue(h.id);
          clearRunFlags(h);
          await clearOwner(h.id);
          ctx.updateLastActive(cctx.agent);
          ctx.saveState();
        }
        return { title: `↩️ ${id} reverted`, output: t("handoffUndoReverted", { id }) };
      }

      if (!args.to || !args.task || !args.context) {
        return { output: t("handoffCreateRequired") };
      }

      const normalizedTo = normalizeName(args.to as string);
      const normalizedFrom = normalizeName(cctx.agent);

      const autoFixed: string[] = [];
      const rawTo = String(args.to ?? "").trim();
      args.to = rawTo.startsWith("@") ? rawTo.trim() : `@${normalizeName(rawTo)}`;
      if (String(args.to) !== rawTo) autoFixed.push("to");
      args.task = String(args.task ?? "").trim();
      let contextToUse = String(args.context ?? "").trim();
      let contextMerged = false;
      if (contextToUse.split(/\s+/u).filter(Boolean).length < 5) {
        const merged = buildAccumulatedContext(ctx, normalizedTo, contextToUse, asCheckpoint(args.checkpoint));
        if (merged.split(/\s+/u).filter(Boolean).length >= 10) {
          contextToUse = merged;
          contextMerged = true;
          autoFixed.push("context");
        }
      }
      args.context = contextToUse;
      if (autoFixed.length > 0) {
        logger.info(`handoff: auto-fixed fields before validation: ${autoFixed.join(", ")}`);
      }

      const feedback = await validateHandoffInput(
        normalizedFrom,
        normalizedTo,
        args.task as string,
        args.context as string,
        args.files as string[] | undefined,
        cctx.directory,
        [...ctx.handoffs.values()],
        ctx.getSuggestedHandoffs(),
      );

      const srcCap =
        ctx.config.agentModels?.[normalizedFrom]?.capability || ctx.readAgentMd(normalizedFrom)?.capability;
      const dstCap = ctx.config.agentModels?.[normalizedTo]?.capability || ctx.readAgentMd(normalizedTo)?.capability;
      if (srcCap && dstCap && srcCap !== dstCap) {
        let note = t("capabilityHandoffNote", {
          from: cctx.agent,
          to: normalizedTo,
          fromCap: srcCap,
          toCap: dstCap,
        });
        const dstModels = ctx.config.agentModels?.[normalizedTo]?.models;
        if (!dstModels?.length) {
          note += " " + t("capabilityModelInherit");
        }
        feedback.push({
          level: "info",
          message: note,
        });
      } else if (srcCap && dstCap && srcCap === dstCap) {
        const dstModels = ctx.config.agentModels?.[normalizedTo]?.models;
        if (!dstModels?.length) {
          feedback.push({
            level: "info",
            message: t("capabilitySameInherit", { from: cctx.agent, to: normalizedTo }),
          });
        }
      }
      const errors = feedback.filter((f) => f.level === "error");
      const warnings = feedback.filter((f) => f.level === "warn");
      const infos = feedback.filter((f) => f.level === "info");

      const s = ctx.strictness();

      if (s === "strict" && errors.length > 0) {
        ctx.incrementError(cctx.agent);
        ctx.saveState();
        return {
          output: [
            t("handoffStrictRejected"),
            ...errors.map((e) => e.message),
            ``,
            t("handoffStrictExample", { to: normalizedTo }),
          ].join("\n"),
        };
      }

      const crInput = await ctx.buildRuleInput(
        cctx.agent,
        normalizedTo,
        args.task as string,
        args.context as string,
        (args.files as string[]) || [],
      );
      let ruleDecision: RuleDecision;
      try {
        const classifierParams = ctx.conflictLearner?.getClassifierParams?.();
        ruleDecision = evaluateRules(crInput, ctx.capabilityTracker, classifierParams);
      } catch (err) {
        logger.warn(`evaluateRules failed:`, err);
        ruleDecision = { action: "block", reason: "Evaluation error — failing closed", confidence: 0 };
      }
      if (s === "strict" && ruleDecision.action === "block") {
        ctx.incrementError(cctx.agent);
        ctx.saveState();
        return {
          output: `⛔ **Handoff blocked**\n\n${ruleDecision.reason}\n\n${t("handoffStrictExample", { to: normalizedTo })}`,
        };
      }
      if (s !== "relaxed") {
        const explain = explainDecision(ruleDecision, ruleDecision.metadata?.ruleId as string | undefined);
        if (ruleDecision.action === "block") {
          feedback.push({ level: "warn", message: `⛔ ${explain}` });
        } else if (
          ruleDecision.action === "reroute" &&
          ruleDecision.suggestedAgent &&
          normalizeName(ruleDecision.suggestedAgent) !== normalizedTo
        ) {
          feedback.push({
            level: "info",
            message: `💡 ${explain} — ${ruleDecision.suggestedAgent ? `Try **${ruleDecision.suggestedAgent}** instead` : ""}`,
          });
        } else if (ruleDecision.action === "warn") {
          feedback.push({ level: "warn", message: `⚠️ ${explain}` });
        } else if (ruleDecision.action === "queue") {
          if (ruleDecision.suggestedPriority) {
            const qid = ctx.nextHandoffId();
            ctx.taskPriority.enqueue({
              id: qid,
              handoffId: qid,
              from: cctx.agent,
              to: normalizedTo,
              task: args.task as string,
              priority: ruleDecision.suggestedPriority,
            });
          }
          feedback.push({ level: "info", message: `📋 ${explain}` });
        }
      }

      const validationOutput =
        s !== "relaxed" ? [...errors.map((e) => e.message), ...warnings.map((w) => w.message)].join("\n") + "\n" : "";

      if (errors.length > 0 || warnings.length > 0) {
        ctx.incrementError(cctx.agent);
        ctx.recordValidationError(cctx.agent);
      }

      const escalationKey = normalizeName(cctx.agent);
      const escalation =
        (ctx.agentErrors[escalationKey] ?? 0) >= 3
          ? t("handoffEscalation", { agent: cctx.agent, count: String(ctx.agentErrors[escalationKey] ?? 0) })
          : "";

      let reroutedModel: string | undefined;
      if (escalation) {
        const callerRole = resolveRole(cctx.agent) ?? escalationKey;
        const currentModel = ctx.config.agentModels?.[escalationKey]?.models?.[0]?.model;
        reroutedModel = resolveRerouteModel(callerRole, currentModel);
      }
      const rerouteNotice = reroutedModel ? t("handoffRerouted", { agent: cctx.agent, model: reroutedModel }) : "";

      const infoOutput = infos.length > 0 ? infos.map((i) => i.message).join("\n") + "\n" : "";

      if (ctx.handoffs.size >= ctx.getMaxHandoffs()) {
        return { output: t("handoffMaxReached", { max: String(ctx.getMaxHandoffs()) }) };
      }

      const isHelpRequest = args.helpRequest === true;
      const helpTask = isHelpRequest ? t("helpRequestPrefix", { task: args.task as string }) : (args.task as string);

      const targetAgent = normalizedTo;
      if (targetAgent === "tawa" && normalizeName(cctx.agent) !== "tawa") {
        return { output: t("handoffTawaRedirect", { agent: cctx.agent }) };
      }

      if (
        normalizeName(cctx.agent) !== "tawa" &&
        normalizeName(cctx.agent) !== "analyst" &&
        normalizeName(cctx.agent) !== normalizedTo
      ) {
        const callerRole = resolveRole(cctx.agent) ?? normalizeName(cctx.agent);
        const targetRole = resolveRole(targetAgent) ?? targetAgent;
        if (callerRole === targetRole) {
          return {
            output: t("handoffSameRole", { agent: cctx.agent, role: callerRole }),
          };
        }
      }

      const accumulatedContext = args.context
        ? contextMerged
          ? (args.context as string)
          : buildAccumulatedContext(ctx, args.to as string, args.context as string, asCheckpoint(args.checkpoint))
        : (args.context as string);

      const agentModelMap = ctx.modelManager.agentModelMap;
      const implementer = resolveAgentModelRef(cctx.agent, agentModelMap);
      const reviewer = resolveAgentModelRef(args.to as string, agentModelMap);
      const dispatchTurn = ctx.toolRunLog ? ctx.toolRunLog.currentTurn(cctx.sessionID) : undefined;
      const entry = {
        id: ctx.nextHandoffId(),
        from: normalizeName(cctx.agent),
        to: normalizeName(args.to as string),
        task: helpTask,
        context: accumulatedContext,
        files: (args.files as string[]) || [],
        checkpoint: asCheckpoint(args.checkpoint),
        timestamp: new Date().toISOString(),
        status: "pending",
        decisionRuleId: ruleDecision.metadata?.ruleId as string | undefined,
        decision: ruleDecision,
        implementer,
        reviewer,
        sessionId: cctx.sessionID,
        ...(dispatchTurn !== undefined ? { turn: dispatchTurn } : {}),
        ...(reroutedModel ? { reroutedModel } : {}),
      };

      if (ctx.agentValidator) {
        const vResult = await ctx.agentValidator.validate({
          handoffId: entry.id,
          from: cctx.agent,
          to: args.to as string,
          task: helpTask,
        });
        if (!vResult.approved) {
          ctx.incrementError(cctx.agent);
          ctx.saveState();
          return {
            output: `⛔ **Handoff validation rejected**\n\n${vResult.reason ?? "No reason"}`,
          };
        }
      }

      ctx.handoffs.set(entry.id, entry as HandoffEntry);

      try {
        const pack = await attachPackToHandoff({
          worktree: cctx.worktree || cctx.directory,
          sessionID: cctx.sessionID,
          agent: cctx.agent,
          entry: entry as unknown as import("../services/context-pack/index.ts").PackHandoffEntryLike,
          config: ctx.config,
        });
        if (pack) {
          entry.context = `${entry.context}\n\n## Portable Context Pack ${pack.digest.slice(0, 16)}\n${pack.preview}`;
        }
      } catch (e) {
        logger.warn("[tawassul] context pack creation skipped:", e instanceof Error ? e.message : String(e));
      }

      try {
        if (ctx.queueDrainer?.shouldDrain(args.to as string)) {
          const altAgents = ctx
            .getAgents()
            .filter((a) => a !== cctx.agent && a !== (args.to as string) && normalizeName(a) !== "tawa");
          let altAgent: string | undefined;
          if (ctx.predictiveRouter && altAgents.length > 0) {
            const r = ctx.predictiveRouter.predict({
              taskDescription: (args.task as string) ?? "",
              availableAgents: altAgents,
              excludeAgents: [args.to as string],
            });
            altAgent = [...r.allPredictions].sort(
              (a, b) => (b.successProbability ?? 0) - (a.successProbability ?? 0),
            )[0]?.agent;
          }
          if (altAgent && altAgent !== (args.to as string)) {
            const validator = ctx.agentValidator;
            const approved =
              !validator ||
              (
                await validator.validate({
                  handoffId: entry.id,
                  from: args.to as string,
                  to: altAgent,
                  task: (args.task as string) ?? "",
                })
              ).approved;
            if (approved) {
              await ctx.handoffService?.drainAgent(args.to as string, altAgent);
            } else {
              logger.debug(`[tawassul] queue drain skipped: alternate ${altAgent} failed validation`);
            }
          }
        }
      } catch (e) {
        logger.debug("[tawassul] queue drain skipped:", (e as Error)?.message ?? e);
      }

      const parallelCount = args.parallelCopies as number | undefined;
      if (parallelCount && parallelCount > 0) {
        const agents = ctx
          .getAgents()
          .filter((a) => a !== cctx.agent && a !== (args.to as string) && normalizeName(a) !== "tawa");
        let selectedAgents: string[];
        if (ctx.predictiveRouter && agents.length > 0) {
          const routingRequest = {
            taskDescription: args.task as string,
            availableAgents: agents,
            excludeAgents: [cctx.agent, args.to as string],
          };
          const routingResult = ctx.predictiveRouter.predict(routingRequest);
          ctx.memoryRoutingIntegration?.learnFromRouting(routingResult, routingRequest, true, 0);
          selectedAgents = routingResult.allPredictions
            .slice(0, Math.min(parallelCount - 1, agents.length, 5))
            .map((p) => p.agent);
          if (selectedAgents.length < parallelCount - 1) {
            const remaining = agents.filter((a) => !selectedAgents.includes(a));
            selectedAgents.push(...remaining.slice(0, parallelCount - 1 - selectedAgents.length));
          }
        } else {
          for (let i = agents.length - 1; i > 0; i--) {
            const j = Math.floor(secureRandom() * (i + 1));
            [agents[i], agents[j]] = [agents[j]!, agents[i]!];
          }
          selectedAgents = agents.slice(0, Math.min(parallelCount - 1, agents.length, 5));
        }
        for (const agent of selectedAgents) {
          const copy = {
            id: ctx.nextHandoffId(),
            from: normalizeName(cctx.agent),
            to: normalizeName(agent),
            task: args.task as string,
            context: args.context as string,
            files: (args.files as string[]) || [],
            checkpoint: asCheckpoint(args.checkpoint),
            timestamp: new Date().toISOString(),
            status: "pending",
            parallelId: entry.id,
            sourceRecordId: entry.id,
            implementer,
            reviewer: resolveAgentModelRef(agent, agentModelMap),
            sessionId: cctx.sessionID,
            ...(dispatchTurn !== undefined ? { turn: dispatchTurn } : {}),
          };
          ctx.handoffs.set(copy.id, copy as HandoffEntry);
        }
      }

      ctx.recordHandoffInitiated(
        cctx.agent,
        args.context as string,
        args.task as string,
        !!args.checkpoint,
        Boolean(args.checkpoint && asCheckpoint(args.checkpoint)?.completed.length === 0),
      );
      if (isHelpRequest) {
        ctx.recordHelpRequestSent(cctx.agent);
      }
      ctx.updateLastActive(cctx.agent);
      ctx.saveState();

      if ((args.files as string[])?.length) {
        for (const f of args.files as string[]) {
          ctx.fileLocks.acquireLock(f, cctx.agent, entry.id);
        }
      }
      ctx.gamification.recordAction(cctx.agent, "handoffsInitiated");
      ctx.statsCollector.recordHandoff(cctx.agent, false, 0);
      ctx.sharedMemory.addDecision({
        agent: cctx.agent,
        content: `Handoff ${entry.id}: ${cctx.agent} → ${args.to || ""}: ${args.task || ""}`,
        tags: ["handoff", "create", cctx.agent],
        importance: "medium",
      });
      ctx.sharedMemory.updateAgentContext(cctx.agent, {
        lastActive: new Date().toISOString(),
        currentTask: args.task as string,
        expertise: [ctx.config.agentModels?.[cctx.agent]?.capability || ""].filter(Boolean),
        recentErrors: [],
      });

      const cp = asCheckpoint(args.checkpoint);
      const checkpointOutput = cp
        ? [
            ``,
            t("checkpointTitle", { id: entry.id }),
            t("checkpointCompleted"),
            ...cp.completed.map((c: string) => `  ✅ ${c}`),
            ``,
            t("checkpointRemaining"),
            ...cp.remaining.map((r: string) => `  ⏳ ${r}`),
            ``,
            t("checkpointFilesChanged"),
            ...cp.filesChanged.map((f: string) => `  📁 \`${f}\``),
            cp.decisions.length > 0
              ? [
                  ``,
                  t("checkpointDecisions"),
                  ...cp.decisions.map((d: { title: string; detail: string }) => `  🎯 **${d.title}**: ${d.detail}`),
                ].join("\n")
              : "",
            ``,
            t("rescueContinuation", { to: args.to as string, from: cctx.agent }),
          ]
            .filter(Boolean)
            .join("\n")
        : "";

      const helpOutput = isHelpRequest
        ? [
            ``,
            t("helpRequestTitle"),
            t("helpRequestBody", { agent: cctx.agent }),
            `**${t("helpRequestTask")}** ${args.task}`,
            `**${t("helpRequestDetails")}** ${args.context}`,
            ``,
            t("helpRequestComplete", { id: entry.id }),
          ].join("\n")
        : "";

      return {
        title: `${isHelpRequest ? "🆘" : "🤝"} ${entry.id}: ${cctx.agent} → ${args.to}`,
        output: [
          validationOutput,
          infoOutput,
          isHelpRequest ? `## 🆘 Help Request ${entry.id}` : `## 🤝 Handoff ${entry.id}`,
          `**From:** ${cctx.agent}`,
          `**To:** ${args.to}`,
          `**Task:** ${isHelpRequest ? helpTask : args.task}`,
          `**Context:** ${args.context}`,
          (args.files as string[])?.length ? `**Files:** ${(args.files as string[]).join(", ")}` : "",
          helpOutput,
          checkpointOutput,
          ``,
          `---`,
          isHelpRequest
            ? t("helpRequestPlease", { to: args.to as string, agent: cctx.agent })
            : t("handoffPleaseTake", { to: args.to as string, agent: cctx.agent }),
          escalation,
          rerouteNotice,
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: { handoff: entry, feedback: [...errors, ...warnings, ...infos], helpRequest: isHelpRequest },
      };
    },
  });
}
