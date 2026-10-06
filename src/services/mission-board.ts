import { FileLockManager } from "../infra/file-lock.ts";
import type { SubTask } from "../types/plan.types.ts";
import type { EventHub } from "./event-hub.ts";
import { logger } from "../utils/logger.ts";
import { DEFAULT_RETENTION } from "./retention.ts";

import { atomicWriteFileFast } from "../infra/disk-utils.ts";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRuntimeStateDir } from "../utils/path-resolver.ts";

type Status = "backlog" | "ready" | "in_progress" | "review" | "done" | "blocked" | "failed";

interface Board {
  id: string;
  name: string;
  columns: Record<Status, TaskItem[]>;
  createdAt: number;
  
  _taskIndex?: Map<string, { column: Status; idx: number }>;
}

interface TaskItem {
  id: string;
  description: string;
  files: string[];
  agent: string;
  dependencies: string[];
  status: Status;
  blockedReason?: string;
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
}

interface BoardView {
  boardId: string;
  name: string;
  columns: Record<Status, TaskItem[]>;
}

interface BlockedTask {
  taskId: string;
  boardId: string;
  reason: string;
  since: number;
}


export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(PLUGIN_ROOT, "data", "mission-board");


export function shouldRunPluginFolderMigration(explicitDataDir: boolean, dataDir: string, legacyDir: string): boolean {
  if (dataDir === legacyDir) return false; 
  if (explicitDataDir) return false; 
  return true;
}
const MAX_BOARDS = 500;
const INDEX_FILE = "index.json";
const SCHEMA_VERSION = 1;
const RETENTION_MS = DEFAULT_RETENTION.maxAgeMs;

const EMPTY_BOARD_TTL_MS = 24 * 60 * 60 * 1000;
const STATUSES: Status[] = ["backlog", "ready", "in_progress", "review", "done", "blocked", "failed"];


function isValidBoard(board: unknown): board is Board {
  const b = board as Board | null;
  return (
    !!b &&
    typeof b.id === "string" &&
    b.id.length > 0 &&
    typeof b.createdAt === "number" &&
    typeof b.columns === "object" &&
    b.columns !== null &&
    STATUSES.every((s) => Array.isArray((b.columns as Record<string, unknown>)[s]))
  );
}

interface BoardIndexEntry {
  id: string;
  file: string;
  createdAt: number;
  status: "active" | "done";
}

interface BoardIndex {
  schemaVersion: number;
  boards: BoardIndexEntry[];
  updatedAt: number;
}

export class MissionBoard {
  private boards: Map<string, Board> = new Map();
  private lockManager: FileLockManager;
  private dataDir: string;
  private explicitDataDir: boolean;
  private indexWriteChain: Promise<void> = Promise.resolve();
  private boardChains: Map<string, Promise<unknown>> = new Map();
  private loadPromise: Promise<void>;

  constructor(
    private eventHub?: EventHub,
    dataDir?: string,
    private stateDir?: string,
    private scope?: import("../utils/path-resolver.ts").InstallScope,
  ) {
    
    
    
    
    this.dataDir = dataDir ?? (stateDir ? this.resolveStateDataDir() : DATA_DIR);
    this.explicitDataDir = dataDir !== undefined;
    this.lockManager = new FileLockManager(true);
    this.loadPromise = this.loadAllAsync().catch((err) => logger.warn(`MissionBoard: load failed: ${err}`));
  }

  
  private resolveStateDataDir(): string {
    return path.join(resolveRuntimeStateDir(this.stateDir!, this.scope), "mission-board");
  }

  
  async ready(): Promise<void> {
    await this.loadPromise;
  }

  
  private async migrateLegacyDataDir(): Promise<void> {
    const legacyDir = path.join(PLUGIN_ROOT, "data", "mission-board");
    if (this.dataDir === legacyDir) {
      
      await migrateLegacyBoardDataDir(path.join(PLUGIN_ROOT, "data", "kanban"), this.dataDir);
      return;
    }
    
    
    
    
    
    
    
    if (!shouldRunPluginFolderMigration(this.explicitDataDir, this.dataDir, legacyDir)) return;
    await migrateLegacyBoardDataDir(legacyDir, this.dataDir);
  }

  private persistAndLog(board: Board): void {
    this.persist(board).catch((err) => logger.warn(`MissionBoard: persist failed for board ${board.id}:`, err));
  }

  async createBoard(name: string): Promise<Board> {
    await this.evictIfNeeded();
    const id = `board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const board: Board = {
      id,
      name,
      columns: {
        backlog: [],
        ready: [],
        in_progress: [],
        review: [],
        done: [],
        blocked: [],
        failed: [],
      },
      createdAt: Date.now(),
    };
    this.boards.set(id, board);
    
    
    
    
    
    
    try {
      const persisted = await this.persist(board);
      if (!persisted) {
        this.boards.delete(id);
        throw new Error(`MissionBoard: persist failed for board ${id} (not on disk)`);
      }
    } catch (e) {

      this.boards.delete(id);
      throw e;
    }
    this.scheduleIndexWrite();
    this.eventHub?.emit({ type: "BOARD_CREATED", boardId: id, name });
    return board;
  }

  addTask(boardId: string, task: SubTask): void {
    const board = this.boards.get(boardId);
    if (!board) return;
    const item: TaskItem = {
      id: task.id,
      description: task.description,
      files: task.files,
      agent: task.agent,
      dependencies: task.dependencies,
      status: "backlog",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    board.columns.backlog.push(item);
    
    if (!board._taskIndex) this._rebuildTaskIndex(board);
    board._taskIndex!.set(item.id, { column: "backlog", idx: board.columns.backlog.length - 1 });
    this.persistAndLog(board);
  }

  updateStatus(boardId: string, taskId: string, status: Status, reason?: string, sessionId?: string): void {
    const board = this.boards.get(boardId);
    if (!board) return;
    if (!board._taskIndex) this._rebuildTaskIndex(board);
    let loc = board._taskIndex!.get(taskId);
    if (!loc) {
      this._rebuildTaskIndex(board);
      loc = board._taskIndex!.get(taskId);
    }
    if (!loc) return;
    const from = loc.column;
    const col = board.columns[from];
    const removed = col.splice(loc.idx, 1);
    if (!removed.length) return;
    const task = removed[0]!;
    if (task.status !== from) return;
    if (task.status === "done" && status !== "done") return;
    task.status = status;
    task.updatedAt = Date.now();
    task.blockedReason = status === "blocked" ? reason : undefined;
    if (sessionId) task.sessionId = sessionId;
    board.columns[status].push(task);
    board._taskIndex!.delete(taskId);
    board._taskIndex!.set(taskId, { column: status, idx: board.columns[status].length - 1 });
    for (let i = loc.idx; i < col.length; i++) {
      const t = col[i]!;
      board._taskIndex!.set(t.id, { column: from, idx: i });
    }
    this.persistAndLog(board);
    this.scheduleIndexWrite();
    this.eventHub?.emit({ type: "TASK_STATUS_CHANGED", boardId, taskId, from, to: status, sessionId: task.sessionId });
    if (status === "blocked") {
      this.eventHub?.emit({ type: "TASK_BLOCKED", boardId, taskId, reason: reason ?? "unspecified" });
    }
  }

  getBoard(boardId: string): BoardView | null {
    const board = this.boards.get(boardId);
    if (!board) return null;
    return {
      boardId: board.id,
      name: board.name,
      columns: board.columns,
    };
  }

  getAllBoards(): BoardView[] {
    return Array.from(this.boards.values()).map((b) => ({
      boardId: b.id,
      name: b.name,
      columns: b.columns,
    }));
  }

  getBlockedTasks(boardId: string): BlockedTask[] {
    const board = this.boards.get(boardId);
    if (!board) return [];
    return board.columns.blocked.map((t) => ({
      taskId: t.id,
      boardId: board.id,
      reason: t.blockedReason ?? "unspecified",
      since: t.updatedAt,
    }));
  }

  
  private _rebuildTaskIndex(board: Board): void {
    const idx = new Map<string, { column: Status; idx: number }>();
    for (const [colName, col] of Object.entries(board.columns) as [Status, TaskItem[]][]) {
      for (let i = 0; i < col.length; i++) {
        idx.set(col[i]!.id, { column: colName, idx: i });
      }
    }
    board._taskIndex = idx;
  }

  private boardPath(boardId: string): string {
    return path.join(this.dataDir, `${boardId}.json`);
  }

  private indexPath(): string {
    return path.join(this.dataDir, INDEX_FILE);
  }

  private buildIndex(): BoardIndex {
    return {
      schemaVersion: SCHEMA_VERSION,
      boards: Array.from(this.boards.entries()).map(([id, b]) => ({
        id,
        file: `${id}.json`,
        createdAt: b.createdAt,
        status: this.isCompleted(b) ? "done" : "active",
      })),
      updatedAt: Date.now(),
    };
  }

  private async writeIndex(): Promise<void> {
    await this.ensureDataDir();
    const lockPath = this.indexPath();
    const lock = await this.lockManager.acquireLock(lockPath, "mission-board", "index");
    if (!lock.acquired) {
      logger.warn(`MissionBoard: index lock not acquired for ${INDEX_FILE} — skipping save`);
      return;
    }
    try {
      const index = this.buildIndex();
      const stateJson = JSON.stringify({ schemaVersion: index.schemaVersion, boards: index.boards });
      let unchanged = false;
      try {
        const { readFile } = await import("node:fs/promises");
        const raw = await readFile(lockPath, "utf8");
        const parsed = JSON.parse(raw) as { schemaVersion?: unknown; boards?: unknown };
        unchanged =
          Array.isArray(parsed.boards) &&
          JSON.stringify({ schemaVersion: parsed.schemaVersion, boards: parsed.boards }) === stateJson;
      } catch {
        unchanged = false;
      }
      if (unchanged) return;
      await atomicWriteFileFast(lockPath, JSON.stringify(this.buildIndex(), null, 2));
    } finally {
      await this.lockManager.releaseLock(lockPath, "mission-board");
    }
  }

  private scheduleIndexWrite(): void {
    
    
    this.indexWriteChain = this.indexWriteChain.then(() => this.writeIndex()).catch(() => {});
  }

  
  async flush(): Promise<void> {
    await Promise.all([...this.boardChains.values()]);
  }

  
  private enqueue<T>(boardId: string, op: () => Promise<T>): Promise<T | void> {
    const prev = this.boardChains.get(boardId) ?? Promise.resolve();
    const next = prev.then(op).catch(() => {});
    this.boardChains.set(boardId, next);
    
    
    next.then(() => {
      if (this.boardChains.get(boardId) === next) this.boardChains.delete(boardId);
    });
    return next;
  }

  private async persist(board: Board): Promise<boolean> {
    const v = await this.enqueue(board.id, async () => {
      await this.ensureDataDir();
      const lockPath = this.boardPath(board.id);
      const lock = await this.lockManager.acquireLock(lockPath, "mission-board", "persist");
      if (!lock.acquired) {
        logger.warn(`MissionBoard: board lock not acquired for ${board.id} — skipping save`);
        return false;
      }
      try {
        await atomicWriteFileFast(lockPath, JSON.stringify(board, null, 2));
        return true;
      } finally {
        await this.lockManager.releaseLock(lockPath, "mission-board");
      }
    });
    return v ?? false;
  }

  private deleteBoardFile(boardId: string): Promise<void> {
    return this.enqueue(boardId, async () => {
      const lockPath = this.boardPath(boardId);
      const lock = await this.lockManager.acquireLock(lockPath, "mission-board", "delete");
      if (!lock.acquired) {
        logger.warn(`MissionBoard: board lock not acquired for ${boardId} — skipping file delete`);
        return;
      }
      try {
        await fsp.rm(lockPath, { force: true });
      } finally {
        await this.lockManager.releaseLock(lockPath, "mission-board");
      }
    });
  }

  async unload(boardId: string): Promise<void> {
    const board = this.boards.get(boardId);
    if (!board) return;
    try {
      const persisted = await this.persist(board);
      if (!persisted) {
        logger.warn(`MissionBoard: unload persist failed for board ${boardId} (not on disk)`);
      }
    } catch (err) {
      logger.warn(`MissionBoard: unload persist failed for board ${boardId}:`, err);
    }
    this.boards.delete(boardId);
  }

  getActiveCount(): number {
    return this.boards.size;
  }

  private isCompleted(board: Board): boolean {
    const hasTasks = Object.values(board.columns).some((col) => col.length > 0);
    if (!hasTasks) return false;
    const total = Object.values(board.columns).reduce((s, col) => s + col.length, 0);
    const doneFailed = board.columns.done.length + board.columns.failed.length;
    return doneFailed === total;
  }

  private async evictIfNeeded(): Promise<void> {
    if (this.boards.size < MAX_BOARDS) return;
    const completed = [...this.boards.entries()].filter(([, b]) => this.isCompleted(b));
    const target =
      completed.length > 0
        ? completed.sort(([, a], [, b]) => a.createdAt - b.createdAt)[0]
        : [...this.boards.entries()].sort(([, a], [, b]) => a.createdAt - b.createdAt)[0];
    if (target) {
      const [id, board] = target;
      
      
      try {
        const persisted = await this.persist(board);
        if (!persisted) {
          logger.warn(`MissionBoard: failed to persist board "${id}" before eviction (not on disk)`);
          return;
        }
      } catch (err) {
        logger.warn(`MissionBoard: failed to persist board "${id}" before eviction:`, err);
        return; 
      }
      this.boards.delete(id);
      
      
      await this.deleteBoardFile(id);
      await this.indexWriteChain;
      this.scheduleIndexWrite();
      logger.warn(
        `MissionBoard: evicted board "${id}" (${completed.length > 0 ? "completed" : "oldest"}, cap ${MAX_BOARDS})`,
      );
    }
  }

  private async ensureDataDir(): Promise<void> {
    try {
      await fsp.mkdir(this.dataDir, { recursive: true });
    } catch {

    }
  }

  private async loadAllAsync(): Promise<void> {
    await this.migrateLegacyDataDir();
    try {
      await this.ensureDataDir();
    } catch {
      return;
    }
    
    
    
    
    try {
      const tmpFiles = (await fsp.readdir(this.dataDir)).filter((f) => f.endsWith(".tmp"));
      await Promise.all(tmpFiles.map((f) => fsp.rm(path.join(this.dataDir, f), { force: true })));
    } catch {

    }
    
    let files: string[];
    try {
      const raw = await fsp.readFile(this.indexPath(), "utf-8");
      const index = JSON.parse(raw) as BoardIndex;
      if (index.schemaVersion === SCHEMA_VERSION && Array.isArray(index.boards)) {
        files = index.boards.map((e) => e.file);
      } else {
        files = (await fsp.readdir(this.dataDir)).filter((f) => f.endsWith(".json") && f !== INDEX_FILE);
      }
    } catch {
      files = (await fsp.readdir(this.dataDir)).filter((f) => f.endsWith(".json") && f !== INDEX_FILE);
    }
    const loadTasks = files.map(async (file) => {
      try {
        const data = await fsp.readFile(path.join(this.dataDir, file), "utf-8");
        const board = JSON.parse(data) as Board;
        if (!isValidBoard(board)) return; 
        this.boards.set(board.id, board);
        this._rebuildTaskIndex(board);
      } catch {

      }
    });
    await Promise.all(loadTasks);
    
    
    await this.applyRetention();
    
    
    await this.reconcileDirectory();
    this.scheduleIndexWrite();
  }

  private async applyRetention(): Promise<void> {
    const now = Date.now();
    for (const [id, board] of this.boards) {
      const empty = !Object.values(board.columns).some((col) => col.length > 0);
      const stale =
        (this.isCompleted(board) && now - board.createdAt > RETENTION_MS) ||
        (empty && now - board.createdAt > EMPTY_BOARD_TTL_MS);
      if (!stale) continue;
      this.boards.delete(id);
      await this.deleteBoardFile(id);
      logger.warn(
        `MissionBoard: retention removed ${empty ? "empty" : "completed"} board "${id}" (age > ${
          empty ? EMPTY_BOARD_TTL_MS : RETENTION_MS
        }ms)`,
      );
    }
  }

  
  private async reconcileDirectory(): Promise<void> {
    let diskFiles: string[];
    try {
      diskFiles = (await fsp.readdir(this.dataDir)).filter((f) => f.endsWith(".json") && f !== INDEX_FILE);
    } catch {
      return;
    }
    const liveIds = new Set(this.boards.keys());
    const claimed = new Set<string>();
    for (const file of diskFiles) {
      if (liveIds.has(file.slice(0, -".json".length))) claimed.add(file.slice(0, -".json".length));
    }
    
    const reads = await Promise.all(
      diskFiles.map(async (file) => {
        const idFromName = file.slice(0, -".json".length);
        if (liveIds.has(idFromName)) return { file, board: null as Board | null, skip: true };
        const full = path.join(this.dataDir, file);
        try {
          const data = await fsp.readFile(full, "utf-8");
          const board = JSON.parse(data) as Board;
          return { file, board, skip: false as const };
        } catch {
          return { file, board: null as Board | null, skip: false as const };
        }
      }),
    );
    const removed: string[] = [];
    for (const { file, board, skip } of reads) {
      if (skip) continue;
      const full = path.join(this.dataDir, file);
      if (!board || !isValidBoard(board)) {
        await fsp.rm(full, { force: true });
        removed.push(file);
        continue;
      }
      const canonical = path.join(this.dataDir, `${board.id}.json`);
      if (!liveIds.has(board.id)) {
        this.boards.set(board.id, board);
        this._rebuildTaskIndex(board);
        liveIds.add(board.id);
        claimed.add(board.id);
        if (canonical !== full) {
          await fsp.rename(full, canonical).catch(() => {
            logger.warn(`MissionBoard: failed to rename adopted board file "${full}"`);
          });
        }
        continue;
      }
      if (!claimed.has(board.id)) {
        claimed.add(board.id);
        await fsp.rename(full, canonical).catch(() => {
          logger.warn(`MissionBoard: failed to rename board file "${full}" → "${canonical}"`);
        });
      } else {
        await fsp.rm(full, { force: true });
        removed.push(file);
      }
    }
    if (removed.length > 0) {
      logger.warn(`MissionBoard: reconciled data dir — removed ${removed.length} orphan/duplicate file(s)`);
    }
  }
}


export async function migrateLegacyBoardDataDir(legacyDir: string, newDir: string): Promise<boolean> {
  try {
    const [hasNew, hasLegacy] = await Promise.all([
      fsp.access(newDir).then(
        () => true,
        () => false,
      ),
      fsp.access(legacyDir).then(
        () => true,
        () => false,
      ),
    ]);
    if (hasNew || !hasLegacy) return false;
    await fsp.mkdir(path.dirname(newDir), { recursive: true });
    await fsp.rename(legacyDir, newDir);
    logger.warn(`MissionBoard: migrated data/kanban → data/mission-board (one-time)`);
    return true;
  } catch (err) {
    
    logger.warn(`MissionBoard: legacy data migration skipped: ${(err as Error)?.message ?? err}`);
    return false;
  }
}
