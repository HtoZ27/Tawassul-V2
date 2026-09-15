import type { z as Zod } from "zod";
import type { ToolContext, ToolDefinition } from "../tool.ts";
import { buildToolJsonSchema } from "../lib/tool-schema-injection.ts";
import { logger } from "../utils/logger.ts";
import { resolveV2Directory } from "./client-shim.ts";
import type { V2Context, V2ToolContext, V2ToolDefinition } from "./types.ts";

const EMPTY_INPUT_SCHEMA = { type: "object", properties: {} };

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

function buildV1ToolContext(ctx: V2Context, context: V2ToolContext): ToolContext {
  const directory = resolveV2Directory(ctx);
  return {
    sessionID: context.sessionID,
    messageID: context.messageID,
    agent: context.agent,
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: (meta) => context.progress(meta),
    ask: undefined,
  };
}

function toV2Result(result: unknown): unknown {
  if (typeof result === "string") {
    return { content: [{ type: "text", text: result }] };
  }
  if (result && typeof result === "object") {
    const rec = result as { output?: unknown; title?: string; metadata?: Record<string, unknown> };
    if (typeof rec.output === "string") {
      return { output: rec.output, metadata: rec.metadata, content: [{ type: "text", text: rec.output }] };
    }
    if (rec.output !== undefined) {
      return { output: rec.output, metadata: rec.metadata };
    }
  }
  return { content: [{ type: "text", text: String(result) }] };
}

export function makeV2Tool(
  ctx: V2Context,
  name: string,
  def: ToolDefinition,
  schema: Record<string, unknown> | undefined,
): V2ToolDefinition {
  return {
    name,
    description: def.description,
    input: schema && Object.keys(schema).length > 0 ? schema : EMPTY_INPUT_SCHEMA,
    options: { codemode: false },
    execute: async (args: Record<string, unknown>, context: V2ToolContext): Promise<unknown> => {
      const v1Context = buildV1ToolContext(ctx, context);
      const result = await def.execute(args, v1Context);
      return toV2Result(result);
    },
  };
}