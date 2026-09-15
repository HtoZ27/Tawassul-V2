
import { appendFile, mkdir, access, readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { logger } from "../utils/logger.ts";
import { hmacWriteFile, hmacReadFile } from "./persist-utils.ts";
import { isIsolationActiveSync } from "./isolation.ts";
import { normalizeName } from "../utils/name-utils.ts";
import type { TimerManagerLike } from "../types/timer-types.ts";
import type {
  TimelineEntry,
  TimelineEntryInput,
  TimelineDailySummary,
  TimelineQuery,
  TimelineAchievements,
  TimelineStats,
} from "../types/timeline-types.ts";

export interface TimelineStoreOptions {
  maxEntries?: number;
  maxAgeMs?: number;
  flushIntervalMs?: number;
  timers?: TimerManagerLike;
}

const DEFAULT_MAX_ENTRIES = 50_000;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; 
const FLUSH_INTERVAL_MS = 5_000;
const WARN_THRESHOLD = 0.8; 
const META_SCHEMA_VERSION = 1;

interface TimelineMeta {
  schemaVersion: number;
  seq: number;
  createdAt: string;
  updatedAt: string;
  count: number;
}


function dayKey(ts: string): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tsMs(ts: string): number {
  return new Date(ts).getTime();
}

export class TimelineStore {
  private eventsPath: string;
  private metaPath: string;
  private dirReady: Promise<void>;
  private timers: TimerManagerLike | null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private warned = false;

  private maxEntries: number;
  private maxAgeMs: number;
  private flushIntervalMs: number;

  
  private entries: TimelineEntry[] = [];
  private byDay = new Map<string, number[]>();
  private byAgent = new Map<string, number[]>();
  private byType = new Map<string, number[]>();
  private seq = 0;
  private monotonic = true;
  private lastTsMs = 0;
  private flushBuffer: TimelineEntry[] = [];

  constructor(baseDir: string, options: TimelineStoreOptions = {}) {
    const dir = resolve(baseDir, "timeline");
    this.eventsPath = join(dir, "events.jsonl");
    this.metaPath = join(dir, "timeline-meta.json");
    this.dirReady = this.ensureDir();
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    this.timers = options.timers ?? null;
  }

  private async ensureDir(): Promise<void> {
    try {
      await access(dirname(this.eventsPath));
    } catch {
      await mkdir(dirname(this.eventsPath), { recursive: true, mode: 0o700 });
    }
  }

  
  append(input: TimelineEntryInput): TimelineEntry {
    const ts = input.timestamp ?? new Date().toISOString();
    const tsNum = tsMs(ts);
    if (tsNum < this.lastTsMs) this.monotonic = false;
    else this.lastTsMs = tsNum;

    const entry: TimelineEntry = {
      id: input.id ?? `tl-${this.seq}`,
      timestamp: ts,
      type: input.type,
      summary: input.summary,
      ...(input.agent !== undefined ? { agent: input.agent } : {}),
      ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      ...(input.boardId !== undefined ? { boardId: input.boardId } : {}),
      ...(input.discussionId !== undefined ? { discussionId: input.discussionId } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.success !== undefined ? { success: input.success } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    };

    const idx = this.entries.length;
    this.entries.push(entry);
    pushIndex(this.byDay, dayKey(ts), idx);
    if (entry.agent) pushIndex(this.byAgent, normalizeName(entry.agent), idx);
    pushIndex(this.byType, entry.type, idx);
    this.seq++;

    
    if (!this.warned && this.entries.length >= this.maxEntries * WARN_THRESHOLD) {
      this.warned = true;
      logger.warn(
        `[timeline] reached ${this.entries.length}/${this.maxEntries} entries (${(this.entries.length * 300) / 1e6}MB) — consider raising maxEntries`,
      );
    }

    
    if (this.entries.length > this.maxEntries) this.evictOldestDay();

    this.flushBuffer.push(entry);
    this.scheduleFlush();
    return entry;
  }

  
  private evictOldestDay(): void {
    const dayKeys = [...this.byDay.keys()].sort();
    const daysToEvict = new Set<string>();
    let est = this.entries.length;
    for (const day of dayKeys) {
      if (est <= this.maxEntries) break;
      const cnt = this.byDay.get(day)?.length ?? 0;
      daysToEvict.add(day);
      est -= cnt;
    }
    if (daysToEvict.size === 0) return;
    this.entries = this.entries.filter((e) => !daysToEvict.has(dayKey(e.timestamp)));
    for (const d of daysToEvict) this.byDay.delete(d);
    this.rebuildIndexes();
  }

  
  private rebuildIndexes(): void {
    this.byDay = new Map();
    this.byAgent = new Map();
    this.byType = new Map();
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      pushIndex(this.byDay, dayKey(e.timestamp), i);
      if (e.agent) pushIndex(this.byAgent, normalizeName(e.agent), i);
      pushIndex(this.byType, e.type, i);
    }
  }

  
  query(q: TimelineQuery = {}): TimelineEntry[] {
    const n = this.entries.length;
    let lo = 0;
    let hi = n;

    if (q.from !== undefined) lo = lowerBound(this.entries, tsMs(q.from));
    if (q.to !== undefined) hi = upperBound(this.entries, tsMs(q.to));
    if (lo >= hi) return [];

    
    let candidates: number[];
    const daySet = new Set<number>();
    for (let i = lo; i < hi; i++) daySet.add(i);

    if (q.agent) {
      const agentIdx = (this.byAgent.get(q.agent) ?? []).filter((i) => i >= lo && i < hi);
      candidates = agentIdx;
    } else if (q.type) {
      candidates = (this.byType.get(q.type) ?? []).filter((i) => i >= lo && i < hi);
    } else {
      candidates = [...daySet];
    }

    let result = candidates
      .map((i) => this.entries[i])
      .filter((e): e is TimelineEntry => {
        if (e === undefined) return false;
        if (q.agent !== undefined && normalizeName(e.agent ?? "") !== normalizeName(q.agent)) return false;
        if (q.type !== undefined && e.type !== q.type) return false;
        if (q.taskId !== undefined && e.taskId !== q.taskId) return false;
        return true;
      })
      .sort((a, b) => tsMs(b.timestamp) - tsMs(a.timestamp));

    const offset = q.offset ?? 0;
    const limit = q.limit ?? 50;
    result = result.slice(offset, offset + limit);
    return result;
  }

  getDailySummary(date: string): TimelineDailySummary {
    const bucket = this.byDay.get(date) ?? [];
    const summary: TimelineDailySummary = {
      date,
      total: bucket.length,
      completed: 0,
      failed: 0,
      agents: {},
      types: {},
      totalDurationMs: 0,
    };
    for (const idx of bucket) {
      const e = this.entries[idx];
      if (!e) continue;
      const agent = normalizeName(e.agent ?? "system");
      summary.agents[agent] = (summary.agents[agent] ?? 0) + 1;
      summary.types[e.type] = (summary.types[e.type] ?? 0) + 1;
      if (e.success === true) summary.completed++;
      else if (e.success === false) summary.failed++;
      if (e.durationMs !== undefined) summary.totalDurationMs += e.durationMs;
    }
    return summary;
  }

  dailySummaries(from?: string, to?: string): TimelineDailySummary[] {
    let days = [...this.byDay.keys()].sort();
    if (from) days = days.filter((d) => d >= from);
    if (to) days = days.filter((d) => d <= to);
    return days.map((d) => this.getDailySummary(d));
  }

  getAgentTimeline(agent: string, q: TimelineQuery = {}): TimelineEntry[] {
    return this.query({ ...q, agent });
  }

  listDays(): string[] {
    return [...this.byDay.keys()].sort().reverse();
  }

  getAchievements(): TimelineAchievements {
    const completedByAgent = new Map<string, number>();
    const failedByAgent = new Map<string, number>();
    const activeDays = new Set<string>();
    let totalCompleted = 0;
    let totalFailed = 0;

    for (const e of this.entries) {
      const agent = normalizeName(e.agent ?? "system");
      activeDays.add(dayKey(e.timestamp));
      if (e.success === true) {
        totalCompleted++;
        completedByAgent.set(agent, (completedByAgent.get(agent) ?? 0) + 1);
      } else if (e.success === false) {
        totalFailed++;
        failedByAgent.set(agent, (failedByAgent.get(agent) ?? 0) + 1);
      }
    }

    const agents = [...new Set([...completedByAgent.keys(), ...failedByAgent.keys()])]
      .map((agent) => ({
        agent,
        count: completedByAgent.get(agent) ?? 0,
        failed: failedByAgent.get(agent) ?? 0,
      }))
      .sort((a, b) => b.count - a.count);

    const milestones = agents
      .filter((a) => a.count >= 10)
      .map((a) => ({
        agent: a.agent,
        level: a.count >= 100 ? "veteran" : a.count >= 50 ? "expert" : "regular",
        count: a.count,
      }));

    return { totalCompleted, totalFailed, activeDays: activeDays.size, agents, milestones };
  }

  getStats(): TimelineStats {
    return {
      entries: this.entries.length,
      seq: this.seq,
      days: this.byDay.size,
      agents: this.byAgent.size,
      maxEntries: this.maxEntries,
      maxAgeMs: this.maxAgeMs,
      monotonic: this.monotonic,
    };
  }

  
  async load(): Promise<void> {
    await this.dirReady;
    try {
      await access(this.eventsPath);
    } catch {
      
      
      this.appendActivationMarker();
      return;
    }
    const meta = await this.readMeta();
    if (meta) this.seq = meta.seq;
    try {
      const raw = await readFile(this.eventsPath, "utf-8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as TimelineEntry;
          this.ingest(entry);
        } catch {
          logger.warn("[timeline] skipping malformed event line");
        }
      }
      
      
      this.seq = Math.max(this.seq, this.entries.length);
    } catch (err) {
      logger.warn("[timeline] load failed:", err);
    }
  }

  
  private appendActivationMarker(): void {
    
    if (this.entries.length > 0) return;
    this.append({
      type: "activation",
      summary: "🟢 Timeline activated — recording started",
      success: true,
      metadata: { schemaVersion: META_SCHEMA_VERSION },
    });
  }

  
  private ingest(entry: TimelineEntry): void {
    const idx = this.entries.length;
    this.entries.push(entry);
    pushIndex(this.byDay, dayKey(entry.timestamp), idx);
    if (entry.agent) pushIndex(this.byAgent, normalizeName(entry.agent), idx);
    pushIndex(this.byType, entry.type, idx);
    const tsNum = tsMs(entry.timestamp);
    if (tsNum < this.lastTsMs) this.monotonic = false;
    else this.lastTsMs = tsNum;
  }

  
  private scheduleFlush(): void {
    if (this.flushTimer || this.disposed) return;
    const runFlush = () => {
      this.flush().catch((e) => logger.warn("[timeline] flush failed:", e));
    };
    this.flushTimer = this.timers
      ? this.timers.setTimeout(runFlush, this.flushIntervalMs)
      : (() => {
          const t = setTimeout(runFlush, this.flushIntervalMs);
          if (t?.unref) t.unref();
          return t;
        })();
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      if (this.timers) this.timers.clear(this.flushTimer);
      else clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.flushBuffer.length === 0) return;
    
    
    
    if (isIsolationActiveSync()) {
      this.flushBuffer = [];
      return;
    }
    await this.dirReady;
    const batch = this.flushBuffer;
    this.flushBuffer = [];
    try {
      
      await this.ensureDir();
      const lines = batch.map((e) => JSON.stringify(e)).join("\n") + "\n";
      await appendFile(this.eventsPath, lines, { mode: 0o600 });
      await this.writeMeta();
    } catch (e) {
      logger.warn("[timeline] flush failed, keeping buffer for retry:", e);
      this.flushBuffer.unshift(...batch);
      this.scheduleFlush();
      throw e;
    }
  }

  private async writeMeta(): Promise<void> {
    const now = new Date().toISOString();
    const meta: TimelineMeta = {
      schemaVersion: META_SCHEMA_VERSION,
      seq: this.seq,
      createdAt: await this.readCreatedAt(),
      updatedAt: now,
      count: this.entries.length,
    };
    await hmacWriteFile(this.metaPath, meta);
  }

  private async readCreatedAt(): Promise<string> {
    const meta = await this.readMeta();
    return meta?.createdAt ?? new Date().toISOString();
  }

  private async readMeta(): Promise<TimelineMeta | null> {
    try {
      return await hmacReadFile<TimelineMeta>(this.metaPath);
    } catch (err) {
      logger.warn("[timeline] meta read failed:", err);
      return null;
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.flushTimer) {
      if (this.timers) this.timers.clear(this.flushTimer);
      else clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    
    try {
      await this.flush();
    } catch (err) {
      logger.warn("[timeline] dispose flush failed:", err);
    }
  }
}


function pushIndex(map: Map<string, number[]>, key: string, idx: number): void {
  const list = map.get(key);
  if (list) list.push(idx);
  else map.set(key, [idx]);
}

function lowerBound(entries: TimelineEntry[], ts: number): number {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const e = entries[mid];
    if (e === undefined) break;
    if (tsMs(e.timestamp) < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(entries: TimelineEntry[], ts: number): number {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const e = entries[mid];
    if (e === undefined) break;
    if (tsMs(e.timestamp) <= ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
