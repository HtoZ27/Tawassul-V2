import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginInput, TawassulHooks } from "../plugin-types.ts";
import { getInitReady, getRosterReady, initPlugin, readActiveConfig } from "../bootstrap/plugin-init.ts";
import { detectInstallScope } from "../core/install-scope.ts";
import { ToolBlockedError } from "../hooks/tool-execute.ts";
import { isBlockedToolForTawa } from "../security-policy.ts";
import { logger } from "../utils/logger.ts";
import { cpuMs, currentGeneration, genTag } from "../utils/boot-telemetry.ts";
import { collectToolSchemas, makeV2Tool, schemaFingerprint, measureSchemaPayload } from "./adapters.ts";
import { toolNameSetHash } from "../services/tool-tripwire.ts";
import { createAskBridge, registerAskPermission } from "./ask.ts";
import { registerPilotCommand, registerPilotSkills } from "../skills/pilot.ts";
import { buildPluginInput } from "./client-shim.ts";
import { isTaskTool, subagentArgsToV1, toolNameToV1, v1ArgsToSubagent } from "./delegation.ts";
import { mapV2EventToV1 } from "./event-adapter.ts";
import { startSchemaRefresh } from "./schema-refresh.ts";
import { installHostGoalMirror, uninstallHostGoalMirror } from "./host-goal.ts";
import { applyV1AfterOutput, jsonSafeMetadata, metadataChanged, resultText, titleFromMetadata, withTitleMetadata } from "./result-bridge.ts";
import { clearSessionBridge, installSessionBridge, type SessionBridge } from "./session-bridge.ts";
import { clearUsageLedger, installUsageLedger } from "../services/usage-ledger.ts";
import { clearUsageShadow, installUsageShadow } from "../services/usage-shadow.ts";
import {
  classifyTerminalFailure,
  createFailurePack,
  handleContextEvent,
  refreshSessionInjection,
  warmWorkspace,
} from "../services/context-pack/index.ts";
import { parseFreeLimitSignal } from "../services/free-limit.ts";
import { hostFloorProblem } from "../core/host-floor.ts";
import {
  commitFailover,
  parseModelTarget,
  planFailover,
  recordFailoverMiss,
  switchSessionModel as switchModelVia,
  type FallbackChainConfig,
  type SwitchModelSession,
} from "../services/model-failover.ts";
import {
  installBackgroundControl,
  recordBackgroundSnapshot,
  uninstallBackgroundControl,
  type BackgroundItem,
} from "../services/background-tasks.ts";
import { finalizeDispatchOnIdle, noteDispatchLifecycleEvent } from "../services/dispatch-ledger.ts";
import type { V2Context, V2SessionEvent, V2ToolContext, V2ToolHookInput } from "./types.ts";
import { noteIdle } from "../services/continuity/detect.ts";

const MAX_PROCESSED_MESSAGES = 1024;
export const INITIAL_SCHEMA_WAIT_MS = 750;
export const SCHEMA_RETRY_ATTEMPTS = 6;
export const SCHEMA_RETRY_DELAY_MS = 500;
export const OPTIONAL_TIMEOUT_MS = 2000;
export const TEARDOWN_STEP_TIMEOUT_MS = 5000;
export const REGISTRATION_WATCHDOG_MS = 10000;
const SETUP_STEP_PARKED: unique symbol = Symbol("setup-step-parked");

export function noteExperimentalIdle(snapshot: { sessionID?: unknown; background?: unknown }): void {
  if (typeof snapshot.sessionID !== "string") return;
  if (Array.isArray(snapshot.background)) {
    recordBackgroundSnapshot(snapshot.sessionID, snapshot.background as BackgroundItem[]);
  }
  void noteIdle();
  try {
    finalizeDispatchOnIdle(
      snapshot.sessionID,
      Array.isArray(snapshot.background) ? snapshot.background : undefined,
    );
  } catch (e) {
    logger.warn("[tawassul] dispatch finalize skipped:", e);
  }
}

const HOST_MESSAGE_ROLES = ["system", "user", "assistant", "tool"] as const;

type HostMessageRole = (typeof HOST_MESSAGE_ROLES)[number];

function toHostMessageRole(value: unknown): HostMessageRole | undefined {
  return typeof value === "string" && (HOST_MESSAGE_ROLES as readonly string[]).includes(value)
    ? (value as HostMessageRole)
    : undefined;
}

function toDynamicAgentModel(model: unknown): { providerID: string; modelID: string } | undefined {
  if (typeof model === "string") {
    const parts = model.split("/");
    const providerID = parts[0];
    if (providerID && parts.length >= 2) return { providerID, modelID: parts.slice(1).join("/") };
    return undefined;
  }
  if (model && typeof model === "object") {
    const rec = model as { providerID?: unknown; modelID?: unknown; id?: unknown };
    const providerID = typeof rec.providerID === "string" ? rec.providerID : undefined;
    const modelID =
      typeof rec.modelID === "string" ? rec.modelID : typeof rec.id === "string" ? rec.id : undefined;
    if (providerID && modelID) return { providerID, modelID };
  }
  return undefined;
}

function cloneArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return { ...(args as Record<string, unknown>) };
}

function rememberProcessed(set: Set<string>, key: string): boolean {
  if (set.has(key)) return true;
  if (set.size >= MAX_PROCESSED_MESSAGES) {
    const first = set.keys().next().value;
    if (first !== undefined) set.delete(first as string);
  }
  set.add(key);
  return false;
}

function toV1MessageID(messageID: string): string {
  return messageID.startsWith("msg") ? messageID : `msg_${messageID}`;
}

const syntheticMessageKeys = new WeakMap<object, string>();
let syntheticMessageCounter = 0;

const INJECTED_PART_KEY = "tawassulInjected";

type TextPartLike = { type: string; text?: string; [key: string]: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isInjectedPart(part: TextPartLike): boolean {
  if (part.type !== "text" || typeof part.text !== "string") return false;
  const metadata = part["metadata"];
  return isRecord(metadata) && metadata[INJECTED_PART_KEY] === true;
}

function markInjectedPart(part: TextPartLike): { type: string; text: string; metadata: Record<string, unknown> } {
  const metadata = isRecord(part["metadata"]) ? { ...part["metadata"] } : {};
  metadata[INJECTED_PART_KEY] = true;
  return { type: "text", text: part.text as string, metadata };
}

function syntheticMessageKey(message: object, index: number): string {
  const cached = syntheticMessageKeys.get(message);
  if (cached) return cached;
  syntheticMessageCounter += 1;
  const key = `synth_${index}_${syntheticMessageCounter}`;
  syntheticMessageKeys.set(message, key);
  return key;
}

export function isBlockError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "ToolBlockedError" || name === "ConsentBlockedError";
}

function isBlockedForAgent(agent: unknown, tool: string): boolean {
  if (typeof agent !== "string") return false;
  const id = agent.trim().toLowerCase();
  const isTawa = id === "tawa" || id.endsWith(":tawa") || id.endsWith("/tawa");
  return isTawa && isBlockedToolForTawa(toolNameToV1(tool));
}

function reportSafetyHookFailure(hook: string, detail: string, error: unknown): void {
  logger.error(
    `[tawassul] v2 ${hook} (${detail}) failed; continuing fail-open:`,
    error instanceof Error ? error.stack : error,
  );
  try {
    logger.audit("V2_SAFETY_HOOK_FAIL_OPEN", {
      hook,
      detail,
      error: error instanceof Error ? error.message : String(error),
    });
  } catch {
    void 0;
  }
}

export type RetryFailoverPayload = {
  error?: unknown;
  decision?: unknown;
  sessionID?: string;
  agent?: string;
  model?: unknown;
  attempt?: number;
};

export type RetryFailoverOptions = {
  switchModel?: SwitchModelSession["switchModel"];
  fallback?: FallbackChainConfig;
};

const failoverInFlight = new Set<string>();

export async function runRetryFailover(
  payload: RetryFailoverPayload,
  options: RetryFailoverOptions,
): Promise<void> {
  const failure = classifyTerminalFailure(payload.error);
  const signal = parseFreeLimitSignal(payload.error).signal;
  const refusal =
    failure.terminal || signal === "free-daily-limit" || signal === "quota-exhausted";
  if (!refusal) return;
  if (payload.sessionID && failoverInFlight.has(payload.sessionID)) {
    logger.debug(`[tawassul] model failover already in flight for ${payload.sessionID}`);
    return;
  }
  if (payload.sessionID) failoverInFlight.add(payload.sessionID);
  try {
    const plan = planFailover({
      config: options.fallback,
      agent: payload.agent,
      model: parseModelTarget(payload.model),
      sessionID: payload.sessionID,
    });
    if (plan.action === "switch" && payload.sessionID) {
      const switched = await switchModelVia(
        { switchModel: options.switchModel },
        payload.sessionID,
        plan.to,
      );
      if (switched) {
        commitFailover(payload.sessionID, plan.target);
        payload.decision = { retry: true, delay: plan.delayMs };
        logger.warn(
          `[tawassul] model failover: ${payload.agent ?? "unknown"} session ${payload.sessionID} -> ${plan.target} (${failure.reason})`,
        );
        return;
      }
      recordFailoverMiss(payload.sessionID, plan.target);
      logger.warn(
        `[tawassul] model failover to ${plan.target} rejected by the host; falling back to the no-retry decision`,
      );
    } else if (plan.action === "keep") {
      logger.debug(`[tawassul] model failover skipped: ${plan.reason}`);
    }
  } catch (e) {
    logger.debug("[tawassul] model failover failed open:", e);
  } finally {
    if (payload.sessionID) failoverInFlight.delete(payload.sessionID);
  }
  if (failure.terminal) payload.decision = { retry: false };
}

export async function runChatMessageBridge(
  plugin: TawassulHooks,
  event: V2SessionEvent,
  processed: Set<string>,
): Promise<void> {
  const messages = event.messages;
  if (!Array.isArray(messages) || messages.length === 0) return;
  const last = messages[messages.length - 1];
  if (!last || typeof last !== "object") return;
  const role = last["role"];
  if (role !== "user" && role !== "assistant") return;
  const sessionID = event.sessionID;
  if (typeof sessionID !== "string" || !sessionID) return;
  const rawId = last["id"];
  const messageID =
    typeof rawId === "string" && rawId.length > 0
      ? rawId
      : syntheticMessageKey(last, messages.length - 1);

  const dedupeKey = `${sessionID}:${messageID}:${role}`;
  if (rememberProcessed(processed, dedupeKey)) return;

  const hook = plugin["chat.message"];
  if (!hook) return;

  const v1Input = {
    sessionID,
    agent: role === "assistant" ? (event.agent as string | undefined) : undefined,
    model: toDynamicAgentModel(event.model),
    messageID: toV1MessageID(messageID),
  };
  const rawContent = last["content"];
  const contentIsString = typeof rawContent === "string";
  const originals: Array<{ type: string; text?: string; [key: string]: unknown }> = [];
  if (Array.isArray(rawContent)) {
    for (const part of rawContent) {
      if (part && typeof part === "object" && !Array.isArray(part)) {
        const record = part as Record<string, unknown>;
        if (typeof record["type"] === "string") {
          originals.push(record as { type: string; text?: string; [key: string]: unknown });
        }
      }
    }
  } else if (contentIsString && rawContent.length > 0) {
    originals.push({ type: "text", text: rawContent });
  }
  const seeded = originals.map((part) => ({ ...part }));
  const seededToOriginal = new Map<object, { type: string; text?: string; [key: string]: unknown }>();
  seeded.forEach((copy, index) => {
    const original = originals[index];
    if (original) seededToOriginal.set(copy, original);
  });
  const injectedTexts = new Set<string>();
  for (const part of originals) {
    if (isInjectedPart(part) && typeof part.text === "string") injectedTexts.add(part.text);
  }

  const v1Output = {
    message: { role: role as string, ...(contentIsString ? { text: rawContent } : {}) },
    parts: seeded,
  };
  try {
    await hook(v1Input, v1Output);
  } catch (e) {
    if (isBlockError(e)) throw e;
    reportSafetyHookFailure("chat.message", sessionID, e);
    return;
  }
  let messageText: string | undefined;
  const outMessage = v1Output.message as unknown;
  if (outMessage && typeof outMessage === "object" && !Array.isArray(outMessage)) {
    const message = outMessage as Record<string, unknown>;
    const nextRole = toHostMessageRole(message["role"]);
    if (nextRole && nextRole !== last["role"]) last["role"] = nextRole;
    const nextAgent = typeof message["agent"] === "string" ? message["agent"].trim() : "";
    if (nextAgent && nextAgent !== event.agent) event.agent = nextAgent;
    const nextModel = toDynamicAgentModel(message["model"]);
    if (nextModel) event.model = nextModel;
    if (contentIsString && typeof message["text"] === "string" && message["text"] !== rawContent) {
      messageText = message["text"];
    }
  }
  const added: Array<{ type: string; text: string; metadata: Record<string, unknown> }> = [];
  const addedTexts = new Set<string>();
  let editedString: string | undefined;
  for (const part of v1Output.parts) {
    if (!part || typeof part !== "object") continue;
    const original = seededToOriginal.get(part);
    if (original) {
      if (original.type === "text" && typeof part.text === "string" && part.text !== original.text) {
        original.text = part.text;
        if (contentIsString) editedString = part.text;
      }
      continue;
    }
    if (part.type === "text" && typeof part.text === "string") {
      if (injectedTexts.has(part.text) || addedTexts.has(part.text)) continue;
      addedTexts.add(part.text);
      added.push(markInjectedPart(part));
    }
  }
  const finalText = contentIsString ? (messageText ?? editedString) : undefined;
  if (finalText !== undefined) {
    last["content"] = finalText;
  }
  if (added.length === 0) return;
  if (Array.isArray(rawContent)) {
    rawContent.push(...added);
    return;
  }
  if (contentIsString) {
    last["content"] = [{ type: "text", text: finalText ?? rawContent }, ...added];
  }
}

async function runCompactionBridge(plugin: TawassulHooks, event: V2SessionEvent): Promise<void> {
  const sessionID = event.sessionID;
  if (typeof sessionID !== "string" || !sessionID) return;
  const system = event.system;
  if (!Array.isArray(system)) return;
  const hook = plugin["experimental.session.compacting"];
  if (!hook) return;
  const v1Output = { context: [] as string[], prompt: undefined as string | undefined };
  try {
    await hook({ sessionID }, v1Output);
  } catch (e) {
    logger.warn(`[tawassul] v2 compaction bridge failed for ${sessionID}:`, e instanceof Error ? e.stack : e);
    return;
  }
  for (const text of v1Output.context) {
    if (typeof text === "string" && text.trim()) {
      system.push({ type: "text", text });
    }
  }
  if (v1Output.prompt && typeof v1Output.prompt === "string") {
    system.push({ type: "text", text: `## Tawassul Swarm Compaction\n${v1Output.prompt}` });
  }
}

export type V2SetupDeps = {
  init?: (input: PluginInput) => TawassulHooks;
  collectSchemas?: typeof collectToolSchemas;
  refresh?: { attempts?: number; delayMs?: number; initialWaitMs?: number };
  rosterWaitMs?: number;
  optionalTimeoutMs?: number;
  teardownTimeoutMs?: number;
  registrationWatchdogMs?: number;
};

const PROJECT_ENTRY_EXTENSIONS = [".js", ".ts", ".mjs", ".cjs"] as const;

function projectEntryCandidates(directory: string): string[] {
  const preferred: string[] = [];
  const fallback: string[] = [];
  for (const dirName of ["plugin", "plugins"]) {
    const base = join(directory, ".opencode", dirName);
    if (!existsSync(base)) continue;
    for (const extension of PROJECT_ENTRY_EXTENSIONS) {
      const flat = join(base, `tawassul${extension}`);
      if (existsSync(flat)) preferred.push(flat);
      const index = join(base, "tawassul", `index${extension}`);
      if (existsSync(index)) preferred.push(index);
    }
    for (const entry of readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "tawassul" || /retired|disabled/i.test(entry.name)) continue;
      const path = join(base, entry.name);
      if (entry.isFile() && PROJECT_ENTRY_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        fallback.push(path);
      } else if (entry.isDirectory()) {
        for (const extension of PROJECT_ENTRY_EXTENSIONS) {
          const index = join(path, `index${extension}`);
          if (existsSync(index)) fallback.push(index);
        }
      }
    }
  }
  return [...new Set([...preferred, ...fallback])];
}

type DelegatedSetup = (ctx: V2Context) => Promise<() => Promise<void>>;

function eventRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function handlePackEvent(raw: unknown, worktree: string, bridge: SessionBridge): Promise<void> {
  const event = eventRecord(raw);
  if (!event) return;
  const type = typeof event.type === "string" ? event.type : "";
  const data = eventRecord(event.data);
  const sessionID = typeof data?.sessionID === "string" ? data.sessionID : undefined;
  if (!sessionID) return;
  if (type === "session.compaction.ended") {
    await refreshSessionInjection({
      worktree,
      sessionID,
      readMessages: async () => bridge.context({ sessionID }),
    });
    return;
  }
  if (type === "session.step.failed") {
    const failure = classifyTerminalFailure(data?.error);
    if (!failure.terminal) return;
    let messages: unknown[] = [];
    try {
      messages = await bridge.context({ sessionID });
    } catch {
      messages = [];
    }
    await createFailurePack({
      worktree,
      sessionID,
      agent: typeof data?.agent === "string" ? data.agent : undefined,
      messages,
      error: data?.error,
      retryAfterMs: failure.retryAfterMs,
    });
  }
}

async function loadProjectSetup(directory: string, selfUrl: string): Promise<DelegatedSetup | undefined> {
  if (!directory) return undefined;
  for (const candidate of projectEntryCandidates(directory)) {
    const url = pathToFileURL(candidate).href;
    if (url === selfUrl) continue;
    try {
      const mod = (await import(url)) as { default?: unknown; tawassul?: unknown };
      const exported = (mod.default ?? mod.tawassul) as { id?: unknown; setup?: unknown } | undefined;
      if (!exported || exported.id !== "tawassul" || typeof exported.setup !== "function") continue;
      logger.info(`[tawassul] global copy delegates to the project copy at ${candidate}`);
      return exported.setup as DelegatedSetup;
    } catch (e) {
      logger.warn(
        `[tawassul] global copy could not load the project copy at ${candidate}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return undefined;
}

export function createV2Setup(deps: V2SetupDeps = {}) {
  return async (rawCtx: unknown): Promise<() => Promise<void>> => {
    const ctx = rawCtx as V2Context;
    if (!ctx || !ctx.session || !ctx.tool) {
      logger.error("[tawassul] v2 setup aborted: host missing required domains (session/tool)");
      return async () => undefined;
    }

    const reportedVersion = ctx.app?.version;
    const floorProblem = hostFloorProblem(reportedVersion);
    if (floorProblem) {
      logger.error(`[tawassul] v2 setup refused: ${floorProblem}`);
      return async () => undefined;
    }
    if (!reportedVersion) {
      logger.debug("[tawassul] v2 setup: the host reported no version; the floor check is skipped");
    }

    if (detectInstallScope(import.meta.url) === "global") {
      const projectSetup = await loadProjectSetup(ctx.location?.directory?.trim() ?? "", import.meta.url);
      if (projectSetup) {
        try {
          return await projectSetup(ctx);
        } catch (e) {
          logger.warn(
            `[tawassul] delegated project setup failed; the global copy continues: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    const input = buildPluginInput(ctx);
    const plugin = (deps.init ?? initPlugin)(input);
    const generation = currentGeneration();
    const setupStartedAt = performance.now();
    const setupCpu = process.cpuUsage();
    logger.info(`[tawassul] v2 setup ${genTag(generation)} start`);
    const rosterProbe = getRosterReady(plugin);
    if (rosterProbe) {
      try {
        const roster = await rosterProbe(deps.rosterWaitMs ?? 2000);
        logger.info(
          `[tawassul] v2 roster prewarm: populated=${roster.populated} complete=${roster.complete} ` +
            `elapsed=${roster.elapsedMs}ms path=${roster.configPath ?? "unknown"}${roster.timedOut ? " bounded=true" : ""}`,
        );
      } catch (e) {
        logger.warn(
          `[tawassul] v2 roster prewarm failed (fail-open): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    const capability = (value: unknown): number => (typeof value === "function" ? 1 : 0);
    logger.info(
      `[tawassul] host capabilities: session=1 tool=1 transform=${capability(ctx.tool.transform)} reload=${capability(ctx.tool.reload)} hook=${capability(ctx.tool.hook)} compacting=${capability(plugin["experimental.session.compacting"])}`,
    );
    const wrapped = plugin.tool ?? {};
    const optionalTimeoutMs = deps.optionalTimeoutMs ?? OPTIONAL_TIMEOUT_MS;
    const teardownTimeoutMs = deps.teardownTimeoutMs ?? TEARDOWN_STEP_TIMEOUT_MS;
    const registrationWatchdogMs = deps.registrationWatchdogMs ?? REGISTRATION_WATCHDOG_MS;
    let disposed = false;
    const relayAbort = new AbortController();
    const pendingSteps = new Set<string>();
    const registered: Array<{ label: string; run: () => Promise<void> }> = [];
    const discardRegistration = (registration: { dispose: () => unknown }): void => {
      void Promise.resolve()
        .then(() => registration.dispose())
        .catch((e) => logger.debug("[tawassul] v2 late registration dispose failed:", e));
    };
    const trackRegistration = (label: string) => (registration: { dispose: () => unknown } | undefined): void => {
      if (!registration) return;
      if (disposed) {
        discardRegistration(registration);
        return;
      }
      registered.push({
        label,
        run: async () => {
          await registration.dispose();
        },
      });
    };
    const trackRegistrationList = (label: string) => (registrations: Array<{ dispose: () => unknown }>): void => {
      for (const registration of registrations) trackRegistration(label)(registration);
    };
    const markStep = async <T>(
      label: string,
      work: Promise<T>,
      onLate: (value: T) => void,
      critical = false,
    ): Promise<T | undefined> => {
      const startedAt = Date.now();
      pendingSteps.add(label);
      logger.info(`[tawassul] v2 setup step ${label} start`);
      work.catch(() => undefined);
      const settled = work.then(
        (value) => ({ ok: true as const, value }),
        (e) => {
          logger.warn(`[tawassul] v2 setup step ${label} failed:`, e);
          return { ok: false as const };
        },
      );
      let timer: ReturnType<typeof setTimeout> | null = null;
      const parked = new Promise<typeof SETUP_STEP_PARKED>((resolve) => {
        timer = setTimeout(() => resolve(SETUP_STEP_PARKED), optionalTimeoutMs);
        timer.unref?.();
      });
      try {
        const winner = await Promise.race([settled, parked]);
        if (winner === SETUP_STEP_PARKED) {
          const message = `[tawassul] v2 setup step ${label} abandoned after ${Date.now() - startedAt}ms`;
          if (critical) logger.error(`${message}; ask confirmations are unavailable for this session`);
          else logger.warn(message);
          void work.then(onLate, () => undefined);
          return undefined;
        }
        if (!winner.ok) return undefined;
        logger.info(`[tawassul] v2 setup step ${label} done in ${Date.now() - startedAt}ms`);
        onLate(winner.value);
        return winner.value;
      } finally {
        pendingSteps.delete(label);
        if (timer) clearTimeout(timer);
      }
    };
    let cleanupSteps = 0;
    let cleanupAbandoned = 0;
    let cleanupFailed = 0;
    let cleanupMaxMs = 0;
    const boundCleanupStep = async (label: string, run: () => Promise<unknown>): Promise<void> => {
      const startedAt = performance.now();
      cleanupSteps += 1;
      let work: Promise<unknown>;
      try {
        work = Promise.resolve(run());
      } catch (e) {
        cleanupFailed += 1;
        logger.debug(`[tawassul] v2 cleanup step ${label} failed:`, e);
        return;
      }
      work.catch(() => undefined);
      let timer: ReturnType<typeof setTimeout> | null = null;
      let workFailed = false;
      const parked = new Promise<typeof SETUP_STEP_PARKED>((resolve) => {
        timer = setTimeout(() => resolve(SETUP_STEP_PARKED), teardownTimeoutMs);
        timer.unref?.();
      });
      try {
        const outcome = await Promise.race([
          work.then(
            () => "done" as const,
            (e) => {
              workFailed = true;
              logger.debug(`[tawassul] v2 cleanup step ${label} failed:`, e);
              return "done" as const;
            },
          ),
          parked,
        ]);
        const elapsed = performance.now() - startedAt;
        cleanupMaxMs = Math.max(cleanupMaxMs, elapsed);
        if (outcome === SETUP_STEP_PARKED) {
          cleanupAbandoned += 1;
          logger.warn(`[tawassul] v2 cleanup step ${label} abandoned after ${elapsed.toFixed(1)}ms`);
        } else if (workFailed) {
          cleanupFailed += 1;
          logger.debug(`[tawassul] v2 cleanup step ${label} failed in ${elapsed.toFixed(1)}ms`);
        } else if (elapsed > 100) {
          logger.info(`[tawassul] v2 cleanup step ${label} ${genTag(generation)} ms=${elapsed.toFixed(1)}`);
        } else {
          logger.debug(`[tawassul] v2 cleanup step ${label} done in ${elapsed.toFixed(1)}ms`);
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    const sessionBridge = installSessionBridge(ctx);
    const usageLedger = installUsageLedger({
      getSession: (sessionID) => ctx.session.get({ sessionID }),
      listSessions: (input) => ctx.session.list(input),
    });
    const usageShadow = installUsageShadow({
      emit: (observation) => {
        usageLedger.recordShadow(observation);
      },
    });
    const processedMessages = new Set<string>();
    const callTools = new Map<string, string>();
    const rememberCallTool = (id: string, tool: string): void => {
      callTools.set(id, tool);
      if (callTools.size > 500) {
        const oldest = callTools.keys().next().value;
        if (oldest !== undefined) callTools.delete(oldest);
      }
    };
    const readyProbe = getInitReady(plugin);
    const hostGoalMirror = installHostGoalMirror(ctx);
    if (hostGoalMirror) {
      registered.push({ label: "host goal mirror", run: async () => uninstallHostGoalMirror(hostGoalMirror) });
    }
    const askRegistration = await markStep("ask", registerAskPermission(ctx), trackRegistration("ask permission"), true);
    const pilotRegistrations =
      (await markStep("skills", registerPilotSkills(ctx), trackRegistrationList("pilot skills"))) ?? [];
    await markStep("command", registerPilotCommand(ctx), trackRegistration("pilot command"));
    const askEnabled = askRegistration !== undefined;
    const askFactory = (context: V2ToolContext) => createAskBridge(ctx, context, askEnabled);

    let schemas: Map<string, Record<string, unknown>> = new Map();
    let registeredSchemaFingerprint = "";
    let registeredNameSetHash = "";
    let initialSchemasCollected = false;
    const refreshSchemas = async (reason: "initial" | "late-init" | "refresh"): Promise<boolean> => {
      const startedAt = performance.now();
      const nameSetHash = toolNameSetHash(Object.keys(wrapped));
      if (
        initialSchemasCollected &&
        registeredNameSetHash !== "" &&
        registeredSchemaFingerprint !== "" &&
        nameSetHash === registeredNameSetHash
      ) {
        return false;
      }
      try {
        schemas = await (deps.collectSchemas ?? collectToolSchemas)(wrapped);
      } catch (e) {
        logger.error("[tawassul] v2 schema collection failed:", e);
        logger.info(
          `[tawassul] v2 schema ${genTag(generation)} reason=${reason} outcome=failed ms=${(performance.now() - startedAt).toFixed(1)}`,
        );
        return false;
      }
      initialSchemasCollected = true;
      registeredNameSetHash = nameSetHash;
      const elapsed = (performance.now() - startedAt).toFixed(1);
      const changed = schemaFingerprint(schemas) !== registeredSchemaFingerprint;
      logger.info(
        `[tawassul] v2 schema ${genTag(generation)} reason=${reason} ms=${elapsed} tools=${schemas.size} changed=${changed}`,
      );
      if (changed) {
        const { bytes, estimatedTokens } = measureSchemaPayload(schemas);
        logger.info(
          `[tawassul] v2 tool schema payload: ${bytes} bytes (~${estimatedTokens} tokens) across ${schemas.size} tools`,
        );
      }
      return changed;
    };

    if (readyProbe) {
      const initialWaitMs = deps.refresh?.initialWaitMs ?? INITIAL_SCHEMA_WAIT_MS;
      const initial = await Promise.race([
        readyProbe(),
        new Promise<{ ready: boolean }>((resolve) => {
          const timer = setTimeout(() => resolve({ ready: false }), initialWaitMs);
          if (timer.unref) timer.unref();
        }),
      ]);
      if (initial.ready) await refreshSchemas("initial");
      else logger.info(`[tawassul] v2 schema ${genTag(generation)} reason=skipped detail=init-not-ready tools=0`);
    }

    let addedToolCount = 0;
    let registrationFailed = false;
    pendingSteps.add("tool-registration");
    const registrationWatchdog = setTimeout(() => {
      logger.warn(
        `[tawassul] v2 setup step tool-registration still pending after ${registrationWatchdogMs}ms; pending=${[...pendingSteps].join(",") || "none"}`,
      );
    }, registrationWatchdogMs);
    registrationWatchdog.unref?.();
    try {
      const nameSetHash = toolNameSetHash(Object.keys(wrapped));
      const toolRegistration = await ctx.tool.transform((editor) => {
        let count = 0;
        for (const [name, def] of Object.entries(wrapped)) {
          editor.add(makeV2Tool(ctx, name, def, schemas.get(name), askFactory));
          count += 1;
        }
        addedToolCount = count;
        logger.info(`[tawassul] v2 registered ${count} tools name-set ${nameSetHash}`);
      });
      registered.push({ label: "tool registration", run: async () => toolRegistration.dispose() });
      registeredSchemaFingerprint = schemaFingerprint(schemas);
    } catch (e) {
      registrationFailed = true;
      logger.error("[tawassul] v2 tool registration failed:", e);
    } finally {
      clearTimeout(registrationWatchdog);
      pendingSteps.delete("tool-registration");
    }

    try {
      const startedAt = performance.now();
      await usageLedger.start();
      const elapsed = performance.now() - startedAt;
      if (elapsed > 20) {
        logger.info(`[tawassul] v2 await usage-ledger ${genTag(generation)} ms=${elapsed.toFixed(1)}`);
      }
    } catch (e) {
      logger.warn("[tawassul] usage ledger start skipped (fail-open):", e instanceof Error ? e.message : String(e));
    }
    try {
      const startedAt = performance.now();
      await warmWorkspace({
        worktree: input.directory,
        readMessages: async (sessionID) => sessionBridge.context({ sessionID }),
      });
      const elapsed = performance.now() - startedAt;
      if (elapsed > 20) {
        logger.info(`[tawassul] v2 await warm-workspace ${genTag(generation)} ms=${elapsed.toFixed(1)}`);
      }
    } catch (e) {
      logger.warn("[tawassul] v2 context pack warm-up skipped:", e instanceof Error ? e.message : String(e));
    }

    const healthLine = `[tawassul] v2 health: tools=${addedToolCount} schemas=${schemas.size} ask=${askEnabled} skills=${pilotRegistrations.length}`;
    if (registrationFailed || addedToolCount === 0) {
      const reason = registrationFailed ? "tool registration failed" : "no tools registered";
      logger.error(`${healthLine} reason=${reason}`);
    } else {
      logger.info(healthLine);
    }

    let refreshStop: (() => Promise<void>) | null = null;
    if (readyProbe) {
      const refresh = startSchemaRefresh({
        probe: readyProbe,
        refresh: () => refreshSchemas(initialSchemasCollected ? "refresh" : "late-init"),
        reload: async () => {
          await ctx.tool.reload();
          registeredSchemaFingerprint = schemaFingerprint(schemas);
        },
        describe: () => `${schemas.size} schemas`,
        attempts: deps.refresh?.attempts ?? SCHEMA_RETRY_ATTEMPTS,
        delayMs: deps.refresh?.delayMs ?? SCHEMA_RETRY_DELAY_MS,
      });
      refreshStop = async () => {
        refresh.stopProbe();
        await refresh.stop();
      };
    }

    if (plugin["tool.execute.before"]) {
      try {
        const beforeRegistration = await ctx.tool.hook("execute.before", (rawInput) => {
          const spec = rawInput as {
            tool: string;
            sessionID: string;
            agent: string;
            id: string;
            input: unknown;
          };
          rememberCallTool(spec.id, spec.tool);
          const v1Input = {
            tool: toolNameToV1(spec.tool),
            agent: spec.agent,
            sessionID: spec.sessionID,
            callID: spec.id,
          };
          const v1Output: { args: Record<string, unknown>; error?: string } = {
            args: isTaskTool(spec.tool) ? subagentArgsToV1(spec.input) : cloneArgs(spec.input),
          };
          const bridge = plugin["tool.execute.before"];
          if (!bridge) return;
          return (async () => {
            if (isBlockedForAgent(spec.agent, spec.tool)) {
              throw new ToolBlockedError(
                `[tawassul] ${spec.tool} is denied for agent ${spec.agent}`,
              );
            }
            try {
              await bridge(v1Input, v1Output);
            } catch (e) {
              if (isBlockError(e)) throw e;
              reportSafetyHookFailure("execute.before", spec.tool, e);
            }
            const blocked = typeof v1Output.error === "string" ? v1Output.error.trim() : "";
            if (blocked) throw new ToolBlockedError(blocked);
            if (v1Output.args && typeof v1Output.args === "object") {
              spec.input = isTaskTool(spec.tool) ? v1ArgsToSubagent(v1Output.args) : cloneArgs(v1Output.args);
            }
          })();
        });
        registered.push({ label: "execute.before", run: async () => beforeRegistration.dispose() });
      } catch (e) {
        logger.error("[tawassul] v2 execute.before registration failed:", e);
      }
    }

    if (plugin["tool.execute.after"]) {
      try {
        const afterRegistration = await ctx.tool.hook("execute.after", (rawInput) => {
          const spec = rawInput as unknown as V2ToolHookInput;
          const v1Input = {
            tool: toolNameToV1(spec.tool),
            agent: spec.agent,
            sessionID: spec.sessionID,
            callID: spec.id,
            args: cloneArgs(spec.input),
          };
          const bridge = plugin["tool.execute.after"];
          if (!bridge) return;
          const completed = spec.status === "completed" ? spec.result : undefined;
          const originalText = resultText(completed);
          const originalMetadata = spec.status === "completed" ? completed?.metadata : spec.error?.metadata;
          const hasStatus = Object.prototype.hasOwnProperty.call(originalMetadata ?? {}, "status");
          const syntheticStatus = !hasStatus;
          const rawChildSessionID = originalMetadata?.sessionID;
          const childSessionID = typeof rawChildSessionID === "string" ? rawChildSessionID : undefined;
          const preserveTaskStatus = v1Input.tool === "task" && (hasStatus || childSessionID !== undefined);
          const v1Output =
            spec.status === "error"
              ? {
                  title: titleFromMetadata(originalMetadata),
                  output: spec.error?.message ?? "tool failed",
                  metadata: {
                    ...(originalMetadata ?? {}),
                    status: "error",
                    error: spec.error?.message ?? "tool failed",
                  } as Record<string, unknown>,
                }
              : {
                  title: titleFromMetadata(originalMetadata),
                  output: originalText,
                  metadata: preserveTaskStatus
                    ? ({ ...(originalMetadata ?? {}) } as Record<string, unknown>)
                    : ({ ...(originalMetadata ?? {}), status: "completed" } as Record<string, unknown>),
                };
          return bridge(v1Input, v1Output)
            .then(() => {
              if (spec.status === "error") {
                if (!spec.error) return;
                const nextMetadata = jsonSafeMetadata(withTitleMetadata(spec.error.metadata, v1Output.title));
                if (metadataChanged(spec.error.metadata, nextMetadata)) spec.error.metadata = nextMetadata;
                return;
              }
              if (!spec.result) return;
              try {
                applyV1AfterOutput(spec.result, originalText, originalMetadata, v1Output, syntheticStatus);
              } catch (e) {
                logger.warn(`[tawassul] v2 execute.after write-back (${spec.tool}) failed:`, e);
              }
            })
            .catch((e) => {
              logger.warn(`[tawassul] v2 execute.after (${spec.tool}) failed:`, e);
            });
        });
        registered.push({ label: "execute.after", run: async () => afterRegistration.dispose() });
      } catch (e) {
        logger.error("[tawassul] v2 execute.after registration failed:", e);
      }
    }

    try {
      const contextRegistration = await ctx.session.hook("context", async (event) => {
        const sessionEvent = event as unknown as V2SessionEvent;
        if (plugin["chat.message"]) {
          await runChatMessageBridge(plugin, sessionEvent, processedMessages);
        }
        handleContextEvent(sessionEvent);
      });
      registered.push({ label: "session context", run: async () => contextRegistration.dispose() });
    } catch (e) {
      logger.error("[tawassul] v2 session.context registration failed:", e);
    }

    try {
      const idleRegistration = await ctx.session.hook("experimental.idle", (event) => {
        noteExperimentalIdle(event as unknown as { sessionID?: unknown; background?: unknown });
      });
      registered.push({ label: "session idle", run: async () => idleRegistration.dispose() });
    } catch (e) {
      logger.error("[tawassul] v2 session.experimental.idle registration failed:", e);
    }

    installBackgroundControl({
      cancelSubagent: async (childSessionID) => {
        await ctx.session.interrupt({ sessionID: childSessionID });
      },
      reviveSubagent: async (childSessionID, text) => {
        await ctx.session.prompt({ sessionID: childSessionID, text, resume: true });
      },
    });
    registered.push({ label: "background control", run: async () => uninstallBackgroundControl() });

    try {
      const retryRegistration = await ctx.session.hook("retry", async (event) => {
        await runRetryFailover(event as RetryFailoverPayload, {
          switchModel: ctx.session.switchModel,
          fallback: readActiveConfig(input.directory)?.fallback,
        });
      });
      registered.push({ label: "session retry", run: async () => retryRegistration.dispose() });
    } catch (e) {
      logger.error("[tawassul] v2 session.retry registration failed:", e);
    }

    if (plugin["experimental.session.compacting"]) {
      try {
        const compactionRegistration = await ctx.session.hook("compaction", async (event) => {
          await runCompactionBridge(plugin, event as unknown as V2SessionEvent);
        });
        registered.push({ label: "session compaction", run: async () => compactionRegistration.dispose() });
      } catch (e) {
        logger.error("[tawassul] v2 session.compaction registration failed:", e);
      }
    }

    let relayTask: Promise<void> | null = null;
    let relayIterator: AsyncIterator<unknown> | null = null;
    if (typeof ctx.event?.subscribe === "function") {
      let stream: AsyncIterable<unknown>;
      try {
        stream = ctx.event.subscribe({ signal: relayAbort.signal }) as AsyncIterable<unknown>;
      } catch (e) {
        logger.debug("[tawassul] v2 event subscribe rejected the stop signal; retrying without options:", e);
        stream = ctx.event.subscribe() as AsyncIterable<unknown>;
      }
      relayTask = (async () => {
        try {
          const iterator = stream[Symbol.asyncIterator]();
          relayIterator = iterator;
          for (;;) {
            const next = await iterator.next();
            if (disposed) return;
            if (next.done) return;
            const raw = next.value;
            try {
              noteDispatchLifecycleEvent(raw);
            } catch (e) {
              logger.debug("[tawassul] v2 dispatch lifecycle skipped:", e);
            }
            try {
              await handlePackEvent(raw, input.directory, sessionBridge);
            } catch (e) {
              logger.debug("[tawassul] v2 context pack event failed:", e);
            }
            try {
              await usageLedger.handleEvent(raw);
              usageShadow.handleEvent(raw);
            } catch (e) {
              logger.debug("[tawassul] usage ledger event skipped:", e);
            }
            if (!plugin.event) continue;
            const mapped = mapV2EventToV1(raw, { toolOf: (id) => callTools.get(id) });
            for (const ev of mapped) {
              try {
                if (plugin.event) await plugin.event({ event: ev });
              } catch (e) {
                logger.debug("[tawassul] v2 event bridge failed:", e);
              }
            }
          }
        } catch (e) {
          if (!disposed) logger.error("[tawassul] v2 event stream failed:", e);
        }
      })();
    }

    if (plugin.config) {
      logger.info(
        "[tawassul] v2: config hook has no host channel; models are baked at config generation and the tawa deny list is enforced in execute.before",
      );
    }

    let cleanupCompletion: Promise<void> | null = null;
    const runCleanup = async (): Promise<void> => {
      const cleanupStartedAt = performance.now();
      const cleanupCpu = process.cpuUsage();
      logger.info(`[tawassul] v2 cleanup ${genTag(generation)} start`);
      disposed = true;
      relayAbort.abort();
      await boundCleanupStep("refresh stop", async () => {
        if (refreshStop) await refreshStop();
      });
      await boundCleanupStep("event relay", async () => {
        if (relayIterator?.return) {
          try {
            await relayIterator.return();
          } catch (e) {
            logger.debug("[tawassul] v2 event relay return failed:", e);
          }
        }
        if (relayTask) await relayTask;
      });
      for (const entry of registered) {
        await boundCleanupStep(entry.label, entry.run);
      }
      await boundCleanupStep("plugin dispose", async () => {
        if (plugin.dispose) await plugin.dispose();
      });
      await boundCleanupStep("bridge clear", async () => clearSessionBridge(sessionBridge));
      await boundCleanupStep("shadow clear", async () => clearUsageShadow(usageShadow));
      await boundCleanupStep("ledger clear", async () => clearUsageLedger(usageLedger));
      logger.info(
        `[tawassul] v2 cleanup ${genTag(generation)} steps=${cleanupSteps} done=${cleanupSteps - cleanupAbandoned - cleanupFailed} abandoned=${cleanupAbandoned} failed=${cleanupFailed} maxMs=${cleanupMaxMs.toFixed(1)} ms=${(performance.now() - cleanupStartedAt).toFixed(1)} cpuMs=${cpuMs(cleanupCpu)}`,
      );
    };

    logger.info(
      `[tawassul] v2 setup ${genTag(generation)} ready ms=${(performance.now() - setupStartedAt).toFixed(1)} cpuMs=${cpuMs(setupCpu)} tools=${addedToolCount}`,
    );
    return () => {
      if (!cleanupCompletion) cleanupCompletion = runCleanup();
      return cleanupCompletion;
    };
  };
}