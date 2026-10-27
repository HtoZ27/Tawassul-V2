import { tool } from "../../tool.ts";
import type { ToolDefinition } from "../../tool.ts";
import type { TawassulContext } from "../../context.ts";
import { countPendingPersists } from "../../services/persist-utils.ts";
import { logger } from "../../utils/logger.ts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defaultKeyFile, classifyDbLane, isolatedDbPathFor } from "../../bootstrap/db-isolation.ts";
import { scopedStatePath, statePath } from "../../utils/state-paths.ts";

const LAG_WARN_THRESHOLD_MS = 500;
const LAG_SPIKE_CAP = 20;
const LAG_SPIKE_LOG_THROTTLE_MS = 60000;

export interface LagSpike {
  timestamp: number;
  lagMs: number;
}

const lagSpikes: LagSpike[] = [];
let lastLagWarnAt = 0;

export function recordLagSpike(lagMs: number, now = Date.now()): void {
  if (lagMs <= LAG_WARN_THRESHOLD_MS) return;
  if (lagSpikes.length >= LAG_SPIKE_CAP) lagSpikes.shift();
  lagSpikes.push({ timestamp: now, lagMs });
  if (now - lastLagWarnAt >= LAG_SPIKE_LOG_THROTTLE_MS) {
    lastLagWarnAt = now;
    logger.warn(`[tawassul] event-loop lag ${Math.round(lagMs)}ms exceeded ${LAG_WARN_THRESHOLD_MS}ms`);
  }
}

export function lagSpikeSummary(): readonly LagSpike[] {
  return lagSpikes;
}

export function resetLagSpikes(): void {
  lagSpikes.length = 0;
  lastLagWarnAt = 0;
}

export function measureEventLoopLag(): Promise<number> {
  const start = performance.now();
  return new Promise<number>((resolve) => {
    setImmediate(() => resolve(performance.now() - start));
  });
}

export interface HealthToolDeps {
  measureLag?: () => Promise<number>;
  rssMb?: () => number;
  pendingFlushes?: () => number;
}

export function buildHealthTool(ctx: TawassulContext, deps: HealthToolDeps = {}): ToolDefinition {
  const measureLag = deps.measureLag ?? measureEventLoopLag;
  const rssMb = deps.rssMb ?? (() => Math.round(process.memoryUsage().rss / 1048576));
  const pendingFlushes = deps.pendingFlushes ?? countPendingPersists;
  return tool({
    description: [
      "Report plugin health — event-loop lag, RSS, active timers, DB isolation, install scope, state paths, pending flushes.",
      "Read-only; no state changes.",
      "",
      "EXAMPLES:",
      "  health() — full health snapshot",
    ].join("\n"),
    args: {},
    async execute() {
      const lagMs = Math.round(await measureLag());
      recordLagSpike(lagMs);
      const rss = rssMb();
      const activeTimers = ctx.timerManager?.activeCount ?? 0;
      const dbEnv = process.env.OPENCODE_DB?.trim() ?? "";
      const dbLane = classifyDbLane(dbEnv);
      const dbIsolated = dbLane !== "shared" && dbLane !== "unset";
      const keyFile = defaultKeyFile();
      const keyPresent = existsSync(keyFile);
      const expectedDb = keyPresent ? isolatedDbPathFor(ctx.stateDir, keyFile) : null;
      const desktopSidecar = dbLane === "desktop-sidecar";
      const dbMatches = desktopSidecar
        ? true
        : dbEnv && expectedDb
          ? resolve(dbEnv) === resolve(expectedDb)
          : null;
      const routerFile = scopedStatePath(ctx.stateDir, ctx.scope, "predictive-router.json");
      const legacyRouterFile = statePath("predictive-router.json");
      const flushes = pendingFlushes();
      return {
        title: "Health",
        output: [
          "## Health",
          `- Event-loop lag: ${lagMs}ms`,
          `- RSS: ${rss} MiB`,
          `- Active timers: ${activeTimers}`,
          `- DB: ${dbIsolated ? "isolated" : "shared"}`,
          `- DB lane: ${dbLane}`,
          `- DB path: ${dbEnv || "(unset)"}`,
          `- DB expected: ${expectedDb ?? "(no HMAC key)"}`,
          `- DB matches isolation: ${dbMatches === null ? "unknown" : dbMatches ? "yes" : "no"}`,
          `- Scope: ${ctx.scope}`,
          `- State dir: ${ctx.stateDir}`,
          `- State file: ${ctx.statePath()}`,
          `- Router file: ${routerFile} (${existsSync(routerFile) ? "exists" : "missing"})`,
          `- Router legacy: ${legacyRouterFile} (${existsSync(legacyRouterFile) ? "exists" : "missing"})`,
          `- HMAC key: ${keyFile} (${keyPresent ? "present" : "missing"})`,
          `- Pending flushes: ${flushes}`,
        ].join("\n"),
      };
    },
  });
}