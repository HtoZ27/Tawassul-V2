import type { ShadowDetector } from "./usage-ledger.ts";

export const SHADOW_REPEAT_WARN_AT = 3;
export const SHADOW_REPEAT_TRIP_AT = 5;
export const SHADOW_ECHO_TRIP_TURNS = 12;
export const SHADOW_ECHO_OVERLAP = 0.8;
export const SHADOW_ECHO_MIN_CHARS = 200;
export const SHADOW_FANOUT_TRIP_COUNT = 6;
export const SHADOW_FANOUT_WINDOW_MS = 10 * 60 * 1000;
export const SHADOW_FANOUT_OVERLAP = 0.8;
export const SHADOW_DISPATCH_TOOLS: readonly string[] = ["task", "handoff", "fasttrack"];

export interface ShadowObservation {
  detector: ShadowDetector;
  sessionID: string;
  tripped: boolean;
  count: number;
  detail: Record<string, unknown>;
}

export interface UsageShadowOptions {
  emit: (observation: ShadowObservation) => void;
  now?: () => number;
  repeatWarnAt?: number;
  repeatTripAt?: number;
  echoTripTurns?: number;
  echoMinChars?: number;
  overlap?: number;
  fanoutTripCount?: number;
  fanoutWindowMs?: number;
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((token) => token.length > 0)
    .join(" ");
}

function tokensOf(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized.length > 0 ? normalized.split(" ") : [];
}

function gramsOf(text: string): Set<string> {
  const tokens = tokensOf(text);
  if (tokens.length === 0) return new Set();
  if (tokens.length < 3) return new Set(tokens);
  const grams = new Set<string>();
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    grams.add(`${tokens[index]} ${tokens[index + 1]} ${tokens[index + 2]}`);
  }
  return grams;
}

export function similarity(left: string, right: string): number {
  const a = gramsOf(left);
  const b = gramsOf(right);
  if (a.size === 0 && b.size === 0) return normalizeText(left) === normalizeText(right) ? 1 : 0;
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function taskTextOf(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  for (const key of ["task", "prompt", "description", "text"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) return normalizeText(value);
  }
  return "";
}

interface EchoState {
  pending: Map<string, string>;
  toolMessages: Set<string>;
  streak: number;
  lastText: string;
  tripped: boolean;
}

interface FanCluster {
  text: string;
  at: number;
  count: number;
  tripped: boolean;
}

interface RepeatState {
  warned: boolean;
  tripped: boolean;
}

const MAX_SESSIONS = 256;
const MAX_PENDING = 16;
const MAX_TOOL_MESSAGES = 256;
const MAX_REPEAT_KEYS = 512;
const MAX_FAN_CLUSTERS = 32;

export class UsageShadow {
  private readonly emitTo: (observation: ShadowObservation) => void;
  private readonly now: () => number;
  private readonly repeatWarnAt: number;
  private readonly repeatTripAt: number;
  private readonly echoTripTurns: number;
  private readonly echoMinChars: number;
  private readonly overlap: number;
  private readonly fanoutTripCount: number;
  private readonly fanoutWindowMs: number;
  private readonly echo = new Map<string, EchoState>();
  private readonly repeat = new Map<string, RepeatState>();
  private readonly fanout = new Map<string, FanCluster[]>();

  constructor(options: UsageShadowOptions) {
    this.emitTo = options.emit;
    this.now = options.now ?? Date.now;
    this.repeatWarnAt = options.repeatWarnAt ?? SHADOW_REPEAT_WARN_AT;
    this.repeatTripAt = options.repeatTripAt ?? SHADOW_REPEAT_TRIP_AT;
    this.echoTripTurns = options.echoTripTurns ?? SHADOW_ECHO_TRIP_TURNS;
    this.echoMinChars = options.echoMinChars ?? SHADOW_ECHO_MIN_CHARS;
    this.overlap = options.overlap ?? SHADOW_ECHO_OVERLAP;
    this.fanoutTripCount = options.fanoutTripCount ?? SHADOW_FANOUT_TRIP_COUNT;
    this.fanoutWindowMs = options.fanoutWindowMs ?? SHADOW_FANOUT_WINDOW_MS;
  }

  handleEvent(raw: unknown): boolean {
    const outer = record(raw);
    if (!outer) return false;
    const type = typeof outer.type === "string" ? outer.type : "";
    const data = record(outer.data);
    const sessionID = typeof data?.sessionID === "string" ? data.sessionID : "";
    if (!sessionID) return false;
    if (type === "session.tool.called") {
      const messageID = typeof data?.assistantMessageID === "string" ? data.assistantMessageID : "";
      if (!messageID) return false;
      const state = this.echoState(sessionID);
      state.toolMessages.add(messageID);
      state.streak = 0;
      state.lastText = "";
      state.tripped = false;
      if (state.toolMessages.size > MAX_TOOL_MESSAGES) {
        const oldest = state.toolMessages.values().next().value;
        if (oldest !== undefined) state.toolMessages.delete(oldest);
      }
      return true;
    }
    if (type === "session.text.ended") {
      const messageID = typeof data?.assistantMessageID === "string" ? data.assistantMessageID : "";
      const text = typeof data?.text === "string" ? data.text : "";
      if (!messageID || text.trim().length === 0) return false;
      const state = this.echoState(sessionID);
      state.pending.delete(messageID);
      state.pending.set(messageID, text);
      if (state.pending.size > MAX_PENDING) {
        const oldest = state.pending.keys().next().value;
        if (oldest !== undefined) state.pending.delete(oldest);
      }
      return true;
    }
    if (type === "session.usage.updated") {
      this.flushEcho(sessionID);
      return true;
    }
    return false;
  }

  observeRepeat(input: {
    sessionID: string;
    agent?: string;
    tool: string;
    count: number;
    success: boolean;
  }): ShadowObservation | undefined {
    if (!input.sessionID || !input.success || !Number.isFinite(input.count)) return undefined;
    if (input.count < this.repeatWarnAt) return undefined;
    const key = `${input.sessionID}\u0000${input.tool}`;
    let state = this.repeat.get(key);
    if (!state) {
      state = { warned: false, tripped: false };
      this.repeat.set(key, state);
      while (this.repeat.size > MAX_REPEAT_KEYS) {
        const oldest = this.repeat.keys().next().value;
        if (oldest === undefined) break;
        this.repeat.delete(oldest);
      }
    }
    const detail: Record<string, unknown> = {
      tool: input.tool,
      agentMissing: !input.agent,
      blockedByCurrentGuard: false,
    };
    if (input.count >= this.repeatTripAt && !state.tripped) {
      state.tripped = true;
      state.warned = true;
      return this.publish({ detector: "repeat", sessionID: input.sessionID, tripped: true, count: input.count, detail });
    }
    if (!state.warned) {
      state.warned = true;
      return this.publish({ detector: "repeat", sessionID: input.sessionID, tripped: false, count: input.count, detail });
    }
    return undefined;
  }

  observeDispatch(input: {
    sessionID: string;
    tool: string;
    args?: Record<string, unknown>;
  }): ShadowObservation | undefined {
    if (!input.sessionID) return undefined;
    if (!SHADOW_DISPATCH_TOOLS.includes(input.tool)) return undefined;
    const text = taskTextOf(input.args);
    if (!text) return undefined;
    const now = this.now();
    const clusters = this.fanout.get(input.sessionID) ?? [];
    const live = clusters.filter((cluster) => now - cluster.at <= this.fanoutWindowMs);
    let match: FanCluster | undefined;
    for (const cluster of live) {
      if (similarity(cluster.text, text) >= this.overlap) {
        match = cluster;
        break;
      }
    }
    if (!match) {
      live.push({ text, at: now, count: 1, tripped: false });
      while (live.length > MAX_FAN_CLUSTERS) live.shift();
      this.fanout.set(input.sessionID, live);
      this.trimSessions(this.fanout);
      return undefined;
    }
    match.count += 1;
    match.at = now;
    this.fanout.set(input.sessionID, live);
    if (match.count >= this.fanoutTripCount && !match.tripped) {
      match.tripped = true;
      return this.publish({
        detector: "fanout",
        sessionID: input.sessionID,
        tripped: true,
        count: match.count,
        detail: { tool: input.tool, windowMs: this.fanoutWindowMs },
      });
    }
    return undefined;
  }

  fanoutBlocked(input: {
    sessionID: string;
    tool: string;
    args?: Record<string, unknown>;
  }): { count: number; windowMs: number } | undefined {
    if (!input.sessionID) return undefined;
    if (!SHADOW_DISPATCH_TOOLS.includes(input.tool)) return undefined;
    const text = taskTextOf(input.args);
    if (!text) return undefined;
    const now = this.now();
    for (const cluster of this.fanout.get(input.sessionID) ?? []) {
      if (now - cluster.at > this.fanoutWindowMs) continue;
      if (cluster.count < this.fanoutTripCount) continue;
      if (similarity(cluster.text, text) >= this.overlap) {
        return { count: cluster.count, windowMs: this.fanoutWindowMs };
      }
    }
    return undefined;
  }

  private flushEcho(sessionID: string): void {
    const state = this.echo.get(sessionID);
    if (!state || state.pending.size === 0) return;
    const pending = [...state.pending.entries()];
    state.pending.clear();
    for (const [messageID, text] of pending) {
      const hadTool = state.toolMessages.delete(messageID);
      const normalized = normalizeText(text);
      if (!normalized) continue;
      if (hadTool) {
        state.streak = 0;
        state.lastText = normalized;
        state.tripped = false;
        continue;
      }
      if (text.trim().length < this.echoMinChars) {
        state.streak = 0;
        state.lastText = "";
        state.tripped = false;
        continue;
      }
      if (!state.lastText) {
        state.streak = 1;
        state.lastText = normalized;
        state.tripped = false;
        continue;
      }
      const score = similarity(state.lastText, normalized);
      if (score >= this.overlap) {
        state.streak += 1;
        if (state.streak >= this.echoTripTurns && !state.tripped) {
          state.tripped = true;
          this.publish({
            detector: "echo",
            sessionID,
            tripped: true,
            count: state.streak,
            detail: {
              similarity: Number(score.toFixed(4)),
              overlap: this.overlap,
              chars: text.trim().length,
              minChars: this.echoMinChars,
            },
          });
        }
      } else {
        state.streak = 1;
        state.tripped = false;
      }
      state.lastText = normalized;
    }
  }

  private echoState(sessionID: string): EchoState {
    let state = this.echo.get(sessionID);
    if (!state) {
      state = { pending: new Map(), toolMessages: new Set(), streak: 0, lastText: "", tripped: false };
      this.echo.set(sessionID, state);
      this.trimSessions(this.echo);
    }
    return state;
  }

  private trimSessions<T>(map: Map<string, T>): void {
    while (map.size > MAX_SESSIONS) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  private publish(observation: ShadowObservation): ShadowObservation {
    try {
      this.emitTo(observation);
    } catch {
      const ignored = undefined;
      void ignored;
    }
    return observation;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

let activeShadow: UsageShadow | null = null;

export function installUsageShadow(options: UsageShadowOptions): UsageShadow {
  const shadow = new UsageShadow(options);
  activeShadow = shadow;
  return shadow;
}

export function getUsageShadow(): UsageShadow | null {
  return activeShadow;
}

export function clearUsageShadow(): void {
  activeShadow = null;
}
