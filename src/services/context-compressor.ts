import { estimateTokensByFactor, TOKENS_PER_CHAR_COMPRESS } from "./token-estimation.ts";

const HISTORICAL_PREFIX = "[REFERENCE ONLY]";
export const DEFAULT_THRESHOLD = 80_000;
const MAX_TOOL_OUTPUT_CHARS = 50_000;

export interface Message {
  role: string;
  content: string;
}


export function countTokens(text: string): number {
  if (!text) return 0;
  return estimateTokensByFactor(text.length, TOKENS_PER_CHAR_COMPRESS);
}

export function shouldCompress(tokenUsage: { input: number; output: number }, threshold = DEFAULT_THRESHOLD): boolean {
  return tokenUsage.input + tokenUsage.output > threshold;
}

export function truncateToolOutput(text: string, maxChars = MAX_TOOL_OUTPUT_CHARS): string {
  if (!text || text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.6));
  const tail = text.slice(text.length - Math.floor(maxChars * 0.4));
  const removed = text.length - head.length - tail.length;
  return head + "\n\n" + HISTORICAL_PREFIX + " … [" + removed + " chars truncated] …\n\n" + tail;
}
