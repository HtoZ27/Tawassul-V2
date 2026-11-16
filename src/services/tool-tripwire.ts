import { createHash } from "node:crypto";

export const TOOL_COUNT_FLOOR = 40;

export function toolNameSetHash(names: readonly string[]): string {
  return createHash("sha256").update([...names].sort().join("\n")).digest("hex");
}
