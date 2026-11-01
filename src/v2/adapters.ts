import { createHash } from "node:crypto";
import { z, type z as Zod } from "zod";
import type { ToolContext, ToolDefinition } from "../tool.ts";
import { buildToolJsonSchema } from "../lib/tool-schema-injection.ts";
import { logger } from "../utils/logger.ts";
import { resolveV2Directory } from "./client-shim.ts";
import { jsonSafeMetadata, withTitleMetadata } from "./result-bridge.ts";
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

function stableSchemaJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSchemaJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSchemaJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function schemaFingerprint(schemas: Map<string, Record<string, unknown>>): string {
  const hash = createHash("sha256");
  for (const name of [...schemas.keys()].sort()) {
    hash.update(name);
    hash.update("\u0000");
    hash.update(stableSchemaJson(schemas.get(name)));
    hash.update("\u0000");
  }
  return hash.digest("hex");
}

export function measureSchemaPayload(schemas: Map<string, Record<string, unknown>>): { bytes: number; estimatedTokens: number } {
  let bytes = 0;
  for (const schema of schemas.values()) {
    bytes += Buffer.byteLength(JSON.stringify(schema), "utf8");
  }
  return { bytes, estimatedTokens: Math.ceil(bytes / 4) };
}

export type DescriptionTextMeasurement = {
  bytes: number;
  estimatedTokens: number;
  lines: Array<{ name: string; bytes: number; estimatedTokens: number }>;
};

export function measureDescriptionText(
  tools: Record<string, { description?: string }>,
): DescriptionTextMeasurement {
  const lines = Object.keys(tools)
    .sort()
    .map((name) => {
      const bytes = Buffer.byteLength(tools[name]?.description ?? "", "utf8");
      return { name, bytes, estimatedTokens: Math.ceil(bytes / 4) };
    });
  const bytes = lines.reduce((sum, line) => sum + line.bytes, 0);
  return { bytes, estimatedTokens: Math.ceil(bytes / 4), lines };
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
    const rec = result as { output?: unknown; title?: unknown; metadata?: Record<string, unknown> };
    const text = typeof rec.output === "string"
      ? rec.output
      : rec.output === undefined
        ? ""
        : typeof rec.output === "object"
          ? JSON.stringify(rec.output)
          : String(rec.output);
    const metadata = jsonSafeMetadata(
      withTitleMetadata(
        rec.metadata && typeof rec.metadata === "object" ? rec.metadata : undefined,
        typeof rec.title === "string" ? rec.title : "",
      ),
    );
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

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "<root>"}: ${issue.message}`)
    .join("; ");
}

export function makeV2Tool(
  ctx: V2Context,
  name: string,
  def: ToolDefinition,
  schema: Record<string, unknown> | undefined,
  askFactory?: AskFactory,
): V2ToolDefinition {
  const shape = (def.args ?? {}) as Zod.ZodRawShape;
  const validator = Object.keys(shape).length > 0 ? z.object(shape) : null;
  return {
    name,
    description: def.description,
    input: schema && Object.keys(schema).length > 0 ? schema : EMPTY_INPUT_SCHEMA,
    options: { codemode: false },
    execute: async (args: Record<string, unknown>, context: V2ToolContext): Promise<unknown> => {
      const v1Context = buildV1ToolContext(ctx, context, askFactory);
      if (validator) {
        const parsed = validator.safeParse(args ?? {});
        if (!parsed.success) {
          throw new Error(`Invalid input for tool "${name}": ${formatIssues(parsed.error)}`);
        }
        return toV2Result(await def.execute(parsed.data as Record<string, unknown>, v1Context));
      }
      return toV2Result(await def.execute(args, v1Context));
    },
  };
}