import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dataRoot } from "../bootstrap/db-isolation.ts";
import { bundleFingerprint } from "../utils/bundle-fingerprint.ts";
import { logger } from "../utils/logger.ts";

const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STALE_LOCK_MS = 3 * 60 * 60 * 1000;
let gapEnvWarned = false;

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

function gapSeconds(projectDir: string): number {
  const env = process.env.TAWASSUL_DB_GAP_SECONDS?.trim();
  if (env) {
    const value = Number(env);
    if (Number.isInteger(value) && value >= 0) return value;
    if (!gapEnvWarned) {
      gapEnvWarned = true;
      logger.warn("[tawassul] TAWASSUL_DB_GAP_SECONDS is not a non-negative integer; using the marker value");
    }
  }
  const script = laneScript(projectDir);
  if (script) {
    try {
      const parsed = JSON.parse(readFileSync(resolve(dirname(script), "MAINTENANCE"), "utf-8")) as {
        gapSeconds?: unknown;
      };
      const value = parsed.gapSeconds;
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
    } catch {
      return 86400;
    }
  }
  return 86400;
}

function stampFresh(projectDir: string): boolean {
  try {
    return Date.now() - statSync(stampPath()).mtimeMs < gapSeconds(projectDir) * 1000;
  } catch {
    return false;
  }
}

function readPid(file: string): number | undefined {
  try {
    const raw = readFileSync(file, "utf-8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function readAt(file: string): number | undefined {
  try {
    const raw = readFileSync(file, "utf-8").trim();
    const at = Number(raw);
    return Number.isInteger(at) && at >= 0 ? at : undefined;
  } catch {
    return undefined;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockState(lock: string): "alive" | "dead" | "unknown" {
  const pid = readPid(resolve(lock, "pid"));
  if (pid === undefined) return "unknown";
  return pidAlive(pid) ? "alive" : "dead";
}

function lockMtime(lock: string): number | undefined {
  try {
    return statSync(lock).mtimeMs;
  } catch {
    return undefined;
  }
}

function reclaimStale(mutex: string): boolean {
  const pid = readPid(resolve(mutex, "pid"));
  const at = readAt(resolve(mutex, "at"));
  const now = Date.now();
  if (pid !== undefined) {
    if (!pidAlive(pid)) return true;
    if (at !== undefined && now / 1000 - at > 120) return true;
    return false;
  }
  if (at !== undefined && now / 1000 - at > 120) return true;
  const mtime = lockMtime(mutex);
  return mtime !== undefined && now - mtime > STALE_LOCK_MS;
}

function writePid(dir: string, pid: number): void {
  try {
    writeFileSync(resolve(dir, "pid"), `${pid}\n`, { mode: 0o600 });
  } catch {
    return;
  }
}

function takeMutex(mutex: string): boolean {
  try {
    mkdirSync(mutex);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") return false;
    if (!reclaimStale(mutex)) return false;
    rmSync(mutex, { recursive: true, force: true });
    try {
      mkdirSync(mutex);
    } catch {
      return false;
    }
  }
  writePid(mutex, process.pid);
  try {
    writeFileSync(resolve(mutex, "at"), `${Math.floor(Date.now() / 1000)}\n`, { mode: 0o600 });
  } catch {
    return true;
  }
  return true;
}

function sweepStaleTombstones(root: string): void {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith("trigger.lock.stale.")) continue;
    const path = resolve(root, entry);
    const mtime = lockMtime(path);
    if (mtime !== undefined && Date.now() - mtime > STALE_LOCK_MS) {
      rmSync(path, { recursive: true, force: true });
    }
  }
}

function acquireLock(): boolean {
  const lock = lockPath();
  const root = dbMaintenanceRoot();
  mkdirSync(root, { recursive: true });
  sweepStaleTombstones(root);
  try {
    mkdirSync(lock);
    writePid(lock, process.pid);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
  }
  const initial = lockState(lock);
  if (initial === "alive") return false;
  if (initial === "unknown") {
    const mtime = lockMtime(lock);
    if (mtime === undefined || Date.now() - mtime < STALE_LOCK_MS) return false;
  }
  const mutex = `${lock}.reclaim`;
  if (!takeMutex(mutex)) return false;
  try {
    const again = lockState(lock);
    if (again === "alive") return false;
    if (again === "unknown") {
      const mtime = lockMtime(lock);
      if (mtime === undefined || Date.now() - mtime < STALE_LOCK_MS) return false;
    }
    const tombstone = `${lock}.stale.${process.pid}`;
    try {
      renameSync(lock, tombstone);
    } catch {
      return false;
    }
    rmSync(tombstone, { recursive: true, force: true });
    try {
      mkdirSync(lock);
    } catch {
      return false;
    }
    writePid(lock, process.pid);
    return true;
  } finally {
    rmSync(mutex, { recursive: true, force: true });
  }
}

function recordLockOwner(pid: number): void {
  writePid(lockPath(), pid);
}

function releaseLock(pid: number): void {
  const lock = lockPath();
  if (readPid(resolve(lock, "pid")) !== pid) return;
  const mutex = `${lock}.reclaim`;
  if (!takeMutex(mutex)) return;
  try {
    if (readPid(resolve(lock, "pid")) !== pid) return;
    rmSync(lock, { recursive: true, force: true });
  } finally {
    rmSync(mutex, { recursive: true, force: true });
  }
}

function attemptRun(projectDir: string, why: string): void {
  try {
    if (stampFresh(projectDir)) return;
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
    const owner = child.pid ?? process.pid;
    recordLockOwner(owner);
    child.unref();
    child.on("error", () => releaseLock(owner));
    child.on("exit", () => releaseLock(owner));
    logger.debug(`[tawassul] db maintenance spawned (${why})`);
  } catch (error) {
    logger.debug("[tawassul] db maintenance trigger skipped:", (error as Error)?.message ?? error);
    releaseLock(process.pid);
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
