import type { ICodeStateService, CodeSnapshot } from "./code-state.ts";
import type { EventHub } from "./event-hub.ts";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { logger } from "../utils/logger.ts";

export type SnapshotId = string;

export interface Snapshot {
  id: SnapshotId;
  label: string;
  sessionId: string;
  createdAt: number;
  codeStateId: string | null;
  afterTree: string;
  beforeTree: string | null;
  
  resumePoint?: { phase: string; taskId: string; remainingTasks: string[] };
}

export interface DiffResult {
  from: string;
  to: string;
  diff: string | null;
}

export class CheckpointManager {
  private codeState: ICodeStateService;
  private snapshots: Map<string, Snapshot> = new Map();
  private persistPath: string | null = null;
  private dirty = false;

  constructor(
    codeState: ICodeStateService,
    private eventHub?: EventHub,
    persistDir?: string,
  ) {
    this.codeState = codeState;
    if (persistDir) {
      this.persistPath = persistDir + "/checkpoints.json";
      this.loadFromDisk().catch((err) => logger.warn("[checkpoint] load failed:", err));
    }
  }

  private async loadFromDisk(): Promise<void> {
    if (!this.persistPath) return;
    try {
      const data = await readFile(this.persistPath, "utf-8");
      const arr: Snapshot[] = JSON.parse(data);
      for (const s of arr) this.snapshots.set(s.id, s);
    } catch {
      /* first run — no file yet */
    }
  }

  private async persistToDisk(): Promise<void> {
    if (!this.persistPath || !this.dirty) return;
    try {
      await mkdir(dirname(this.persistPath), { recursive: true });
      const data = JSON.stringify(Array.from(this.snapshots.values()), null, 2);
      const tmp = this.persistPath + ".tmp";
      await writeFile(tmp, data, "utf-8");
      const { rename } = await import("node:fs/promises");
      await rename(tmp, this.persistPath);
      this.dirty = false;
    } catch (err) {
      logger.warn("[checkpoint] persist failed:", err);
    }
  }

  async createSnapshot(task: string, resumePoint?: Snapshot["resumePoint"]): Promise<SnapshotId> {
    const cs: CodeSnapshot = await this.codeState.capture(task);
    const id = `ck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.snapshots.set(id, {
      id,
      label: task,
      sessionId: cs.messageId ?? "",
      createdAt: Date.now(),
      codeStateId: cs.id,
      afterTree: cs.afterTree ?? "",
      beforeTree: cs.beforeTree,
      ...(resumePoint ? { resumePoint } : {}),
    });
    this.dirty = true;
    this.eventHub?.emit({ type: "CHECKPOINT_CREATED", taskId: task, snapshotId: id });
    this.persistToDisk().catch(() => {});
    return id;
  }

  async restore(snapshotId: SnapshotId): Promise<void> {
    const entry = this.snapshots.get(snapshotId);
    if (!entry) throw new Error(`Checkpoint غير موجود: ${snapshotId}`);
    if (!entry.codeStateId) throw new Error(`Checkpoint ${snapshotId} ليس لديه codeStateId`);
    const result = await this.codeState.restoreById(entry.codeStateId);
    if (!result.ok) {
      throw new Error(`فشل استعادة checkpoint ${snapshotId}: ${result.error}`);
    }
    this.eventHub?.emit({ type: "CHECKPOINT_RESTORED", snapshotId });
  }

  listSnapshots(sessionId?: string): Snapshot[] {
    if (sessionId == null) return Array.from(this.snapshots.values());
    return Array.from(this.snapshots.values()).filter((s) => s.sessionId === sessionId);
  }

  async diff(fromId: SnapshotId, toId?: SnapshotId): Promise<DiffResult> {
    const from = this.snapshots.get(fromId);
    if (!from) throw new Error(`Checkpoint غير موجود: ${fromId}`);
    const to = toId ? this.snapshots.get(toId) : undefined;
    const diff = await this.codeState.diffBetween(from.beforeTree, to?.afterTree ?? "HEAD");
    return {
      from: from.label,
      to: to?.label ?? "HEAD",
      diff,
    };
  }

  cleanup(maxAge: number): void {
    const cutoff = Date.now() - maxAge;
    for (const [id, snapshot] of this.snapshots) {
      if (snapshot.createdAt < cutoff) {
        this.snapshots.delete(id);
        this.dirty = true;
      }
    }
    this.persistToDisk().catch(() => {});
  }
}
