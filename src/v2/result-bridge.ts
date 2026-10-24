import type { V2ResultPart, V2ToolResult } from "./types.ts";

export type V1AfterOutput = {
  title: string;
  output: string;
  metadata: Record<string, unknown>;
};

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
  if (v1Output.metadata && metadataChanged(originalMetadata, v1Output.metadata)) {
    result.metadata = v1Output.metadata;
  }
}
