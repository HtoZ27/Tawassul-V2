
import type {
  ToolExecuteBeforeContext,
  ToolExecuteAfterContext,
  ToolExecuteServiceClients,
} from "./tool-execute-types.ts";

import { maybeAutoCapture } from "../services/code-state-auto.ts";

import { runTodoReconcile, stashCopilotDigest } from "../services/goal-auto.ts";
import { normalizeName, normalizeToolName } from "../utils/name-utils.ts";
import {
  runPipeline,
  isTawassulTool,
  incrementMemoryLogCounter,
  resetMemoryLogCounter,
  logMemoryUsage,
  getTaskAgents,
} from "./validation-pipeline.ts";
import { PipelineState } from "./PipelineState.ts";
import type { StageOutput } from "./guards/shared/types.ts";
import { logger } from "../utils/logger.ts";
import { t } from "../translations.ts";

import { evaluateGates, generateReport } from "../services/quality-gate-manager.ts";
import type { DedupSignature } from "../context/priority-types.ts";
import { scanToolOutput } from "./guards/threat_patterns.ts";
import { ps } from "./guards/shared.ts";
import { TASK_TOOL_NAMES } from "../security-policy.ts";

import { truncateToolOutput } from "../services/context-compressor.ts";

import { PRIVACY_REDACTED } from "../services/privacy-guard.ts";

import { wrapUntrusted, escapeGoalText } from "../services/prompt-sanitizer.ts";

import { newChainId } from "../services/chain-ctx.ts";
import type { TawassulEvent } from "../services/event-hub.ts";
import {
  recordToolFailure,
  recordToolSuccess,
  recordNoProgress,
  isToolLoopBlocked,
  sweepStaleEntries,
} from "./guards/tool-loop-guard.ts";

import { consume, refund, sweepStaleBudgets } from "../services/iteration-budget.ts";
import { TAWA_AGENT, SecurityPolicy } from "../security-policy.ts";
import { isManagedAgent } from "../utils/agent.ts";

import { start as hbStart, check as hbCheck, stop as hbStop, sweepStaleStates } from "../services/heartbeat-monitor.ts";

import { _taskTimeouts, runTrackedStructuralAnalysis } from "../services/lifecycle-drain.ts";





export {
  drainTaskTimeouts,
  drainStructuralAnalyses,
  runTrackedStructuralAnalysis,
  getPendingAnalysesCount,
  __resetPendingAnalysesForTest,
} from "../services/lifecycle-drain.ts";

const TASK_TIMEOUT_MS = 420_000;




const _callStartTimes = new Map<string, number>();
function callStartKey(sessionID: string, callID?: string): string {
  return `${sessionID}:${callID ?? "?"}`;
}


function resolveServiceClients(clients?: ToolExecuteServiceClients): ToolExecuteServiceClients {
  if (clients) return clients;
  return {
    wrapUntrusted,
    escapeGoalText,
    truncateToolOutput: truncateToolOutput,
    evaluateGates,
    generateReport,
    newChainId,
    maybeAutoCapture,
    reconcileTodos: runTodoReconcile,
    stashCopilotDigest,
  };
}


export class ToolBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolBlockedError";
  }
}



const REALTIME_CONSOLE_TOOLS = new Set(["bash", "lint", "lint-fix"]);

export function blockTool(message: string): never {
  throw new ToolBlockedError(message);
}


function canonicalStringify(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, replacer);
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    const sorted: Record<string, unknown> = {};
    for (const k of [...value.keys()].sort()) {
      sorted[String(k)] = value.get(k);
    }
    return { __type: "Map", entries: sorted };
  }
  if (value instanceof Set) {
    return { __type: "Set", values: [...value].sort() };
  }
  if (value instanceof Date) {
    return { __type: "Date", iso: value.toISOString() };
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}





function releaseCallLocks(sessionId: string | undefined, agents: Set<string>, pState: PipelineState): void {
  if (!sessionId) return;
  
  
  for (const agent of agents) pState.releaseAgentLock(sessionId, agent);
}

export function createToolExecuteBeforeHook(ctx: ToolExecuteBeforeContext) {
  const svc = resolveServiceClients(ctx.serviceClients);
  return async (
    input: { tool: string; agent?: string; sessionID: string; callID?: string },
    output: { args: Record<string, unknown>; error?: string },
  ) => {
    try {
      input.tool = normalizeToolName(input.tool);
      const normalizedAgent = input.agent ? normalizeName(input.agent) : undefined;

      if (isTawassulTool(input.tool)) {
        logger.debug(`Tool called: ${input.tool} by ${normalizedAgent ?? "undefined"}`);
      }

      
      
      
      if (normalizedAgent && !isManagedAgent(normalizedAgent)) return;

      
      const toolDedup = ctx.toolDeduplicator;
      if (toolDedup && normalizedAgent && input.sessionID) {
        
        
        
        const argsJson = canonicalStringify(output.args ?? {});
        const sig: DedupSignature = {
          tool: input.tool,
          agent: normalizedAgent,
          sessionId: input.sessionID,
          callDepth: 0,
          argsHash: argsJson,
          timestamp: Date.now(),
        };
        const dedupResult = toolDedup.check(sig);
        if (dedupResult.isDuplicate && dedupResult.strategy === "skip") {
          blockTool(dedupResult.reason);
        }
        if (dedupResult.isDuplicate && dedupResult.strategy === "merge") {
          logger.debug(`Tool dedup: ${dedupResult.reason}`);
        }

        
        
        const trl = ctx.toolRunLog;
        if (trl && normalizedAgent && input.sessionID) {
          const crossDup = trl.findCrossSessionDuplicate(input.tool, argsJson, Date.now());
          if (crossDup) {
            blockTool(`Cross-session duplicate of ${input.tool} (prior run ${crossDup.id})`);
          }
        }
      }

      
      if (normalizedAgent && input.tool) {
        const blockReason = isToolLoopBlocked(normalizedAgent, input.tool);
        if (blockReason) {
          blockTool(blockReason);
        }
      }

      
      let pipelineOk: boolean;
      try {
        pipelineOk = await runPipeline(ctx, input, output);
      } catch (err) {
        
        
        
        
        releaseCallLocks(input.sessionID, getTaskAgents(output).agents, ps(ctx));
        throw err;
      }
      if (!pipelineOk) {
        releaseCallLocks(input.sessionID, getTaskAgents(output).agents, ps(ctx)); 
        blockTool(output.error ?? "🚫 Blocked by tawassul validation pipeline"); 
      }

      
      
      
      if (REALTIME_CONSOLE_TOOLS.has(input.tool)) {
        const a = output.args ?? {};
        const preview = input.tool === "bash" ? String(a.command ?? "") : JSON.stringify(a.paths ?? a);
        const cmd = preview.length > 300 ? `${preview.slice(0, 300)}…` : preview;
        logger.info(`▶ [${input.tool}] ${normalizedAgent ?? "?"}: ${cmd}`);
      }

      
      
      if (input.tool === "bash" && output.args && typeof output.args.env === "object" && output.args.env !== null) {
        output.args.env = SecurityPolicy.filterEnvKeys(
          output.args.env as Record<string, string | undefined>,
        ) as unknown;
      }

      
      if (normalizedAgent) {
        const agentKey = normalizeName(normalizedAgent);
        try {
          if (!consume(agentKey, input.sessionID)) {
            blockTool(t("budgetExhausted", { agent: normalizedAgent }));
          }
        } catch (consumeErr) {
          logger.warn("[tawassul] consume iteration budget error:", consumeErr);
          blockTool(t("budgetCheckFailed"));
        }

        try {
          hbStart(agentKey, input.tool);
        } catch (hbErr) {
          logger.warn("[tawassul] heartbeat start error, refunding budget:", hbErr);
          try {
            refund(agentKey, input.sessionID);
          } catch {

          }
          blockTool(t("heartbeatCheckFailed"));
        }
      }

      
      if (input.tool === "task" && input.sessionID) {
        const key = `${input.sessionID}:${normalizeName(normalizedAgent ?? "unknown")}`;
        if (_taskTimeouts.has(key)) clearTimeout(_taskTimeouts.get(key));
        const taskTimer = setTimeout(() => {
          logger.warn(`[tawassul] P0.7: task timeout for ${normalizedAgent ?? "unknown"} (session ${input.sessionID})`);
          _taskTimeouts.delete(key);
        }, TASK_TIMEOUT_MS);
        taskTimer.unref?.();
        _taskTimeouts.set(key, taskTimer);
      }

      
      if (input.sessionID) {
        let targetAgents: Set<string> | null = null;
        if (input.tool === "task") {
          targetAgents = getTaskAgents(output).agents;
        } else if (input.tool === "handoff" || input.tool === "fasttrack") {
          const to = output.args?.to;
          if (typeof to === "string" && to.trim()) {
            targetAgents = new Set([normalizeName(to)]);
          }
        }
        const p = ps(ctx);
        if (!p.dispatchChain.has(input.sessionID)) p.dispatchChain.set(input.sessionID, []);
        const chain = p.dispatchChain.get(input.sessionID)!;
        
        
        const callerNorm = normalizeName(normalizedAgent) || null;
        if (callerNorm && callerNorm !== TAWA_AGENT && chain[chain.length - 1] !== callerNorm) {
          chain.push(callerNorm);
        }
        if (targetAgents && targetAgents.size > 0) {
          for (const agent of targetAgents) {
            if (agent === TAWA_AGENT || chain[chain.length - 1] === agent) continue;
            chain.push(agent);
          }
        }
        
        
        if (input.tool === "task" && targetAgents && targetAgents.size > 0) {
          try {
            const taskId = input.sessionID;
            for (const target of targetAgents) {
              ctx.emitWithChain?.("TASK_STARTED", { agent: target, taskId });
            }
          } catch (e) {
            logger.debug("[tawassul] TASK_STARTED emit skipped:", (e as Error)?.message ?? e);
          }
        }
        
        const MAX_CHAIN_LENGTH = 50;
        if (chain.length > MAX_CHAIN_LENGTH) {
          chain.splice(0, chain.length - MAX_CHAIN_LENGTH);
        }

      }

      
      const isParallel =
        input.tool === "task" &&
        ((Array.isArray(output.args?.desc) && output.args.desc.length > 1) ||
          (Array.isArray(output.args?.subagent) && output.args.subagent.length > 1));
      const prompt = output.args?.prompt;
      if (
        ctx.chainActive &&
        input.tool === "task" &&
        !isParallel &&
        typeof prompt === "string" &&
        prompt.includes("{prev}") &&
        ctx.lastChainResult
      ) {
        output.args.prompt = prompt.replace(/\{prev\}/g, svc.wrapUntrusted(ctx.lastChainResult));
      }

      
      if (ctx.chainActive && input.tool === "task" && !ctx.chainCtx) {
        ctx.chainCtx = {
          chainId: ctx.sessionId ? `chain-${ctx.sessionId}` : svc.newChainId(),
          hop: 0,
          sessionId: ctx.sessionId,
          taskId: input.sessionID ?? input.callID ?? "task",
          origin: normalizedAgent ? "agent" : "system",
        };
      } else if (ctx.chainActive && input.tool === "task" && ctx.chainCtx) {
        ctx.chainCtx = { ...ctx.chainCtx, hop: ctx.chainCtx.hop + 1 };
      }

      
      
      if (input.callID) {
        _callStartTimes.set(callStartKey(input.sessionID, input.callID), Date.now());
      }
    } catch (e) {
      logger.warn("[tawassul] tool.execute.before error:", e);
      throw e;
    }
  };
}


function recordPipelineState(
  ctx: ToolExecuteAfterContext,
  input: { tool: string; agent?: string; sessionID: string; callID?: string; args: Record<string, unknown> },
  success: boolean,
): void {
  if (!ctx.pipelineManager || input.tool !== "task") return;
  try {
    const normalizedAgent = input.agent ? normalizeName(input.agent) : undefined;
    const rawResult = ctx.pipelineManager.recordToolResult(input.tool, success);
    const transitionResult =
      rawResult !== null && rawResult !== undefined && typeof rawResult === "object" && "allowed" in rawResult
        ? (rawResult as { allowed: boolean; reason: string })
        : null;
    if (!transitionResult) return;

    logger.debug(`Pipeline transition: ${transitionResult.reason}`);
    if (!transitionResult.allowed || !success) return;

    const featureId = ctx.pipelineManager.getFeatureId();
    if (!featureId || !normalizedAgent) return;

    const states = ctx.pipelineManager.getStates();
    const changedFiles: string[] = [];
    for (const [, state] of Object.entries(states)) {
      if (state && typeof state === "object" && "filesChanged" in state) {
        const files = state.filesChanged;
        if (Array.isArray(files)) {
          changedFiles.push(...files.filter((f): f is string => typeof f === "string"));
        }
      }
    }

    const fixRecord = ctx.regressionGuard.registerFixWithRegression(
      {
        featureId,
        algId: `task-${input.tool}`,
        description: transitionResult.reason,
        files: changedFiles,
      },
      ctx.featureIndex,
    );
    logger.debug(`Fix registered: ${fixRecord.id} for feature ${featureId}`);

    const asyncQueue = ctx.asyncStageQueue;
    if (changedFiles.length > 0) {
      if (asyncQueue) {
        asyncQueue.enqueue(async () => {
          runTrackedStructuralAnalysis(ctx, featureId, changedFiles, fixRecord);
        }, 0);
      } else {
        runTrackedStructuralAnalysis(ctx, featureId, changedFiles, fixRecord);
      }
    }

    const runQualityGates = () => {
      try {
        const svc = resolveServiceClients(ctx.serviceClients);
        const gateCtx = {
          featureId,
          featureIndex: ctx.featureIndex,
          handoffs: [...ctx.handoffsRef()],
        };
        const gates = svc.evaluateGates(gateCtx);
        const report = svc.generateReport(gates, featureId);
        if (!report.allPassed) {
          const failed = gates.filter((g) => !g.passed);
          logger.debug(`Quality gates: ${failed.length} failed — ${failed.map((g) => g.label).join(", ")}`);
        }
      } catch (e) {
        logger.warn("[tawassul] quality gate evaluation error:", e);
      }
    };

    if (asyncQueue) {
      asyncQueue.enqueue(async () => {
        runQualityGates();
      }, 1);
    } else {
      runQualityGates();
    }
  } catch (e) {
    logger.warn("[tawassul] pipelineManager.recordToolResult error:", e);
  }
}





export function createToolExecuteAfterHook(ctx: ToolExecuteAfterContext) {
  const svc = resolveServiceClients(ctx.serviceClients);
  return async (
    input: { tool: string; agent?: string; sessionID: string; callID?: string; args: Record<string, unknown> },
    output: { title: string; output: string; metadata: Record<string, unknown> },
  ) => {
    try {
      input.tool = normalizeToolName(input.tool);
      const normalizedAgent = input.agent ? normalizeName(input.agent) : undefined;

      
      
      const startedAt = input.callID ? _callStartTimes.get(callStartKey(input.sessionID, input.callID)) : undefined;
      if (input.callID) _callStartTimes.delete(callStartKey(input.sessionID, input.callID));

      
      if (isTawassulTool(input.tool) && normalizedAgent !== undefined) {
        try {
          const fullModel = ctx.getAgentModel(normalizedAgent) || "default/default";
          const [provider, model] = fullModel.includes("/")
            ? [fullModel.split("/")[0] ?? "default", fullModel.split("/")[1] ?? fullModel]
            : ["default", fullModel];
          ctx.rateLimiter?.releaseConcurrent(normalizedAgent, provider, model);
        } catch (releaseErr) {
          logger.warn("[tawassul] Forced concurrent release error:", releaseErr);
        }
      }

      
      
      
      
      if (input.sessionID && input.tool === "task") {
        const pAfter = ps(ctx);
        const targets = input.args ? getTaskAgents({ args: input.args } as StageOutput).agents : null;
        if (targets) {
          releaseCallLocks(input.sessionID, targets, pAfter);
        } else {
          releaseCallLocks(input.sessionID, pAfter.pendingAgentLocks.get(input.sessionID) ?? new Set<string>(), pAfter);
        }
      }

      
      if (input.tool === "task" && input.sessionID) {
        const p = ps(ctx);
        const currentDepth = p.callDepth.get(input.sessionID);
        if (currentDepth !== undefined) {
          const newDepth = currentDepth - 1;
          if (newDepth <= 0) {
            p.callDepth.delete(input.sessionID);

          } else {
            p.callDepth.set(input.sessionID, newDepth);
          }
        }
      }

      
      

      
      
      
      const declaredStatus = output.metadata?.status;
      const success =
        declaredStatus === "error"
          ? false
          : declaredStatus === "completed"
            ? true
            : !!(output.title || output.output || (output as Record<string, unknown>).result);

      
      
      
      
      if (REALTIME_CONSOLE_TOOLS.has(input.tool)) {
        
        
        const dur = startedAt !== undefined ? ` (${Date.now() - startedAt}ms)` : "";
        const status = success === false ? " FAILED" : "";
        logger.info(`◀ [${input.tool}] ${normalizedAgent ?? "?"} done${status}${dur}`);
      } else {
        const out = typeof output.output === "string" ? output.output : "";
        const preview = out.length > 300 ? `${out.slice(0, 300)}…` : out;
        const dur = startedAt !== undefined ? ` (${Date.now() - startedAt}ms)` : "";
        const status = success === false ? " FAILED" : "";
        logger.info(`◀ [${input.tool}] ${normalizedAgent ?? "?"} done${status}${dur}: ${preview}`);
      }

      
      
      
      if (normalizedAgent) {
        if (success) {
          recordToolSuccess(normalizedAgent, input.tool);
        } else {
          recordToolFailure(normalizedAgent, input.tool);
          refund(normalizedAgent, input.sessionID);
          recordNoProgress(normalizedAgent);
        }
        const hbResult = hbCheck(normalizedAgent, input.tool);
        if (hbResult.stale) {
          hbStop(normalizedAgent);
          if (ctx.circuitBreaker) {
            ctx.circuitBreaker.recordFailure(normalizedAgent);
          }
        }
      }

      
      
      
      if (ctx.toolRunLog && normalizedAgent && input.sessionID) {
        ctx.toolRunLog.record({
          tool: input.tool,
          agent: normalizedAgent,
          sessionId: input.sessionID,
          argsHash: canonicalStringify(input.args ?? {}),
          status: success ? "success" : "error",
          input: input.args,
          error: success ? undefined : (output.output ?? output.title ?? "unknown"),
        });
      }

      
      
      
      
      if (input.tool === "todowrite" && success && ctx.goalStore && svc.reconcileTodos) {
        try {
          const rawTodos = (input.args ?? {}).todos;
          const todos: Array<{ title: string; status: string }> = [];
          if (Array.isArray(rawTodos)) {
            for (const t of rawTodos) {
              const rec = (t ?? {}) as Record<string, unknown>;
              const title = String(rec.content ?? rec.title ?? rec.text ?? "").trim();
              if (title) todos.push({ title, status: String(rec.status ?? "pending") });
            }
          }
          if (todos.length > 0) {
            const owner = normalizedAgent ?? "main";
            const reconciled = await svc.reconcileTodos({
              store: ctx.goalStore,
              sessionId: input.sessionID,
              owner,
              todos,
            });
            if (reconciled.ok && reconciled.digest) {
              svc.stashCopilotDigest?.(input.sessionID, reconciled.digest);
            }
          }
        } catch (e) {
          logger.debug("[tawassul] todowrite reconcile skipped:", (e as Error)?.message ?? e);
        }
      }

      
      
      
      if (ctx.contextCompressionEscalation && normalizedAgent) {
        ctx.contextCompressionEscalation.observe(output.output ?? "");
        ctx.contextCompressionEscalation.evaluate();
      }

      
      if (input.tool === "task" && input.sessionID) {
        const key = `${input.sessionID}:${normalizeName(normalizedAgent ?? "unknown")}`;
        const t = _taskTimeouts.get(key);
        if (t) {
          clearTimeout(t);
          _taskTimeouts.delete(key);
        }
      }

      
      
      
      
      
      if (input.tool === "task" && success && input.sessionID) {
        try {
          const taskTargets = input.args ? getTaskAgents({ args: input.args } as StageOutput).agents : null;
          if (taskTargets && taskTargets.size > 0) {
            const taskId = input.sessionID;
            const targetedAnalyst = [...taskTargets].some((t) => t.startsWith("analyst"));
            if (targetedAnalyst && ctx.featureIndex) {
              
              
              
              const sessionHasEvalReport = ctx.featureIndex
                .getAll()
                .some((f) =>
                  ctx.featureIndex.getEvaluationReports(f.id).some((r) => r.metadata?.sessionId === ctx.sessionId),
                );
              if (!sessionHasEvalReport) {
                output.output = `${output.output ?? ""}\n\n${t("teAnalystNotice")}`;
              }
            }
            for (const target of taskTargets) {
              ctx.emitWithChain?.("TASK_COMPLETED", {
                agent: target,
                taskId,
                ...(startedAt !== undefined ? { durationMs: Math.max(0, Date.now() - startedAt) } : {}),
              });
            }
          }
        } catch (e) {
          logger.debug("[tawassul] TASK_COMPLETED emit skipped:", (e as Error)?.message ?? e);
        }
      }

      recordPipelineState(ctx, input, success);

      
      const outputText = output.output || output.title || ((output as Record<string, unknown>).result as string) || "";
      
      
      
      
      const SCAN_CAP = 50_000;
      const scanText = outputText.length > SCAN_CAP ? outputText.slice(0, SCAN_CAP) : outputText;
      let quarantineApplied = false;
      if (scanText) {
        const outputThreats = scanToolOutput(scanText);
        if (outputThreats.length > 0) {
          
          
          
          
          
          const QUARANTINE_PATTERNS = new Set(["prev_agent_output_envelope", "hidden_unicode_chars"]);
          const quarantineThreats = outputThreats.filter(
            (t) => QUARANTINE_PATTERNS.has(t.pattern) && t.severity === "critical",
          );
          const warnings = outputThreats.filter(
            (t) => !QUARANTINE_PATTERNS.has(t.pattern) || t.severity !== "critical",
          );
          if (warnings.length > 0) {
            logger.warn(
              `[tawassul] Tool output scan: ${warnings.length} warning(s) in ${input.tool} output: ${warnings.map((t) => t.pattern).join(", ")}`,
            );
          }
          if (quarantineThreats.length > 0) {
            
            logger.warn(
              `[tawassul] 🛑 TOOL_OUTPUT_QUARANTINED: ${quarantineThreats.length} critical threat(s) in ${input.tool} output: ${quarantineThreats.map((t) => t.pattern).join(", ")}`,
            );
            output.output = `[QUARANTINED] Tool output blocked — ${quarantineThreats.length} critical threat(s): ${quarantineThreats
              .map((t) => t.pattern)
              .join(", ")}. Review the tool and rerun safely.`;
            quarantineApplied = true;
            const emitEvt =
              ctx.emitWithChain ??
              ((type: string, payload: Record<string, unknown>) => {
                ctx.eventHub?.emit({ type, ...payload } as TawassulEvent);
              });
            emitEvt("TOOL_OUTPUT_QUARANTINED", {
              tool: input.tool,
              agent: normalizedAgent ?? "unknown",
              patterns: quarantineThreats.map((t) => t.pattern),
              
              
              
              snippet: svc.escapeGoalText(outputText.slice(0, 200)),
            });
          }
        }
      }

      
      
      
      let deliveredText = outputText;
      if (ctx.privacyGuard && scanText && !quarantineApplied) {
        const pr = ctx.privacyGuard.redact(outputText);
        if (pr.isPrivate) {
          deliveredText = pr.redacted;
          const emitEvt =
            ctx.emitWithChain ??
            ((type: string, payload: Record<string, unknown>) => {
              ctx.eventHub?.emit({ type, ...payload } as TawassulEvent);
            });
          emitEvt(PRIVACY_REDACTED, {
            tool: input.tool,
            agent: normalizedAgent ?? "unknown",
            hits: pr.hits,
            snippet: svc.escapeGoalText(outputText.slice(0, 200)),
          });
        }
      }

      
      if (!quarantineApplied && outputText && !TASK_TOOL_NAMES.includes(input.tool)) {
        output.output = svc.truncateToolOutput(deliveredText);
      }

      if (!isTawassulTool(input.tool)) return;

      
      const counter = incrementMemoryLogCounter();
      if (counter >= 100) {
        resetMemoryLogCounter();
        logMemoryUsage(ctx.sessionId);
        
        const pSweep = ctx.pipelineState;
        pSweep?.sweepStaleSessions(ctx.sessionId); 
        sweepStaleEntries();
        sweepStaleBudgets();
        sweepStaleStates();
      }

      
      if (counter % 50 === 0 && ctx.conflictLearner) {
        const adjustments = ctx.conflictLearner.checkAllRules();
        if (adjustments.length > 0) logger.warn(`[tawassul] Rule adjustments recommended:`, adjustments);
      }

      
      if (ctx.chainActive && ctx.chainStepsRemaining > 0 && input.tool === "task" && normalizedAgent && success) {
        const res = (output as Record<string, unknown>).result;
        const resObj = res && typeof res === "object" ? (res as Record<string, unknown>) : undefined;
        ctx.lastChainResult = String(resObj?.output ?? resObj?.title ?? output.output ?? output.title ?? "");
        ctx.chainStepsRemaining--;
        
        const emitEvt =
          ctx.emitWithChain ??
          ((type: string, payload: Record<string, unknown>) => {
            ctx.eventHub?.emit({ type, ...payload } as TawassulEvent);
          });
        emitEvt("EXECUTION_FINISHED", {
          taskId: input.sessionID ?? input.callID ?? "task",
          status: "success",
        });


      }

      
      if (normalizedAgent) {
        ctx.recordToolCall(normalizedAgent, input.tool, success);
        ctx.conflictLearner?.recordOutcome(
          input.tool,
          { action: success ? "allow" : "block", reason: "Tool execution", confidence: 1 },
          success,
          normalizedAgent,
        );
      }

      if (!success && normalizedAgent) {
        ctx.incrementError(normalizedAgent);
        const emitEvt =
          ctx.emitWithChain ??
          ((type: string, payload: Record<string, unknown>) => {
            ctx.eventHub?.emit({ type, ...payload } as TawassulEvent);
          });
        emitEvt("AGENT_FAILED", { agent: normalizedAgent, reason: `Tool ${input.tool} failed` });
        try {
          
          const ctxAny = ctx as unknown as { handoffs?: Map<string, unknown> | unknown[] };
          const handoffsRaw = ctxAny.handoffs;
          const handoffsArr = handoffsRaw instanceof Map ? [...handoffsRaw.values()] : (handoffsRaw as unknown[]);
          const handoffTask = (handoffsArr as { to: string; task: string }[])
            .slice()
            .reverse()
            .find((h) => normalizeName(h.to) === normalizedAgent)?.task;
          const taskSignal = handoffTask ?? (input as unknown as { task?: string }).task ?? input.tool;
          ctx.predictiveRouter?.recordOutcome(normalizedAgent, taskSignal, false);
        } catch (e) {
          logger.debug("[tawassul] predictiveRouter.recordOutcome skipped:", (e as Error)?.message ?? e);
        }
        try {
          ctx.gamification?.recordAction(normalizedAgent, "toolFailure");
        } catch (e) {
          logger.debug("[tawassul] gamification.recordAction skipped:", (e as Error)?.message ?? e);
        }
        logger.warn(`[tawassul] Tool ${input.tool} failed for ${normalizedAgent ?? "unknown"}`);
      } else if (success && normalizedAgent) {
        const emitEvt =
          ctx.emitWithChain ??
          ((type: string, payload: Record<string, unknown>) => {
            ctx.eventHub?.emit({ type, ...payload } as TawassulEvent);
          });
        emitEvt("AGENT_SUCCESS", {
          agent: normalizedAgent,
          
          
          
          outputLength: outputText.length,
          ...(startedAt !== undefined ? { durationMs: Math.max(0, Date.now() - startedAt) } : {}),
        });
        try {
          
          const ctxAny2 = ctx as unknown as { handoffs?: Map<string, unknown> | unknown[] };
          const handoffsRaw2 = ctxAny2.handoffs;
          const handoffsArr2 = handoffsRaw2 instanceof Map ? [...handoffsRaw2.values()] : (handoffsRaw2 as unknown[]);
          const handoffTask2 = (handoffsArr2 as { to: string; task: string }[])
            .slice()
            .reverse()
            .find((h) => normalizeName(h.to) === normalizedAgent)?.task;
          const taskSignal2 = handoffTask2 ?? (input as unknown as { task?: string }).task ?? input.tool;
          ctx.predictiveRouter?.recordOutcome(normalizedAgent, taskSignal2, true);
        } catch (e) {
          logger.debug("[tawassul] predictiveRouter.recordOutcome skipped:", (e as Error)?.message ?? e);
        }
        try {
          ctx.gamification?.recordAction(normalizedAgent, "toolSuccess");
        } catch (e) {
          logger.debug("[tawassul] gamification.recordAction skipped:", (e as Error)?.message ?? e);
        }
      }

      
      
      if (ctx.chainActive && ctx.chainStepsRemaining <= 0 && input.tool === "task" && ctx.chainCtx) {
        ctx.chainActive = false;
        ctx.lastChainResult = "";
        ctx.chainCtx = undefined;
      }

      
      try {
        await svc.maybeAutoCapture(input.tool, success);
      } catch (e) {
        logger.debug("[tawassul] maybeAutoCapture skipped:", (e as Error)?.message ?? e);
      }
    } catch (e) {
      logger.warn("[tawassul] tool.execute.after error:", e);
    }
  };
}
