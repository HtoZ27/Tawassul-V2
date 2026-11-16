import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dataRoot } from "../bootstrap/db-isolation.ts";
import { bundleFingerprint } from "../utils/bundle-fingerprint.ts";
import { logger } from "../utils/logger.ts";

const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STALE_LOCK_MS = 3 * 60 * 60 * 1000;
const MIN_RUN_GAP_MS = 24 * 60 * 60 * 1000;

function dbMaintenanceRoot(): string {
  return resolve(dataRoot(), "tawassul-v2", "db-maintenance");
}

function stampPath(): string {
  return resolve(dbMaintenanceRoot(), "last-run.stamp");
}

function lockPath(): string {
  return resolve(dbMaintenanceRoot(), "trigger.lock");
}

function canonicalRepo(projectDir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(resolve(projectDir, "package.json"), "utf-8")) as { name?: unknown };
    return pkg.name === "tawassul-v2";
  } catch {
    return false;
  }
}

function laneScript(projectDir: string): string | undefined {
  const override = process.env.TAWASSUL_DB_SCRIPT?.trim();
  if (override) return existsSync(override) ? override : undefined;
  const pluginDir = dirname(fileURLToPath(import.meta.url));
  const runtime = resolve(pluginDir, "..", "tawassul-runtime", "db", "opencode-db-scheduled.sh");
  if (existsSync(runtime)) return runtime;
  if (!canonicalRepo(projectDir)) return undefined;
  const local = resolve(projectDir, "scripts", "opencode-db-scheduled.sh");
  return existsSync(local) ? local : undefined;
}

function dbExists(): boolean {
  const override = process.env.OPENCODE_DB?.trim();
  return existsSync(override || resolve(dataRoot(), "opencode", "opencode.db"));
}

function stampFresh(): boolean {
  try {
    return Date.now() - statSync(stampPath()).mtimeMs < MIN_RUN_GAP_MS;
  } catch {
    return false;
  }
}

function lockOwnerAlive(lock: string): boolean | undefined {
  try {
    const raw = readFileSync(resolve(lock, "pid"), "utf-8").trim();
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return undefined;
  }
}

function acquireLock(): boolean {
  const lock = lockPath();
  mkdirSync(dirname(lock), { recursive: true });
  try {
    mkdirSync(lock);
    return true;
  } catch (error) {
    const err = error as { code?: string };
    if (err.code !== "EEXIST") throw error;
    const alive = lockOwnerAlive(lock);
    if (alive === true) return false;
    if (alive === undefined) {
      try {
        if (Date.now() - statSync(lock).mtimeMs < STALE_LOCK_MS) return false;
      } catch {
        return false;
      }
    }
    rmSync(lock, { recursive: true, force: true });
    try {
      mkdirSync(lock);
      return true;
    } catch {
      return false;
    }
  }
}

function recordLockOwner(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    writeFileSync(resolve(lockPath(), "pid"), `${pid}\n`, { mode: 0o600 });
  } catch {
    return;
  }
}

function releaseLock(): void {
  try {
    rmSync(lockPath(), { recursive: true, force: true });
  } catch {
    return;
  }
}

function attemptRun(projectDir: string, why: string): void {
  try {
    if (stampFresh()) return;
    const script = laneScript(projectDir);
    if (!script) {
      logger.debug("[tawassul] db maintenance lane script missing — retry next cycle");
      return;
    }
    if (!dbExists()) {
      logger.debug("[tawassul] no DB file yet — nothing to maintain");
      return;
    }
    if (!acquireLock()) return;
    const child = spawn("bash", [script, "--run"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, TAWASSUL_TRIGGER_LOCK: lockPath() },
    });
    recordLockOwner(child.pid);
    child.unref();
    child.on("error", releaseLock);
    logger.debug(`[tawassul] db maintenance spawned (${why})`);
  } catch (error) {
    logger.debug("[tawassul] db maintenance trigger skipped:", (error as Error)?.message ?? error);
    releaseLock();
  }
}

export type DbMaintenanceState = "enabled" | "disabled" | "unavailable";

export function dbMaintenanceState(): DbMaintenanceState {
  if (process.platform === "win32") return "unavailable";
  const raw = process.env.TAWASSUL_DB_MAINTENANCE?.trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false" || raw === "disabled") return "disabled";
  return "enabled";
}

function noticePath(): string | undefined {
  const fingerprint = bundleFingerprint();
  if (!fingerprint) return undefined;
  return resolve(dbMaintenanceRoot(), `notice-${fingerprint.sha256.slice(0, 12)}`);
}

function announceOnce(): void {
  try {
    const file = noticePath();
    if (file && existsSync(file)) return;
    logger.info(
      "[tawassul] db maintenance is enabled: backup, prune and VACUUM run in the background; " +
        "set TAWASSUL_DB_MAINTENANCE=off to disable it (see docs/database.md)",
    );
    if (file) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${new Date().toISOString()}\n`, { mode: 0o600 });
    }
  } catch {
    return;
  }
}

export function armDbMaintenanceTrigger(projectDir: string): void {
  const state = dbMaintenanceState();
  if (state === "unavailable") {
    logger.debug("[tawassul] db maintenance is unavailable on Windows");
    return;
  }
  if (state === "disabled") {
    logger.debug("[tawassul] db maintenance is disabled by TAWASSUL_DB_MAINTENANCE");
    return;
  }
  announceOnce();
  try {
    attemptRun(projectDir, "boot");
    const timer = setInterval(() => attemptRun(projectDir, "interval"), RUN_INTERVAL_MS);
    timer.unref();
  } catch (error) {
    logger.debug("[tawassul] db maintenance trigger skipped:", (error as Error)?.message ?? error);
  }
}
