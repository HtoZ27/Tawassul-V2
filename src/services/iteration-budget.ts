import { TAWA_AGENT } from "../security-policy.ts";
import { logger } from "../utils/logger.ts";
import { normalizeName } from "../utils/name-utils.ts";

const DEFAULT_PARENT_LIMIT = 90;
const DEFAULT_SUBAGENT_LIMIT = 60;

export type ProjectScale = "small" | "medium" | "large";

const SCALE_FACTOR: Record<ProjectScale, number> = { small: 0.7, medium: 1, large: 1.6 };
const TIER_BASE: Record<string, number> = {
  shallow: 60,
  moderate: 100,
  deep: 160,
  "analyze-first": 320,
};

const _used = new Map<string, number>();
const _limit = new Map<string, number>();
const _dynamic = new Map<string, number>();
const _initial = new Map<string, number>();

let _adaptive = true;
let _scale: ProjectScale = "medium";
let _stepPercent = 50;
let _ceilingFactor = 4;

export function setAdaptiveBudget(enabled: boolean): void {
  _adaptive = enabled;
}

export function setProjectScale(scale: ProjectScale): void {
  _scale = scale;
}

export function setBudgetStep(percent: number): void {
  _stepPercent = Math.max(0, percent);
}

export function setBudgetCeiling(factor: number): void {
  _ceilingFactor = Math.max(1, factor);
}

export function isAdaptiveBudget(): boolean {
  return _adaptive;
}

export function applyBudgetTiers(tiers: Record<string, number> | undefined): number {
  if (!tiers) return 0;
  let applied = 0;
  for (const [name, value] of Object.entries(tiers)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1) continue;
    TIER_BASE[name] = Math.floor(value);
    applied++;
  }
  return applied;
}

export function setBudget(agent: string, limit: number): void {
  _limit.set(normalizeName(agent), limit);
}

export function applyIterationBudgets(
  budgets: Record<string, number> | undefined,
  onInvalid?: (agent: string, value: unknown) => void,
): number {
  if (!budgets) return 0;
  let applied = 0;
  for (const [agent, value] of Object.entries(budgets)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
      onInvalid?.(agent, value);
      continue;
    }
    setBudget(agent, Math.floor(value));
    applied++;
  }
  return applied;
}

function budgetKey(agent: string, scope?: string): string {
  const name = normalizeName(agent);
  return scope ? `${name}@${scope}` : name;
}

function baseFor(agent: string): number {
  return normalizeName(agent) === TAWA_AGENT ? DEFAULT_PARENT_LIMIT : DEFAULT_SUBAGENT_LIMIT;
}

function scaled(base: number): number {
  const factor = _adaptive ? SCALE_FACTOR[_scale] : 1;
  return Math.max(1, Math.round(base * factor));
}

function isExplicit(agent: string): boolean {
  return _limit.has(normalizeName(agent));
}

function initialFor(agent: string, scope: string | undefined, fallback: number): number {
  const key = budgetKey(agent, scope);
  const known = _initial.get(key);
  if (known !== undefined) return known;
  _initial.set(key, fallback);
  return fallback;
}

function limitFor(agent: string, scope?: string): number {
  const explicit = _limit.get(normalizeName(agent));
  if (explicit !== undefined) return explicit;
  const key = budgetKey(agent, scope);
  const dynamic = _dynamic.get(key);
  if (dynamic !== undefined) return dynamic;
  const value = scaled(baseFor(agent));
  _initial.set(key, value);
  return value;
}

export function assignTier(agent: string, scope: string | undefined, tier: string): void {
  if (!_adaptive || isExplicit(agent)) return;
  const base = TIER_BASE[tier];
  if (base === undefined) return;
  const key = budgetKey(agent, scope);
  const used = _used.get(key) ?? 0;
  const existing = _dynamic.get(key) ?? 0;
  const computed = Math.max(scaled(base), used + 1, existing);
  _dynamic.set(key, computed);
  _initial.set(key, Math.max(computed, _initial.get(key) ?? 0));
}

export function consume(agent: string, scope?: string): boolean {
  const key = budgetKey(agent, scope);
  let limit = limitFor(agent, scope);
  const used = _used.get(key) ?? 0;
  if (used >= limit && _adaptive && !isExplicit(agent) && _stepPercent > 0) {
    const start = initialFor(agent, scope, limit);
    const ceiling = Math.round(start * _ceilingFactor);
    const grown = Math.min(ceiling, Math.round(limit * (1 + _stepPercent / 100)));
    if (grown > limit) {
      _dynamic.set(key, grown);
      logger.info(`iteration budget extended for ${key} (${used}/${grown})`);
      limit = grown;
    }
  }
  if (used >= limit) {
    logger.warn(`iteration budget exhausted for ${key} (${used}/${limit})`);
    return false;
  }
  _used.set(key, used + 1);
  return true;
}

export function refund(agent: string, scope?: string): void {
  const key = budgetKey(agent, scope);
  const used = _used.get(key) ?? 0;
  if (used > 0) _used.set(key, used - 1);
}

export function remaining(agent: string, scope?: string): number {
  const key = budgetKey(agent, scope);
  const limit = limitFor(agent, scope);
  const used = _used.get(key) ?? 0;
  return Math.max(0, limit - used);
}

export function resetBudgets(): void {
  _used.clear();
  _limit.clear();
  _dynamic.clear();
  _initial.clear();
}

const MAX_BUDGET_ENTRIES = 200;
let _lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 300_000;

export function sweepStaleBudgets(): void {
  const now = Date.now();
  if (now - _lastSweep < SWEEP_INTERVAL_MS) return;
  _lastSweep = now;
  for (const map of [_used, _limit, _dynamic, _initial]) {
    if (map.size > MAX_BUDGET_ENTRIES) {
      const keys = [...map.keys()].slice(0, map.size - MAX_BUDGET_ENTRIES);
      for (const k of keys) map.delete(k);
    }
  }
}

interface CapRule {
  maxDepth: number;
  maxSubagents: number;
  maxTokens: number;
}

const caps = new Map<string, CapRule>();
export const DEFAULT_CAP: CapRule = { maxDepth: 3, maxSubagents: 5, maxTokens: 200_000_000 };

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
