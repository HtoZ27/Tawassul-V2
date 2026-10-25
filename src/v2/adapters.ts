import type { z as Zod } from "zod";
import type { ToolContext, ToolDefinition } from "../tool.ts";
import { buildToolJsonSchema } from "../lib/tool-schema-injection.ts";
import { logger } from "../utils/logger.ts";
import { resolveV2Directory } from "./client-shim.ts";
import type { V2Context, V2ToolContext, V2ToolDefinition } from "./types.ts";

const EMPTY_INPUT_SCHEMA = { type: "object", properties: {}, additionalProperties: true };

export async function collectToolSchemas(
  tools: Record<string, ToolDefinition>,
): Promise<Map<string, Record<string, unknown>>> {
  const schemas = new Map<string, Record<string, unknown>>();
  await Promise.all(
    Object.entries(tools).map(async ([name, def]) => {
      try {
        const shape = (def.args ?? {}) as Zod.ZodRawShape;
        const schema = await buildToolJsonSchema(shape);
        if (schema && Object.keys(schema).length > 0) schemas.set(name, schema);
      } catch (e) {
        logger.warn(`[tawassul] v2 schema generation failed for ${name}:`, e);
      }
    }),
  );
  return schemas;
}

function buildV1ToolContext(
  ctx: V2Context,
  context: V2ToolContext,
  askFactory: AskFactory | undefined,
): ToolContext {
  const directory = resolveV2Directory(ctx);
  return {
    sessionID: context.sessionID,
    messageID: context.messageID,
    agent: context.agent,
    directory,
    worktree: directory,
    abort: context.signal ?? new AbortController().signal,
    metadata: (meta) => {
      const update = meta as { metadata?: Record<string, unknown> } | undefined;
      const payload = update?.metadata ?? (update as Record<string, unknown> | undefined) ?? {};
      return context.progress(payload as Record<string, unknown>);
    },
    ask: askFactory ? askFactory(context) : undefined,
  };
}

export function toV2Result(result: unknown): unknown {
  if (typeof result === "string") {
    return { content: [{ type: "text", text: result }] };
  }
  if (result && typeof result === "object") {
    const rec = result as { output?: unknown; metadata?: Record<string, unknown> };
    const text = typeof rec.output === "string"
      ? rec.output
      : rec.output === undefined
        ? ""
        : typeof rec.output === "object"
          ? JSON.stringify(rec.output)
          : String(rec.output);
    const metadata = rec.metadata && typeof rec.metadata === "object" ? rec.metadata : undefined;
    if (text.length > 0) {
      return metadata
        ? { content: [{ type: "text", text }], metadata }
        : { content: [{ type: "text", text }] };
    }
    return metadata ? { content: [], metadata } : { content: [] };
  }
  return { content: [{ type: "text", text: String(result) }] };
}

export type AskFactory = (context: V2ToolContext) => ToolContext["ask"];

export function makeV2Tool(
  ctx: V2Context,
  name: string,
  def: ToolDefinition,
  schema: Record<string, unknown> | undefined,
  askFactory?: AskFactory,
): V2ToolDefinition {
  return {
    name,
    description: def.description,
    input: schema && Object.keys(schema).length > 0 ? schema : EMPTY_INPUT_SCHEMA,
    options: { codemode: false },
    execute: async (args: Record<string, unknown>, context: V2ToolContext): Promise<unknown> => {
      const v1Context = buildV1ToolContext(ctx, context, askFactory);
      const result = await def.execute(args, v1Context);
      return toV2Result(result);
    },
  };
}