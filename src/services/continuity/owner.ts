import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { HandoffEntry } from "../../context/types.ts";
import { isProcessAlive } from "../../utils/process.ts";
import { projectStatePath } from "../../utils/state-paths.ts";
import { logger } from "../../utils/logger.ts";

export const CONTINUITY_STALE_MS = 30 * 60_000;
export const CONTINUITY_HEARTBEAT_MS = 60_000;
export const CONTINUITY_DEBOUNCE_MS = 60_000;
export const CONTINUITY_CACHE_MAX = 64;
export const CONTINUITY_PROBE_TIMEOUT_MS = 2000;
export const CONTINUITY_WINDOWS_TIMEOUT_MS = 5000;

export type OwnerState = "live" | "stale" | "interrupted" | "unknown";
export type InterruptedReason = "gone" | "zombie" | "rebooted" | "unknown";

export type OwnerRecord = {
  pid: number;
  startedAt: number;
  bootId: string;
  heartbeatAt: string;
  sessionId: string;
};

export type OwnerProbe = {
  state: OwnerState;
  reason?: InterruptedReason;
  pid: number;
  startedAt: number;
  bootId: string;
  heartbeatAt: string;
  sessionId: string;
};

export type IdentityFacts = {
  alive: boolean;
  startedAt: number;
  bootId: string;
  processState: string | null;
};

export type OwnerVerdict = {
  state: OwnerState;
  reason?: InterruptedReason;
};

export type ContinuityRuntimeOptions = {
  baseDir: string;
  configEnabled?: boolean;
  handoffs?: () => Iterable<HandoffEntry>;
  flush?: () => Promise<void>;
};

type ContinuityRuntime = {
  baseDir: string;
  configEnabled: boolean;
  handoffs?: () => Iterable<HandoffEntry>;
  flush?: () => Promise<void>;
};

type CommandResult = {
  ok: boolean;
  stdout: string;
  code: number | null;
};

let runtime: ContinuityRuntime | null = null;
let ownerQueue: Promise<unknown> = Promise.resolve();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatInFlight: Promise<number> | null = null;
let heartbeatQueued = false;
let selfPromise: Promise<IdentityFacts | null> | null = null;

const io = { reads: 0, writes: 0, probes: 0 };

export function configureContinuity(options: ContinuityRuntimeOptions): void {
  runtime = {
    baseDir: options.baseDir,
    configEnabled: options.configEnabled === true,
    handoffs: options.handoffs,
    flush: options.flush,
  };
  if (!continuityEnabled()) stopHeartbeat();
}

export function resetOwnerRuntime(): void {
  stopHeartbeat();
  runtime = null;
  ownerQueue = Promise.resolve();
  heartbeatInFlight = null;
  heartbeatQueued = false;
  selfPromise = null;
}

export function continuityEnabled(): boolean {
  if (!runtime) return false;
  const raw = process.env.TAWASSUL_CONTINUITY?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  return runtime.configEnabled;
}

export function continuityHandoffs(): Iterable<HandoffEntry> | null {
  return runtime?.handoffs ? runtime.handoffs() : null;
}

export function continuityFlush(): (() => Promise<void>) | null {
  return runtime?.flush ?? null;
}

export function continuityBaseDir(): string | null {
  return runtime?.baseDir ?? null;
}

export function continuityIoStats(): { reads: number; writes: number; probes: number } {
  return { ...io };
}

export function resetContinuityIoStats(): void {
  io.reads = 0;
  io.writes = 0;
  io.probes = 0;
}

function ownersPath(): string | null {
  return runtime ? projectStatePath(runtime.baseDir, "continuity/owners.json") : null;
}

function isOwnerRecord(value: unknown): value is OwnerRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Number.isInteger(record.pid) &&
    (record.pid as number) > 0 &&
    typeof record.startedAt === "number" &&
    Number.isFinite(record.startedAt) &&
    typeof record.bootId === "string" &&
    typeof record.heartbeatAt === "string" &&
    typeof record.sessionId === "string"
  );
}

function readOwnersLocked(): Record<string, OwnerRecord> {
  const file = ownersPath();
  if (!file) return {};
  io.reads += 1;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const owners: Record<string, OwnerRecord> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isOwnerRecord(value)) owners[id] = value;
    }
    return owners;
  } catch {
    return {};
  }
}

function writeOwnersLocked(owners: Record<string, OwnerRecord>): boolean {
  const file = ownersPath();
  if (!file) return false;
  io.writes += 1;
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(tmp, JSON.stringify(owners), { mode: 0o600 });
    renameSync(tmp, file);
    return true;
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {}
    logger.warn("[tawassul] continuity owner write failed:", e);
    return false;
  }
}

function withOwnerLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = ownerQueue.then(fn, fn);
  ownerQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function snapshotOwners(): Promise<Record<string, OwnerRecord>> {
  return withOwnerLock(() => readOwnersLocked());
}

function hasSelfRecord(owners: Record<string, OwnerRecord>): boolean {
  return Object.values(owners).some((record) => record.pid === process.pid);
}

function syncHandoffMirror(id: string, heartbeatAt: string, runState: OwnerState): void {
  const handoffs = continuityHandoffs();
  if (!handoffs) return;
  for (const handoff of handoffs) {
    if (handoff.id !== id) continue;
    handoff.heartbeatAt = heartbeatAt;
    if (runState === "live") handoff.runState = "live";
    return;
  }
}

export async function stampOwner(handoff: HandoffEntry, sessionId: string): Promise<boolean> {
  if (!continuityEnabled()) return false;
  const identity = await selfIdentity();
  const record: OwnerRecord = {
    pid: process.pid,
    startedAt: identity?.startedAt ?? 0,
    bootId: identity?.bootId ?? "",
    heartbeatAt: new Date().toISOString(),
    sessionId,
  };
  const written = await withOwnerLock(() => {
    const owners = readOwnersLocked();
    owners[handoff.id] = record;
    return writeOwnersLocked(owners);
  });
  if (!written) return false;
  handoff.ownerPid = record.pid;
  handoff.ownerStartedAt = record.startedAt;
  handoff.ownerBootId = record.bootId;
  handoff.heartbeatAt = record.heartbeatAt;
  handoff.runState = "live";
  delete handoff.interruptedAt;
  delete handoff.interruptedReason;
  delete handoff.resumedAt;
  startHeartbeat();
  return true;
}

export async function touch(handoff: HandoffEntry, at: number = Date.now()): Promise<boolean> {
  if (!continuityEnabled()) return false;
  const heartbeatAt = new Date(at).toISOString();
  const updated = await withOwnerLock(() => {
    const owners = readOwnersLocked();
    const record = owners[handoff.id];
    if (!record || record.pid !== process.pid) return false;
    record.heartbeatAt = heartbeatAt;
    return writeOwnersLocked(owners);
  });
  if (!updated) return false;
  handoff.heartbeatAt = heartbeatAt;
  handoff.runState = "live";
  delete handoff.interruptedAt;
  delete handoff.interruptedReason;
  startHeartbeat();
  return true;
}

export function clearRunFlags(handoff: HandoffEntry): void {
  delete handoff.runState;
  delete handoff.interruptedAt;
  delete handoff.interruptedReason;
  delete handoff.resumedAt;
}

export async function clearOwner(handoffId: string): Promise<boolean> {
  if (!continuityEnabled()) return false;
  const result = await withOwnerLock(() => {
    const owners = readOwnersLocked();
    if (!(handoffId in owners)) return { removed: false, selfRemains: hasSelfRecord(owners) };
    delete owners[handoffId];
    const removed = writeOwnersLocked(owners);
    return { removed, selfRemains: hasSelfRecord(owners) };
  });
  if (!result.selfRemains) stopHeartbeat();
  return result.removed;
}

export function startHeartbeat(): void {
  if (!continuityEnabled() || heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    void heartbeatTick();
  }, CONTINUITY_HEARTBEAT_MS);
  heartbeatTimer.unref?.();
}

export function stopHeartbeat(): void {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

export function heartbeatActive(): boolean {
  return heartbeatTimer !== null;
}

export function heartbeatTick(at: number = Date.now()): Promise<number> {
  if (!continuityEnabled()) return Promise.resolve(0);
  if (heartbeatInFlight) {
    heartbeatQueued = true;
    return heartbeatInFlight;
  }
  heartbeatInFlight = runHeartbeatTick(at)
    .catch(() => 0)
    .finally(() => {
      heartbeatInFlight = null;
      if (heartbeatQueued) {
        heartbeatQueued = false;
        void heartbeatTick();
      }
    });
  return heartbeatInFlight;
}

async function runHeartbeatTick(at: number): Promise<number> {
  const heartbeatAt = new Date(at).toISOString();
  const refreshed = await withOwnerLock(() => {
    const owners = readOwnersLocked();
    let count = 0;
    for (const [id, record] of Object.entries(owners)) {
      if (record.pid !== process.pid) continue;
      record.heartbeatAt = heartbeatAt;
      count += 1;
      syncHandoffMirror(id, heartbeatAt, "live");
    }
    if (count === 0) {
      stopHeartbeat();
      return 0;
    }
    if (!writeOwnersLocked(owners)) return 0;
    return count;
  });
  return refreshed;
}

export function parseLinuxStat(
  text: string,
  pid: number,
): { startedAt: number; processState: string } | null {
  if (!text.startsWith(`${pid} (`)) return null;
  const close = text.lastIndexOf(")");
  if (close < 0) return null;
  const fields = text.slice(close + 1).trim().split(/\s+/);
  if (fields.length < 20) return null;
  const processState = fields[0] ?? "";
  if (!/^[A-Za-z]$/.test(processState)) return null;
  const startedAt = Number(fields[19]);
  if (!Number.isFinite(startedAt)) return null;
  return { startedAt, processState };
}

export function parseLinuxBootTime(text: string): string | null {
  const match = text.match(/^btime\s+(\d+)\s*$/m);
  return match?.[1] ?? null;
}

export function parseMacStart(text: string): number | null {
  const parsed = Date.parse(text.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseMacBootTime(text: string): string | null {
  const sec = text.match(/sec\s*=\s*(\d+)/)?.[1];
  return sec ?? null;
}

export function parseMacState(text: string): string | null {
  const state = text.trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(state) ? state : null;
}

export function parseWindowsDate(text: string): number | null {
  const match = text
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!match) return null;
  const fraction = match[3] ? `.${match[3].slice(0, 3).padEnd(3, "0")}` : "";
  const rawZone = match[4] ?? "Z";
  const zone = /^[+-]\d{4}$/.test(rawZone) ? `${rawZone.slice(0, 3)}:${rawZone.slice(3)}` : rawZone;
  const parsed = Date.parse(`${match[1]}T${match[2]}${fraction}${zone}`);
  return Number.isFinite(parsed) ? parsed : null;
}

function runCommand(bin: string, args: string[], timeout: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        timeout,
        windowsHide: true,
        maxBuffer: 64 * 1024,
        env: { ...process.env, LC_ALL: "C" },
      },
      (error, stdout) => {
        const rawCode = error ? (error as NodeJS.ErrnoException & { code?: unknown }).code : 0;
        const code = typeof rawCode === "number" ? rawCode : null;
        resolve({ ok: !error, stdout: String(stdout ?? ""), code });
      },
    );
  });
}

async function linuxIdentity(pid: number): Promise<IdentityFacts | null> {
  const statText = await readFile("/proc/stat", "utf8").catch(() => null);
  const bootId = statText ? parseLinuxBootTime(statText) : null;
  if (bootId === null) return null;
  const alive = isProcessAlive(pid);
  if (!alive) return { alive: false, startedAt: 0, bootId, processState: null };
  const procText = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => null);
  if (procText === null) return { alive: false, startedAt: 0, bootId, processState: null };
  const parsed = parseLinuxStat(procText, pid);
  if (!parsed) return null;
  return { alive: true, startedAt: parsed.startedAt, bootId, processState: parsed.processState };
}

async function macIdentity(pid: number): Promise<IdentityFacts | null> {
  const boot = await runCommand("sysctl", ["-n", "kern.boottime"], CONTINUITY_PROBE_TIMEOUT_MS);
  const bootId = boot.ok ? parseMacBootTime(boot.stdout) : null;
  if (bootId === null) return null;
  const alive = isProcessAlive(pid);
  if (!alive) return { alive: false, startedAt: 0, bootId, processState: null };
  const start = await runCommand("ps", ["-o", "lstart=", "-p", String(pid)], CONTINUITY_PROBE_TIMEOUT_MS);
  if (!start.ok) {
    if (start.code === 1) return { alive: false, startedAt: 0, bootId, processState: null };
    return null;
  }
  const startedAt = parseMacStart(start.stdout);
  if (startedAt === null) return null;
  const state = await runCommand("ps", ["-o", "state=", "-p", String(pid)], CONTINUITY_PROBE_TIMEOUT_MS);
  if (!state.ok) return null;
  const processState = parseMacState(state.stdout);
  if (processState === null) return null;
  return { alive: true, startedAt, bootId, processState };
}

async function windowsIdentity(pid: number): Promise<IdentityFacts | null> {
  const boot = await runCommand(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('o')",
    ],
    CONTINUITY_WINDOWS_TIMEOUT_MS,
  );
  const bootAt = boot.ok ? parseWindowsDate(boot.stdout) : null;
  if (bootAt === null) return null;
  const bootId = String(bootAt);
  const alive = isProcessAlive(pid);
  if (!alive) return { alive: false, startedAt: 0, bootId, processState: null };
  const proc = await runCommand(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { $p.CreationDate.ToString('o') }`,
    ],
    CONTINUITY_WINDOWS_TIMEOUT_MS,
  );
  if (!proc.ok) return null;
  if (!proc.stdout.trim()) return { alive: false, startedAt: 0, bootId, processState: null };
  const startedAt = parseWindowsDate(proc.stdout);
  if (startedAt === null) return null;
  return { alive: true, startedAt, bootId, processState: null };
}

export async function probeIdentity(pid: number): Promise<IdentityFacts | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  io.probes += 1;
  if (process.platform === "linux") return linuxIdentity(pid);
  if (process.platform === "darwin") return macIdentity(pid);
  if (process.platform === "win32") return windowsIdentity(pid);
  return null;
}

export function selfIdentity(): Promise<IdentityFacts | null> {
  if (!selfPromise) {
    selfPromise = probeIdentity(process.pid).catch(() => null);
  }
  return selfPromise;
}

export function selfKey(identity: IdentityFacts | null): string {
  return `${process.pid}:${identity?.startedAt ?? 0}:${identity?.bootId ?? ""}`;
}

export function classifyOwner(
  record: OwnerRecord,
  facts: IdentityFacts | null,
  at: number = Date.now(),
): OwnerVerdict {
  if (!facts) return { state: "unknown" };
  if (record.bootId && facts.bootId && record.bootId !== facts.bootId) {
    return { state: "interrupted", reason: "rebooted" };
  }
  if (!facts.alive) return { state: "interrupted", reason: "gone" };
  if (record.startedAt > 0 && facts.startedAt !== record.startedAt) {
    return { state: "interrupted", reason: "gone" };
  }
  if (facts.processState === "Z") return { state: "interrupted", reason: "zombie" };
  const heartbeatAt = Date.parse(record.heartbeatAt);
  if (!Number.isFinite(heartbeatAt)) return { state: "unknown" };
  if (at - heartbeatAt > CONTINUITY_STALE_MS) return { state: "stale" };
  return { state: "live" };
}

export async function probeOwner(record: OwnerRecord, options: { at?: number } = {}): Promise<OwnerProbe> {
  const facts = await probeIdentity(record.pid);
  const verdict = classifyOwner(record, facts, options.at ?? Date.now());
  return {
    state: verdict.state,
    reason: verdict.reason,
    pid: record.pid,
    startedAt: record.startedAt,
    bootId: record.bootId,
    heartbeatAt: record.heartbeatAt,
    sessionId: record.sessionId,
  };
}
