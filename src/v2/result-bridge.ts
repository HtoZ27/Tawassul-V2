import type { V2ResultPart, V2ToolResult } from "./types.ts";

export type V1AfterOutput = {
  title: string;
  output: string;
  metadata: Record<string, unknown>;
};

export const V1_TITLE_KEY = "tawassul.title";

export function jsonSafeValue(value: unknown, seen?: WeakSet<object>): unknown {
  if (value === null) return null;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return value;
  if (kind === "number") return Number.isFinite(value as number) ? value : null;
  if (kind === "bigint") return (value as bigint).toString();
  if (kind === "undefined" || kind === "function" || kind === "symbol") return undefined;
  if (kind !== "object") return undefined;
  const object = value as object;
  if (object instanceof Date) {
    return Number.isNaN(object.getTime()) ? null : object.toISOString();
  }
  const visited = seen ?? new WeakSet<object>();
  if (visited.has(object)) return undefined;
  visited.add(object);
  let next: unknown;
  try {
    if (Array.isArray(object)) {
      next = object.map((item) => {
        const safe = jsonSafeValue(item, visited);
        return safe === undefined ? null : safe;
      });
    } else {
      const record = object as Record<string, unknown>;
      const safe: Record<string, unknown> = {};
      for (const key of Object.keys(record)) {
        let raw: unknown;
        try {
          raw = record[key];
        } catch {
          continue;
        }
        const item = jsonSafeValue(raw, visited);
        if (item !== undefined) safe[key] = item;
      }
      next = safe;
    }
  } catch {
    visited.delete(object);
    return undefined;
  }
  visited.delete(object);
  return next;
}

export function jsonSafeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const safe = jsonSafeValue(metadata) as Record<string, unknown>;
  return Object.keys(safe).length > 0 ? safe : undefined;
}

export function titleFromMetadata(metadata: Record<string, unknown> | undefined): string {
  const value = metadata?.[V1_TITLE_KEY];
  return typeof value === "string" ? value : "";
}

export function withTitleMetadata(
  metadata: Record<string, unknown> | undefined,
  title: string,
): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = { ...(metadata ?? {}) };
  if (title) next[V1_TITLE_KEY] = title;
  else delete next[V1_TITLE_KEY];
  return Object.keys(next).length > 0 ? next : undefined;
}

export function resultText(result: V2ToolResult | undefined): string {
  if (!result) return "";
  if (typeof result.content === "string") return result.content;
  if (Array.isArray(result.content)) {
    return result.content
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .filter((text) => text.length > 0)
      .join("\n");
  }
  if (typeof result.output === "string") return result.output;
  if (result.output !== undefined) {
    try {
      return JSON.stringify(result.output);
    } catch {
      return String(result.output);
    }
  }
  return "";
}

export function writeBackV1Output(result: V2ToolResult, originalText: string, nextText: string): void {
  if (typeof nextText !== "string" || nextText === originalText) return;
  const content = result.content;
  if (typeof content === "string") {
    result.content = nextText;
  } else if (Array.isArray(content)) {
    const parts = content as V2ResultPart[];
    let replaced = false;
    const nextParts: V2ResultPart[] = [];
    for (const part of parts) {
      if (part && part.type === "text") {
        if (!replaced) {
          nextParts.push({ ...part, text: nextText });
          replaced = true;
        } else {
          nextParts.push(part);
        }
        continue;
      }
      nextParts.push(part);
    }
    if (!replaced) nextParts.unshift({ type: "text", text: nextText });
    result.content = nextParts;
  } else {
    result.content = [{ type: "text", text: nextText }];
  }
  if (typeof result.output === "string") result.output = nextText;
}

export function metadataChanged(
  original: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): boolean {
  if (original === next) return false;
  if (!original || !next) return true;
  const originalKeys = Object.keys(original);
  const nextKeys = Object.keys(next);
  if (originalKeys.length !== nextKeys.length) return true;
  for (const key of originalKeys) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) return true;
    if (original[key] !== next[key]) return true;
  }
  return false;
}

export function applyV1AfterOutput(
  result: V2ToolResult,
  originalText: string,
  originalMetadata: Record<string, unknown> | undefined,
  v1Output: V1AfterOutput,
  syntheticStatus: boolean,
): void {
  writeBackV1Output(result, originalText, v1Output.output);
  if (syntheticStatus && v1Output.metadata) delete v1Output.metadata.status;
  const nextMetadata = jsonSafeMetadata(withTitleMetadata(v1Output.metadata, v1Output.title));
  if (nextMetadata && metadataChanged(originalMetadata, nextMetadata)) {
    result.metadata = nextMetadata;
  }
}
