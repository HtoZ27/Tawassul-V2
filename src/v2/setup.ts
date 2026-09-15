import type { TawassulHooks } from "../plugin-types.ts";
import { initPlugin } from "../bootstrap/plugin-init.ts";
import { logger } from "../utils/logger.ts";
import { collectToolSchemas, makeV2Tool } from "./adapters.ts";
import { buildPluginInput } from "./client-shim.ts";
import { isTaskTool, subagentArgsToV1, toolNameToV1, v1ArgsToSubagent } from "./delegation.ts";
import { mapV2EventToV1 } from "./event-adapter.ts";
import type { V2Context, V2SessionEvent } from "./types.ts";

const MAX_PROCESSED_MESSAGES = 1024;

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

async function runChatMessageBridge(
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
  const messageID = last["id"];
  if (typeof messageID !== "string" || !messageID) return;

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
  const v1Output = {
    message: { role: role as string },
    parts: [] as Array<{ type: string; text?: string; [key: string]: unknown }>,
  };
  try {
    await hook(v1Input, v1Output);
  } catch (e) {
    logger.warn(`[tawassul] v2 chat.message bridge failed for ${sessionID}:`, e instanceof Error ? e.stack : e);
    return;
  }
  const content = last["content"];
  if (!Array.isArray(content)) return;
  for (const part of v1Output.parts) {
    if (part && typeof part === "object" && part["type"] === "text" && typeof part["text"] === "string") {
      content.push({ type: "text", text: part["text"] });
    }
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

export function createV2Setup() {
  return async (rawCtx: unknown): Promise<() => Promise<void>> => {
    const ctx = rawCtx as V2Context;
    if (!ctx || !ctx.session || !ctx.tool) {
      logger.error("[tawassul] v2 setup aborted: host missing required domains (session/tool)");
      return async () => undefined;
    }

    const input = buildPluginInput(ctx);
    const plugin = initPlugin(input);
    const wrapped = plugin.tool ?? {};
    const registered: Array<() => Promise<void>> = [];
    const processedMessages = new Set<string>();

    let schemas: Map<string, Record<string, unknown>> = new Map();
    try {
      schemas = await collectToolSchemas(wrapped);
    } catch (e) {
      logger.error("[tawassul] v2 schema collection failed:", e);
    }

    try {
      const toolRegistration = await ctx.tool.transform((editor) => {
        let count = 0;
        for (const [name, def] of Object.entries(wrapped)) {
          editor.add(makeV2Tool(ctx, name, def, schemas.get(name)));
          count += 1;
        }
        logger.info(`[tawassul] v2 registered ${count} tools`);
      });
      registered.push(() => toolRegistration.dispose());
    } catch (e) {
      logger.error("[tawassul] v2 tool registration failed:", e);
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
          const v1Input = {
            tool: toolNameToV1(spec.tool),
            agent: spec.agent,
            sessionID: spec.sessionID,
            callID: spec.id,
          };
          const v1Output = {
            args: isTaskTool(spec.tool) ? subagentArgsToV1(spec.input) : cloneArgs(spec.input),
          };
          const bridge = plugin["tool.execute.before"];
          if (!bridge) return;
          return (async () => {
            try {
              await bridge(v1Input, v1Output);
            } catch (e) {
              logger.warn(`[tawassul] v2 execute.before (${spec.tool}) failed:`, e);
            }
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
          const spec = rawInput as {
            tool: string;
            sessionID: string;
            agent: string;
            id: string;
            input: unknown;
          };
          const v1Input = {
            tool: toolNameToV1(spec.tool),
            agent: spec.agent,
            sessionID: spec.sessionID,
            callID: spec.id,
            args: cloneArgs(spec.input),
          };
          const v1Output = {
            title: "",
            output: "",
            metadata: {},
          };
          const bridge = plugin["tool.execute.after"];
          if (!bridge) return;
          return bridge(v1Input, v1Output).catch((e) => {
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
          await runChatMessageBridge(plugin, event, processedMessages);
        });
        registered.push(() => contextRegistration.dispose());
      } catch (e) {
        logger.error("[tawassul] v2 session.context registration failed:", e);
      }
    }

    if (plugin["experimental.session.compacting"]) {
      try {
        const compactionRegistration = await ctx.session.hook("compaction", async (event) => {
          await runCompactionBridge(plugin, event);
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
            const mapped = mapV2EventToV1(raw);
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
      logger.debug("[tawassul] v2: config hook not bridged (no config channel on the v2 host)");
    }

    return async () => {
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