import type { TawaOrchestratorContext } from "../core/service-context.ts";
import { logger } from "../utils/logger.ts";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { normalizeName } from "../utils/name-utils.ts";

import { loadAllState } from "./state-loader-facade.ts";
import { atomicWriteFile } from "../infra/disk-utils.ts";
import { getSaveIsolationVerdict, isIsolationActiveSync } from "./isolation.ts";
import { resetHmacKeyCache } from "../utils/crypto.ts";
import { MAX_DYNAMIC_AGENTS_DEFAULT, STATE_VERSION } from "../context/constants.ts";
import { RevisionConflictError, type StateData, type SessionDataEntry } from "../context/managers/StateManager.ts";
import type { RecordEntry } from "../context/types.ts";
import { SharedMemorySchema } from "../validation.ts";

function normalizeMapKeys<T>(obj: Record<string, T>): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[normalizeName(k)] = v;
  }
  return result;
}
import type { Discussion } from "../discussion/discussion.ts";
import type { EvidencedDiscussion } from "../discussion/evidence-types.ts";

function featureIndexPath(stateDir: string): string {
  return resolve(stateDir, ".opencode", "feature-index.json");
}


async function saveFeatureIndex(stateDir: string, featureIndex: unknown): Promise<void> {
  
  if (isIsolationActiveSync()) {
    logger.warn("⛔ FeatureIndex save skipped: session is isolated (read-only fail-safe).");
    return;
  }
  const fiPath = featureIndexPath(stateDir);
  try {
    await mkdir(dirname(fiPath), { recursive: true });
  } catch {
    /* ignore */
  }
  const fiData = JSON.stringify(featureIndex, null, 2);
  for (let fiAttempt = 0; fiAttempt < 3; fiAttempt++) {
    try {
      await atomicWriteFile(fiPath, fiData);
      return;
    } catch (e) {
      if (fiAttempt < 2) await new Promise((r) => setTimeout(r, 5 * (fiAttempt + 1)));
      else logger.warn("FeatureIndex save failed after 3 attempts:", e);
    }
  }
}




function prefillSessionCache(ctx: TawaOrchestratorContext): void {
  const sid = ctx.sessionManager.getSessionId();
  const cache = ctx.stateManager.getSessionDataCache();
  const session = (cache[sid] ??= {});
  session.pauseState = ctx.pauseState;
  session.seenAgents = {
    ...(session.seenAgents ?? {}),
    [sid]: [...(ctx.seenAgents.get(sid) ?? [])],
  };
  ctx.stateManager.setSessionDataCache(cache);
}

function smToPlain(sm: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!sm) return undefined;
  return {
    decisions: sm.decisions,
    learnings: sm.learnings,
    warnings: sm.warnings,
    handoffHistory: sm.handoffHistory,
    agentContext: sm.agentContext,
    fileContext: sm.fileContext,
  };
}


function collectStateData(
  ctx: TawaOrchestratorContext,
  opts: { sessionData?: Record<string, SessionDataEntry>; version?: number } = {},
): StateData {
  const em = ctx.discussionManager.getEvidenceManager();
  const counters = em?.getSeqCounters() ?? { seqReceipt: 0, seqClaim: 0, seqVerification: 0, seqChallenge: 0 };
  const sm = (() => {
    try {
      return ctx.sharedMemory.get();
    } catch {
      return undefined;
    }
  })();
  const data: StateData = {
    records: [...ctx.records],
    handoffs: [...ctx.handoffs.values()],
    recSeq: ctx.recSeq,
    hoffSeq: ctx.hoffSeq,
    agentErrors: { ...ctx.errorManager.agentErrors },
    agentRatings: { ...ctx.ratingManager.agentRatings },
    dynamicAgents: [...ctx.agentManager.dynamicAgents],
    agentModelMap: { ...ctx.modelManager.agentModelMap },
    pauseState: ctx.pauseState,
    seenAgents: Object.fromEntries([...ctx.seenAgents.entries()].map(([k, v]) => [k, [...v]])),
    sharedMemory: smToPlain(sm),
    discussions: ctx.discussionManager.getFullState().discussions,
    discussionSeq: ctx.discussionManager.getSequence(),
    evidencedDiscussions: ctx.discussionManager.getFullState().evidencedDiscussions,
    evidenceSeqReceipt: counters.seqReceipt,
    evidenceSeqClaim: counters.seqClaim,
    evidenceSeqVerification: counters.seqVerification,
    evidenceSeqChallenge: counters.seqChallenge,
    trainingEvaluator: (() => {
      try {
        return ctx.trainingEvaluator.toJSON();
      } catch {
        return undefined;
      }
    })() as Record<string, unknown> | undefined,
    sessionData: (opts.sessionData ?? ctx.stateManager.getSessionDataCache()) as StateData["sessionData"],
  };
  if (opts.version !== undefined) data.version = opts.version;
  return data;
}


function liveCtxData(ctx: TawaOrchestratorContext, liveSessionData: Record<string, SessionDataEntry>): StateData {
  return collectStateData(ctx, { sessionData: liveSessionData });
}





function maxByKey(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = Math.max(out[k] ?? 0, v ?? 0);
  return out;
}

function unionStrings(a: string[] | undefined, b: string[] | undefined): string[] {
  
  
  
  return Array.from(
    new Set(
      [...(a ?? []), ...(b ?? [])]
        .filter((s): s is string => typeof s === "string")
        .map((s) => normalizeName(s))
        .filter(Boolean),
    ),
  );
}

function mergeRatings(
  a: StateData["agentRatings"],
  b: StateData["agentRatings"],
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = { ...(b ?? {}) };
  for (const [agent, rating] of Object.entries(a ?? {})) {
    const d = (b ?? {})[agent];
    if (!d) {
      out[agent] = rating;
      continue;
    }
    const la = String((rating as { lastActionAt?: string }).lastActionAt ?? "");
    const da = String((d as { lastActionAt?: string }).lastActionAt ?? "");
    if (la > da) out[agent] = rating;
  }
  return out;
}


function mergeSessionData(
  live: StateData["sessionData"],
  disk: StateData["sessionData"],
  currentSessionId: string,
): StateData["sessionData"] {
  const out: NonNullable<StateData["sessionData"]> = { ...(disk ?? {}) };
  for (const [sid, entry] of Object.entries(live ?? {})) if (!(sid in out)) out[sid] = entry;
  const liveCur = (live ?? {})[currentSessionId];
  if (liveCur !== undefined) out[currentSessionId] = liveCur;
  return out;
}

function mergeSharedMemory(
  live: StateData["sharedMemory"],
  disk: StateData["sharedMemory"],
): StateData["sharedMemory"] | undefined {
  if (!live && !disk) return undefined;
  const base = (disk ?? {}) as Record<string, unknown>;
  const src = (live ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["decisions", "learnings", "warnings", "handoffHistory"]) {
    const lg = (src[key] as Array<{ id?: string }>) ?? [];
    const dg = (base[key] as Array<{ id?: string }>) ?? [];
    const byId = new Map<string, unknown>();
    for (const item of dg) if (item && typeof item.id === "string") byId.set(item.id, item);
    for (const item of lg) {
      if (item && typeof item.id === "string") byId.set(item.id, item);
      else byId.set(`k${byId.size}`, item);
    }
    out[key] = [...byId.values()];
  }
  for (const key of ["agentContext", "fileContext"]) {
    out[key] = { ...((base[key] as object) ?? {}), ...((src[key] as object) ?? {}) };
  }
  return out as StateData["sharedMemory"];
}

type Mergeable = { id: string };


function unionByKey<T>(live: T[], disk: T[], keyOf: (e: T) => string, pickTime: (e: T) => string): T[] {
  const out = new Map<string, T>();
  for (const d of disk) out.set(keyOf(d), d);
  for (const l of live) {
    const k = keyOf(l);
    const ex = out.get(k);
    if (!ex) out.set(k, l);
    else if (pickTime(l) > pickTime(ex)) out.set(k, l); 
  }
  return [...out.values()];
}


function unionById<T extends Mergeable>(live: T[], disk: T[], pickTime: (e: T) => string): T[] {
  return unionByKey(live, disk, (e) => e.id, pickTime);
}


function rekeyLosers<T extends Mergeable>(
  liveArr: T[],
  diskArr: T[],
  merged: StateData,
  prefix: "H" | "R",
  pickTime: (e: T) => string,
  renamed: Map<string, string>,
): void {
  const arr = prefix === "H" ? merged.handoffs : merged.records;
  const counterKey: "hoffSeq" | "recSeq" = prefix === "H" ? "hoffSeq" : "recSeq";
  
  const existingIds = new Set<string>(arr.map((e) => e.id));
  const rekey = (entry: T): T => {
    let n = (merged[counterKey] as number) + 1;
    while (existingIds.has(`${prefix}-${String(n).padStart(3, "0")}`)) n++;
    merged[counterKey] = n;
    const newId = `${prefix}-${String(n).padStart(3, "0")}`;
    existingIds.add(newId);
    renamed.set(entry.id, newId);
    return { ...entry, id: newId };
  };
  const diskById = new Map(diskArr.map((h) => [h.id, h]));
  for (const lv of liveArr) {
    const dk = diskById.get(lv.id);
    if (dk && pickTime(lv) <= pickTime(dk)) arr.push(rekey(lv) as never); 
  }
  const liveById = new Map(liveArr.map((h) => [h.id, h]));
  for (const dk of diskArr) {
    const lv = liveById.get(dk.id);
    if (lv && pickTime(dk) < pickTime(lv)) arr.push(rekey(dk) as never); 
  }
}


function rekeyDiscussions(
  liveD: Mergeable[],
  diskD: Mergeable[],
  merged: StateData,
  renamed: Map<string, string>,
): void {
  const arr = merged.discussions as unknown[];
  const pick = (e: Mergeable): string => String((e as { updatedAt?: string }).updatedAt ?? "");
  
  const existingIds = new Set<string>((arr as Array<{ id?: string }>).map((e) => e.id ?? ""));
  const rekey = (entry: Mergeable): Mergeable => {
    let n = (merged.discussionSeq ?? 0) + 1;
    while (existingIds.has(`D-${String(n).padStart(3, "0")}`)) n++;
    merged.discussionSeq = n;
    const newId = `D-${String(n).padStart(3, "0")}`;
    existingIds.add(newId);
    renamed.set(entry.id, newId);
    return { ...entry, id: newId };
  };
  const diskById = new Map(diskD.map((h) => [h.id, h]));
  for (const lv of liveD) {
    const dk = diskById.get(lv.id);
    if (dk && pick(lv) <= pick(dk)) arr.push(rekey(lv) as never);
  }
  const liveById = new Map(liveD.map((h) => [h.id, h]));
  for (const dk of diskD) {
    const lv = liveById.get(dk.id);
    if (lv && pick(dk) < pick(lv)) arr.push(rekey(dk) as never);
  }
}

function mergeFullScope(
  live: StateData,
  disk: StateData,
  currentSessionId: string,
): { merged: StateData; renamed: Map<string, string> } {
  const renamed = new Map<string, string>();
  const ts = (e: Mergeable): string => String((e as { timestamp?: string }).timestamp ?? "");
  const upd = (e: Mergeable): string => String((e as { updatedAt?: string }).updatedAt ?? "");

  
  const records = [...unionById(live.records ?? [], disk.records ?? [], ts)];
  const handoffs = [...unionById(live.handoffs ?? [], disk.handoffs ?? [], ts)];
  const discussions = [
    ...unionById((live.discussions ?? []) as Mergeable[], (disk.discussions ?? []) as Mergeable[], upd),
  ];

  const merged: StateData = {
    records,
    handoffs,
    recSeq: Math.max(live.recSeq ?? 0, disk.recSeq ?? 0),
    hoffSeq: Math.max(live.hoffSeq ?? 0, disk.hoffSeq ?? 0),
    agentErrors: maxByKey(live.agentErrors, disk.agentErrors),
    agentRatings: mergeRatings(live.agentRatings, disk.agentRatings),
    dynamicAgents: unionStrings(live.dynamicAgents, disk.dynamicAgents),
    
    
    
    agentModelMap: (() => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(disk.agentModelMap ?? {})) out[normalizeName(k)] = v;
      for (const [k, v] of Object.entries(live.agentModelMap ?? {})) out[normalizeName(k)] = v;
      return out;
    })(),
    pauseState: live.pauseState ?? disk.pauseState ?? null,
    seenAgents: (() => {
      const out: Record<string, string[]> = { ...(disk.seenAgents ?? {}) };
      for (const [sid, vals] of Object.entries(live.seenAgents ?? {})) if (!(sid in out)) out[sid] = [...vals];
      const liveCur = (live.seenAgents ?? {})[currentSessionId];
      if (liveCur) out[currentSessionId] = [...liveCur];
      return out;
    })(),
    sharedMemory: mergeSharedMemory(live.sharedMemory, disk.sharedMemory),
    discussions,
    discussionSeq: Math.max(live.discussionSeq ?? 0, disk.discussionSeq ?? 0),
    evidencedDiscussions: [] as EvidencedDiscussion[],
    evidenceSeqReceipt: Math.max(live.evidenceSeqReceipt ?? 0, disk.evidenceSeqReceipt ?? 0),
    evidenceSeqClaim: Math.max(live.evidenceSeqClaim ?? 0, disk.evidenceSeqClaim ?? 0),
    evidenceSeqVerification: Math.max(live.evidenceSeqVerification ?? 0, disk.evidenceSeqVerification ?? 0),
    evidenceSeqChallenge: Math.max(live.evidenceSeqChallenge ?? 0, disk.evidenceSeqChallenge ?? 0),
    trainingEvaluator: disk.trainingEvaluator ?? live.trainingEvaluator,
    sessionData: mergeSessionData(live.sessionData, disk.sessionData, currentSessionId),
    _meta: disk._meta,
  };

  
  merged.evidencedDiscussions = unionByKey(
    (live.evidencedDiscussions ?? []) as EvidencedDiscussion[],
    (disk.evidencedDiscussions ?? []) as EvidencedDiscussion[],
    (e) => e.discussionId,
    (e) => String(e.updatedAt ?? ""),
  );

  rekeyLosers(live.handoffs ?? [], disk.handoffs ?? [], merged, "H", ts, renamed);
  rekeyLosers(live.records ?? [], disk.records ?? [], merged, "R", ts, renamed);
  rekeyDiscussions((live.discussions ?? []) as Mergeable[], (disk.discussions ?? []) as Mergeable[], merged, renamed);

  
  
  for (const ed of (merged.evidencedDiscussions ?? []) as EvidencedDiscussion[]) {
    const nw = renamed.get(ed.discussionId);
    if (nw) ed.discussionId = nw;
  }

  
  for (const h of merged.handoffs) {
    if (h.sourceRecordId) {
      const nw = renamed.get(h.sourceRecordId);
      if (nw) h.sourceRecordId = nw;
    }
    if (h.sourceDiscussionId) {
      const nw = renamed.get(h.sourceDiscussionId);
      if (nw) h.sourceDiscussionId = nw;
    }
  }

  return { merged, renamed };
}


function emptyStateData(): StateData {
  return {
    records: [],
    handoffs: [],
    recSeq: 0,
    hoffSeq: 0,
    agentErrors: {},
    agentRatings: {},
    dynamicAgents: [],
    agentModelMap: {},
  };
}


function mergeSeenAgents(sessionData: NonNullable<StateData["sessionData"]>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [sid, s] of Object.entries(sessionData ?? {})) {
    const set = new Set<string>();
    for (const ids of Object.values(s?.seenAgents ?? {})) for (const id of ids ?? []) set.add(id);
    map.set(sid, set);
  }
  return map;
}


function restoreSharedMemoryCtx(ctx: TawaOrchestratorContext, sharedMemory: Record<string, unknown>): void {
  try {
    const sm = ctx.sharedMemory.get();
    const parsed = SharedMemorySchema.safeParse(sharedMemory);
    if (!parsed.success) {
      logger.warn("SharedMemory restore failed validation, using defaults");
      return;
    }
    const smData = parsed.data;
    if (smData.decisions) sm.decisions = smData.decisions;
    if (smData.learnings) sm.learnings = smData.learnings;
    if (smData.warnings) sm.warnings = smData.warnings;
    if (smData.handoffHistory) sm.handoffHistory = smData.handoffHistory;
    if (smData.agentContext) Object.assign(sm.agentContext, smData.agentContext);
    if (smData.fileContext) Object.assign(sm.fileContext, smData.fileContext);
    for (const agent of Object.keys(sm.agentContext)) {
      if (sm.agentContext[agent]?.currentTask) delete sm.agentContext[agent].currentTask;
    }
  } catch (e) {
    logger.warn("SharedMemory restore failed:", e);
  }
}


function injectMergedIntoCtx(
  merged: StateData,
  ctx: TawaOrchestratorContext,
  currentSessionId: string,
  renamed: Map<string, string>,
): void {
  ctx.records.length = 0;
  ctx.records.push(...((merged.records as RecordEntry[]) ?? []));
  ctx.handoffs.clear();
  for (const h of merged.handoffs ?? []) ctx.handoffs.set(h.id, h);
  ctx.recSeq = merged.recSeq ?? 0;
  ctx.hoffSeq = merged.hoffSeq ?? 0;
  ctx.stateManager.rebuildIndexes(merged);

  
  
  for (const t of ctx.taskPriority.getQueue()) {
    if (renamed.has(t.handoffId)) t.handoffId = renamed.get(t.handoffId)!;
  }

  
  const normalizedErrors = normalizeMapKeys(merged.agentErrors ?? {});
  Object.assign(ctx.errorManager.agentErrors, normalizedErrors);
  const normalizedRatings = normalizeMapKeys(merged.agentRatings ?? {}) as Record<
    string,
    import("../context/types.ts").AgentRating
  >;
  ctx.ratingManager.agentRatings = normalizedRatings;
  ctx.agentManager.dynamicAgents = merged.dynamicAgents ?? [];
  const normalizedModelMap = normalizeMapKeys(merged.agentModelMap ?? {});
  ctx.modelManager.agentModelMap = normalizedModelMap;

  
  
  const cs = merged.sessionData?.[currentSessionId];
  ctx.pauseState = cs !== undefined ? (cs.pauseState ?? null) : (merged.pauseState ?? null);
  ctx.seenAgents = mergeSeenAgents(merged.sessionData ?? {});

  
  ctx.discussionManager.loadFromState((merged.discussions ?? []) as Discussion[], merged.discussionSeq ?? 0);
  const em = ctx.discussionManager.getEvidenceManager();
  if (em && merged.evidencedDiscussions) {
    em.loadFromState(merged.evidencedDiscussions as EvidencedDiscussion[]);
    em.setSeqCounters({
      seqReceipt: merged.evidenceSeqReceipt ?? 0,
      seqClaim: merged.evidenceSeqClaim ?? 0,
      seqVerification: merged.evidenceSeqVerification ?? 0,
      seqChallenge: merged.evidenceSeqChallenge ?? 0,
    });
  }
  if (merged.sharedMemory) restoreSharedMemoryCtx(ctx, merged.sharedMemory);

  
  if (merged.trainingEvaluator) {
    try {
      ctx.trainingEvaluator.restoreFrom(
        merged.trainingEvaluator as Parameters<typeof ctx.trainingEvaluator.restoreFrom>[0],
      );
    } catch (e) {
      logger.warn("Training evaluator restore failed:", e);
    }
  }

  
  ctx.stateManager.setKnownRevision(merged._meta?.revision ?? 0);
  ctx.stateManager.setSessionDataCache(merged.sessionData ?? {});
}


function buildPayload(ctx: TawaOrchestratorContext): Record<string, unknown> {
  return collectStateData(ctx, { version: STATE_VERSION }) as unknown as Record<string, unknown>;
}


function sanitizePayloadForWrite(payload: Record<string, unknown>): Record<string, unknown> {
  return sanitizePersistedStrings(payload) as Record<string, unknown>;
}


function sanitizePersistedStrings(value: unknown, depth = 0, budget = 2000): unknown {
  if (typeof value === "string") return SecurityPolicy.sanitizeOutput(value);
  if (depth > 6 || budget <= 0) return value;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    let remaining = budget;
    for (const v of value) {
      const next = sanitizePersistedStrings(v, depth + 1, remaining);
      if (typeof next === "string") remaining--;
      out.push(next);
    }
    return out;
  }
  if (value && typeof value === "object") {
    let vals: unknown[];
    try {
      vals = Object.values(value as Record<string, unknown>);
    } catch {
      return value;
    }
    const out: Record<string, unknown> = {};
    let remaining = Math.max(budget, vals.length);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = sanitizePersistedStrings(v, depth + 1, remaining);
      if (typeof next === "string") remaining--;
      out[k] = next;
    }
    return out;
  }
  return value;
}

import type { TimerManagerLike } from "../types/timer-types.ts";
import { SecurityPolicy } from "../security-policy.ts";


type RebaseSnapshot = () => void;

export class StatePersistence {
  saveTimeout: ReturnType<typeof setTimeout> | null = null;
  saveDirty = false;
  private saveInProgress = false;
  private _saveCompletionResolve: (() => void) | null = null;
  private _saveCompletionPromise: Promise<void> | null = null;
  private disposing = false;
  private timers: TimerManagerLike | null = null;
  
  
  private _isolationObserved = false;
  
  
  private saveFailureCount = 0;
  private nextRetryAt = 0;
  private static readonly MAX_SAVE_FAILURES = 8;
  private static readonly BASE_DELAY = 100;
  private static readonly MAX_BACKOFF = 30000;
  
  private static readonly LOCK_ATTEMPTS = 10;
  
  private static readonly MAX_CAS_ATTEMPTS = 3;
  
  private rebaseRollback: RebaseSnapshot | undefined = undefined;

  constructor(
    private ctx: TawaOrchestratorContext,
    timers?: TimerManagerLike,
  ) {
    this.timers = timers ?? null;
  }

  isDisposing(): boolean {
    return this.disposing;
  }
  markDisposing(): void {
    this.disposing = true;
  }

  
  private jitterBackoff(delay: number): number {
    const spread = delay * 0.25;
    return Math.max(0, Math.round(delay + (Math.random() * 2 - 1) * spread));
  }

  async saveState(): Promise<void> {
    if (this.disposing) return;
    if (!this.ctx.stateDir) return;
    this.saveDirty = true;
    this.scheduleDeferredSave();
    if (this._saveCompletionPromise) await this._saveCompletionPromise;
  }

  
  private scheduleDeferredSave(): void {
    if (this.disposing || this.saveTimeout || !this.saveDirty) return;
    const now = Date.now();
    if (now < this.nextRetryAt) return;
    if (this.saveFailureCount >= StatePersistence.MAX_SAVE_FAILURES) {
      this.nextRetryAt = now + StatePersistence.MAX_BACKOFF;
      logger.error(
        `State save failed ${this.saveFailureCount} times — backing off ${StatePersistence.MAX_BACKOFF}ms before retrying. In-memory state preserved; on-disk state may be stale.`,
      );
      return;
    }
    const delay =
      this.saveFailureCount > 0
        ? this.jitterBackoff(
            Math.min(StatePersistence.MAX_BACKOFF, StatePersistence.BASE_DELAY * 2 ** this.saveFailureCount),
          )
        : StatePersistence.BASE_DELAY;
    const runSave = () => {
      this.saveTimeout = null;
      if (this.saveDirty) {
        this.doSave()
          .then(() => {
            this.saveFailureCount = 0;
            this.nextRetryAt = 0;
          })
          .catch((e) => {
            this.saveFailureCount++;
            this.nextRetryAt =
              Date.now() +
              this.jitterBackoff(
                Math.min(StatePersistence.MAX_BACKOFF, StatePersistence.BASE_DELAY * 2 ** this.saveFailureCount),
              );
            logger.warn("deferred save failed:", e);
          });
      }
    };
    this.saveTimeout = this.timers
      ? this.timers.setTimeout(runSave, delay)
      : (() => {
          const t = setTimeout(runSave, delay);
          if (t?.unref) t.unref();
          return t;
        })();
  }

  async flushSaves(): Promise<void> {
    
    
    if (this.saveFailureCount >= StatePersistence.MAX_SAVE_FAILURES) return;
    if (this.saveTimeout) {
      if (this.timers) this.timers.clear(this.saveTimeout);
      else clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this.saveInProgress) {
      const completionPromise = this._saveCompletionPromise ?? Promise.resolve();
      await Promise.race([completionPromise, new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 3000);
        if (t?.unref) t.unref();
      })]);
    }
    await this.doSave();
    const deadline = Date.now() + 1000;
    let flushAttempts = 0;
    while (this.saveDirty && Date.now() < deadline && flushAttempts < 5) {
      flushAttempts++;
      await this.doSave();
      if (this.saveDirty) await new Promise((r) => setTimeout(r, 50));
    }
    if (this.saveDirty) logger.warn("flushSaves: gave up after retries");
  }

  
  async doSave(type?: string): Promise<void> {
    if (this.disposing) return;
    if (!this.ctx.stateDir) return;
    
    
    
    
    
    
    
    const verdict = await getSaveIsolationVerdict(
      this.ctx.stateDir,
      typeof this.ctx.statePath === "function" ? () => this.ctx.statePath() : undefined,
    );
    if (verdict !== null) {
      this._isolationObserved = true;
      logger.warn(
        verdict === "foreign-key"
          ? "⛔ State save skipped: host state file is signed by an unknown key and no local host key exists (foreign-key). Read-only on this device — no key created, no re-signing."
          : "⛔ State save skipped: session is isolated (fail-safe read-only). No writes to the host state file.",
      );
      this.saveDirty = false;
      this.saveFailureCount = 0;
      this.nextRetryAt = 0;
      if (!this.saveInProgress) {
        this._saveCompletionResolve?.();
        this._saveCompletionResolve = null;
        this._saveCompletionPromise = null;
      }
      return;
    }
    
    
    
    
    if (this._isolationObserved) {
      this._isolationObserved = false;
      resetHmacKeyCache();
      logger.info("P1: isolation cleared — state writes resumed after host state re-verification.");
    }
    
    if (this.saveInProgress) {
      this.saveDirty = true;
      if (this._saveCompletionPromise) await this._saveCompletionPromise;
      return;
    }
    try {
      this.saveInProgress = true;
      this._saveCompletionPromise = new Promise<void>((resolve) => {
        this._saveCompletionResolve = resolve;
      });
      this.ctx.eventHub.emit({ type: "STATE_SAVING", payload: { type } });
      if (!this.ctx.stateDir) return;

      try {
        this.ctx.sharedMemory.compact();
      } catch {
        /* ignore */
      }

      
      prefillSessionCache(this.ctx);
      const sessionId = this.ctx.sessionManager.getSessionId();

      let lockAcquired = false;
      for (let l = 0; l < StatePersistence.LOCK_ATTEMPTS; l++) {
        if (await this.ctx.stateManager.acquireStateLock(sessionId)) {
          lockAcquired = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50 * (l + 1)));
      }
      if (!lockAcquired) {
        logger.warn(`⚠️ State save dropped: could not acquire lock after ${StatePersistence.LOCK_ATTEMPTS} attempts`);
        this.ctx.eventHub.emit({ type: "STATE_LOCK_LOST", payload: { type: type ?? "" } });
        return;
      }

      try {
        const rollback = this.enforceStateLimits();
        try {
          for (let attempt = 1; attempt <= StatePersistence.MAX_CAS_ATTEMPTS; attempt++) {
            try {
              const payload = sanitizePayloadForWrite(buildPayload(this.ctx));
              await this.ctx.stateManager.saveWithRevision(payload, this.ctx.stateManager.getKnownRevision());
              break; 
            } catch (e) {
              if (e instanceof RevisionConflictError) {
                const payloadEmit = {
                  attempt,
                  sessionId,
                  baseRevision: e.expected,
                  currentRevision: e.actual,
                  outcome: "rebased" as const,
                };
                const conflictEvent = {
                  type: "SAVE_CONFLICT_DETECTED" as const,
                  payload: { ...payloadEmit } as {
                    attempt: number;
                    sessionId: string;
                    baseRevision: number;
                    currentRevision: number;
                    outcome: "conflict" | "rebased" | "exhausted";
                  },
                };
                if (attempt === StatePersistence.MAX_CAS_ATTEMPTS) {
                  
                  conflictEvent.payload.outcome = "exhausted";
                  this.ctx.eventHub.emit(conflictEvent);
                  throw e; 
                }
                this.ctx.eventHub.emit(conflictEvent);
                await this.reBaseAndRetry();
                // loop continues with the merged ctx (no save here — R6a)
              } else {
                
                
                this.rebaseRollback?.();
                throw e;
              }
            }
          }
          this.rebaseRollback = undefined; 
          await saveFeatureIndex(this.ctx.stateDir, this.ctx.featureIndex.toJSON());
          
          if (this.ctx.toolRunLog) {
            try {
              await this.ctx.toolRunLog.save();
            } catch (e) {
              logger.warn("tool-run-log save failed:", e);
            }
          }
          
          if (this.ctx.vectorRetrieval) {
            try {
              const docs = [
                ...this.ctx.records.map((r) => ({
                  id: r.id,
                  kind: "record" as const,
                  text: `${r.title}\n${r.detail}`,
                })),
                ...[...this.ctx.handoffs.values()].map((h) => ({
                  id: h.id,
                  kind: "handoff" as const,
                  text: h.context,
                })),
              ];
              
              
              
              const purged = this.ctx.vectorRetrieval.syncFromLive(docs);
              if (purged > 0) logger.debug(`[vector] ALG-037 purged ${purged} stale/redacted index entries`);
              await this.ctx.vectorRetrieval.save?.(this.ctx.stateDir);
            } catch (e) {
              logger.warn("vector-index save failed:", e);
            }
          }
          
          if (this.ctx.backgroundNotifier) {
            try {
              await this.ctx.backgroundNotifier.save(this.ctx.stateDir);
            } catch (e) {
              logger.warn("activity-metrics save failed:", e);
            }
          }
          this.saveDirty = false; 
          this.ctx.eventHub.emit({ type: "STATE_SAVED", payload: { type } });
        } catch (e) {
          rollback();
          throw e;
        }
      } finally {
        await this.ctx.stateManager.releaseStateLock(sessionId);
      }
    } catch (error) {
      this.ctx.eventHub.emit({ type: "STATE_SAVE_FAILED", payload: { error, type } });
      throw error;
    } finally {
      this.saveInProgress = false;
      this._saveCompletionResolve?.();
      this._saveCompletionResolve = null;
      this._saveCompletionPromise = null;
      if (!this.saveDirty) this.saveFailureCount = 0;
      this.scheduleDeferredSave();
    }
  }

  
  private async reBaseAndRetry(): Promise<void> {
    
    const liveSessionData = { ...this.ctx.stateManager.getSessionDataCache() };
    const currentSessionId = this.ctx.sessionManager.getSessionId();

    
    const session = (liveSessionData[currentSessionId] ??= {});
    session.pauseState = this.ctx.pauseState;
    session.seenAgents = {
      ...(session.seenAgents ?? {}),
      [currentSessionId]: [...(this.ctx.seenAgents.get(currentSessionId) ?? [])],
    };

    
    
    
    
    const beforeCache = structuredClone(this.ctx.stateManager.getSessionDataCache());
    const beforeKnown = this.ctx.stateManager.getKnownRevision();
    const beforeRecords = structuredClone(this.ctx.records);
    const beforeHandoffs = structuredClone([...this.ctx.handoffs.values()]);
    this.rebaseRollback = () => {
      this.ctx.stateManager.setSessionDataCache(beforeCache);
      this.ctx.stateManager.setKnownRevision(beforeKnown);
      this.ctx.records.length = 0;
      this.ctx.records.push(...beforeRecords);
      this.ctx.handoffs.clear();
      for (const h of beforeHandoffs) this.ctx.handoffs.set(h.id, h);
    };

    
    const diskState = await this.ctx.stateManager.loadFromFile(emptyStateData(), currentSessionId);

    
    const { merged, renamed } = mergeFullScope(liveCtxData(this.ctx, liveSessionData), diskState, currentSessionId);

    
    injectMergedIntoCtx(merged, this.ctx, currentSessionId, renamed);

    
    this.enforceStateLimits();

    // 4. baseline revision for the next attempt. (rebaseRollback stays armed.)
  }

  async loadStateAsync(): Promise<void> {
    await loadAllState(this.ctx);
  }

  enforceStateLimits(): () => void {
    const _maxHandoffs = this.ctx.agentManager.getMaxHandoffs();
    const _maxRecords = this.ctx.agentManager.getMaxRecords();
    const _maxDynamicAgents = this.ctx.config?.maxDynamicAgents ?? MAX_DYNAMIC_AGENTS_DEFAULT;
    const handoffsArray = [...this.ctx.handoffs.values()];
    const rollback = this.ctx.stateManager.enforceStateLimits(
      {
        records: this.ctx.records,
        handoffs: handoffsArray,
        recSeq: this.ctx.recSeq,
        hoffSeq: this.ctx.hoffSeq,
        agentErrors: this.ctx.errorManager.agentErrors,
        agentRatings: this.ctx.ratingManager.agentRatings,
        dynamicAgents: this.ctx.agentManager.dynamicAgents,
        agentModelMap: this.ctx.modelManager.agentModelMap,
      },
      _maxHandoffs,
      _maxRecords,
      50,
      50,
      50,
      _maxDynamicAgents,
      50,
      this.ctx.seenAgents,
    );
    
    this.ctx.handoffs.clear();
    for (const h of handoffsArray) this.ctx.handoffs.set(h.id, h);
    return () => {
      rollback();
      
      this.ctx.handoffs.clear();
      for (const h of handoffsArray) this.ctx.handoffs.set(h.id, h);
    };
  }
}
