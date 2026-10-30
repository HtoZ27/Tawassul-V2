import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginInput, TawassulHooks } from "../plugin-types.ts";
import { getInitReady, initPlugin } from "../bootstrap/plugin-init.ts";
import { detectInstallScope } from "../core/install-scope.ts";
import { ToolBlockedError } from "../hooks/tool-execute.ts";
import { isBlockedToolForTawa } from "../security-policy.ts";
import { logger } from "../utils/logger.ts";
import { collectToolSchemas, makeV2Tool, schemaFingerprint, measureSchemaPayload } from "./adapters.ts";
import { createAskBridge, registerAskPermission } from "./ask.ts";
import { buildPluginInput } from "./client-shim.ts";
import { isTaskTool, subagentArgsToV1, toolNameToV1, v1ArgsToSubagent } from "./delegation.ts";
import { mapV2EventToV1 } from "./event-adapter.ts";
import { startSchemaRefresh } from "./schema-refresh.ts";
import { installHostGoalMirror, uninstallHostGoalMirror } from "./host-goal.ts";
import { applyV1AfterOutput, jsonSafeMetadata, metadataChanged, resultText, titleFromMetadata, withTitleMetadata } from "./result-bridge.ts";
import type { V2Context, V2SessionEvent, V2ToolContext, V2ToolHookInput } from "./types.ts";

const MAX_PROCESSED_MESSAGES = 1024;
export const INITIAL_SCHEMA_WAIT_MS = 750;
export const SCHEMA_RETRY_ATTEMPTS = 6;
export const SCHEMA_RETRY_DELAY_MS = 500;

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
      : `synth_${createHash("sha1").update(`${sessionID}:${role}:${JSON.stringify(last["content"] ?? null)}`).digest("hex").slice(0, 16)}`;

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
  const added: Array<{ type: string; text: string }> = [];
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
      added.push({ type: "text", text: part.text });
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
  refresh?: { attempts?: number; delayMs?: number; initialWaitMs?: number };
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
    const capability = (value: unknown): number => (typeof value === "function" ? 1 : 0);
    logger.info(
      `[tawassul] host capabilities: session=1 tool=1 transform=${capability(ctx.tool.transform)} reload=${capability(ctx.tool.reload)} hook=${capability(ctx.tool.hook)} compacting=${capability(plugin["experimental.session.compacting"])}`,
    );
    const wrapped = plugin.tool ?? {};
    const registered: Array<() => Promise<void>> = [];
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
    if (hostGoalMirror) registered.push(async () => uninstallHostGoalMirror(hostGoalMirror));
    const askRegistration = await registerAskPermission(ctx);
    if (askRegistration) registered.push(() => askRegistration.dispose());
    const askEnabled = askRegistration !== undefined;
    const askFactory = (context: V2ToolContext) => createAskBridge(ctx, context, askEnabled);

    let schemas: Map<string, Record<string, unknown>> = new Map();
    let registeredSchemaFingerprint = "";
    const refreshSchemas = async (): Promise<boolean> => {
      try {
        schemas = await collectToolSchemas(wrapped);
      } catch (e) {
        logger.error("[tawassul] v2 schema collection failed:", e);
        return false;
      }
      const changed = schemaFingerprint(schemas) !== registeredSchemaFingerprint;
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
      if (initial.ready) await refreshSchemas();
    }

    try {
      const toolRegistration = await ctx.tool.transform((editor) => {
        let count = 0;
        for (const [name, def] of Object.entries(wrapped)) {
          editor.add(makeV2Tool(ctx, name, def, schemas.get(name), askFactory));
          count += 1;
        }
        logger.info(`[tawassul] v2 registered ${count} tools`);
      });
      registered.push(() => toolRegistration.dispose());
      registeredSchemaFingerprint = schemaFingerprint(schemas);
    } catch (e) {
      logger.error("[tawassul] v2 tool registration failed:", e);
    }

    let refreshStop: (() => Promise<void>) | null = null;
    if (readyProbe) {
      const refresh = startSchemaRefresh({
        probe: readyProbe,
        refresh: refreshSchemas,
        reload: async () => {
          await ctx.tool.reload();
          registeredSchemaFingerprint = schemaFingerprint(schemas);
        },
        describe: () => `${schemas.size} schemas`,
        attempts: deps.refresh?.attempts ?? SCHEMA_RETRY_ATTEMPTS,
        delayMs: deps.refresh?.delayMs ?? SCHEMA_RETRY_DELAY_MS,
      });
      refreshStop = refresh.stop;
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
        registered.push(() => beforeRegistration.dispose());
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
          const syntheticStatus = !Object.prototype.hasOwnProperty.call(originalMetadata ?? {}, "status");
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
                  metadata: { ...(originalMetadata ?? {}), status: "completed" } as Record<string, unknown>,
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
        registered.push(() => afterRegistration.dispose());
      } catch (e) {
        logger.error("[tawassul] v2 execute.after registration failed:", e);
      }
    }

    if (plugin["chat.message"]) {
      try {
        const contextRegistration = await ctx.session.hook("context", async (event) => {
          await runChatMessageBridge(plugin, event as unknown as V2SessionEvent, processedMessages);
        });
        registered.push(() => contextRegistration.dispose());
      } catch (e) {
        logger.error("[tawassul] v2 session.context registration failed:", e);
      }
    }

    if (plugin["experimental.session.compacting"]) {
      try {
        const compactionRegistration = await ctx.session.hook("compaction", async (event) => {
          await runCompactionBridge(plugin, event as unknown as V2SessionEvent);
        });
        registered.push(() => compactionRegistration.dispose());
      } catch (e) {
        logger.error("[tawassul] v2 session.compaction registration failed:", e);
      }
    }

    if (plugin.event) {
      let disposed = false;
      const relay = (async () => {
        try {
          const stream = ctx.event.subscribe();
          for await (const raw of stream) {
            if (disposed) return;
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
      registered.push(() => {
        disposed = true;
        return relay.catch(() => undefined);
      });
    }

    if (plugin.config) {
      logger.info(
        "[tawassul] v2: config hook has no host channel; models are baked at config generation and the tawa deny list is enforced in execute.before",
      );
    }

    return async () => {
      if (refreshStop) {
        try {
          await refreshStop();
        } catch (e) {
          logger.debug("[tawassul] v2 schema refresh stop failed:", e);
        }
      }
      for (const cleanup of registered) {
        try {
          await cleanup();
        } catch (e) {
          logger.debug("[tawassul] v2 cleanup step failed:", e);
        }
      }
      try {
        if (plugin.dispose) await plugin.dispose();
      } catch (e) {
        logger.debug("[tawassul] v2 plugin dispose failed:", e);
      }
    };
  };
}