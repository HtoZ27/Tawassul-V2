import type { ContextUsage } from "../context/priority-types.ts";
import type { RecordEntry } from "../context/types.ts";

export type HostTokenUsage = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  contextTokens: number;
};

export type ContextSnapshot = {
  sessionID: string;
  action: "summarize" | "save";
  percentage: number;
  usedTokens: number;
  maxTokens: number;
  source: "host" | "estimate";
};

type Rec = Record<string, unknown>;

function nonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function pick(record: Rec | undefined, ...keys: string[]): number | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = nonNegative(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function readHostTokenUsage(message: unknown): HostTokenUsage | null {
  if (!message || typeof message !== "object") return null;
  const outer = message as Rec;
  const nested = outer.tokens ?? outer.usage;
  const tokens = nested && typeof nested === "object" ? (nested as Rec) : undefined;
  const cacheSource = tokens?.cache ?? outer.cache;
  const cache = cacheSource && typeof cacheSource === "object" ? (cacheSource as Rec) : undefined;
  const input = pick(tokens, "input") ?? pick(outer, "input");
  const output = pick(tokens, "output") ?? pick(outer, "output");
  const reasoning = pick(tokens, "reasoning") ?? pick(outer, "reasoning") ?? 0;
  const cacheRead =
    pick(cache, "read") ?? pick(tokens, "cacheRead", "cache_read") ?? pick(outer, "cacheRead", "cache_read") ?? 0;
  const cacheWrite =
    pick(cache, "write") ?? pick(tokens, "cacheWrite", "cache_write") ?? pick(outer, "cacheWrite", "cache_write") ?? 0;
  const contextSize = pick(outer, "contextSize", "context_size") ?? pick(tokens, "contextSize", "context_size");
  if (input === undefined && output === undefined && contextSize === undefined) return null;
  const measured = (input ?? 0) + (output ?? 0) + reasoning + cacheRead + cacheWrite;
  const total = pick(tokens, "total") ?? pick(outer, "total") ?? measured;
  const contextTokens = Math.max(contextSize ?? 0, total, measured);
  return {
    input: input ?? 0,
    output: output ?? 0,
    reasoning,
    cacheRead,
    cacheWrite,
    total,
    contextTokens,
  };
}

export function usageFromHost(message: unknown, maxTokens: number): ContextUsage | null {
  const host = readHostTokenUsage(message);
  if (!host || host.contextTokens <= 0) return null;
  return {
    usedTokens: host.contextTokens,
    maxTokens,
    percentage: maxTokens > 0 ? Math.min(1, host.contextTokens / maxTokens) : 0,
    breakdown: {
      systemPrompt: 0,
      conversationHistory: host.input + host.cacheRead + host.cacheWrite,
      toolOutputs: 0,
      agentMemory: 0,
    },
  };
}

export function contextSnapshotTitle(snapshot: ContextSnapshot): string {
  return `Context ${snapshot.action} snapshot at ${Math.round(snapshot.percentage * 100)}%`;
}

export function contextSnapshotDetail(snapshot: ContextSnapshot): string {
  const pct = Math.round(snapshot.percentage * 100);
  return `Session ${snapshot.sessionID} at ${snapshot.usedTokens}/${snapshot.maxTokens} tokens (${pct}%, ${snapshot.source}); nudge action ${snapshot.action}; compaction is not forced.`;
}

export function buildContextSnapshotRecord(snapshot: ContextSnapshot, id: string): RecordEntry {
  return {
    id,
    timestamp: new Date().toISOString(),
    agent: "@tawa",
    type: "note",
    title: contextSnapshotTitle(snapshot),
    detail: contextSnapshotDetail(snapshot),
    provenance: "tool_observed",
  };
}
