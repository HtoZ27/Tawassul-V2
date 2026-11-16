









import { logger } from "../utils/logger.ts";
import { atomicWriteFile } from "../infra/disk-utils.ts";
import { isIsolationActiveSync } from "./isolation.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";

export const NOTIFICATION_EMITTED = "NOTIFICATION_EMITTED";

function metricsPath(stateDir: string): string {
  return resolve(stateDir, ".opencode", "activity-metrics.json");
}

export interface NotificationConfig {
  
  rateLimitMs?: number;
}

export interface ActivityMetric {
  agent: string;
  tool: string;
  totalMs: number;
  calls: number;
}

export class BackgroundNotifier {
  private readonly rateLimitMs: number;
  private readonly lastSent = new Map<string, number>();
  private readonly activity = new Map<string, ActivityMetric>();
  private readonly emit?: (type: string, payload: Record<string, unknown>) => void;

  constructor(cfg: NotificationConfig = {}, emit?: (type: string, payload: Record<string, unknown>) => void) {
    this.rateLimitMs = cfg.rateLimitMs ?? 60_000; 
    this.emit = emit;
  }

  
  notify(category: string, payload: Record<string, unknown> = {}): boolean {
    const now = Date.now();
    const last = this.lastSent.get(category) ?? 0;
    if (now - last < this.rateLimitMs) return false;
    this.lastSent.set(category, now);
    try {
      this.emit?.(NOTIFICATION_EMITTED, { category, ...payload });
    } catch (e) {
      logger.warn("background-notifier emit failed:", e);
    }
    return true;
  }

  
  recordActivity(agent: string, tool: string, ms: number): void {
    if (ms < 0) ms = 0;
    const key = `${normalizeName(agent)} ${tool}`;
    const m = this.activity.get(key) ?? { agent: normalizeName(agent), tool, totalMs: 0, calls: 0 };
    m.totalMs += ms;
    m.calls += 1;
    this.activity.set(key, m);
  }

  getActivityMetrics(): ActivityMetric[] {
    return [...this.activity.values()].sort((a, b) => b.totalMs - a.totalMs);
  }

  
  get totalActiveMs(): number {
    return [...this.activity.values()].reduce((s, m) => s + m.totalMs, 0);
  }

  
  async save(stateDir: string): Promise<void> {
    if (isIsolationActiveSync()) return; 
    const p = metricsPath(stateDir);
    try {
      await mkdir(dirname(p), { recursive: true });
    } catch {

    }
    const data = JSON.stringify({ metrics: this.getActivityMetrics() }, null, 2);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await atomicWriteFile(p, data);
        return;
      } catch (e) {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 5 * (attempt + 1)));
        else logger.warn("activity-metrics save failed after 3 attempts:", e);
      }
    }
  }

  
  async load(stateDir: string): Promise<void> {
    if (isIsolationActiveSync()) return;
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(metricsPath(stateDir), "utf-8");
      const parsed = JSON.parse(raw) as { metrics?: unknown };
      if (Array.isArray(parsed.metrics)) {
        for (const m of parsed.metrics as ActivityMetric[]) {
          if (m && typeof m.agent === "string" && typeof m.tool === "string") {
            this.recordActivity(m.agent, m.tool, m.totalMs);
          }
        }
      }
    } catch {

    }
  }
}
