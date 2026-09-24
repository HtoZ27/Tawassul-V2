import { TAWA_AGENT } from "../security-policy.ts";
import { logger } from "../utils/logger.ts";
import { normalizeName } from "../utils/name-utils.ts";

const _used = new Map<string, number>();
const _limit = new Map<string, number>();

const DEFAULT_PARENT_LIMIT = 90;
const DEFAULT_SUBAGENT_LIMIT = 50;

export function setBudget(agent: string, limit: number): void {
  _limit.set(normalizeName(agent), limit);
}

export function consume(agent: string): boolean {
  const key = normalizeName(agent);
  const limit = _limit.get(key) ?? (key === TAWA_AGENT ? DEFAULT_PARENT_LIMIT : DEFAULT_SUBAGENT_LIMIT);
  const used = _used.get(key) ?? 0;
  if (used >= limit) {
    logger.warn(`iteration budget exhausted for ${key} (${used}/${limit})`);
    return false;
  }
  _used.set(key, used + 1);
  return true;
}

export function refund(agent: string): void {
  const key = normalizeName(agent);
  const used = _used.get(key) ?? 0;
  if (used > 0) _used.set(key, used - 1);
}

export function remaining(agent: string): number {
  const key = normalizeName(agent);
  const limit = _limit.get(key) ?? (key === TAWA_AGENT ? DEFAULT_PARENT_LIMIT : DEFAULT_SUBAGENT_LIMIT);
  const used = _used.get(key) ?? 0;
  return Math.max(0, limit - used);
}

export function resetBudgets(): void {
  _used.clear();
  _limit.clear();
}

const MAX_BUDGET_ENTRIES = 200;
let _lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 300_000;

export function sweepStaleBudgets(): void {
  const now = Date.now();
  if (now - _lastSweep < SWEEP_INTERVAL_MS) return;
  _lastSweep = now;
  if (_used.size > MAX_BUDGET_ENTRIES) {
    const keys = [..._used.keys()].slice(0, _used.size - MAX_BUDGET_ENTRIES);
    for (const k of keys) _used.delete(k);
  }
  if (_limit.size > MAX_BUDGET_ENTRIES) {
    const keys = [..._limit.keys()].slice(0, _limit.size - MAX_BUDGET_ENTRIES);
    for (const k of keys) _limit.delete(k);
  }
}



interface CapRule {
  maxDepth: number;
  maxSubagents: number;
  maxTokens: number;
}

const caps = new Map<string, CapRule>();
export const DEFAULT_CAP: CapRule = { maxDepth: 3, maxSubagents: 5, maxTokens: 10000 };

export function setCap(agent: string, rule: Partial<CapRule>): void {
  const key = normalizeName(agent);
  const existing = caps.get(key) ?? DEFAULT_CAP;
  caps.set(key, { ...existing, ...rule });
}

export function getCap(agent: string): CapRule {
  return caps.get(normalizeName(agent)) ?? DEFAULT_CAP;
}

export function checkCap(agent: string, depth: number, subagentCount: number, tokens: number): string | null {
  const rule = getCap(agent);
  if (depth > rule.maxDepth) return `Exceeded max depth (${rule.maxDepth})`;
  if (subagentCount > rule.maxSubagents) return `Exceeded max subagents (${rule.maxSubagents})`;
  if (tokens > rule.maxTokens) return `Exceeded token limit (${rule.maxTokens})`;
  return null;
}

export function removeCap(agent: string): void {
  caps.delete(normalizeName(agent));
}

export function listCaps(): Array<{ agent: string; rule: CapRule }> {
  return Array.from(caps.entries()).map(([agent, rule]) => ({ agent, rule }));
}

export function resetCaps(): void {
  caps.clear();
}
