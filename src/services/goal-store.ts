
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { logger } from "../utils/logger.ts";
import { hmacWriteFile, hmacReadFile } from "./persist-utils.ts";
import { isIsolationActiveSync } from "./isolation.ts";
import { FileLockManager } from "../infra/file-lock.ts";
import { resolveRuntimeStateDir } from "../utils/path-resolver.ts";
import type {
  Goal,
  GoalStatus,
  GoalItemState,
  GoalListFilter,
  GoalInvariantCheck,
  GoalDigest,
  DoDStatus,
} from "../types/goal-types.ts";
import { GoalSchema } from "../validation.ts";
import { normalizeName } from "../utils/name-utils.ts";

export interface GoalStoreOptions {
  maxGoals?: number;
  minEvidenceIntervalMs?: number;
  lockManager?: FileLockManager | null;
}

export interface GoalCreateInput {
  title: string;
  detail?: string;
  owner: string;
  ownerKind?: "solo" | "delegated";
  parentId?: string | null;
  items?: string[];
  acceptance?: string[];
  linkedRecords?: string[];
  linkedHandoffs?: string[];
  linkedBoards?: string[];
}

export interface GoalUpdatePatch {
  title?: string;
  detail?: string;
  status?: GoalStatus;
  parentId?: string | null;
  pinned?: boolean;
  itemStates?: Array<{ itemId: string; state: GoalItemState }>;
  
  itemEvidence?: Array<{ itemId: string; text: string }>;
  
  acceptanceStates?: Array<{ criterion: string; status: DoDStatus }>;
  acceptanceEvidence?: Array<{ criterion: string; text: string }>;
  itemsAdd?: string[];
  acceptanceAdd?: string[];
  linkedRecords?: string[];
  linkedHandoffs?: string[];
  linkedBoards?: string[];
}

export type GoalWriteResult = { ok: true; goal: Goal } | { ok: false; reason: string; missing?: string[] };
export type EvidenceResult = { ok: true; goal: Goal } | { ok: false; reason: string };

const GOALS_SUBDIR = "goals";
const EVENTS_FILE = "goals.jsonl";
const META_FILE = "goals-meta.json";
const META_SCHEMA_VERSION = 1;
const DEFAULT_MAX_GOALS = 5000;
const WARN_THRESHOLD = 0.8;
const MAX_EVIDENCE_PER_GOAL = 100;
const MIN_EVIDENCE_LEN = 8;
const DEFAULT_MIN_EVIDENCE_INTERVAL_MS = 2000;
const DIGEST_ATTENTION_CAP = 12;
const DIGEST_ROSTER_CAP = 80;
const DIGEST_CHANGED_CAP = 50;

interface GoalMeta {
  schemaVersion: number;
  seq: number;
  count: number;
  
  ledgerHash: string;
  
  completed: number;
  verified: number;
  dropped: number;
  createdAt: string;
  updatedAt: string;
}


const ALLOWED_TRANSITIONS: Record<GoalStatus, readonly GoalStatus[]> = {
  open: ["in_progress", "blocked", "completed", "verified", "dropped"],
  in_progress: ["partial", "blocked", "completed", "dropped"],
  partial: ["in_progress", "blocked", "completed", "dropped"],
  blocked: ["open", "in_progress", "dropped"],
  
  
  completed: ["verified", "in_progress", "blocked", "dropped"],
  verified: ["dropped"],
  dropped: ["open"],
  stale: ["open", "in_progress", "dropped"],
};

const ACTIVE_STATUSES: readonly GoalStatus[] = ["open", "in_progress", "partial", "blocked", "stale"];

function sha1(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

function deriveProgress(goal: Pick<Goal, "items" | "completedItems" | "status">): number {
  const total = goal.items.length + goal.completedItems.length;
  if (total === 0) return goal.status === "completed" || goal.status === "verified" ? 100 : 0;
  const done = goal.items.filter((i) => i.state === "done").length + goal.completedItems.length;
  return Math.round((done / total) * 100);
}

export function checkCloseInvariant(goal: Pick<Goal, "items" | "completedItems" | "acceptance">): GoalInvariantCheck {
  const missing: string[] = [];
  if (goal.items.length === 0 && goal.completedItems.length === 0 && goal.acceptance.length === 0) {
    missing.push("empty: no items, no completed items, and no acceptance criteria to verify");
    return { ok: false, missing };
  }
  for (const item of goal.items) {
    if (item.state !== "done") missing.push(`item:${item.id} (${item.state})`);
  }
  for (const dod of goal.acceptance) {
    if (dod.status !== "met") missing.push(`dod:${dod.criterion}`);
  }
  return { ok: missing.length === 0, missing };
}


function hasIncompleteItems(goal: Pick<Goal, "items" | "acceptance">): boolean {
  return goal.items.some((i) => i.state !== "done") || goal.acceptance.some((d) => d.status !== "met");
}

export class GoalStore {
  private dir: string;
  private eventsPath: string;
  private metaPath: string;
  private dirReady: Promise<void>;
  private lockManager: FileLockManager | null;
  private maxGoals: number;
  private minEvidenceIntervalMs: number;

  private goals = new Map<string, Goal>();
  private seq = 0;
  private warned = false;
  
  private lockAcq = 0;
  
  private lifecycleCounts = { completed: 0, verified: 0, dropped: 0 };
  
  private static normTitle = (t: string): string => normalizeName(t.replace(/\s+/g, " ").trim());

  constructor(
    stateDir?: string,
    private scope?: import("../utils/path-resolver.ts").InstallScope,
    options: GoalStoreOptions = {},
  ) {
    
    const base = stateDir ? resolve(resolveRuntimeStateDir(stateDir, this.scope), GOALS_SUBDIR) : resolve(GOALS_SUBDIR);
    this.dir = base;
    this.eventsPath = join(base, EVENTS_FILE);
    this.metaPath = join(base, META_FILE);
    this.dirReady = mkdir(dirname(this.eventsPath), { recursive: true, mode: 0o700 }).then(
      () => undefined,
      (e) => {
        logger.warn("[goal-store] ensureDir failed:", e);
      },
    );
    this.lockManager = options.lockManager === undefined ? new FileLockManager(true) : options.lockManager;
    this.maxGoals = options.maxGoals ?? DEFAULT_MAX_GOALS;
    this.minEvidenceIntervalMs = options.minEvidenceIntervalMs ?? DEFAULT_MIN_EVIDENCE_INTERVAL_MS;
  }

  
  get paths(): { dir: string; events: string; meta: string } {
    return { dir: this.dir, events: this.eventsPath, meta: this.metaPath };
  }

  get size(): number {
    return this.goals.size;
  }

  private loadPromise: Promise<void> | null = null;

  ensureLoaded(opts: { sweepStaleMs?: number } = {}): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.load(opts).then(
        () => undefined,
        (err) => {
          logger.warn("[goal-store] ensureLoaded: load failed, serving empty state:", err);
        },
      );
    }
    return this.loadPromise;
  }

  async load(opts: { sweepStaleMs?: number } = {}): Promise<void> {
    await this.dirReady;
    this.tornTailNeedsSep = false;
    const meta = await hmacReadFile<GoalMeta>(this.metaPath);
    if (meta && typeof meta.seq === "number") {
      this.seq = meta.seq;
      
      this.lifecycleCounts = {
        completed: meta.completed ?? 0,
        verified: meta.verified ?? 0,
        dropped: meta.dropped ?? 0,
      };
    } else if (meta === null) {
      
      
      
      
      logger.warn("[goal-store] goals meta unreadable (missing or tampered) — seq recomputed from ledger");
    }
    let raw: string;
    try {
      raw = await readFile(this.eventsPath, "utf-8");
    } catch {
      return; 
    }
    let skipped = 0;
    
    
    
    
    
    const lastNl = raw.lastIndexOf("\n");
    if (raw.length > 0 && lastNl !== raw.length - 1 && raw.trim() !== "") {
      let tailIsTorn = true;
      try {
        JSON.parse(raw.slice(lastNl + 1));
        tailIsTorn = false; 
      } catch {

      }
      if (tailIsTorn) {
        logger.warn(
          `[goal-store] torn ledger tail detected (${raw.length - lastNl - 1} bytes) — skipping fragment, next append separates`,
        );
        this.tornTailNeedsSep = true;
      }
    }
    
    
    
    
    
    const lastLive = new Map<string, GoalStatus>();
    const replayed = { completed: 0, verified: 0, dropped: 0 };
    let ledgerHash = "";
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = GoalSchema.safeParse(JSON.parse(trimmed));
        if (!parsed.success) {
          skipped++;
          continue;
        }
        const goal = parsed.data as Goal;
        
        
        this.goals.set(goal.id, goal); 
        if (goal.seq > this.seq) this.seq = goal.seq;
        
        
        
        
        
        
        
        
        const prior = lastLive.get(goal.id) ?? null;
        if (goal.status === "dropped") {
          if (prior === "completed") replayed.completed += 1;
          else if (prior === "verified") replayed.verified += 1;
          else replayed.dropped += 1;
          lastLive.delete(goal.id);
        } else {
          lastLive.set(goal.id, goal.status);
        }
        ledgerHash = GoalStore.foldLedgerHash(ledgerHash, goal.id, goal.seq, goal.updatedAt);
      } catch {
        skipped++;
      }
    }
    
    
    
    for (const [id, goal] of this.goals) {
      if (goal.status === "dropped") this.goals.delete(id);
    }
    
    
    
    
    const ledgerSeq = this.seq;
    const metaTrusted = !!(meta && typeof meta.seq === "number" && typeof meta.ledgerHash === "string");
    if (!metaTrusted || meta.ledgerHash !== ledgerHash || meta.seq !== ledgerSeq) {
      this.lifecycleCounts = { ...replayed };
      this.ledgerHash = ledgerHash;
      if (metaTrusted && (meta.ledgerHash !== ledgerHash || meta.seq < ledgerSeq))
        logger.warn(
          `[goal-store] meta stale (hash ${meta.ledgerHash !== ledgerHash ? "mismatch" : "match"} / seq ${meta.seq} vs ${ledgerSeq}) — counts replayed, meta healed`,
        );
      await this.persistMeta().catch((e) => logger.warn("[goal-store] meta heal write failed on load (non-fatal):", e));
    } else {
      this.ledgerHash = ledgerHash;
    }
    if (skipped > 0) logger.warn(`[goal-store] skipped ${skipped} invalid ledger line(s)`);
    if (opts.sweepStaleMs !== undefined) {
      const staled = await this.markStale(opts.sweepStaleMs);
      if (staled.length > 0)
        logger.warn(`[goal-store] boot sweep staled ${staled.length} goal(s): ${staled.join(", ")}`);
    }
  }

  
  
  
  
  
  
  private lastLines = new Set<string>();
  private static readonly LAST_LINES_CAP = 128;
  private tornTailNeedsSep = false;

  
  private async commit(next: Goal, opts: { remove?: boolean } = {}): Promise<void> {
    await this.writeEvent(next);
    if (opts.remove) this.goals.delete(next.id);
    else this.goals.set(next.id, next);
  }

  private async writeEvent(goal: Goal): Promise<void> {
    await this.dirReady;
    const sep = this.tornTailNeedsSep ? "\n" : "";
    this.tornTailNeedsSep = false;
    const line = `${sep}${JSON.stringify(goal)}\n`;
    
    
    
    if (this.lastLines.has(line)) return;
    
    
    
    
    
    
    
    
    await appendFile(this.eventsPath, line, "utf-8");
    if (this.lastLines.size >= GoalStore.LAST_LINES_CAP) {
      const oldest = this.lastLines.values().next().value as string | undefined;
      if (oldest !== undefined) this.lastLines.delete(oldest);
    }
    this.lastLines.add(line);
    this.ledgerHash = GoalStore.foldLedgerHash(this.ledgerHash, goal.id, goal.seq, goal.updatedAt);
    try {
      await this.persistMeta();
    } catch (e) {
      logger.warn(
        `[goal-store] meta write fell behind the ledger for ${goal.id} (seq ${goal.seq}) — will heal on next load:`,
        e,
      );
    }
  }

  
  private activeCount(): number {
    let n = 0;
    for (const goal of this.goals.values()) {
      if ((ACTIVE_STATUSES as readonly string[]).includes(goal.status)) n += 1;
    }
    return n;
  }

  private countStatus(status: GoalStatus): number {
    let n = 0;
    for (const goal of this.goals.values()) {
      if (goal.status === status) n += 1;
    }
    return n;
  }

  private bumpTerminal(prior: GoalStatus): void {
    if (prior === "completed") this.lifecycleCounts.completed += 1;
    else if (prior === "verified") this.lifecycleCounts.verified += 1;
    else this.lifecycleCounts.dropped += 1;
  }

  private async persistMeta(): Promise<void> {
    await this.dirReady;
    const meta: GoalMeta = {
      schemaVersion: META_SCHEMA_VERSION,
      seq: this.seq,
      count: this.goals.size,
      ledgerHash: this.ledgerHash,
      completed: this.lifecycleCounts.completed,
      verified: this.lifecycleCounts.verified,
      dropped: this.lifecycleCounts.dropped,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await hmacWriteFile(this.metaPath, meta);
  }

  
  private ledgerHash = "";

  
  private static foldLedgerHash(prev: string, id: string, seq: number, updatedAt: string): string {
    return createHash("sha256").update(`${prev}|${id}|${seq}|${updatedAt}`).digest("hex");
  }

  
  private async mutate<T>(key: string, fn: () => Promise<T>): Promise<T | { ok: false; reason: "locked" }> {
    const release = await this.withLock(key);
    if (!release) return { ok: false, reason: "locked" };
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async withLock(id: string): Promise<(() => void) | null> {
    if (!this.lockManager) return () => undefined;
    
    
    
    
    
    
    const acq = ++this.lockAcq;
    const owner = `goal-store:${id}:${acq}`;
    try {
      const lock = await this.lockManager.acquireLock(this.metaPath, owner, id);
      
      if (!lock.acquired) return null;
      return () => {
        void this.lockManager?.releaseLock(this.metaPath, owner).catch(() => undefined);
      };
    } catch {
      return null;
    }
  }

  private writeGuarded(): { ok: false; reason: string } | null {
    
    if (isIsolationActiveSync()) return { ok: false, reason: "isolated" };
    return null;
  }

  
  async create(input: GoalCreateInput): Promise<GoalWriteResult> {
    const blocked = this.writeGuarded();
    if (blocked) return blocked;
    const title = input.title?.trim() ?? "";
    if (!title) return { ok: false, reason: "required" };
    if (!this.warned && this.activeCount() >= Math.floor(this.maxGoals * WARN_THRESHOLD)) {
      this.warned = true;
      logger.warn(`[goal-store] active goal count near cap (${this.activeCount()}/${this.maxGoals})`);
    }
    const now = new Date().toISOString();
    
    
    
    return this.mutate("create", async (): Promise<GoalWriteResult> => {
      if (this.activeCount() >= this.maxGoals) return { ok: false as const, reason: "max" };
      this.seq += 1;
      const id = `G-${String(this.seq).padStart(3, "0")}`;
      const items = (input.items ?? []).map((t, n) => ({
        id: `${id}-I${n + 1}`,
        title: t,
        state: "pending" as GoalItemState,
        evidence: [] as string[],
        verifiedBy: null as string | null,
        updatedAt: now,
      }));
      const acceptance = (input.acceptance ?? []).map((c) => ({
        criterion: c,
        verification: "agent_check" as const,
        status: "pending" as const,
        evidence: [] as string[],
      }));
      const goal: Goal = {
        id,
        seq: this.seq,
        title,
        detail: input.detail ?? "",
        status: "open",
        progressPct: 0,
        owner: normalizeName(input.owner) || "main",
        ownerKind: input.ownerKind ?? "solo",
        parentId: input.parentId ?? null,
        items,
        completedItems: [],
        acceptance,
        linkedRecords: input.linkedRecords ?? [],
        linkedHandoffs: input.linkedHandoffs ?? [],
        linkedBoards: input.linkedBoards ?? [],
        evidence: [],
        evidenceHashes: [],
        pinned: false,
        createdAt: now,
        updatedAt: now,
        verifiedBy: null,
        lastEvidenceAt: null,
      };
      
      
      try {
        await this.commit(goal);
      } catch (e) {
        this.seq -= 1;
        throw e;
      }
      return { ok: true, goal };
    });
  }

  async update(id: string, patch: GoalUpdatePatch): Promise<GoalWriteResult> {
    const blocked = this.writeGuarded();
    if (blocked) return blocked;
    const goal = this.goals.get(id);
    if (!goal) return { ok: false, reason: "not-found" };
    return this.mutate(id, async (): Promise<GoalWriteResult> => {
      const now = new Date().toISOString();
      const fresh = this.goals.get(id);
      if (!fresh) return { ok: false, reason: "not-found" };
      const next = structuredClone(fresh);
      if (patch.title !== undefined) {
        if (!patch.title.trim()) return { ok: false, reason: "required" };
        next.title = patch.title.trim();
      }
      if (patch.detail !== undefined) next.detail = patch.detail;
      if (patch.parentId !== undefined) next.parentId = patch.parentId;
      if (patch.pinned !== undefined) next.pinned = patch.pinned;
      if (patch.linkedRecords !== undefined) next.linkedRecords = patch.linkedRecords;
      if (patch.linkedHandoffs !== undefined) next.linkedHandoffs = patch.linkedHandoffs;
      if (patch.linkedBoards !== undefined) next.linkedBoards = patch.linkedBoards;
      if (patch.itemsAdd !== undefined) {
        const base = next.items.length;
        for (const [n, t] of patch.itemsAdd.entries()) {
          next.items.push({
            id: `${next.id}-I${base + n + 1}`,
            title: t,
            state: "pending",
            evidence: [],
            verifiedBy: null,
            updatedAt: now,
          });
        }
      }
      if (patch.acceptanceAdd !== undefined) {
        for (const c of patch.acceptanceAdd) {
          next.acceptance.push({ criterion: c, verification: "agent_check", status: "pending", evidence: [] });
        }
      }
      
      if (patch.acceptanceEvidence !== undefined) {
        for (const { criterion, text } of patch.acceptanceEvidence) {
          const dod = next.acceptance.find((a) => a.criterion === criterion);
          if (!dod) return { ok: false, reason: "acceptance-unknown", missing: [criterion] };
          const clean = text?.trim() ?? "";
          if (clean.length < MIN_EVIDENCE_LEN) {
            return { ok: false, reason: "acceptance-evidence-short", missing: [criterion] };
          }
          if (!dod.evidence.includes(clean)) dod.evidence.push(clean);
          dod.verification = "agent_check";
        }
      }
      if (patch.acceptanceStates !== undefined) {
        for (const { criterion, status } of patch.acceptanceStates) {
          const dod = next.acceptance.find((a) => a.criterion === criterion);
          if (!dod) return { ok: false, reason: "acceptance-unknown", missing: [criterion] };
          if (status === "met" && dod.evidence.length === 0) {
            return { ok: false, reason: "acceptance-evidence", missing: [criterion] };
          }
          dod.status = status;
        }
      }
      if (patch.itemEvidence !== undefined) {
        for (const { itemId, text } of patch.itemEvidence) {
          const item = next.items.find((i) => i.id === itemId);
          if (!item) return { ok: false, reason: "unknown-item", missing: [itemId] };
          const clean = text?.trim() ?? "";
          if (clean.length < MIN_EVIDENCE_LEN) return { ok: false, reason: "item-evidence-short", missing: [itemId] };
          
          if (!item.evidence.includes(clean)) item.evidence.push(clean);
          item.updatedAt = now;
        }
      }
      if (patch.itemStates !== undefined) {
        for (const { itemId, state } of patch.itemStates) {
          const item = next.items.find((i) => i.id === itemId);
          const archived = next.completedItems.find((c) => c.id === itemId);
          if (!item && !archived) return { ok: false, reason: "unknown-item", missing: [itemId] };
          if (state === "done") {
            if (archived) continue; 
            if (!item) return { ok: false, reason: "unknown-item", missing: [itemId] };
            
            
            if (item.evidence.length === 0) return { ok: false, reason: "item-evidence", missing: [itemId] };
            
            
            next.completedItems.push({
              id: item.id,
              title: item.title,
              completedAt: now,
              evidence: [...item.evidence],
            });
            next.items.splice(next.items.indexOf(item), 1);
          } else if (archived) {
            
            next.completedItems.splice(next.completedItems.indexOf(archived), 1);
            next.items.push({
              id: archived.id,
              title: archived.title,
              state,
              evidence: archived.evidence,
              verifiedBy: null,
              updatedAt: now,
            });
          } else if (item) {
            item.state = state;
            item.updatedAt = now;
          }
        }
      }
      if (patch.status !== undefined && patch.status !== next.status) {
        if (!ALLOWED_TRANSITIONS[next.status].includes(patch.status)) {
          return { ok: false, reason: "transition", missing: [`${next.status}→${patch.status}`] };
        }
        next.status = patch.status;
      }
      next.progressPct = deriveProgress(next);
      next.updatedAt = now;
      if (patch.status === "completed" || patch.status === "verified") {
        return this.finishLocked(next, patch.status, "goal.update");
      }
      if (patch.status === "dropped") {
        this.bumpTerminal(fresh.status);
        await this.commit(next, { remove: true });
        return { ok: true, goal: next };
      }
      await this.commit(next);
      return { ok: true, goal: next };
    });
  }

  
  async close(id: string, verify: boolean, by: string): Promise<GoalWriteResult> {
    const blocked = this.writeGuarded();
    if (blocked) return blocked;
    const goal = this.goals.get(id);
    if (!goal) return { ok: false, reason: "not-found" };
    const target: GoalStatus = verify ? "verified" : "completed";
    return this.mutate(id, async (): Promise<GoalWriteResult> => {
      const fresh = this.goals.get(id);
      if (!fresh) return { ok: false, reason: "not-found" };
      if (fresh.status === target) return { ok: true, goal: fresh };
      if (fresh.status !== target && !ALLOWED_TRANSITIONS[fresh.status].includes(target)) {
        return { ok: false, reason: "transition", missing: [`${fresh.status}→${target}`] };
      }
      return this.finishLocked(fresh, target, by);
    });
  }

  private async finishLocked(base: Goal, target: "completed" | "verified", by: string): Promise<GoalWriteResult> {
    const check = checkCloseInvariant(base);
    if (!check.ok) return { ok: false, reason: "invariant", missing: check.missing };
    if (target === "verified" && base.evidence.length === 0) {
      return {
        ok: false,
        reason: "invariant",
        missing: ["verified requires at least one goal-level evidence entry"],
      };
    }
    const now = new Date().toISOString();
    const next = structuredClone(base);
    for (let i = next.items.length - 1; i >= 0; i--) {
      const item = next.items[i];
      if (item && item.state === "done") {
        next.completedItems.push({ id: item.id, title: item.title, completedAt: now, evidence: [...item.evidence] });
        next.items.splice(i, 1);
      }
    }
    next.status = target;
    if (target === "verified" && by) next.verifiedBy = by;
    next.progressPct = deriveProgress(next);
    next.updatedAt = now;
    const closed = structuredClone(next);
    await this.writeEvent(closed);
    if (target === "verified") this.lifecycleCounts.verified += 1;
    else this.lifecycleCounts.completed += 1;
    const tomb = structuredClone(closed);
    tomb.status = "dropped";
    tomb.updatedAt = new Date().toISOString();
    await this.commit(tomb, { remove: true });
    return { ok: true, goal: closed };
  }

  
  async deleteGoal(id: string): Promise<GoalWriteResult> {
    const blocked = this.writeGuarded();
    if (blocked) return blocked;
    const goal = this.goals.get(id);
    if (!goal) return { ok: false, reason: "not-found" };
    return this.mutate(id, async (): Promise<GoalWriteResult> => {
      const now = new Date().toISOString();
      const fresh = this.goals.get(id);
      if (!fresh) return { ok: false, reason: "not-found" };
      const tomb = structuredClone(fresh);
      tomb.status = "dropped";
      tomb.updatedAt = now;
      this.bumpTerminal(fresh.status);
      await this.commit(tomb, { remove: true });
      return { ok: true, goal: tomb };
    });
  }

  
  async appendEvidence(id: string, text: string): Promise<EvidenceResult> {
    const blocked = this.writeGuarded();
    if (blocked) return blocked;
    const goal = this.goals.get(id);
    if (!goal) return { ok: false, reason: "not-found" };
    const clean = text?.trim() ?? "";
    if (clean.length < MIN_EVIDENCE_LEN) return { ok: false, reason: "short" };
    
    
    
    return this.mutate(id, async (): Promise<EvidenceResult> => {
      const fresh = this.goals.get(id);
      if (!fresh) return { ok: false, reason: "not-found" };
      const hash = sha1(clean);
      if (fresh.evidenceHashes.includes(hash)) return { ok: false, reason: "dup" };
      if (fresh.evidence.length >= MAX_EVIDENCE_PER_GOAL) return { ok: false, reason: "cap" };
      if (fresh.lastEvidenceAt) {
        const gap = Date.now() - new Date(fresh.lastEvidenceAt).getTime();
        if (gap < this.minEvidenceIntervalMs) return { ok: false, reason: "rate" };
      }
      const now = new Date().toISOString();
      const next = structuredClone(fresh);
      next.evidence.push(clean);
      next.evidenceHashes.push(hash);
      next.lastEvidenceAt = now;
      next.updatedAt = now;
      await this.commit(next);
      return { ok: true, goal: next };
    });
  }

  
  get(id: string): Goal | undefined {
    return this.goals.get(id);
  }

  list(filter: GoalListFilter = "active"): Goal[] {
    const all = [...this.goals.values()].sort((a, b) => a.seq - b.seq);
    if (filter === "all") return all;
    if (filter === "active") return all.filter((g) => (ACTIVE_STATUSES as readonly string[]).includes(g.status));
    return all.filter((g) => g.status === filter);
  }

  
  async markStale(thresholdMs: number, nowMs = Date.now()): Promise<string[]> {
    const blocked = this.writeGuarded();
    if (blocked) return [];
    const changed: string[] = [];
    await this.mutate("sweep", async () => {
      for (const goal of this.goals.values()) {
        
        
        
        
        if (hasIncompleteItems(goal)) continue;
        
        if (
          !goal.pinned &&
          (goal.status === "open" || goal.status === "in_progress" || goal.status === "partial") &&
          nowMs - new Date(goal.updatedAt).getTime() > thresholdMs
        ) {
          const next = structuredClone(goal);
          next.status = "stale";
          next.updatedAt = new Date(nowMs).toISOString();
          await this.commit(next);
          changed.push(goal.id);
        }
      }
    });
    return changed;
  }

  
  
  compactDigest(): string {
    const digest = this.buildDigest({ attentionCap: 12, rosterCap: 60, changedCap: 30 });
    if (digest.open === 0) return "";
    return `### 🎯 Goals (${digest.open} open)\n${digest.text}`;
  }

  
  buildDigest(opts: { attentionCap?: number; rosterCap?: number; changedCap?: number } = {}): GoalDigest {
    const attentionCap = opts.attentionCap ?? DIGEST_ATTENTION_CAP;
    const rosterCap = opts.rosterCap ?? DIGEST_ROSTER_CAP;
    const changedCap = opts.changedCap ?? DIGEST_CHANGED_CAP;
    const active = this.list("active");
    const byUpdated = [...active].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    const attentionIds = new Set<string>();
    const attention: string[] = [];
    const pushAttention = (g: Goal, tag: string) => {
      if (attention.length >= attentionCap + changedCap) return;
      attentionIds.add(g.id);
      const line =
        tag === "changed"
          ? `📝 **${g.id}** updated — ${g.status} ${g.progressPct}% · ${g.title}`
          : `${g.status === "blocked" ? "🚧" : "⏳"} **${g.id}** ${g.status} — ${g.title}`;
      attention.push(line);
    };
    for (const g of active) {
      
      
      if (g.status === "blocked" || g.status === "stale" || g.pinned) pushAttention(g, "flag");
    }
    let changed = 0;
    for (const g of byUpdated) {
      if (changed >= changedCap) break;
      if (attentionIds.has(g.id)) continue;
      pushAttention(g, "changed");
      changed++;
    }
    const roster: string[] = [];
    let overflow = 0;
    for (const g of active) {
      if (attentionIds.has(g.id)) continue;
      if (roster.length < rosterCap) {
        const total = g.items.length + g.completedItems.length;
        const frac =
          total > 0 ? ` · ${g.items.filter((i) => i.state === "done").length + g.completedItems.length}/${total}` : "";
        roster.push(`▫️ ${g.id} · ${g.status} ${g.progressPct}%${frac} · ${g.title}`);
      } else {
        overflow++;
      }
    }
    
    
    const done = this.lifecycleCounts.completed + this.countStatus("completed");
    const verified = this.lifecycleCounts.verified + this.countStatus("verified");
    const dropped = this.lifecycleCounts.dropped;
    const activeNow = this.activeCount();
    const lines = [
      `🎯 ${active.length} open · ✅ ${done} completed · ✔ ${verified} verified · 🗑 ${dropped} dropped`,
      `🚧 ATTENTION (${attention.length}):`,
      ...attention,
      `📋 ROSTER (${roster.length}):`,
      ...roster,
    ];
    if (overflow > 0) lines.push(`+ ${overflow} more (goal(board) for the full list)`);
    if (activeNow >= this.maxGoals) {
      lines.push(
        `⛔ active goal cap reached (${activeNow}/${this.maxGoals}) — close or drop a goal before creating another`,
      );
    }
    return {
      text: lines.join("\n"),
      attention: attention.length,
      roster: roster.length,
      overflow,
      changed,
      open: active.length,
      done: done + verified,
    };
  }

  
  
  private static findItemIndex(list: Array<{ title: string }>, title: string): number {
    const norm = GoalStore.normTitle(title);
    return list.findIndex((i) => GoalStore.normTitle(i.title) === norm);
  }

  private static normalizeTodoState(status: string): GoalItemState {
    const s = (status ?? "").trim().toLowerCase();
    if (s === "completed" || s === "done") return "done";
    if (s === "in_progress" || s === "partial") return "in_progress";
    return "pending";
  }

  
  async reconcileCapture(input: {
    owner: string;
    sessionId: string;
    todos: Array<{ title: string; status: string }>;
  }): Promise<GoalWriteResult> {
    await this.ensureLoaded();
    const blocked = this.writeGuarded();
    if (blocked) return blocked;
    const owner = normalizeName(input.owner) || "main";
    const todos = (input.todos ?? [])
      .map((t) => ({ title: (t.title ?? "").trim(), status: (t.status ?? "").trim().toLowerCase() }))
      .filter((t) => t.title.length > 0);
    if (todos.length === 0) return { ok: false, reason: "no-todos" };
    return this.mutate("reconcile", async (): Promise<GoalWriteResult> => {
      const now = new Date().toISOString();
      const goal = await this.pickCaptureGoal(owner, input.sessionId, now);
      if (!goal) return { ok: false, reason: "max" };
      const next = structuredClone(goal);
      let changed = false;
      for (const todo of todos) {
        changed = this.applyReconcileTodo(next, todo.title, todo.status, now) || changed;
      }
      if (!changed) return { ok: true, goal: next };
      next.progressPct = deriveProgress(next);
      next.updatedAt = now;
      await this.commit(next);
      return { ok: true, goal: next };
    });
  }

  
  private async pickCaptureGoal(owner: string, sessionId: string, now: string): Promise<Goal | null> {
    const openFor = (g: Goal) => g.owner === owner && (ACTIVE_STATUSES as readonly string[]).includes(g.status);
    const open = [...this.goals.values()].filter(openFor);
    
    if (open.length === 1) return open[0] ?? null;
    
    const capture = [...this.goals.values()].find((g) => g.owner === owner && g.detail === sessionId && !g.pinned);
    if (capture) return capture;
    
    if (this.activeCount() >= this.maxGoals) return null;
    this.seq += 1;
    const id = `G-${String(this.seq).padStart(3, "0")}`;
    const goal: Goal = {
      id,
      seq: this.seq,
      title: `Session plan — ${sessionId}`,
      detail: sessionId,
      status: "open",
      progressPct: 0,
      owner,
      ownerKind: "solo",
      parentId: null,
      items: [],
      completedItems: [],
      acceptance: [],
      linkedRecords: [],
      linkedHandoffs: [],
      linkedBoards: [],
      evidence: [],
      evidenceHashes: [],
      pinned: false,
      createdAt: now,
      updatedAt: now,
      verifiedBy: null,
      lastEvidenceAt: null,
    };
    try {
      await this.commit(goal);
    } catch (e) {
      this.seq -= 1;
      throw e;
    }
    return goal;
  }

  
  private applyReconcileTodo(goal: Goal, title: string, status: string, now: string): boolean {
    const completed = status === "completed" || status === "done";
    const iIdx = GoalStore.findItemIndex(goal.items, title);
    const cIdx = GoalStore.findItemIndex(goal.completedItems, title);
    const AUTO = "auto: marked complete in todowrite";
    if (completed) {
      if (cIdx >= 0) return false; 
      if (iIdx >= 0) {
        const item = goal.items[iIdx];
        if (!item) return false;
        if (item.state === "done") {
          
          goal.completedItems.push({
            id: item.id,
            title: item.title,
            completedAt: now,
            evidence: [...item.evidence, AUTO],
          });
          goal.items.splice(iIdx, 1);
          return true;
        }
        item.state = "done";
        item.updatedAt = now;
        if (!item.evidence.includes(AUTO)) item.evidence.push(AUTO);
        return true;
      }
      
      
      goal.items.push({
        id: this.nextItemId(goal),
        title,
        state: "done",
        evidence: [AUTO],
        verifiedBy: null,
        updatedAt: now,
      });
      return true;
    }
    const state = GoalStore.normalizeTodoState(status);
    if (cIdx >= 0) {
      
      const archived = goal.completedItems[cIdx];
      if (!archived) return false;
      goal.completedItems.splice(cIdx, 1);
      goal.items.push({
        id: archived.id,
        title: archived.title,
        state,
        evidence: archived.evidence,
        verifiedBy: null,
        updatedAt: now,
      });
      return true;
    }
    if (iIdx >= 0) {
      const item = goal.items[iIdx];
      if (!item) return false;
      if (item.state === state) return false;
      item.state = state;
      item.updatedAt = now;
      return true;
    }
    goal.items.push({ id: this.nextItemId(goal), title, state, evidence: [], verifiedBy: null, updatedAt: now });
    return true;
  }

  private nextItemId(goal: Goal): string {
    const existing = [...goal.items, ...goal.completedItems];
    let max = 0;
    for (const i of existing) {
      const m = /-I(\d+)$/.exec(i.id);
      if (m?.[1]) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${goal.id}-I${max + 1}`;
  }
}
