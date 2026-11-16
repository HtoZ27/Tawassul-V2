import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../utils/logger.ts";
import { statePath } from "../utils/state-paths.ts";
import { truncateToolOutput } from "./context-compressor.ts";

export const DISPATCH_OUTPUT_CHARS = 8_000;

function safePart(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "unknown";
}

export function capDispatchOutput(input: {
  text: string;
  sessionID: string;
  callID?: string;
  tool: string;
  now?: number;
}): { text: string; path: string } | undefined {
  if (input.text.length <= DISPATCH_OUTPUT_CHARS) return undefined;
  const stamp = input.now ?? Date.now();
  const nonce = Math.random().toString(36).slice(2, 8);
  const dir = statePath("dispatch-output");
  const file = resolve(
    dir,
    `${safePart(input.sessionID)}-${safePart(input.callID ?? `${stamp}-${nonce}`)}-${safePart(input.tool)}.txt`,
  );
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, input.text, { mode: 0o600 });
  } catch (error) {
    logger.warn(
      `[tawassul] dispatch output cap kept the full ${input.tool} result: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
  const pointer = `\n\n[full ${input.tool} result: ${input.text.length} chars, saved to ${file}]`;
  const budget = Math.max(0, DISPATCH_OUTPUT_CHARS - pointer.length - 256);
  return { text: `${truncateToolOutput(input.text, budget)}${pointer}`, path: file };
}
