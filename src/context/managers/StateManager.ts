

import { access, rename, copyFile, unlink, readdir, rmdir, stat, readFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { t } from "../../translations.ts";
import {
  DiscussionSchema,
  EvidencedDiscussionSchema,
  HandoffEntrySchema,
  RecordEntrySchema,
  StateSchema,
} from "../../validation.ts";
import { migrateStateData, isFreeOfPrototypePollution, replaceLegacyEncryptedFields } from "../migration.ts";
import { MAX_DYNAMIC_AGENTS_DEFAULT, STATE_VERSION } from "../constants.ts";
import { wrapWithHmac, unwrapWithHmac } from "../../utils/crypto.ts";
import { isIsolationActiveSync } from "../../services/isolation.ts";
import { acquireFSLock, releaseFSLock, removeFSLockDir } from "../../infra/file-lock.ts";
import { atomicWriteFile, checkDiskSpace } from "../../infra/disk-utils.ts";
import type { RecordEntry, HandoffEntry } from "../types.ts";
import type { PauseState } from "../../tools/system-controls.ts";
import { logger } from "../../utils/logger.ts";




const INCREMENTAL_SAVE_INTERVAL = 5;



export type StateData = {
  records: RecordEntry[];
  handoffs: HandoffEntry[];
  recSeq: number;
  hoffSeq: number;
  agentErrors: Record<string, number>;
  agentRatings: Record<string, Record<string, unknown>>;
  dynamicAgents: string[];
  agentModelMap: Record<string, string>;
  sharedMemory?: Record<string, unknown>;
  discussions?: unknown[];
  discussionSeq?: number;
  evidencedDiscussions?: unknown[];
  evidenceSeqReceipt?: number;
  evidenceSeqClaim?: number;
  evidenceSeqVerification?: number;
  evidenceSeqChallenge?: number;
  trainingEvaluator?: Record<string, unknown>;
  pauseState?: PauseState | null;
  seenAgents?: Record<string, string[]>;
  version?: number;
  
  sessionData?: Record<
    string,
    {
      pauseState?: PauseState | null;
      seenAgents?: Record<string, string[]>;
    }
  >;
  
  _meta?: { revision?: number; [k: string]: unknown };
};


export type SessionDataEntry = {
  pauseState?: PauseState | null;
  seenAgents?: Record<string, string[]>;
};


export class RevisionConflictError extends Error {
  readonly name = "RevisionConflictError";
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`State revision conflict: expected ${expected}, disk has ${actual}`);
  }
}

export class StateManager {
  private stateDir: string;
  private statePathFn: () => string;

  
  
  handoffIndex: Map<string, HandoffEntry> = new Map();
  
  recordIndex: Map<string, RecordEntry> = new Map();

  static MAX_BACKUPS = 1;
  static BACKUP_SIZE_WARN_BYTES = 5 * 1024 * 1024;

  
  private incrementalCounter = 0;

  
  private _readOnly = false;

  constructor(stateDir: string, statePathFn: () => string) {
    this.stateDir = stateDir;
    this.statePathFn = statePathFn;
    StateManager._instances.add(this);
  }

  isReadOnly(): boolean {
    return this._readOnly;
  }

  

  
  private _knownRevision = 0;

  getKnownRevision(): number {
    return this._knownRevision;
  }

  setKnownRevision(v: number): void {
    this._knownRevision = v;
  }

  
  getSessionDataCache(): Record<string, SessionDataEntry> {
    return Object.fromEntries(
      Object.entries(this._sessionDataCache).map(([sid, v]) => [sid, v as SessionDataEntry]),
    ) as Record<string, SessionDataEntry>;
  }

  setSessionDataCache(v: Record<string, SessionDataEntry>): void {
    this._sessionDataCache = v as Record<string, Record<string, unknown>>;
    this.trimSessionCache();
  }

  
  
  
  
  

  private static _fsLockEnabled = true;
  static readonly LOCK_TIMEOUT_MS = 60000;
  
  static readonly STATE_LOCK_NAME = "tawassul-state-lock";
  private static readonly _instances = new Set<StateManager>();

  private _lockOwner: string | null = null;
  private _lockName: string | null = null;

  
  private _quarantineAudit: Array<{
    timestamp: string;
    droppedRecords: number;
    droppedHandoffs: number;
    droppedDiscussions: number;
    droppedEvidenced: number;
    recordIds: string[];
    handoffIds: string[];
    discussionIds: string[];
    evidencedIds: string[];
  }> = [];

  private static readonly _quarantineCopies = new Set<string>();

  
  private lockName(): string {
    const hash = createHash("sha1").update(this.stateDir).digest("hex").slice(0, 16);
    return `tawassul-state-lock-${hash}`;
  }

  
  static async resetGlobalLock(): Promise<void> {
    await removeFSLockDir(StateManager.STATE_LOCK_NAME);
    for (const inst of StateManager._instances) {
      await inst.resetLock();
    }
  }

  private async resetLock(): Promise<void> {
    if (this._lockOwner && this._lockName) {
      await releaseFSLock(this._lockName, this._lockOwner);
    }
    this._lockOwner = null;
    this._lockName = null;
  }

  async acquireStateLock(sessionId?: string): Promise<boolean> {
    
    
    const owner = `${sessionId ?? "tawassul"}::pid-${process.pid}`;
    if (!StateManager._fsLockEnabled) {
      return true;
    }
    try {
      const name = this.lockName();
      const acquired = await acquireFSLock(name, owner, StateManager.LOCK_TIMEOUT_MS);
      if (acquired) {
        this._lockOwner = owner;
        this._lockName = name;
      }
      return acquired;
    } catch {
      
      logger.warn("FS lock failed this call — degraded to in-memory; will retry FS next save");
      return true;
    }
  }

  async releaseStateLock(sessionId?: string): Promise<void> {
    
    const owner = `${sessionId ?? "tawassul"}::pid-${process.pid}`;
    if (!StateManager._fsLockEnabled) return;
    if (this._lockOwner !== owner || !this._lockName) return;
    await releaseFSLock(this._lockName, owner);
    this._lockOwner = null;
    this._lockName = null;
  }

  

  
  private async rotateBackups(fp: string): Promise<void> {
    try {
      await access(fp);
    } catch {
      return;
    }

    
    try {
      const st = await stat(fp);
      if (st.size > StateManager.BACKUP_SIZE_WARN_BYTES) {
        logger.warn(
          `State file ${st.size} bytes exceeds ${StateManager.BACKUP_SIZE_WARN_BYTES} bytes; backing up anyway to preserve recovery`,
        );
      }
    } catch {

    }

    const bakBase = fp + ".bak";
    try {
      const oldest = bakBase + "." + StateManager.MAX_BACKUPS;
      await unlink(oldest);
    } catch {

    }

    for (let i = StateManager.MAX_BACKUPS - 1; i >= 0; i--) {
      const src = bakBase + "." + i;
      try {
        await rename(src, bakBase + "." + (i + 1));
      } catch {

      }
      if (i % 3 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    try {
      await copyFile(fp, bakBase + ".0");
    } catch {

    }
  }

  

  
  rebuildIndexes(stateData: StateData): void {
    this.handoffIndex.clear();
    for (const h of stateData.handoffs) {
      this.handoffIndex.set(h.id, h);
    }
    this.recordIndex.clear();
    for (const r of stateData.records) {
      this.recordIndex.set(r.id, r);
    }
  }

  
  findHandoff(id: string): HandoffEntry | undefined {
    return this.handoffIndex.get(id);
  }

  
  findRecord(id: string): RecordEntry | undefined {
    return this.recordIndex.get(id);
  }

  

  
  
  private _lastWrittenJson: Map<string, string> = new Map();
  private static readonly MAX_LAST_WRITTEN = 8;

  
  
  private cmpKey(_fp: string, jsonPayload: string): string {
    try {
      const obj = JSON.parse(jsonPayload);
      if ("_meta" in obj) delete obj._meta;
      return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
    } catch {
      return createHash("sha256").update(jsonPayload).digest("hex");
    }
  }

  private setLastWritten(fp: string, json: string): void {
    const key = this.cmpKey(fp, json);
    
    this._lastWrittenJson.delete(fp);
    this._lastWrittenJson.set(fp, key);
    if (this._lastWrittenJson.size > StateManager.MAX_LAST_WRITTEN) {
      const oldest = this._lastWrittenJson.keys().next().value;
      if (oldest !== undefined) this._lastWrittenJson.delete(oldest);
    }
  }

  
  async cleanOrphanedTmp(fp: string): Promise<void> {
    
    
    if (isIsolationActiveSync()) return;
    const dir = dirname(fp);
    const base = basename(fp);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    const orphans: string[] = [];
    for (const entry of entries) {
      if (entry.startsWith(base + ".") && /\.(tmp|delta)$/.test(entry)) {
        try {
          await unlink(join(dir, entry));
        } catch {

        }
        continue;
      }
      if (entry.startsWith(`${base}.bak.orphan-`)) orphans.push(entry);
    }
    orphans.sort().reverse();
    for (const stale of orphans.slice(StateManager.MAX_BACKUPS)) {
      try {
        await unlink(join(dir, stale));
      } catch (e) {
        logger.debug(`StateManager: orphan cleanup skipped for ${stale}:`, e);
      }
    }
  }

  
  private async saveIncremental(fp: string, data: Record<string, unknown>): Promise<boolean> {
    const space = await checkDiskSpace(fp);
    if (!space.ok) {
      throw new Error(space.error);
    }

    
    const {
      
      vectorIndex: _vi,
      
      patchingDecisions: _pd,
      
      prb: _prb,
      ...hmacData
    } = data as Record<string, unknown> & {
      vectorIndex?: unknown;
      patchingDecisions?: unknown;
      prb?: unknown;
    };
    let baseExists = false;
    try {
      await access(fp);
      baseExists = true;
    } catch {

    }

    const checked = await this.validateBeforeSave(hmacData, fp);
    const jsonPayload = JSON.stringify(checked);

    
    if (this._lastWrittenJson.get(fp) === this.cmpKey(fp, jsonPayload)) {
      this._readOnly = false;
      return false;
    }
    const signedPayload = wrapWithHmac(jsonPayload);

    this.incrementalCounter++;

    if (this.incrementalCounter >= INCREMENTAL_SAVE_INTERVAL) {
      this.incrementalCounter = 0;
      await this.writeFullSave(fp, jsonPayload, signedPayload);
      return true;
    }

    if (!baseExists) {
      await this.writeFullSave(fp, jsonPayload, signedPayload);
      return true;
    }
    await atomicWriteFile(fp, signedPayload);
    this.setLastWritten(fp, jsonPayload);
    this._readOnly = false;
    return true;
  }

  
  private async writeFullSave(fp: string, jsonPayload: string, signedPayload: string): Promise<void> {
    const space = await checkDiskSpace(fp);
    if (!space.ok) {
      throw new Error(space.error);
    }

    await this.rotateBackups(fp);

    await atomicWriteFile(fp, signedPayload);
    this.setLastWritten(fp, jsonPayload);
    this._readOnly = false;
  }

  

  
  async getDiskRevision(fp: string = this.statePathFn()): Promise<number> {
    const data = await this.tryLoadFile(fp);
    const meta = (data as { _meta?: { revision?: number } } | null)?._meta;
    return typeof meta?.revision === "number" ? meta.revision : 0;
  }

  
  async saveWithRevision(statePayload: Record<string, unknown>, expectedRevision: number): Promise<void> {
    const fp = this.statePathFn();
    
    
    const locked = await this.acquireStateLock();
    try {
      const diskRevision = await this.getDiskRevision(fp);
      if (diskRevision !== expectedRevision) {
        throw new RevisionConflictError(expectedRevision, diskRevision);
      }
      statePayload._meta = { revision: expectedRevision + 1 };
      const wrote = await this.saveIncremental(fp, statePayload);
      if (wrote) this._knownRevision = expectedRevision + 1;
    } finally {
      if (locked) await this.releaseStateLock();
    }
  }

  

  validateStateData(
    data: unknown,
  ): { valid: true; sanitized: Record<string, unknown> } | { valid: false; errors: string[] } {
    const result = StateSchema.safeParse(data);
    if (result.success) {
      return { valid: true, sanitized: { ...result.data } as Record<string, unknown> };
    }
    const errors = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    return { valid: false, errors };
  }

  
  sanitizeStateData(data: Record<string, unknown>): {
    data: Record<string, unknown>;
    droppedRecords: number;
    droppedHandoffs: number;
    droppedDiscussions: number;
    droppedEvidenced: number;
  } | null {
    const droppedIds = (arr: unknown[], schema: { safeParse: (v: unknown) => { success: boolean } }): string[] =>
      arr
        .filter((e) => !schema.safeParse(e).success)
        .map((e) => (e as { id?: unknown } | null)?.id)
        .filter((id): id is string => typeof id === "string");

    const section = (
      key: string,
      schema: { safeParse: (v: unknown) => { success: boolean } },
    ): { kept: unknown[]; dropped: number; ids: string[] } => {
      const raw = Array.isArray(data[key]) ? (data[key] as unknown[]) : [];
      const kept = raw.filter((e) => schema.safeParse(e).success);
      const shapeBroken = key in data && !Array.isArray(data[key]) ? 1 : 0;
      return { kept, dropped: raw.length - kept.length + shapeBroken, ids: droppedIds(raw, schema) };
    };

    const records = section("records", RecordEntrySchema);
    const handoffs = section("handoffs", HandoffEntrySchema);
    const discussions = section("discussions", DiscussionSchema);
    const evidenced = section("evidencedDiscussions", EvidencedDiscussionSchema);
    const total = records.dropped + handoffs.dropped + discussions.dropped + evidenced.dropped;
    if (total === 0) return null;

    const healed: Record<string, unknown> = { ...data, records: records.kept, handoffs: handoffs.kept };
    if ("discussions" in data) healed.discussions = discussions.kept;
    if ("evidencedDiscussions" in data) healed.evidencedDiscussions = evidenced.kept;

    this._quarantineAudit.push({
      timestamp: new Date().toISOString(),
      droppedRecords: records.dropped,
      droppedHandoffs: handoffs.dropped,
      droppedDiscussions: discussions.dropped,
      droppedEvidenced: evidenced.dropped,
      recordIds: records.ids,
      handoffIds: handoffs.ids,
      discussionIds: discussions.ids,
      evidencedIds: evidenced.ids,
    });
    logger.warn(
      `[tawassul] Quarantine audit: dropped ${records.dropped} record(s) [${records.ids.join(", ")}], ` +
        `${handoffs.dropped} handoff(s) [${handoffs.ids.join(", ")}], ` +
        `${discussions.dropped} discussion(s) [${discussions.ids.join(", ")}] and ` +
        `${evidenced.dropped} evidenced discussion(s) [${evidenced.ids.join(", ")}]`,
    );

    return {
      data: healed,
      droppedRecords: records.dropped,
      droppedHandoffs: handoffs.dropped,
      droppedDiscussions: discussions.dropped,
      droppedEvidenced: evidenced.dropped,
    };
  }

  
  getQuarantineAudit(): Array<{
    timestamp: string;
    droppedRecords: number;
    droppedHandoffs: number;
    droppedDiscussions: number;
    droppedEvidenced: number;
    recordIds: string[];
    handoffIds: string[];
    discussionIds: string[];
    evidencedIds: string[];
  }> {
    return [...this._quarantineAudit];
  }

  private async quarantineCopy(fp: string): Promise<void> {
    try {
      if (isIsolationActiveSync()) return;
      let st;
      try {
        st = await stat(fp);
      } catch {
        return;
      }
      const key = `${fp}:${st.mtimeMs}`;
      if (StateManager._quarantineCopies.has(key)) return;
      StateManager._quarantineCopies.add(key);
      if (StateManager._quarantineCopies.size > 256) {
        const oldest = StateManager._quarantineCopies.values().next().value;
        if (oldest !== undefined) StateManager._quarantineCopies.delete(oldest);
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const dest = `${fp}.quarantine-${stamp}`;
      await copyFile(fp, dest);
      logger.warn(`[tawassul] Quarantine copy preserved: ${dest}`);
    } catch (e) {
      logger.warn(`[tawassul] Quarantine copy failed for ${fp} (healing continues):`, e);
    }
  }

  async validateBeforeSave(data: Record<string, unknown>, fp?: string): Promise<Record<string, unknown>> {
    if (this.validateStateData(data).valid) return data;
    const healed = this.sanitizeStateData(data);
    if (!healed) return data;
    if (fp) await this.quarantineCopy(fp);
    logger.warn(
      `[tawassul] State write healed before persist: dropped ${healed.droppedRecords} record(s), ` +
        `${healed.droppedHandoffs} handoff(s), ${healed.droppedDiscussions} discussion(s), ` +
        `${healed.droppedEvidenced} evidenced discussion(s)`,
    );
    return healed.data;
  }

  
  async tryLoadFile(path: string): Promise<Record<string, unknown> | null> {
    try {
      await access(path);
    } catch {
      return null;
    }
    try {
      const fileContent = await readFile(path, "utf-8");

      
      const verifiedPayload = unwrapWithHmac(fileContent);
      if (verifiedPayload === null) {
        logger.warn(`State file rejected: ${path}`);
        return null;
      }

      const rawData = JSON.parse(verifiedPayload) as Record<string, unknown>;

      
      replaceLegacyEncryptedFields(
        rawData,
        [
          { key: "agentRatings", fallback: {} },
          { key: "sharedMemory", fallback: {} },
          { key: "discussions", fallback: [] },
        ],
        "State",
      );

      
      if (!isFreeOfPrototypePollution(rawData)) {
        logger.warn("BLOCKED: Prototype pollution detected in state file, rejecting");
        return null;
      }
      const migratedData = migrateStateData(rawData);
      const validation = this.validateStateData(migratedData);
      if (validation.valid) return validation.sanitized;
      logger.warn("State validation failed:", validation.errors);
      
      
      
      const sanitized = this.sanitizeStateData(migratedData);
      if (sanitized) {
        await this.quarantineCopy(path);
        logger.warn(
          `State self-healed: dropped ${sanitized.droppedRecords} invalid record(s), ` +
            `${sanitized.droppedHandoffs} invalid handoff(s), ${sanitized.droppedDiscussions} discussion(s) ` +
            `and ${sanitized.droppedEvidenced} evidenced discussion(s)`,
        );
        const healedValidation = this.validateStateData(sanitized.data);
        if (healedValidation.valid) return healedValidation.sanitized;
      }
      return null;
    } catch (e) {
      logger.warn(t("loadStateFailed"), e);
      return null;
    }
  }

  

  
  private _sessionDataCache: Record<string, Record<string, unknown>> = {};
  private readonly MAX_CACHED_SESSIONS = 100;

  private trimSessionCache(): void {
    const keys = Object.keys(this._sessionDataCache);
    if (keys.length > this.MAX_CACHED_SESSIONS) {
      const toDelete = keys.slice(0, keys.length - this.MAX_CACHED_SESSIONS);
      for (const k of toDelete) delete this._sessionDataCache[k];
    }
  }

  

  async loadFromFile(stateData: StateData, sessionId?: string): Promise<StateData> {
    if (!this.stateDir) return stateData;
    const fp = this.statePathFn();

    
    
    
    await this.cleanOrphanedTmp(fp);

    
    try {
      
      if (!isIsolationActiveSync()) {
        const stateDir = dirname(fp);
        const entries = await readdir(stateDir);
        for (const entry of entries) {
          if (entry.startsWith("tawassul-test-") || entry.startsWith(".int-handoff-")) {
            try {
              await rmdir(join(stateDir, entry));
            } catch {

            }
          }
        }
      }
    } catch {

    }

    let data: Record<string, unknown> | null;

    
    data = await this.tryLoadFile(fp);

    
    if (!data) {
      const bakBase = this.statePathFn() + ".bak";
      for (let i = 0; i <= StateManager.MAX_BACKUPS; i++) {
        data = await this.tryLoadFile(bakBase + "." + i);
        if (data) {
          logger.debug(`Recovered from backup: ${bakBase}.${i}`);
          break;
        }
      }
      if (!data) {
        try {
          await access(bakBase);
          data = await this.tryLoadFile(bakBase);
        } catch {

        }
        if (data) {
          logger.debug(`Recovered from legacy backup: ${bakBase}`);
        }
      }
    }

    if (!data) return stateData;

    if (data.version !== STATE_VERSION) {
      logger.warn(t("loadStateVersionMismatch", { version: String(data.version), expected: String(STATE_VERSION) }));
    }

    
    stateData.records.length = 0;
    stateData.handoffs.length = 0;
    if (data.records) stateData.records.push(...(data.records as RecordEntry[]));
    if (data.handoffs) stateData.handoffs.push(...(data.handoffs as HandoffEntry[]));
    stateData.recSeq = (data.recSeq as number) ?? 0;
    stateData.hoffSeq = (data.hoffSeq as number) ?? 0;
    stateData.agentErrors = (data.agentErrors as Record<string, number>) ?? {};
    stateData.agentRatings = (data.agentRatings as Record<string, Record<string, unknown>>) ?? {};
    stateData.dynamicAgents = (data.dynamicAgents as string[]) ?? [];
    stateData.agentModelMap = (data.agentModelMap as Record<string, string>) ?? {};
    stateData.sharedMemory = data.sharedMemory as Record<string, unknown> | undefined;
    stateData.discussions = data.discussions as unknown[];
    stateData.discussionSeq = data.discussionSeq as number;
    stateData.evidencedDiscussions = data.evidencedDiscussions as unknown[];
    stateData.evidenceSeqReceipt = (data.evidenceSeqReceipt as number) ?? 0;
    stateData.evidenceSeqClaim = (data.evidenceSeqClaim as number) ?? 0;
    stateData.evidenceSeqVerification = (data.evidenceSeqVerification as number) ?? 0;
    stateData.evidenceSeqChallenge = (data.evidenceSeqChallenge as number) ?? 0;
    stateData.trainingEvaluator = data.trainingEvaluator as Record<string, unknown> | undefined;

    
    stateData._meta = data._meta as StateData["_meta"];
    this._knownRevision = (data._meta as { revision?: number } | undefined)?.revision ?? 0;

    
    const sessionData = data.sessionData as Record<string, Record<string, unknown>> | undefined;
    
    
    
    
    if (sessionData) {
      this._sessionDataCache = { ...sessionData };
      this.trimSessionCache();
    }
    if (sessionId && sessionData && sessionData[sessionId]) {
      const sData = sessionData[sessionId];
      stateData.pauseState = (sData.pauseState as PauseState | null) ?? null;
      if (sData.seenAgents) {
        stateData.seenAgents = sData.seenAgents as Record<string, string[]>;
      }
      logger.debug(`Loaded session-specific data for ${sessionId}`);
    } else {
      
      stateData.pauseState = (data.pauseState as PauseState | null) ?? null;
    }

    
    this.rebuildIndexes(stateData);

    return stateData;
  }

  

  
  enforceStateLimits(
    stateData: StateData,
    maxHandoffs: number,
    maxRecords: number,
    maxAgentRatings: number = 50,
    maxSeenSessions: number = 50,
    maxAgentErrors: number = 50,
    maxDynamicAgents: number = MAX_DYNAMIC_AGENTS_DEFAULT,
    maxModelMap: number = 50,
    seenAgents?: Map<string, Set<string>>,
  ): () => void {
    const rollbacks: Array<() => void> = [];

    if (stateData.handoffs.length > maxHandoffs) {
      const removed = stateData.handoffs.splice(0, stateData.handoffs.length - maxHandoffs);
      for (const h of removed) this.handoffIndex.delete(h.id);
      rollbacks.push(() => {
        
        const existingIds = new Set(stateData.handoffs.map((h) => h.id));
        for (const h of removed) {
          if (!existingIds.has(h.id)) {
            stateData.handoffs.unshift(h);
            existingIds.add(h.id);
          }
          this.handoffIndex.set(h.id, h);
        }
      });
      logger.debug(`Capped handoffs: removed ${removed.length} oldest (max ${maxHandoffs})`);
    }
    if (stateData.records.length > maxRecords) {
      const removed = stateData.records.splice(0, stateData.records.length - maxRecords);
      for (const r of removed) this.recordIndex.delete(r.id);
      rollbacks.push(() => {
        stateData.records.unshift(...removed);
        for (const r of removed) this.recordIndex.set(r.id, r);
      });
      logger.debug(`Capped records: removed ${removed.length} oldest (max ${maxRecords})`);
    }
    const ratingKeys = Object.keys(stateData.agentRatings);
    if (ratingKeys.length > maxAgentRatings) {
      const toDelete = ratingKeys.slice(0, ratingKeys.length - maxAgentRatings);
      const saved: Record<string, Record<string, unknown>> = {};
      for (const k of toDelete) {
        saved[k] = stateData.agentRatings[k]!;
        delete stateData.agentRatings[k];
      }
      rollbacks.push(() => {
        Object.assign(stateData.agentRatings, saved);
      });
      logger.debug(`Capped agent ratings: removed ${toDelete.length} oldest (max ${maxAgentRatings})`);
    }
    const cappedSeenAgents: Array<{ key: string; value: Set<string> }> = [];
    if (seenAgents) {
      const seenKeys = [...seenAgents.keys()];
      if (seenKeys.length > maxSeenSessions) {
        const toDelete = seenKeys.slice(0, seenKeys.length - maxSeenSessions);
        for (const k of toDelete) {
          const v = seenAgents.get(k);
          if (v) cappedSeenAgents.push({ key: k, value: v });
          seenAgents.delete(k);
        }
        rollbacks.push(() => {
          for (const { key, value } of cappedSeenAgents) seenAgents!.set(key, value);
        });
        logger.debug(`Capped seenAgents: removed ${toDelete.length} oldest sessions (max ${maxSeenSessions})`);
      }
    }
    const errorKeys = Object.keys(stateData.agentErrors);
    if (errorKeys.length > maxAgentErrors) {
      const toDelete = errorKeys.slice(0, errorKeys.length - maxAgentErrors);
      const saved: Record<string, number> = {};
      for (const k of toDelete) {
        saved[k] = stateData.agentErrors[k]!;
        delete stateData.agentErrors[k];
      }
      rollbacks.push(() => {
        Object.assign(stateData.agentErrors, saved);
      });
    }
    if (stateData.dynamicAgents.length > maxDynamicAgents) {
      const removed = stateData.dynamicAgents.splice(0, stateData.dynamicAgents.length - maxDynamicAgents);
      
      
      const savedModel: Record<string, string> = {};
      for (const a of removed) {
        if (a in stateData.agentModelMap) {
          savedModel[a] = stateData.agentModelMap[a]!;
          delete stateData.agentModelMap[a];
        }
      }
      rollbacks.push(() => {
        stateData.dynamicAgents.unshift(...removed);
        Object.assign(stateData.agentModelMap, savedModel);
      });
    }
    const modelKeys = Object.keys(stateData.agentModelMap);
    if (modelKeys.length > maxModelMap) {
      const toDelete = modelKeys.slice(0, modelKeys.length - maxModelMap);
      const saved: Record<string, string> = {};
      for (const k of toDelete) {
        saved[k] = stateData.agentModelMap[k]!;
        delete stateData.agentModelMap[k];
      }
      rollbacks.push(() => {
        Object.assign(stateData.agentModelMap, saved);
      });
    }

    return () => {
      for (const rb of rollbacks) rb();
    };
  }
}
