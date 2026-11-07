
import type { z as Zod } from "zod";

const schemaCache = new WeakMap<object, unknown>();


export function isPlainJsonSchema(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}


export async function buildToolJsonSchema(argsShape: Zod.ZodRawShape): Promise<Record<string, unknown> | undefined> {
  const cached = schemaCache.get(argsShape);
  if (isPlainJsonSchema(cached)) return cached;
  try {
    const { z } = await import("zod");
    const schema = z.toJSONSchema(z.object(argsShape), {
      target: "draft-2020-12",
      io: "input",
    });
    if (!isPlainJsonSchema(schema)) return undefined;
    delete schema.$schema;
    schemaCache.set(argsShape, schema);
    return schema;
  } catch {
    return undefined;
  }
}


export function isValidMessageId(id: unknown): id is string {
  return typeof id === "string" && /^msg/.test(id);
}
