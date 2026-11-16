import { normalizeName } from "../utils/name-utils.ts";
import { logger } from "../utils/logger.ts";
import { getDynamicFallbackChainForRole, getFallbackChain } from "./proxy-fallback-chains.ts";

export type FallbackChainConfig = {
  enabled?: boolean;
  maxSwitches?: number;
  cooldownMs?: number;
  chains?: Record<string, string[]>;
};

export type FailoverTarget = {
  providerID: string;
  modelID: string;
};

export type FailoverPlan =
  | { action: "switch"; to: FailoverTarget; target: string; delayMs: number }
  | { action: "keep"; reason: string };

export type FailoverDynamicContext = {
  dynamicAgents: readonly string[];
  agentModelMap: Record<string, string>;
};

export const DEFAULT_MAX_SWITCHES = 2;
export const DEFAULT_COOLDOWN_MS = 750;
export const MAX_COOLDOWN_MS = 60_000;
export const MAX_SWITCHES_CAP = 20;
export const FAILOVER_CLAIM_TTL_MS = 5 * 60_000;
const MAX_TRACKED_SESSIONS = 500;

type SessionState = {
  count: number;
  at: number;
  tried: Map<string, number>;
};

const _sessions = new Map<string, SessionState>();

export function resetFailoverState(): void {
  _sessions.clear();
}

export function failoverSwitchCount(sessionID: string): number {
  return _sessions.get(sessionID)?.count ?? 0;
}

export function hasFailoverClaim(sessionID: string, now = Date.now()): boolean {
  const state = _sessions.get(sessionID);
  if (!state || state.count === 0 || state.at === 0) return false;
  return now - state.at <= FAILOVER_CLAIM_TTL_MS;
}

export type FailoverSummary = {
  sessions: number;
  switches: number;
  claimed: number;
};

export function failoverSummary(now = Date.now()): FailoverSummary {
  let switches = 0;
  let claimed = 0;
  for (const state of _sessions.values()) {
    switches += state.count;
    if (state.count > 0 && now - state.at <= FAILOVER_CLAIM_TTL_MS) claimed += 1;
  }
  return { sessions: _sessions.size, switches, claimed };
}

function isStaleClaim(state: SessionState, now: number): boolean {
  return state.at !== 0 && now - state.at > FAILOVER_CLAIM_TTL_MS;
}

function stateFor(sessionID: string, now: number): SessionState {
  const existing = _sessions.get(sessionID);
  if (existing) {
    if (isStaleClaim(existing, now)) {
      existing.count = 0;
      existing.at = 0;
      existing.tried.clear();
    } else {
      for (const [target, at] of existing.tried) {
        if (now - at > FAILOVER_CLAIM_TTL_MS) existing.tried.delete(target);
      }
    }
    _sessions.delete(sessionID);
    _sessions.set(sessionID, existing);
    return existing;
  }
  const created: SessionState = { count: 0, at: 0, tried: new Map() };
  _sessions.set(sessionID, created);
  if (_sessions.size > MAX_TRACKED_SESSIONS) {
    const oldest = _sessions.keys().next().value;
    if (oldest !== undefined && oldest !== sessionID) _sessions.delete(oldest);
  }
  return created;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

export function formatTarget(target: FailoverTarget): string {
  return `${target.providerID}/${target.modelID}`;
}

export function parseModelTarget(value: unknown): FailoverTarget | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const slash = trimmed.indexOf("/");
    if (slash <= 0 || slash === trimmed.length - 1) return undefined;
    return { providerID: trimmed.slice(0, slash), modelID: trimmed.slice(slash + 1) };
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as { providerID?: unknown; modelID?: unknown; id?: unknown };
  const providerID = typeof record.providerID === "string" ? record.providerID.trim() : "";
  const modelID =
    typeof record.modelID === "string"
      ? record.modelID.trim()
      : typeof record.id === "string"
        ? record.id.trim()
        : "";
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

function toEntries(raw: readonly string[]): Array<{ target: string; model: FailoverTarget }> {
  const seen = new Set<string>();
  const out: Array<{ target: string; model: FailoverTarget }> = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const model = parseModelTarget(entry);
    if (!model) continue;
    const target = formatTarget(model);
    if (seen.has(target)) continue;
    seen.add(target);
    out.push({ target, model });
  }
  return out;
}

export function explicitChain(
  config: FallbackChainConfig | undefined,
  agent: string | undefined,
): string[] | undefined {
  if (!config?.chains || typeof config.chains !== "object") return undefined;
  const candidates: Array<readonly string[] | undefined> = [];
  if (agent) {
    candidates.push(config.chains[agent]);
    candidates.push(config.chains[normalizeName(agent)]);
  }
  candidates.push(config.chains["*"]);
  const raw = candidates.find((entry) => Array.isArray(entry));
  return raw ? [...raw] : undefined;
}

export function resolveChain(input: {
  config?: FallbackChainConfig;
  agent?: string;
  role?: string;
  dynamic?: FailoverDynamicContext;
}): Array<{ target: string; model: FailoverTarget }> {
  const explicit = explicitChain(input.config, input.agent);
  if (explicit && explicit.length > 0) return toEntries(explicit);
  const role = input.role ?? (input.agent ? normalizeName(input.agent) : "dev");
  const dynamicChain = input.dynamic ? getDynamicFallbackChainForRole(role, input.dynamic) : [];
  const chain = dynamicChain.length > 0 ? dynamicChain : getFallbackChain(role);
  return toEntries(chain);
}

export function planFailover(input: {
  config?: FallbackChainConfig;
  agent?: string;
  role?: string;
  dynamic?: FailoverDynamicContext;
  model?: FailoverTarget;
  sessionID?: string;
  now?: number;
}): FailoverPlan {
  const config = input.config;
  if (config && config.enabled === false) return { action: "keep", reason: "disabled" };
  if (!input.sessionID) return { action: "keep", reason: "no-session" };
  const chain = resolveChain(input);
  if (chain.length === 0) return { action: "keep", reason: "no-chain" };
  const now = input.now ?? Date.now();
  const state = stateFor(input.sessionID, now);
  const max = clampInt(config?.maxSwitches, DEFAULT_MAX_SWITCHES, 0, MAX_SWITCHES_CAP);
  if (state.count >= max) return { action: "keep", reason: "max-switches" };
  const current = input.model ? formatTarget(input.model) : undefined;
  const startIndex = current ? chain.findIndex((entry) => entry.target === current) : -1;
  const ordered =
    startIndex >= 0 ? [...chain.slice(startIndex + 1), ...chain.slice(0, startIndex)] : chain;
  for (const entry of ordered) {
    if (entry.target === current) continue;
    if (state.tried.has(entry.target)) continue;
    const delayMs = clampInt(config?.cooldownMs, DEFAULT_COOLDOWN_MS, 0, MAX_COOLDOWN_MS);
    return { action: "switch", to: entry.model, target: entry.target, delayMs };
  }
  return { action: "keep", reason: "chain-exhausted" };
}

export function commitFailover(sessionID: string, target: string, now = Date.now()): void {
  const state = stateFor(sessionID, now);
  state.count += 1;
  state.at = now;
  state.tried.set(target, now);
}

export function recordFailoverMiss(sessionID: string, target: string, now = Date.now()): void {
  const state = stateFor(sessionID, now);
  state.tried.set(target, now);
}

export type SwitchModelSession = {
  switchModel?: (input: {
    sessionID: string;
    model: { id: string; providerID: string; variant?: string };
  }) => Promise<unknown>;
};

export async function switchSessionModel(
  session: SwitchModelSession | undefined,
  sessionID: string,
  model: FailoverTarget,
): Promise<boolean> {
  if (!session || typeof session.switchModel !== "function") return false;
  try {
    await session.switchModel({
      sessionID,
      model: { id: model.modelID, providerID: model.providerID },
    });
    return true;
  } catch (e) {
    logger.warn(
      `[tawassul] switchModel failed for ${sessionID} -> ${model.providerID}/${model.modelID}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return false;
  }
}
