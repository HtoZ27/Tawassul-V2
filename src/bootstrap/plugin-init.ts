

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { TAWASSUL_TOOL_NAMES, STATELESS_TOOLS } from "../tool-names.ts";
import { mark, measure, report, reset as perfReset } from "../utils/perf.ts";
import type { TawassulHooks as Hooks, PluginInput, Config, InitReadyProbe } from "../plugin-types.ts";
import { INIT_READY } from "../plugin-types.ts";
import type { ToolDefinition, ToolContext } from "../tool.ts";
import { setLanguage, t } from "../translations.ts";
import { applyIterationBudgets } from "../services/iteration-budget.ts";
import { TawassulContext } from "../context.ts";
import { createServices } from "./service-factory.ts";
import { createHooks } from "./hooks-registration.ts";
import { buildToolJsonSchema } from "../lib/tool-schema-injection.ts";
import { initAutoSweep, stopAutoSweep, resetAllState } from "../hooks/validation-pipeline.ts";
import { resetModelCache } from "../hooks/guards/shared.ts";
import { buildToolRegistry } from "./tool-registry.ts";
import { logger } from "../utils/logger.ts";
import { isHomeProject, forceQuietMode, clearQuietModeForce, quietModeForceReason } from "../utils/quiet.ts";
import { lruSet } from "../utils/bounded-map.ts";
import { runWithContext } from "../context/context-store.ts";
import { AskChannel, type AskChannelDeps } from "../services/ask-channel.ts";
import { formatAskPrompt, ASK_MARKER, type AskKind } from "../services/ask-channel-parse.ts";
import { readAskRenderEnv, resolveAskRenderer } from "../services/ask-render.ts";
import { defaultAgentModelForRole, DYNAMIC_MODEL_SENTINEL, sweepRetiredModelPins } from "../services/proxy-fallback-chains.ts";
import { resolveRole } from "../utils/agent.ts";
import {
  acquireOpencodeConfigLock,
  ensureGlobalRosterSeed,
  ensureMinimalProjectContract,
  repairProjectConfigBoot,
  sleepBootJitter,
} from "../utils/opencode-config.ts";
import { releaseFSLock } from "../infra/file-lock.ts";
import { createHandoffEntry } from "../services/handoff-entry.ts";
import { requiresConsent } from "../hooks/guards/shared/limits.ts";
import { detectInstallScope, claimCoexistence, isCoexistenceOwner, releaseCoexistence } from "../core/install-scope.ts";
import { warnIfUnisolatedDb } from "./db-isolation.ts";
import { getAutoGrantableTools } from "../utils/permission-rules.ts";
import { matchesPatterns } from "../utils/text-utils.ts";
import { BLOCKED_TOOLS } from "../security-policy.ts";




export const CONSENT_BLOCKING_TIMEOUT_MS = 25_000;













async function passiveSelfCheck(projectDir: string, pluginDir: string): Promise<void> {
  try {
    const checks: string[] = [];
    const distJs = resolve(pluginDir, "dist/index.js");
    const altDistJs = resolve(projectDir, "dist/index.js");
    if (!existsSync(distJs) && !existsSync(altDistJs)) checks.push("dist/index.js missing — run: bun build-v2.mjs or bun --cwd .opencode/plugins/tawassul build.mjs");
    
    const nm = resolve(projectDir, ".opencode/node_modules");
    if (!existsSync(nm)) checks.push(".opencode/node_modules missing — opencode will run bun install on next start");

    if (checks.length === 0) return; 
    logger.warn(`[tawassul] self-check: ${checks.join(" | ")}`);
  } catch (e) {
    logger.debug("[tawassul] passiveSelfCheck skipped:", (e as Error)?.message ?? e);
  }
}






export function applyDynamicAgentModelFix(cfg: Config): Config {
  const agents = cfg.agent;
  if (!agents || typeof agents !== "object") return cfg;
  for (const [name, agentCfg] of Object.entries(agents)) {
    if (!agentCfg || typeof agentCfg !== "object") continue;
    if (agentCfg.model !== DYNAMIC_MODEL_SENTINEL) continue;
    const role = resolveRole(name) ?? name;
    const concrete = defaultAgentModelForRole(role) ?? cfg.model;
    if (typeof concrete === "string" && concrete.trim()) {
      agentCfg.model = concrete;
    }
  }
  return cfg;
}


export function ensureTawaToolPermissions(cfg: Config): void {
  const tawa = (cfg.agent as Record<string, unknown> | undefined)?.tawa as Record<string, unknown> | undefined;
  if (!tawa || typeof tawa !== "object") return;
  const perm = tawa.permission as Record<string, unknown> | undefined;
  if (!perm || typeof perm !== "object") return;
  
  const tawaInnovations = (tawa as Record<string, unknown>).innovations as Record<string, unknown> | undefined;
  const autoGrantMode = (tawaInnovations?.autoGrantMode as "all" | "safe-only" | "none") ?? "all";
  const granted = getAutoGrantableTools(perm, autoGrantMode);
  for (const name of granted) {
    perm[name] = "allow";
  }
  for (const b of BLOCKED_TOOLS) {
    perm[b] = "deny";
  }
}


export function ensureAddAgentToolPermissions(cfg: Config): void {
  const addagent = (cfg.agent as Record<string, unknown> | undefined)?.addagent as Record<string, unknown> | undefined;
  if (!addagent || typeof addagent !== "object") return;
  const perm = addagent.permission as Record<string, unknown> | undefined;
  if (!perm || typeof perm !== "object") return;
  perm.addagent = "allow";
  perm.kick = "allow";
}

function initAudit(ctx: TawassulContext): void {
  const checks: string[] = [];
  const warnings: string[] = [];
  if (ctx.eventHub) checks.push("EventHub");
  else warnings.push("EventHub missing");
  if (ctx.pipelineManager) checks.push("PipelineManager");
  else warnings.push("PipelineManager missing");
  if (ctx.rateLimiter) checks.push("RateLimiter");
  else warnings.push("RateLimiter missing");
  try {
    if (ctx.agentAvailability?.circuitBreaker) checks.push("CircuitBreaker");
    else warnings.push("CircuitBreaker missing");
  } catch {
    warnings.push("CircuitBreaker missing");
  }
  if (ctx.stateManager) checks.push("StateManager");
  else warnings.push("StateManager missing");
  const health = warnings.length === 0 ? "healthy" : `degraded (${warnings.length} issues)`;
  logger.audit("INIT_AUDIT", {
    timestamp: new Date().toISOString(),
    services: checks,
    warnings,
    health,
  });
  if (warnings.length > 0) {
    logger.warn(`initAudit: ${warnings.join(", ")}`);
  }
}


type TranscriptPromptInput = {
  path: { id: string };
  body: { parts: Array<{ type: "text"; text: string }>; noReply?: boolean };
  query?: { directory?: string };
};

type TranscriptClient = {
  session?: {
    prompt?: (o: TranscriptPromptInput) => Promise<unknown>;
    promptAsync?: (o: TranscriptPromptInput) => Promise<unknown>;
  };
};


export function matchesRateLimit(message: string, patterns?: readonly string[]): boolean {
  return matchesPatterns(message, patterns);
}




export const MAX_RETRYING_SESSIONS = 200;
export const retryingSessions = new Map<string, number>();
function rememberRetryingSession(sessionId: string, attempt: number): void {
  lruSet(retryingSessions, sessionId, attempt, { moveToFront: true, cap: MAX_RETRYING_SESSIONS });
}
export function getRetryDelayMs(attempt: number, baseMs = 1000): number {
  
  
  
  
  
  const nominal = Math.min(30_000, baseMs * Math.pow(2, Math.max(0, attempt)));
  return Math.max(50, Math.round(nominal * (0.5 + Math.random() * 0.5)));
}
export function clearRateLimitRetry(sessionId: string): void {
  retryingSessions.delete(sessionId);
}
async function handleRateLimitError(
  ctx: PluginInput,
  tawaCtx: TawassulContext,
  sessionId: string,
  errorMessage: string,
): Promise<boolean> {
  if (!matchesRateLimit(errorMessage)) return false;
  
  const rlCfg = tawaCtx.configManager.config.rateLimits ?? {};
  const apiRetryMax = rlCfg.apiRetryMax ?? 5;
  const apiRetryBaseMs = rlCfg.apiRetryBaseMs ?? 1000;
  const attempt = retryingSessions.get(sessionId) ?? 0;
  if (attempt >= apiRetryMax) {
    retryingSessions.delete(sessionId);
    logger.warn(`[tawassul] rate-limit retry exhausted for session ${sessionId}`);
    const exhaustedTui = (ctx.client as { tui?: { showToast?: (m: { message: string; variant?: string }) => void } } | undefined)
      ?.tui;
    try {
      exhaustedTui?.showToast?.({
        message: t("rateLimitRetryExhausted", { attempts: String(apiRetryMax) }),
        variant: "error",
      });
    } catch (err) {
      logger.debug("[tawassul] rate-limit exhaustion toast failed:", err);
    }
    return false;
  }
  const delayMs = getRetryDelayMs(attempt, apiRetryBaseMs);
  rememberRetryingSession(sessionId, attempt + 1);
  const tui = (ctx.client as { tui?: { showToast?: (m: { message: string; variant?: string }) => void } } | undefined)
    ?.tui;
  try {
    tui?.showToast?.({
      message: t("rateLimitRetrying", { attempt: String(attempt + 1), delay: String(delayMs / 1000) }),
      variant: "warning",
    });
  } catch (err) {
    logger.debug("[tawassul] rate-limit retry toast failed:", err);
  }
  logger.warn(
    `[tawassul] rate-limit detected (attempt ${attempt + 1}/${apiRetryMax}) — retrying session ${sessionId} in ${delayMs}ms`,
  );
  const client = ctx.client as TranscriptClient | undefined;
  const promptAsync = client?.session?.promptAsync ?? client?.session?.prompt;
  if (promptAsync && tawaCtx.timerManager) {
    tawaCtx.timerManager.setTimeout(() => {
      
      Promise.resolve(
        (promptAsync as (o: TranscriptPromptInput) => Promise<unknown>)({
          path: { id: sessionId },
          body: { parts: [{ type: "text", text: t("rateLimitRetryPrompt") }], noReply: false },
          query: { directory: ctx.directory },
        }),
      )
        .then(() => clearRateLimitRetry(sessionId))
        .catch(() => {
          
          
          
          
          
          
          rememberRetryingSession(sessionId, attempt + 1);
        });
    }, delayMs);
  } else {
    tawaCtx.timerManager?.setTimeout(() => clearRateLimitRetry(sessionId), delayMs);
  }
  return true;
}


const TRANSCRIPT_INJECT_TIMEOUT_MS = 10_000;







let errorHandlerRefCount = 0;
let uncaughtHandler: ((err: Error) => void) | undefined = undefined;
let _homeProjectWarned = false;
let unhandledRejectionHandler: ((reason: unknown) => void) | undefined = undefined;

function disposeGlobalErrorHandlers(): void {
  errorHandlerRefCount = Math.max(0, errorHandlerRefCount - 1);
  if (errorHandlerRefCount !== 0) return;
  if (uncaughtHandler) process.removeListener("uncaughtException", uncaughtHandler);
  if (unhandledRejectionHandler) process.removeListener("unhandledRejection", unhandledRejectionHandler);
  uncaughtHandler = undefined;
  unhandledRejectionHandler = undefined;
}


export async function injectTranscriptQuestion(
  ctx: PluginInput,
  sessionID: string,
  title: string,
  kind: AskKind,
): Promise<void> {
  const client = ctx.client as TranscriptClient | undefined;
  const session = client?.session;
  const inject = session?.promptAsync ?? session?.prompt;
  if (!inject) {
    logger.warn("[tawassul] AskChannel: transcript renderer missing client.session.prompt — question not shown");
    return;
  }
  const text = `${ASK_MARKER}\n${formatAskPrompt(title, kind)}`;
  const pending = Promise.resolve(
    inject({
      path: { id: sessionID },
      body: { parts: [{ type: "text", text }], noReply: true },
      query: { directory: ctx.directory },
    }),
  ).catch((injectErr) => {
    logger.warn("[tawassul] AskChannel: transcript inject failed — question not shown", {
      sessionID,
      title,
      err: injectErr,
    });
  });
  let settled = false;
  let releaseTimeout = () => {};
  const timeout = new Promise<void>((resolve) => {
    releaseTimeout = resolve;
  });
  const handle = setTimeout(() => {
    if (settled) return;
    logger.debug(`[tawassul] transcript inject timed out after ${TRANSCRIPT_INJECT_TIMEOUT_MS}ms`);
    releaseTimeout();
  }, TRANSCRIPT_INJECT_TIMEOUT_MS);
  await Promise.race([pending, timeout]);
  settled = true;
  clearTimeout(handle);
}

export function getInitReady(hooks: Hooks): InitReadyProbe | undefined {
  return hooks[INIT_READY];
}

export function initPlugin(ctx: PluginInput, deps?: { TawassulContext?: typeof TawassulContext }) {
  perfReset();
  mark("initPlugin:start");

  
  void passiveSelfCheck(ctx.directory, resolve(ctx.directory, ".opencode/plugins/tawassul"));

  clearQuietModeForce();
  if (!_homeProjectWarned && isHomeProject(ctx.directory)) {
    _homeProjectWarned = true;
    forceQuietMode("home-as-project");
    logger.warn(
      `[tawassul] home-as-project detected: the project directory is $HOME itself — quiet mode forced (${quietModeForceReason()}; warn-once; run continues, no refusal).`,
    );
  }

  warnIfUnisolatedDb(ctx.directory);

  
  
  
  
  if (errorHandlerRefCount === 0) {
    uncaughtHandler = (err: Error) => {
      console.error("[tawassul] 🔴 Uncaught exception:", err);
    };
    unhandledRejectionHandler = (reason: unknown) => {
      console.error("[tawassul] 🔴 Unhandled rejection:", reason);
    };
    process.on("uncaughtException", uncaughtHandler);
    process.on("unhandledRejection", unhandledRejectionHandler);
  }
  errorHandlerRefCount += 1;

  
  const envDisabled = process?.env?.TAWASSUL_DISABLED === "1" || process?.env?.TAWASSUL_DISABLED === "true";
  if (envDisabled) {
    logger.warn("Plugin disabled via TAWASSUL_DISABLED env var");
    return {};
  }

  
  
  
  
  
  
  const coexistenceScope = detectInstallScope(import.meta.url);
  const coexistenceToken = fileURLToPath(import.meta.url);
  const coexistence = claimCoexistence(coexistenceScope, coexistenceToken, ctx.directory);
  if (!coexistence.shouldRegister) {
    logger.debug(`[tawassul] v2 setup yielded to another copy: ${coexistence.reason}`);
    return {};
  }
  
  
  
  
  const isActiveOwner = (): boolean => isCoexistenceOwner(coexistenceScope, coexistenceToken, ctx.directory);
  let coexistenceReleased = false;

  
  
  
  let tawaCtx: TawassulContext;
  mark("context:constructor:start");
  try {
    const ContextClass = deps?.TawassulContext ?? TawassulContext;
    
    
    const stateDir = process?.env?.TAWASSUL_STATE_DIR?.trim() || ctx.directory;
    tawaCtx = new ContextClass(stateDir);
  } catch (e) {
    logger.error("Failed to create context:", e);
    logger.warn("Returning empty hooks — no tools or hooks registered");
    return {};
  }
  mark("context:constructor:end");
  measure("context:constructor:start", "context:constructor:end", "new TawassulContext()");

  
  if (tawaCtx.isConfigDisabled()) {
    logger.warn("Plugin disabled via config.disabled");
    return {};
  }

  
  
  
  
  
  
  
  
  
  
  const askEnv = String(process?.env?.TAWASSUL_ASK_CHANNEL ?? "1")
    .trim()
    .toLowerCase();
  const askEnabled = askEnv !== "0" && askEnv !== "false";
  const appendPrompt = (
    ctx.client as { tui?: { appendPrompt?: (p: { text?: string }) => Promise<unknown> } } | undefined
  )?.tui?.appendPrompt;
  const renderEnv = readAskRenderEnv();
  const renderMode = resolveAskRenderer({
    appendPromptAvailable: Boolean(appendPrompt),
    appendPromptEnabled: renderEnv.appendPromptEnabled,
    transcriptEnabled: renderEnv.transcriptEnabled,
  });
  if (askEnabled && tawaCtx.timerManager) {
    const askDeps: AskChannelDeps = {
      sessionID: () => tawaCtx.sessionId,
      timers: tawaCtx.timerManager,
      render:
        renderMode === "append"
          ? async (slot) => {
              await appendPrompt!({ text: formatAskPrompt(slot.title, slot.kind) });
            }
          : renderMode === "transcript"
            ? async (slot) => {
                await injectTranscriptQuestion(ctx, slot.sessionID, slot.title, slot.kind);
              }
            : undefined,
      
      
      
      blockingTimeoutMs: CONSENT_BLOCKING_TIMEOUT_MS,
    };
    const askChannel = new AskChannel(askDeps);
    tawaCtx.askChannelInstance = askChannel;
    tawaCtx.askChannel = askChannel.ask.bind(askChannel);
    logger.info(`[tawassul] AskChannel enabled — questions surface in transcript/agent (renderMode=${renderMode})`);
  } else {
    logger.debug(`[tawassul] AskChannel disabled (env=${askEnv} timer=${tawaCtx.timerManager ? "yes" : "no"})`);
  }

  
  
  
  
  
  
  void repairProjectConfigBoot(ctx.directory).then((bootResult) => {
    if (bootResult.changed) {
      logger.info(
        `[tawassul] Boot repair done: ${bootResult.fixes.join(" + ")} in ${bootResult.configPath} (backup: ${bootResult.backupPath})`,
      );
    }
  });

  if (coexistenceScope === "global") {
    void ensureGlobalRosterSeed().then((r) => {
      if (r.created) logger.info(`[tawassul] Boot seed done: global roster at ${r.path}`);
    });
  } else {
    void ensureMinimalProjectContract(ctx.directory, coexistenceScope).then((r) => {
      if (r.created) logger.info(`[tawassul] Boot seed done: minimal contract at ${r.configPath}`);
    });
  }

  
  
  
  
  
  
  
  
  
  let initResolved = false;
  let initError: Error | null = null;
  let services: import("./service-factory.ts").ServiceFactoryResult | null = null;
  let hooks: import("./hooks-registration.ts").HooksResult | null = null;
  let tools: Record<string, ToolDefinition> = {};
  const initAbortController = new AbortController();
  let initTimeoutMs = 30_000;

  
  mark("initPromise:start");

  const initPromise = runWithContext(tawaCtx, async () => {
    try {
      
      await tawaCtx.init();
      if (initAbortController.signal.aborted) return;

      try {
        const reassigned = sweepRetiredModelPins(tawaCtx.modelManager.agentModelMap as Record<string, string>);
        if (reassigned.length > 0) {
          logger.warn(
            `[tawassul] Boot retired-pin sweep: ${reassigned.map((r) => `${r.name} ${r.oldModel} -> ${r.newModel}`).join(", ")}`,
          );
        }
      } catch (e) {
        logger.debug(`[tawassul] Boot retired-pin sweep skipped: ${e instanceof Error ? e.message : String(e)}`);
      }

      
      
      void (async () => {
        try {
          const { checkGeneratedConfig, buildExpectedConfig, resolveGenPaths } =
            await import("../scripts/gen-opencode-config.ts");
          const chk = checkGeneratedConfig();
          if (chk.ok) return;
          const paths = resolveGenPaths();
          const raw = readFileSync(paths.configPath, "utf-8");
          const expected = buildExpectedConfig(raw);
          if (expected !== raw) {
            
            
            
            
            
            const lockAnchor = dirname(paths.configPath);
            
            
            
            
            await sleepBootJitter();
            
            
            
            const { acquired: f6acq, lockName: f6lock, owner: f6owner } = await acquireOpencodeConfigLock(lockAnchor);
            if (!f6acq) {
              logger.debug(
                `[tawassul] F6 passive regen: config lock busy for ${paths.configPath} — skipping drift auto-fix this boot`,
              );
            } else {
              try {
                
                const rawLocked = readFileSync(paths.configPath, "utf-8");
                const expectedLocked = buildExpectedConfig(rawLocked);
                if (expectedLocked !== rawLocked) {
                  const { atomicWriteFile } = await import("../utils/atomic.ts");
                  await atomicWriteFile(paths.configPath, expectedLocked);
                  logger.warn(
                    `[tawassul] F6 passive regen: drift auto-fixed — ${chk.diff?.slice(0, 120) ?? "out of sync"}`,
                  );
                }
              } finally {
                try {
                  await releaseFSLock(f6lock, f6owner);
                } catch (err) {
                  logger.debug("[tawassul] F6 FS lock release failed:", err);
                }
              }
            }
          }
        } catch (e) {
          logger.debug(`[tawassul] F6 passive regen skipped: ${e instanceof Error ? e.message : String(e)}`);
        }
      })();

      
      initTimeoutMs = tawaCtx.configManager.config.initTimeoutMs ?? 30_000;

      
      if (tawaCtx.configManager.config.language) {
        setLanguage(tawaCtx.configManager.config.language);
      }

      const budgetOverrides = tawaCtx.configManager.config.iterationBudgets;
      if (budgetOverrides) {
        const applied = applyIterationBudgets(budgetOverrides, (agent, value) => {
          logger.warn(`[tawassul] iterationBudgets: ignoring ${agent} (invalid limit: ${String(value)})`);
        });
        if (applied > 0) {
          logger.info(`[tawassul] iteration budgets overridden for ${applied} agent(s) from config`);
        }
      }

      if (initAbortController.signal.aborted) return;

      
      
      
      mark("services:start");
      try {
        services = createServices(tawaCtx, ctx.directory);
      } catch (e) {
        logger.error("createServices failed:", e);
        initError = e instanceof Error ? e : new Error(String(e));

      }
      mark("services:end");
      measure("services:start", "services:end", "createServices()");

      if (initAbortController.signal.aborted) return;

      
      
      try {
        if (services?.handoffService) {
          await services.handoffService.resumeInterruptedSagas();
        } else if (tawaCtx.handoffService) {
          await tawaCtx.handoffService.resumeInterruptedSagas();
        }
      } catch (e) {
        logger.warn("[tawassul] P2.3: saga resume skipped:", (e as Error)?.message ?? e);
      }

      
      const discussionManager = tawaCtx.discussionManager;
      mark("hooks:start");
      try {
        
        
        
        if (services) {
          hooks = createHooks(tawaCtx, ctx.directory, services, discussionManager, ctx.serverUrl);
        } else {
          logger.warn("createHooks skipped: services not initialized");
        }
      } catch (e) {
        logger.error("createHooks failed:", e);
        if (!initError) {
          initError = e instanceof Error ? e : new Error(String(e));
        }
      } finally {
        mark("hooks:end");
        measure("hooks:start", "hooks:end", "createHooks()");
      }

      if (initAbortController.signal.aborted) return;

      
      discussionManager.setCreateHandoffCallback((params) => {
        const id = tawaCtx.nextHandoffId();
        const entry = createHandoffEntry({
          id,
          from: params.from,
          to: params.to,
          task: params.task,
          context: params.context,
          files: params.files,
          sourceDiscussionId: params.sourceDiscussionId,
        });
        tawaCtx.handoffs.set(id, entry);
        return id;
      });

      if (initAbortController.signal.aborted) return;

      
      mark("tools:build:start");
      const registry = buildToolRegistry(tawaCtx, services ?? undefined);
      tools = registry.tools;
      mark("tools:build:end");
      measure("tools:build:start", "tools:build:end", "buildToolRegistry()");

      
      if (tawaCtx.pipelineState) initAutoSweep(tawaCtx.pipelineState);

      mark("initPromise:complete");
      measure("initPromise:start", "initPromise:complete", "initPromise() async chunk");

      initResolved = true;
      logger.info("[tawassul] ✅ Background init completed successfully");

      
      initAudit(tawaCtx);

      
      
      try {
        tawaCtx.eventHub.emit({ type: "PLUGIN_READY" });
      } catch (e) {
        logger.warn("[tawassul] PLUGIN_READY emit failed:", (e as Error)?.message ?? e);
      }
    } catch (e) {
      if (initAbortController.signal.aborted) return; 
      initError = e instanceof Error ? e : new Error(String(e));
      logger.error("Background init failed:", initError.message);

    }
  });

  
  
  
  const ensureReady = async (): Promise<{ ready: boolean; error?: Error }> => {
    if (initResolved) return { ready: true };
    if (initError) return { ready: false, error: initError };
    if (initAbortController.signal.aborted)
      return { ready: false, error: new Error("[tawassul] Init cancelled (disposed)") };

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), initTimeoutMs);
    if (timer?.unref) timer.unref();
    try {
      await Promise.race([
        initPromise,
        new Promise<never>((_, rej) =>
          ac.signal.addEventListener(
            "abort",
            () => rej(new Error(`[tawassul] Init timed out after ${initTimeoutMs}ms`)),
            { once: true },
          ),
        ),
      ]);
    } catch (e) {
      initError = e instanceof Error ? e : new Error(String(e));
    } finally {
      clearTimeout(timer);
    }
    if (initResolved) return { ready: true };
    if (initError) return { ready: false, error: initError };
    return { ready: initResolved, error: initError ?? undefined };
  };

  
  const stateless = STATELESS_TOOLS;

  
  const wrappedTools: Record<string, ToolDefinition> = {};
  const toolNames = TAWASSUL_TOOL_NAMES;
  const liveTool = (n: string): ToolDefinition | undefined => tools[n];
  for (const name of toolNames) {
    const wrapper = (n: string): ToolDefinition => ({
      get description(): string {
        return liveTool(n)?.description ?? `[tawassul] ${n} — initializing, retry in a moment`;
      },
      get args(): z.ZodRawShape {
        return (liveTool(n)?.args ?? {}) as z.ZodRawShape;
      },
      execute: async (args: Record<string, unknown>, context: ToolContext) => {
        const status = await ensureReady();
        if (stateless.has(n)) {
          if (!status.ready && status.error) {
            
            if (n === "help") {
              return `[tawassul] Plugin initializing. Available commands: help, review, panic. Other tools will be available after init completes.`;
            }
            if (n === "panic") {
              return `[tawassul] Plugin initializing. Panic reset will be available after init completes.`;
            }
            return `[tawassul] Tool ${n} available (init pending: ${status.error.message})`;
          }
        } else if (status.error) {
          
          throw new Error(`[tawassul] Tool ${n} unavailable: ${status.error.message}. Try again in a moment.`);
        }
        const real = tools[n];
        if (!real) {
          if (stateless.has(n)) return `[tawassul] Tool ${n} not available yet (init pending)`;
          throw new Error(`[tawassul] Tool ${n} not found after init`);
        }
        
        
        
        if (!isActiveOwner()) {
          throw new Error(`[tawassul] Tool ${n} inactive: superseded by another ${coexistenceScope}-scope copy`);
        }
        return runWithContext(tawaCtx, () => real.execute(args, context));
      },
    });
    wrappedTools[name] = wrapper(name);
  }

  
  const toolCount = Object.keys(wrappedTools).length;
  if (toolCount !== TAWASSUL_TOOL_NAMES.length) {
    logger.warn(`[tawassul] Health check: ${toolCount} tools registered, expected ${TAWASSUL_TOOL_NAMES.length}`);
  }

  mark("initPlugin:return");
  measure("initPlugin:start", "initPlugin:return", "initPlugin() total");
  const perfReport = report();
  if (perfReport) logger.debug(perfReport);
  perfReset();

  
  
  const gateHook =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R => {
      if (!isActiveOwner()) {
        logger.debug(`[tawassul] hook skipped: superseded by another ${coexistenceScope}-scope copy`);
        return undefined as R;
      }
      return fn(...args);
    };

  
  type HookChatMessage = NonNullable<Hooks["chat.message"]>;
  type HookSessionCompacted = NonNullable<Hooks["experimental.session.compacting"]>;

  
  
  
  let toolSchemaDriftWarned = false;
  let toolReadyWarned = false;
  let toolTamperWarned = false;

  return {
    tool: wrappedTools,
    [INIT_READY]: ensureReady,
    config: gateHook((async (cfg) => {
      applyDynamicAgentModelFix(cfg);
      ensureTawaToolPermissions(cfg);
      ensureAddAgentToolPermissions(cfg);
    }) as NonNullable<Hooks["config"]>),
    "chat.message": gateHook((async (...args: Parameters<HookChatMessage>) => {
      const status = await ensureReady();
      if (!status.ready) {
        
        logger.warn(`chat.message: init not ready (${status.error?.message ?? "pending"})`);
        return;
      }
      return runWithContext(tawaCtx, async () => {
        if (hooks) return hooks.messageUpdatedHook(...args);
      });
    }) as HookChatMessage),
    "experimental.session.compacting": gateHook((async (...args: Parameters<HookSessionCompacted>) => {
      const status = await ensureReady();
      if (!status.ready) {
        logger.warn(`session.compacting: init not ready (${status.error?.message ?? "pending"})`);
        return;
      }
      return runWithContext(tawaCtx, async () => {
        if (hooks) return hooks.sessionCompactedHook(...args);
      });
    }) as HookSessionCompacted),
    "tool.definition": gateHook((async (
      input: { toolID: string },
      output: { description: string; parameters: Record<string, unknown>; jsonSchema?: unknown },
    ) => {
      
      
      
      
      
      
      
      
      
      
      
      
      
      if (tawaCtx.configManager.config.injectToolSchemas === false) return;
      const status = await ensureReady();
      if (!status.ready) {
        
        
        if (!toolReadyWarned) {
          toolReadyWarned = true;
          logger.warn("[tawassul] tool.definition: init pending — advertising placeholder schemas until ready");
        }
        return;
      }
      const real = tools[input.toolID];
      if (!real || !real.args) return;
      const parametersRef = output.parameters;
      try {
        const schema = await buildToolJsonSchema(real.args as z.ZodRawShape);
        if (!schema) {
          if (!toolSchemaDriftWarned) {
            toolSchemaDriftWarned = true;
            logger.error(
              `[tawassul] tool.definition: schema generation failed for ${input.toolID} — ` +
                `proceeding without injection (server will use wrapper's empty parameters)`,
            );
          }
          return;
        }
        output.jsonSchema = schema;
        output.description = real.description;
        
        
        
        
        
        if (output.parameters !== parametersRef && !toolTamperWarned) {
          toolTamperWarned = true;
          logger.error(
            `[tawassul] tool.definition(${input.toolID}): output.parameters was replaced by another hook while awaiting — ` +
              `injection contract degraded; investigate co-installed plugins`,
          );
        }
      } catch {

      }
    }) as NonNullable<Hooks["tool.definition"]>),
    "tool.execute.before": gateHook((async (
      input: Parameters<NonNullable<Hooks["tool.execute.before"]>>[0],
      output: Parameters<NonNullable<Hooks["tool.execute.before"]>>[1],
    ) => {
      const status = await ensureReady();
      if (!status.ready) {
        if (
          requiresConsent(
            (input as { tool?: string }).tool ?? "",
            (output as { args?: Record<string, unknown> }).args ?? {},
          )
        ) {
          throw new Error(
            `[tawassul] Tool blocked: plugin init not ready (${status.error?.message ?? "pending"}). Try again in a moment.`,
          );
        }
        logger.warn(`tool.execute.before: init not ready (${status.error?.message ?? "pending"})`);
        return;
      }
      return runWithContext(tawaCtx, async () => {
        if (hooks) return hooks.toolExecuteBeforeHook(input, output);
      });
    }) as NonNullable<Hooks["tool.execute.before"]>),
    "tool.execute.after": gateHook((async (
      input: Parameters<NonNullable<Hooks["tool.execute.after"]>>[0],
      output: Parameters<NonNullable<Hooks["tool.execute.after"]>>[1],
    ) => {
      const status = await ensureReady();
      if (!status.ready) {
        logger.warn(`tool.execute.after: init not ready (${status.error?.message ?? "pending"})`);
        return;
      }
      return runWithContext(tawaCtx, async () => {
        if (hooks) return hooks.toolExecuteAfterHook(input, output);
      });
    }) as NonNullable<Hooks["tool.execute.after"]>),
    event: gateHook((async (input: unknown) => {
      
      try {
        const ev = input as Record<string, unknown>;
        const props = (ev?.properties as Record<string, unknown> | undefined) ?? ev;
        const errMsg: string | undefined =
          (props?.error as string | undefined) ??
          (ev?.error as string | undefined) ??
          ((props?.payload as Record<string, unknown> | undefined)?.error as string | undefined) ??
          (typeof props?.message === "string" ? (props.message as string) : undefined);
        const sessId: string | undefined =
          (props?.sessionID as string | undefined) ??
          (ev?.sessionID as string | undefined) ??
          ((props?.payload as Record<string, unknown> | undefined)?.sessionID as string | undefined);
        const evType = (ev?.type as string | undefined) ?? (ev?.event as string | undefined) ?? "";
        if (
          (evType === "session.error" || evType === "session_error" || evType === "session_idle") &&
          errMsg &&
          sessId
        ) {
          if (matchesRateLimit(errMsg)) {
            await handleRateLimitError(ctx, tawaCtx, sessId, errMsg);
            return;
          }
        } else if (errMsg && sessId && matchesRateLimit(errMsg)) {
          await handleRateLimitError(ctx, tawaCtx, sessId, errMsg);
          return;
        }
      } catch {
        void 0;
      }
      const status = await ensureReady();
      if (!status.ready) {
        logger.debug(`event hook: init not ready (${status.error?.message ?? "pending"})`);
        return;
      }
      return runWithContext(tawaCtx, async () => {
        if (hooks) {
          const eventInput = input as Parameters<NonNullable<Hooks["event"]>>[0];
          await hooks.n2AutoHook(eventInput as { event: unknown });
          return hooks.toolOutputStreamHook(eventInput);
        }
      });
    }) as NonNullable<Hooks["event"]>),
    dispose: async () => {
      disposeGlobalErrorHandlers();
      initAbortController.abort();
      if (tawaCtx.pipelineState) stopAutoSweep(tawaCtx.pipelineState); 
      
      
      
      
      
      if (!coexistenceReleased) {
        coexistenceReleased = true;
        releaseCoexistence(coexistenceScope, coexistenceToken, ctx.directory);
      }
      
      try {
        tawaCtx.agentManager.stopRefresh();
      } catch (e) {
        logger.warn("[plugin-init] dispose: stopRefresh failed:", e);
      }
      try {
        resetAllState(tawaCtx.pipelineState, tawaCtx.rateLimiter);
      } catch (e) {
        logger.warn("[plugin-init] dispose: resetAllState failed:", e);
      }
      try {
        resetModelCache();
      } catch (e) {
        logger.warn("[plugin-init] dispose: resetModelCache failed:", e);
      }
      try {
        tawaCtx.askChannelInstance?.dispose();
      } catch (e) {
        logger.warn("[plugin-init] dispose: askChannel cleanup failed:", e);
      }
      const status = await ensureReady();
      if (!status.ready) {
        logger.warn("dispose: init not ready, forcing cleanup:", status.error?.message ?? "pending");
      }
      return runWithContext(tawaCtx, async () => {
        if (hooks) return hooks.disposeHook();
      });
    },
    tawaCtx,
  };
}
