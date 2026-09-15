
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.ts";
import { isIsolationActiveSync } from "./isolation.ts";

export type SessionEvent = "created" | "active" | "paused" | "resumed" | "completed" | "failed" | "destroyed";

export interface SessionInfo {
  id: string;
  state: SessionEvent;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export type SessionObserverCallback = (event: SessionEvent, info: SessionInfo) => void;

const TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export class SessionObserver {
  private sessions: Map<string, SessionInfo> = new Map();
  private listeners: Map<SessionEvent, SessionObserverCallback[]> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private persistPath: string | null = null;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  
  
  
  private _persistDirty = false;
  public readonly initPromise: Promise<void>;

  constructor(persistPath?: string) {
    this.startCleanup();
    if (persistPath) {
      this.persistPath = persistPath;
      this.initPromise = this.loadPersisted().catch(() => {});
      this.persistTimer = setInterval(() => void this.savePersisted(), 30000);
      if (this.persistTimer?.unref) this.persistTimer.unref();
    } else {
      this.initPromise = Promise.resolve();
    }
  }

  on(event: SessionEvent, cb: SessionObserverCallback): void {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
  }

  off(event: SessionEvent, cb: SessionObserverCallback): void {
    const list = this.listeners.get(event);
    if (!list) return;
    this.listeners.set(
      event,
      list.filter((l) => l !== cb),
    );
  }

  track(id: string, event: SessionEvent, metadata?: Record<string, unknown>): void {
    const now = Date.now();
    const existing = this.sessions.get(id);
    const info: SessionInfo = {
      id,
      state: event,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      metadata: { ...existing?.metadata, ...metadata },
    };
    this.sessions.set(id, info);
    this._persistDirty = true;
    this.emit(event, info);
  }

  get(id: string): SessionInfo | undefined {
    return this.sessions.get(id);
  }

  all(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  private emit(event: SessionEvent, info: SessionInfo): void {
    const list = this.listeners.get(event);
    if (!list) return;
    for (const cb of list) {
      try {
        cb(event, info);
      } catch (e) {
        logger.warn(`[session-observer] listener error for ${event}:`, e);
      }
    }
  }

  private startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, info] of this.sessions) {
        if (now - info.updatedAt > TTL_MS) {
          this.track(id, "destroyed", { reason: "ttl_expired" });
          this.sessions.delete(id);
        }
      }
    }, CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer?.unref) this.cleanupTimer.unref();
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  toJSON(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  private async savePersisted(): Promise<void> {
    if (!this.persistPath) return;
    
    
    if (!this._persistDirty) return;
    
    if (isIsolationActiveSync()) return;
    try {
      
      
      
      this._persistDirty = false;
      const dir = path.dirname(this.persistPath);
      await mkdir(dir, { recursive: true });
      await writeFile(this.persistPath, JSON.stringify(Array.from(this.sessions.entries())));
    } catch (e) {
      
      this._persistDirty = true;
      logger.warn("[session-observer] persist failed (non-fatal):", e);
    }
  }

  private async loadPersisted(): Promise<void> {
    if (!this.persistPath) return;
    try {
      const raw = await readFile(this.persistPath, "utf-8");
      const entries = JSON.parse(raw);
      this.sessions = new Map(entries);
    } catch {
      /* clean start */
    }
  }

  async dispose(): Promise<void> {
    this.stopCleanup();
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
    try {
      await this.savePersisted();
    } catch {
      /* dispose errors non-fatal */
    }
  }
}
