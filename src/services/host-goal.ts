export type HostGoalStatus = "active" | "paused" | "complete";

export interface HostGoalState {
  id: string;
  objective: string;
  status: HostGoalStatus;
  reason?: string;
  rounds: number;
  maxRounds: number;
  stalls?: number;
  boot: string;
  updatedAt: number;
}

export interface HostGoalChange {
  sessionID: string;
  goal: HostGoalState | null;
}

export interface HostGoalSource {
  read: (sessionID: string) => Promise<unknown>;
  subscribe: (handler: (change: HostGoalChange) => void) => () => void;
}

export interface HostGoalMirrorOptions {
  ttlMs?: number;
  cap?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 5000;
const DEFAULT_CAP = 256;

export function normalizeHostGoal(value: unknown): HostGoalState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const status = raw.status;
  if (status !== "active" && status !== "paused" && status !== "complete") return null;
  if (typeof raw.objective !== "string" || raw.objective.trim().length === 0) return null;
  if (typeof raw.rounds !== "number" || !Number.isFinite(raw.rounds)) return null;
  if (typeof raw.maxRounds !== "number" || !Number.isFinite(raw.maxRounds)) return null;
  if (typeof raw.updatedAt !== "number" || !Number.isFinite(raw.updatedAt)) return null;
  if (typeof raw.boot !== "string") return null;
  const state: HostGoalState = {
    id: typeof raw.id === "string" ? raw.id : "",
    objective: raw.objective,
    status,
    rounds: raw.rounds,
    maxRounds: raw.maxRounds,
    boot: raw.boot,
    updatedAt: raw.updatedAt,
  };
  if (typeof raw.reason === "string" && raw.reason.length > 0) state.reason = raw.reason;
  if (typeof raw.stalls === "number" && Number.isFinite(raw.stalls)) state.stalls = raw.stalls;
  return state;
}

export class HostGoalMirror {
  private readonly cache = new Map<string, { state: HostGoalState; at: number }>();
  private readonly ttlMs: number;
  private readonly cap: number;
  private readonly now: () => number;
  private readonly source: HostGoalSource;
  private unsubscribe: (() => void) | null = null;

  constructor(source: HostGoalSource, options: HostGoalMirrorOptions = {}) {
    this.source = source;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.cap = options.cap ?? DEFAULT_CAP;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.unsubscribe) return;
    try {
      this.unsubscribe = this.source.subscribe((change) => this.apply(change));
    } catch {
      this.unsubscribe = null;
    }
  }

  async get(sessionID: string): Promise<HostGoalState | null> {
    const key = sessionID.trim();
    if (!key) return null;
    const hit = this.cache.get(key);
    const now = this.now();
    if (hit && now - hit.at < this.ttlMs) return hit.state;
    try {
      const state = normalizeHostGoal(await this.source.read(key));
      if (!state) {
        this.cache.delete(key);
        return null;
      }
      this.remember(key, state, now);
      return state;
    } catch {
      return hit?.state ?? null;
    }
  }

  peek(sessionID: string): HostGoalState | null {
    return this.cache.get(sessionID.trim())?.state ?? null;
  }

  apply(change: HostGoalChange): void {
    const key = typeof change.sessionID === "string" ? change.sessionID.trim() : "";
    if (!key) return;
    const state = normalizeHostGoal(change.goal);
    if (!state) {
      this.cache.delete(key);
      return;
    }
    this.remember(key, state, this.now());
  }

  dispose(): void {
    if (this.unsubscribe) {
      try {
        this.unsubscribe();
      } catch {
        void 0;
      }
      this.unsubscribe = null;
    }
    this.cache.clear();
  }

  private remember(key: string, state: HostGoalState, at: number): void {
    this.cache.delete(key);
    this.cache.set(key, { state, at });
    while (this.cache.size > this.cap) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}

let activeMirror: HostGoalMirror | null = null;

export function setActiveHostGoalMirror(mirror: HostGoalMirror | null): void {
  activeMirror = mirror;
}

export function getActiveHostGoalMirror(): HostGoalMirror | null {
  return activeMirror;
}

export async function readHostGoal(sessionID: string): Promise<HostGoalState | null> {
  return activeMirror ? activeMirror.get(sessionID) : null;
}

export function formatHostGoal(state: HostGoalState): string {
  const rounds = `${state.rounds}/${state.maxRounds}`;
  const reason = state.reason ? ` · ${state.reason}` : "";
  return `Host /goal · ${state.status} · ${rounds} · ${state.objective}${reason}`;
}

export function hostGoalSuffix(state: HostGoalState | null): string {
  return state && state.status !== "complete" ? `\n\n${formatHostGoal(state)}` : "";
}
