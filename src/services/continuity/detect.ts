import type { HandoffEntry } from "../../context/types.ts";
import { logger } from "../../utils/logger.ts";
import {
  CONTINUITY_CACHE_MAX,
  CONTINUITY_DEBOUNCE_MS,
  classifyOwner,
  continuityEnabled,
  continuityFlush,
  continuityHandoffs,
  probeIdentity,
  resetOwnerRuntime,
  selfIdentity,
  selfKey,
  snapshotOwners,
} from "./owner.ts";
import type { IdentityFacts, OwnerRecord, OwnerState } from "./owner.ts";

export type DetectResult = {
  ran: boolean;
  interrupted: string[];
  stale: string[];
  unknown: string[];
  live: number;
};

export type DetectOptions = {
  at?: number;
  skipDebounce?: boolean;
  force?: boolean;
  probe?: (pid: number) => Promise<IdentityFacts | null>;
};

function emptyResult(ran = false): DetectResult {
  return { ran, interrupted: [], stale: [], unknown: [], live: 0 };
}

const probeCache = new Map<string, { facts: IdentityFacts | null; at: number }>();
const debounce = new Map<string, number>();

function ownerKey(record: OwnerRecord): string {
  return `${record.pid}:${record.startedAt}:${record.bootId}`;
}

function rememberProbe(key: string, facts: IdentityFacts | null, at: number): void {
  probeCache.delete(key);
  probeCache.set(key, { facts, at });
  while (probeCache.size > CONTINUITY_CACHE_MAX) {
    const oldest = probeCache.keys().next().value;
    if (!oldest) break;
    probeCache.delete(oldest);
  }
}

async function cachedFacts(
  record: OwnerRecord,
  at: number,
  probe: (pid: number) => Promise<IdentityFacts | null>,
): Promise<IdentityFacts | null> {
  const key = ownerKey(record);
  const cached = probeCache.get(key);
  if (cached && at - cached.at < CONTINUITY_DEBOUNCE_MS) return cached.facts;
  const facts = await probe(record.pid);
  rememberProbe(key, facts, at);
  return facts;
}

function isTerminal(handoff: HandoffEntry): boolean {
  return handoff.status === "completed" || handoff.status === "cancelled" || handoff.status === "closed";
}

function applyVerdict(
  handoff: HandoffEntry,
  record: OwnerRecord,
  state: OwnerState,
  reason: string | undefined,
  at: number,
): boolean {
  const before = [handoff.runState, handoff.interruptedAt, handoff.interruptedReason, handoff.heartbeatAt].join("|");
  if (state === "interrupted") {
    handoff.runState = "interrupted";
    handoff.interruptedAt = new Date(at).toISOString();
    handoff.interruptedReason = (reason as HandoffEntry["interruptedReason"]) ?? "unknown";
    handoff.heartbeatAt = record.heartbeatAt;
  } else if (state === "stale") {
    handoff.runState = "stale";
    handoff.heartbeatAt = record.heartbeatAt;
    delete handoff.interruptedAt;
    delete handoff.interruptedReason;
  } else if (state === "live") {
    handoff.runState = "live";
    handoff.heartbeatAt = record.heartbeatAt;
    delete handoff.interruptedAt;
    delete handoff.interruptedReason;
  }
  return before !== [handoff.runState, handoff.interruptedAt, handoff.interruptedReason, handoff.heartbeatAt].join("|");
}

export function detectionCacheSize(): number {
  return probeCache.size;
}

export function resetContinuity(): void {
  probeCache.clear();
  debounce.clear();
  resetOwnerRuntime();
}

export async function detectInterrupted(
  handoffs?: Iterable<HandoffEntry>,
  options: DetectOptions = {},
): Promise<DetectResult> {
  if (!continuityEnabled()) return emptyResult();
  const at = options.at ?? Date.now();
  if (!options.force && !options.skipDebounce) {
    const identity = await selfIdentity();
    const key = selfKey(identity);
    const last = debounce.get(key);
    if (last !== undefined && at - last < CONTINUITY_DEBOUNCE_MS) return emptyResult();
    debounce.set(key, at);
  }
  const owners = await snapshotOwners();
  const configuredHandoffs = handoffs ? null : continuityHandoffs();
  const entries = handoffs ? [...handoffs] : configuredHandoffs ? [...configuredHandoffs] : [];
  const result: DetectResult = emptyResult(true);
  const probe = options.probe ?? probeIdentity;
  let dirty = false;
  for (const handoff of entries) {
    if (isTerminal(handoff)) continue;
    const record = owners[handoff.id];
    if (!record) continue;
    const facts = await cachedFacts(record, at, probe);
    const verdict = classifyOwner(record, facts, at);
    dirty = applyVerdict(handoff, record, verdict.state, verdict.reason, at) || dirty;
    if (verdict.state === "interrupted") result.interrupted.push(handoff.id);
    else if (verdict.state === "stale") result.stale.push(handoff.id);
    else if (verdict.state === "live") result.live += 1;
    else result.unknown.push(handoff.id);
  }
  if (dirty) {
    const flush = continuityFlush();
    if (flush) {
      try {
        await flush();
      } catch (e) {
        logger.warn("[tawassul] continuity flush failed:", e);
      }
    }
  }
  return result;
}

export async function noteIdle(
  at: number = Date.now(),
  probe?: (pid: number) => Promise<IdentityFacts | null>,
): Promise<DetectResult | null> {
  if (!continuityEnabled()) return null;
  const identity = await selfIdentity();
  const key = selfKey(identity);
  const last = debounce.get(key);
  if (last !== undefined && at - last < CONTINUITY_DEBOUNCE_MS) return null;
  debounce.set(key, at);
  try {
    return await detectInterrupted(undefined, { at, skipDebounce: true, probe });
  } catch (e) {
    logger.warn("[tawassul] continuity idle detection failed:", e);
    return null;
  }
}

export { continuityEnabled } from "./owner.ts";
