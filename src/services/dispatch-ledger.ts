import { logger } from "../utils/logger.ts";

export const MAX_DISPATCH_SESSIONS = 200;
export const EARLY_TERMINAL_TTL_MS = 60_000;
export const FINALIZED_RETENTION_MS = 10 * 60_000;

export type DispatchOutcome = "completed" | "failed" | "interrupted";

export type DispatchRegistration = {
  childSessionID: string;
  parentSessionID: string;
  callID: string;
  targets: readonly string[];
  startedAt: number;
  onTerminal: (outcome: DispatchOutcome) => void;
};

type DispatchEntry = DispatchRegistration & {
  outcome?: DispatchOutcome;
  finalizedAt?: number;
};

type EarlyTerminal = {
  outcome: DispatchOutcome;
  at: number;
};

const _entries = new Map<string, DispatchEntry>();
const _early = new Map<string, EarlyTerminal>();

function prune(now: number): void {
  for (const [id, entry] of _entries) {
    if (entry.outcome && now - (entry.finalizedAt ?? 0) > FINALIZED_RETENTION_MS) {
      _entries.delete(id);
    }
  }
  for (const [id, early] of _early) {
    if (now - early.at > EARLY_TERMINAL_TTL_MS) {
      _early.delete(id);
      logger.debug(`[tawassul] early terminal for ${id} expired before its dispatch was recorded`);
    }
  }
}

function makeRoom(): boolean {
  if (_entries.size + _early.size < MAX_DISPATCH_SESSIONS) return true;
  for (const [id, entry] of _entries) {
    if (entry.outcome) {
      _entries.delete(id);
      return true;
    }
  }
  const oldestEarly = _early.keys().next().value;
  if (oldestEarly !== undefined) {
    _early.delete(oldestEarly);
    return true;
  }
  return false;
}

function finalize(entry: DispatchEntry, outcome: DispatchOutcome, now: number): void {
  if (entry.outcome) return;
  entry.outcome = outcome;
  entry.finalizedAt = now;
  try {
    entry.onTerminal(outcome);
  } catch (e) {
    logger.warn(`[tawassul] dispatch terminal handler failed for ${entry.childSessionID}:`, e);
  }
}

export function recordDispatch(registration: DispatchRegistration, now = Date.now()): void {
  prune(now);
  const existing = _entries.get(registration.childSessionID);
  if (existing && !existing.outcome) {
    logger.warn(`[tawassul] dispatch for ${registration.childSessionID} is already pending; reusing that entry`);
    return;
  }
  if (existing) _entries.delete(registration.childSessionID);
  if (!makeRoom()) {
    logger.warn(`[tawassul] dispatch ledger is full with pending entries; refusing ${registration.childSessionID}`);
    return;
  }
  const early = _early.get(registration.childSessionID);
  _early.delete(registration.childSessionID);
  const entry: DispatchEntry = { ...registration, targets: [...registration.targets] };
  _entries.set(registration.childSessionID, entry);
  if (early) finalize(entry, early.outcome, now);
}

export function finalizeDispatchOnIdle(
  childSessionID: string,
  background?: readonly unknown[],
  now = Date.now(),
): void {
  prune(now);
  if (background && ownsBackgroundWork(childSessionID, background)) {
    logger.debug(`[tawassul] idle for ${childSessionID} is not terminal; its own background work is still running`);
    return;
  }
  const entry = _entries.get(childSessionID);
  if (!entry) {
    if (_early.has(childSessionID)) return;
    if (!makeRoom()) {
      logger.debug(`[tawassul] early terminal buffer is full; ignoring idle for ${childSessionID}`);
      return;
    }
    _early.set(childSessionID, { outcome: "completed", at: now });
    return;
  }
  finalize(entry, "completed", now);
}

export function finalizeDispatchFailure(
  childSessionID: string,
  outcome: "failed" | "interrupted",
  now = Date.now(),
): void {
  prune(now);
  const entry = _entries.get(childSessionID);
  if (!entry) {
    if (_early.has(childSessionID)) return;
    if (!makeRoom()) {
      logger.debug(`[tawassul] early terminal buffer is full; ignoring ${outcome} for ${childSessionID}`);
      return;
    }
    _early.set(childSessionID, { outcome, at: now });
    return;
  }
  finalize(entry, outcome, now);
}

function rawRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function ownsBackgroundWork(childSessionID: string, background: readonly unknown[]): boolean {
  return background.some((item) => rawRecord(item)?.sessionID === childSessionID);
}

function rawSessionID(record: Record<string, unknown>): string | undefined {
  const data = rawRecord(record.data);
  if (data && typeof data.sessionID === "string") return data.sessionID;
  if (typeof record.sessionID === "string") return record.sessionID;
  const properties = rawRecord(record.properties);
  if (properties && typeof properties.sessionID === "string") return properties.sessionID;
  return undefined;
}

export function noteDispatchLifecycleEvent(event: unknown, now = Date.now()): void {
  const record = rawRecord(event);
  if (!record) return;
  const type = typeof record.type === "string" ? record.type : typeof record.event === "string" ? record.event : "";
  const outcome =
    type === "session.execution.failed"
      ? "failed"
      : type === "session.execution.interrupted"
        ? "interrupted"
        : undefined;
  if (!outcome) return;
  const sessionID = rawSessionID(record);
  if (!sessionID) return;
  finalizeDispatchFailure(sessionID, outcome, now);
}

export function pendingDispatchCount(): number {
  let count = 0;
  for (const entry of _entries.values()) {
    if (!entry.outcome) count++;
  }
  return count;
}

export function dispatchLedgerCount(): number {
  return _entries.size + _early.size;
}

export function earlyDispatchCount(): number {
  return _early.size;
}

export function resetDispatchLedger(): void {
  _entries.clear();
  _early.clear();
}
