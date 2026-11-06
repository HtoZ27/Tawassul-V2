import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { logger } from "../utils/logger.ts";
import { statePath, v2DataRoot } from "../utils/state-paths.ts";

export const USAGE_LEDGER_VERSION = 1;
export const USAGE_LEDGER_ENV = "TAWASSUL_USAGE_LEDGER";
export const USAGE_LEDGER_MAX_BYTES = 32 * 1024 * 1024;
export const USAGE_LEDGER_PAGE_LIMIT = 500;
export const USAGE_LEDGER_MAX_PAGES = 10;
export const USAGE_LEDGER_FLUSH_MS = 250;

export interface UsageWeights {
  read: number;
  write: number;
  source: "default" | "catalog";
}

export const DEFAULT_USAGE_WEIGHTS: UsageWeights = { read: 0.1, write: 1.25, source: "default" };

export interface UsageCounters {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface UsageRawCounters extends UsageCounters {
  cost: number;
}

export interface UsageEventRecord {
  sessionID: string;
  cost: number;
  tokens: UsageCounters;
}

export interface UsageLedgerRow {
  v: number;
  kind: "usage";
  ts: string;
  source: "event" | "session.list";
  sessionID: string;
  parentID: string | null;
  depth: number | null;
  agent: string | null;
  raw: UsageRawCounters;
  delta: UsageRawCounters;
  billable: number;
  billableUnit: "weighted_tokens";
  costCumulative: number;
  costUnpriced: boolean;
  weights: UsageWeights;
  contextSize: number;
  turn: number;
  unobserved: boolean;
  resync: boolean;
}

export interface UsageInjectionRow {
  v: number;
  kind: "injection";
  ts: string;
  sessionID: string;
  source: string;
  bytes: number;
}

export type ShadowDetector = "repeat" | "echo" | "fanout";

export interface UsageShadowRow {
  v: number;
  kind: "shadow";
  ts: string;
  detector: ShadowDetector;
  sessionID: string;
  tripped: boolean;
  count: number;
  detail: Record<string, unknown>;
}

export type UsageLedgerLine = UsageLedgerRow | UsageInjectionRow | UsageShadowRow;

export interface UsageSessionSnapshot {
  id: string;
  parentID?: string | null;
  agent?: string | null;
  cost?: number | null;
  tokens?: Partial<UsageCounters> & { cache?: Partial<{ read: number; write: number }> | null } | null;
}

export interface UsageSessionList {
  data?: UsageSessionSnapshot[];
  cursor?: { previous?: string | null; next?: string | null } | null;
}

export interface UsageSessionListInput {
  limit?: number;
  order?: "asc" | "desc";
  cursor?: string;
}

export interface UsageLedgerOptions {
  path?: string;
  weights?: Partial<UsageWeights>;
  getSession?: (sessionID: string) => Promise<UsageSessionSnapshot | undefined | null>;
  listSessions?: (input?: UsageSessionListInput) => Promise<UsageSessionList | UsageSessionSnapshot[] | undefined | null>;
  now?: () => number;
  maxBytes?: number;
}

export interface UsagePercentiles {
  p50: number | null;
  p90: number | null;
  p99: number | null;
}

export interface UsageLedgerSummary {
  enabled: boolean;
  path: string;
  rows: number;
  usageRows: number;
  injectionRows: number;
  injectionBytes: number;
  shadowRows: number;
  repeatSessions: number;
  echoSessions: number;
  fanoutSessions: number;
  sessions: number;
  roots: number;
  children: number;
  orphanChildren: number;
  lineageUnknown: number;
  pricedSessions: number;
  unpricedSessions: number;
  unobservedRows: number;
  backfilledSessions: number;
  lastEventAt: string | null;
  unit: "usd" | "weighted_tokens" | "mixed" | "none";
  root: UsagePercentiles;
  child: UsagePercentiles;
}

interface SessionState {
  id: string;
  parentID: string | null;
  agent: string | null;
  depth: number | null;
  raw: UsageRawCounters;
  turn: number;
  seenAt: number;
  backfilled: boolean;
}

const EMPTY_COUNTERS: UsageCounters = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function positive(value: unknown): number {
  const n = finite(value);
  return n === undefined || n < 0 ? 0 : n;
}

export function parseUsageEvent(raw: unknown): UsageEventRecord | undefined {
  const outer = record(raw);
  if (!outer) return undefined;
  const type = typeof outer.type === "string" ? outer.type : "";
  if (type && type !== "session.usage.updated") return undefined;
  const data = record(outer.data) ?? outer;
  const sessionID = typeof data.sessionID === "string" ? data.sessionID.trim() : "";
  if (!sessionID) return undefined;
  const tokens = record(data.tokens);
  if (!tokens) return undefined;
  const cache = record(tokens.cache);
  return {
    sessionID,
    cost: positive(data.cost),
    tokens: {
      input: positive(tokens.input),
      output: positive(tokens.output),
      reasoning: positive(tokens.reasoning),
      cacheRead: positive(cache?.read),
      cacheWrite: positive(cache?.write),
    },
  };
}

export function countersOf(snapshot: UsageSessionSnapshot): UsageCounters | undefined {
  const tokens = snapshot.tokens;
  if (!tokens || typeof tokens !== "object") return undefined;
  return {
    input: positive(tokens.input),
    output: positive(tokens.output),
    reasoning: positive(tokens.reasoning),
    cacheRead: positive(tokens.cache?.read),
    cacheWrite: positive(tokens.cache?.write),
  };
}

export function isZeroCounters(counters: UsageCounters, cost = 0): boolean {
  return (
    counters.input === 0 &&
    counters.output === 0 &&
    counters.reasoning === 0 &&
    counters.cacheRead === 0 &&
    counters.cacheWrite === 0 &&
    cost === 0
  );
}

export function diffCounters(prev: UsageCounters, next: UsageCounters): { delta: UsageCounters; resync: boolean } {
  const delta: UsageCounters = {
    input: next.input - prev.input,
    output: next.output - prev.output,
    reasoning: next.reasoning - prev.reasoning,
    cacheRead: next.cacheRead - prev.cacheRead,
    cacheWrite: next.cacheWrite - prev.cacheWrite,
  };
  const resync =
    delta.input < 0 ||
    delta.output < 0 ||
    delta.reasoning < 0 ||
    delta.cacheRead < 0 ||
    delta.cacheWrite < 0;
  return { delta: resync ? { ...next } : delta, resync };
}

export function computeBillable(counters: UsageCounters, weights: UsageWeights = DEFAULT_USAGE_WEIGHTS): number {
  return (
    counters.input +
    counters.output +
    counters.cacheRead * weights.read +
    counters.cacheWrite * weights.write
  );
}

export function contextSizeOf(counters: UsageCounters): number {
  return counters.input + counters.cacheRead;
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index] ?? null;
}

export function percentileSet(values: readonly number[]): UsagePercentiles {
  return { p50: percentile(values, 50), p90: percentile(values, 90), p99: percentile(values, 99) };
}

export function usageLedgerPath(override?: string): string {
  const explicit = override ?? process.env[USAGE_LEDGER_ENV]?.trim();
  if (explicit) return resolve(explicit);
  const root = v2DataRoot();
  if (root) return resolve(root, "usage-ledger.jsonl");
  return statePath("usage-ledger.jsonl");
}

function normalizeWeights(input?: Partial<UsageWeights>): UsageWeights {
  const read = finite(input?.read);
  const write = finite(input?.write);
  return {
    read: read !== undefined && read >= 0 ? read : DEFAULT_USAGE_WEIGHTS.read,
    write: write !== undefined && write >= 0 ? write : DEFAULT_USAGE_WEIGHTS.write,
    source: input?.source === "catalog" ? "catalog" : "default",
  };
}

function compareCounters(a: UsageCounters, b: UsageCounters): boolean {
  return (
    a.input >= b.input &&
    a.output >= b.output &&
    a.reasoning >= b.reasoning &&
    a.cacheRead >= b.cacheRead &&
    a.cacheWrite >= b.cacheWrite
  );
}

export class UsageLedger {
  private readonly path: string;
  private readonly weights: UsageWeights;
  private readonly getSession?: UsageLedgerOptions["getSession"];
  private readonly listSessions?: UsageLedgerOptions["listSessions"];
  private readonly now: () => number;
  private readonly maxBytes: number;
  private readonly states = new Map<string, SessionState>();
  private pending: string[] = [];
  private flushChain: Promise<void> = Promise.resolve();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private started = false;
  private rows = 0;
  private usageRows = 0;
  private injectionRows = 0;
  private injectionBytes = 0;
  private shadowRows = 0;
  private readonly shadowSessions: Record<ShadowDetector, Set<string>> = {
    repeat: new Set(),
    echo: new Set(),
    fanout: new Set(),
  };
  private unobservedRows = 0;
  private backfilledSessions = 0;
  private lastEventAt: string | null = null;

  constructor(options: UsageLedgerOptions = {}) {
    this.path = usageLedgerPath(options.path);
    this.weights = normalizeWeights(options.weights);
    this.getSession = options.getSession;
    this.listSessions = options.listSessions;
    this.now = options.now ?? Date.now;
    this.maxBytes = options.maxBytes ?? USAGE_LEDGER_MAX_BYTES;
  }

  ledgerPath(): string {
    return this.path;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      await this.load();
    } catch (e) {
      logger.warn("[tawassul] usage ledger reload skipped:", e instanceof Error ? e.message : String(e));
    }
    try {
      await this.reconcile();
    } catch (e) {
      logger.warn("[tawassul] usage ledger backfill skipped (fail-open):", e instanceof Error ? e.message : String(e));
    }
  }

  async load(): Promise<void> {
    const files = [`${this.path}.1`, this.path];
    for (const file of files) {
      let text = "";
      try {
        text = await readFile(file, "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        this.absorb(parsed);
      }
    }
  }

  private absorb(value: unknown): void {
    const row = record(value);
    if (!row) return;
    if (row.kind === "injection") {
      const bytes = finite(row.bytes);
      if (bytes === undefined || bytes < 0) return;
      this.rows += 1;
      this.injectionRows += 1;
      this.injectionBytes += bytes;
      return;
    }
    if (row.kind === "shadow") {
      const detector = row.detector;
      const sessionID = typeof row.sessionID === "string" ? row.sessionID : "";
      if (detector !== "repeat" && detector !== "echo" && detector !== "fanout") return;
      if (!sessionID) return;
      this.rows += 1;
      this.shadowRows += 1;
      this.shadowSessions[detector].add(sessionID);
      return;
    }
    if (row.kind !== "usage") return;
    const raw = record(row.raw);
    const sessionID = typeof row.sessionID === "string" ? row.sessionID : "";
    if (!raw || !sessionID) return;
    const counters: UsageCounters = {
      input: positive(raw.input),
      output: positive(raw.output),
      reasoning: positive(raw.reasoning),
      cacheRead: positive(raw.cacheRead),
      cacheWrite: positive(raw.cacheWrite),
    };
    const cost = positive(raw.cost);
    const parentID = typeof row.parentID === "string" ? row.parentID : null;
    const depth = finite(row.depth);
    const agent = typeof row.agent === "string" ? row.agent : null;
    const turn = finite(row.turn);
    const ts = typeof row.ts === "string" ? row.ts : null;
    const existing = this.states.get(sessionID);
    this.states.set(sessionID, {
      id: sessionID,
      parentID: parentID ?? existing?.parentID ?? null,
      agent: agent ?? existing?.agent ?? null,
      depth: depth ?? existing?.depth ?? null,
      raw: { ...counters, cost },
      turn: turn ?? existing?.turn ?? 0,
      seenAt: ts ? Date.parse(ts) || this.now() : this.now(),
      backfilled: row.source === "session.list" || existing?.backfilled === true,
    });
    this.rows += 1;
    this.usageRows += 1;
    if (row.unobserved === true) this.unobservedRows += 1;
    if (ts) this.lastEventAt = ts;
  }

  async reconcile(): Promise<void> {
    if (!this.listSessions) return;
    const collected: UsageSessionSnapshot[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < USAGE_LEDGER_MAX_PAGES; page += 1) {
      const response = await this.listSessions(
        cursor ? { limit: USAGE_LEDGER_PAGE_LIMIT, order: "desc", cursor } : { limit: USAGE_LEDGER_PAGE_LIMIT, order: "desc" },
      );
      const list = Array.isArray(response) ? response : response?.data;
      if (!list || list.length === 0) break;
      collected.push(...list);
      const next = Array.isArray(response) ? undefined : response?.cursor?.next;
      if (!next) break;
      cursor = next;
    }
    const byID = new Map<string, UsageSessionSnapshot>();
    for (const entry of collected) {
      if (typeof entry.id === "string" && entry.id) byID.set(entry.id, entry);
    }
    const depthOf = (id: string, seen: Set<string>): number | null => {
      if (seen.has(id)) return null;
      seen.add(id);
      const entry = byID.get(id) ?? this.states.get(id);
      const parentID = entry?.parentID;
      if (!parentID) return 0;
      const parent = byID.get(parentID) ?? this.states.get(parentID);
      if (!parent) return null;
      const depth = depthOf(parentID, seen);
      return depth === null ? null : depth + 1;
    };
    for (const entry of collected) {
      const id = typeof entry.id === "string" ? entry.id : "";
      if (!id) continue;
      const counters = countersOf(entry);
      if (!counters) continue;
      const cost = positive(entry.cost);
      if (isZeroCounters(counters, cost)) continue;
      const parentID = typeof entry.parentID === "string" && entry.parentID ? entry.parentID : null;
      const agent = typeof entry.agent === "string" ? entry.agent : null;
      const depth = depthOf(id, new Set());
      const existing = this.states.get(id);
      if (!existing) {
        this.emitUsage({
          sessionID: id,
          parentID,
          depth,
          agent,
          raw: { ...counters, cost },
          delta: { ...counters, cost },
          turn: 0,
          source: "session.list",
          unobserved: false,
          resync: false,
        });
        const state = this.states.get(id);
        if (state) state.backfilled = true;
        this.backfilledSessions += 1;
        continue;
      }
      const previous: UsageRawCounters = { ...existing.raw };
      if (!compareCounters(counters, previous)) continue;
      const gap: UsageCounters = {
        input: counters.input - previous.input,
        output: counters.output - previous.output,
        reasoning: counters.reasoning - previous.reasoning,
        cacheRead: counters.cacheRead - previous.cacheRead,
        cacheWrite: counters.cacheWrite - previous.cacheWrite,
      };
      const costGap = Math.max(0, cost - previous.cost);
      if (isZeroCounters(gap, costGap)) continue;
      this.emitUsage({
        sessionID: id,
        parentID: parentID ?? existing.parentID,
        depth: depth ?? existing.depth,
        agent: agent ?? existing.agent,
        raw: { ...counters, cost },
        delta: { ...gap, cost: costGap },
        turn: existing.turn,
        source: "session.list",
        unobserved: true,
        resync: false,
        backfilled: existing.backfilled,
      });
      this.unobservedRows += 1;
    }
  }

  async handleEvent(raw: unknown): Promise<boolean> {
    const parsed = parseUsageEvent(raw);
    if (!parsed) return false;
    await this.ensureLineage(parsed.sessionID, new Set());
    this.ingest(parsed);
    return true;
  }

  ingest(event: UsageEventRecord): UsageLedgerRow {
    const existing = this.states.get(event.sessionID);
    const raw: UsageRawCounters = { ...event.tokens, cost: event.cost };
    let delta: UsageCounters;
    let resync = false;
    let costDelta = event.cost;
    if (existing) {
      const diff = diffCounters(existing.raw, event.tokens);
      delta = diff.delta;
      resync = diff.resync;
      costDelta = resync ? event.cost : Math.max(0, event.cost - existing.raw.cost);
    } else {
      delta = { ...event.tokens };
    }
    const row = this.emitUsage({
      sessionID: event.sessionID,
      parentID: existing?.parentID ?? null,
      depth: existing?.depth ?? null,
      agent: existing?.agent ?? null,
      raw,
      delta: { ...delta, cost: costDelta },
      turn: (existing?.turn ?? 0) + 1,
      source: "event",
      unobserved: false,
      resync,
    });
    return row;
  }

  private emitUsage(input: {
    sessionID: string;
    parentID: string | null;
    depth: number | null;
    agent: string | null;
    raw: UsageRawCounters;
    delta: UsageRawCounters;
    turn: number;
    source: "event" | "session.list";
    unobserved: boolean;
    resync: boolean;
    backfilled?: boolean;
  }): UsageLedgerRow {
    const ts = new Date(this.now()).toISOString();
    const deltaCounters: UsageCounters = {
      input: input.delta.input,
      output: input.delta.output,
      reasoning: input.delta.reasoning,
      cacheRead: input.delta.cacheRead,
      cacheWrite: input.delta.cacheWrite,
    };
    const row: UsageLedgerRow = {
      v: USAGE_LEDGER_VERSION,
      kind: "usage",
      ts,
      source: input.source,
      sessionID: input.sessionID,
      parentID: input.parentID,
      depth: input.depth,
      agent: input.agent,
      raw: { ...input.raw },
      delta: { ...input.delta },
      billable: computeBillable(deltaCounters, this.weights),
      billableUnit: "weighted_tokens",
      costCumulative: input.raw.cost,
      costUnpriced: input.raw.cost === 0,
      weights: { ...this.weights },
      contextSize: contextSizeOf(input.raw),
      turn: input.turn,
      unobserved: input.unobserved,
      resync: input.resync,
    };
    this.states.set(input.sessionID, {
      id: input.sessionID,
      parentID: input.parentID,
      agent: input.agent,
      depth: input.depth,
      raw: { ...input.raw },
      turn: input.turn,
      seenAt: this.now(),
      backfilled: input.backfilled ?? input.source === "session.list",
    });
    this.rows += 1;
    this.usageRows += 1;
    this.lastEventAt = ts;
    this.enqueue(JSON.stringify(row));
    return row;
  }

  recordInjection(input: { sessionID: string; source: string; bytes: number }): UsageInjectionRow | undefined {
    if (this.disposed) return undefined;
    if (!input.sessionID) return undefined;
    const bytes = finite(input.bytes);
    if (bytes === undefined || bytes < 0) return undefined;
    const row: UsageInjectionRow = {
      v: USAGE_LEDGER_VERSION,
      kind: "injection",
      ts: new Date(this.now()).toISOString(),
      sessionID: input.sessionID,
      source: input.source,
      bytes: Math.round(bytes),
    };
    this.rows += 1;
    this.injectionRows += 1;
    this.injectionBytes += row.bytes;
    this.enqueue(JSON.stringify(row));
    return row;
  }

  recordShadow(input: {
    detector: ShadowDetector;
    sessionID: string;
    tripped: boolean;
    count: number;
    detail?: Record<string, unknown>;
  }): UsageShadowRow | undefined {
    if (this.disposed) return undefined;
    if (!input.sessionID) return undefined;
    const count = finite(input.count);
    if (count === undefined || count < 0) return undefined;
    const row: UsageShadowRow = {
      v: USAGE_LEDGER_VERSION,
      kind: "shadow",
      ts: new Date(this.now()).toISOString(),
      detector: input.detector,
      sessionID: input.sessionID,
      tripped: input.tripped === true,
      count,
      detail: input.detail ?? {},
    };
    this.rows += 1;
    this.shadowRows += 1;
    this.shadowSessions[input.detector].add(input.sessionID);
    this.enqueue(JSON.stringify(row));
    return row;
  }

  summary(): UsageLedgerSummary {
    const roots: number[] = [];
    const children: number[] = [];
    let priced = 0;
    let unpriced = 0;
    let orphanChildren = 0;
    let lineageUnknown = 0;
    for (const state of this.states.values()) {
      const billable = computeBillable(state.raw, this.weights);
      if (state.parentID) {
        children.push(billable);
        if (!this.states.has(state.parentID)) orphanChildren += 1;
      } else {
        if (state.depth === null) lineageUnknown += 1;
        roots.push(billable);
      }
      if (state.raw.cost > 0) priced += 1;
      else unpriced += 1;
    }
    const unit: UsageLedgerSummary["unit"] =
      priced > 0 && unpriced > 0 ? "mixed" : priced > 0 ? "usd" : unpriced > 0 ? "weighted_tokens" : "none";
    return {
      enabled: !this.disposed,
      path: this.path,
      rows: this.rows,
      usageRows: this.usageRows,
      injectionRows: this.injectionRows,
      injectionBytes: this.injectionBytes,
      shadowRows: this.shadowRows,
      repeatSessions: this.shadowSessions.repeat.size,
      echoSessions: this.shadowSessions.echo.size,
      fanoutSessions: this.shadowSessions.fanout.size,
      sessions: this.states.size,
      roots: roots.length,
      children: children.length,
      orphanChildren,
      lineageUnknown,
      pricedSessions: priced,
      unpricedSessions: unpriced,
      unobservedRows: this.unobservedRows,
      backfilledSessions: this.backfilledSessions,
      lastEventAt: this.lastEventAt,
      unit,
      root: percentileSet(roots),
      child: percentileSet(children),
    };
  }

  sessionCount(): number {
    return this.states.size;
  }

  sessionSnapshot(sessionID: string): {
    sessionID: string;
    parentID: string | null;
    depth: number | null;
    agent: string | null;
    billable: number;
    cost: number;
    costUnpriced: boolean;
    turn: number;
    backfilled: boolean;
  } | undefined {
    const state = this.states.get(sessionID);
    if (!state) return undefined;
    return {
      sessionID: state.id,
      parentID: state.parentID,
      depth: state.depth,
      agent: state.agent,
      billable: computeBillable(state.raw, this.weights),
      cost: state.raw.cost,
      costUnpriced: state.raw.cost === 0,
      turn: state.turn,
      backfilled: state.backfilled,
    };
  }

  private async ensureLineage(sessionID: string, seen: Set<string>): Promise<void> {
    if (!this.getSession || seen.has(sessionID)) return;
    seen.add(sessionID);
    const existing = this.states.get(sessionID);
    if (existing && existing.depth !== null) return;
    let snapshot: UsageSessionSnapshot | undefined | null;
    try {
      snapshot = await this.getSession(sessionID);
    } catch {
      return;
    }
    if (!snapshot) return;
    const parentID = typeof snapshot.parentID === "string" && snapshot.parentID ? snapshot.parentID : null;
    const agent = typeof snapshot.agent === "string" ? snapshot.agent : null;
    if (parentID) await this.ensureLineage(parentID, seen);
    let depth: number | null = 0;
    if (parentID) {
      const parentDepth = this.states.get(parentID)?.depth;
      depth = parentDepth === undefined || parentDepth === null ? null : parentDepth + 1;
    }
    const state = this.states.get(sessionID);
    const raw = state?.raw ?? { ...EMPTY_COUNTERS, cost: 0 };
    this.states.set(sessionID, {
      id: sessionID,
      parentID: parentID ?? state?.parentID ?? null,
      agent: agent ?? state?.agent ?? null,
      depth,
      raw,
      turn: state?.turn ?? 0,
      seenAt: state?.seenAt ?? this.now(),
      backfilled: state?.backfilled ?? false,
    });
  }

  private enqueue(line: string): void {
    this.pending.push(line);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.disposed) return;
    const timer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush().catch((e) => {
        logger.warn("[tawassul] usage ledger flush failed:", e instanceof Error ? e.message : String(e));
      });
    }, USAGE_LEDGER_FLUSH_MS);
    timer.unref?.();
    this.flushTimer = timer;
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    const text = `${batch.join("\n")}\n`;
    this.flushChain = this.flushChain.then(() => this.append(text)).catch((e) => {
      this.pending = [...batch, ...this.pending];
      logger.warn("[tawassul] usage ledger append failed, keeping buffer:", e instanceof Error ? e.message : String(e));
    });
    await this.flushChain;
  }

  private async append(text: string): Promise<void> {
    const dir = dirname(this.path);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      const size = (await stat(this.path)).size;
      if (size > this.maxBytes) await rename(this.path, `${this.path}.1`);
    } catch {
      const ignored = undefined;
      void ignored;
    }
    await appendFile(this.path, text, { mode: 0o600 });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}

let activeLedger: UsageLedger | null = null;

export function installUsageLedger(options: UsageLedgerOptions = {}): UsageLedger {
  const previous = activeLedger;
  const ledger = new UsageLedger(options);
  activeLedger = ledger;
  if (previous) void previous.dispose().catch(() => undefined);
  return ledger;
}

export function getUsageLedger(): UsageLedger | null {
  return activeLedger;
}

export async function clearUsageLedger(): Promise<void> {
  const ledger = activeLedger;
  activeLedger = null;
  if (ledger) await ledger.dispose();
}
