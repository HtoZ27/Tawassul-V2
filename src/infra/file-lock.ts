import type { FileLock } from "../conflict-resolver/types.ts";
import { mkdir, writeFile, readFile, readdir, unlink, rmdir, access } from "node:fs/promises";
import { unlinkSync, rmdirSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";
import { tmpdir, userInfo, hostname } from "node:os";
import { createHash } from "node:crypto";
import { logger } from "../utils/logger.ts";
import { isProcessAlive } from "../utils/process.ts";






const LOCK_TIMEOUT_MS = 90_000;


const MEM_LOCK_TIMEOUT_MS = 30 * 60 * 1000;





const USER_UID = (() => {
  try {
    if (process.platform === "win32") {
      const u = userInfo();
      return `${u.username || "unknown"}-${hostname()}`;
    }
    return String(userInfo().uid);
  } catch {
    return "unknown";
  }
})();
const FS_LOCK_DIR = resolve(tmpdir(), `.tawassul-file-locks-${USER_UID}`);



function shardId(lockName: string): string {
  return createHash("sha256").update(lockName).digest("hex").slice(0, 1); 
}

function lockDirFor(lockName: string): string {
  return resolve(FS_LOCK_DIR, shardId(lockName), lockName);
}


const acquiredFSLocks: Set<string> = new Set();
let exitCleanupRegistered = false;
const _signalHandlers: Array<{ signal: string; handler: () => void }> = [];

export function unregisterExitCleanup(): void {
  for (const { signal, handler } of _signalHandlers) {
    process.removeListener(signal as NodeJS.Signals, handler);
  }
  _signalHandlers.length = 0;
  exitCleanupRegistered = false;
}


function registerExitCleanup(): void {
  if (exitCleanupRegistered) return;
  exitCleanupRegistered = true;

  const cleanup = () => {
    for (const lockName of acquiredFSLocks) {
      const lockDir = lockDirFor(lockName);
      try {
        unlinkSync(resolve(lockDir, "lock"));
      } catch {

      }
      try {
        unlinkSync(resolve(lockDir, "owner"));
      } catch {

      }
      try {
        unlinkSync(resolve(lockDir, "expires"));
      } catch {

      }
      try {
        unlinkSync(resolve(lockDir, "path"));
      } catch {

      }
      try {
        rmdirSync(lockDir);
      } catch {

      }
    }
    acquiredFSLocks.clear();
  };

  process.on("exit", cleanup);
  
  
  
  
  
  const makeSignalHandler = (signal: NodeJS.Signals): (() => void) => {
    const handler = () => {
      cleanup();
      try {
        process.removeListener(signal, handler);
        process.kill(process.pid, signal);
      } catch {
        process.exit(signal === "SIGINT" ? 130 : 143); 
      }
    };
    return handler;
  };
  const sigtermHandler = makeSignalHandler("SIGTERM");
  const sigintHandler = makeSignalHandler("SIGINT");
  process.on("SIGTERM", sigtermHandler);
  process.on("SIGINT", sigintHandler);
  _signalHandlers.push({ signal: "SIGTERM", handler: sigtermHandler });
  _signalHandlers.push({ signal: "SIGINT", handler: sigintHandler });
}






const _heartbeats = new Map<string, NodeJS.Timeout>();

function heartbeatIntervalMs(ttlMs: number): number {
  
  return Math.max(200, Math.min(5000, Math.floor(ttlMs / 3)));
}

async function renewExpiry(lockName: string, ownerId: string, ttlMs: number): Promise<void> {
  const lockDir = lockDirFor(lockName);
  const current = await readOwner(lockDir);
  if (current !== ownerId) {
    
    stopHeartbeat(lockName);
    return;
  }
  try {
    await writeFile(resolve(lockDir, "expires"), String(Date.now() + ttlMs), "utf-8");
  } catch {
    
    stopHeartbeat(lockName);
  }
}

function startHeartbeat(lockName: string, ownerId: string, ttlMs: number): void {
  stopHeartbeat(lockName);
  const timer = setInterval(() => {
    void renewExpiry(lockName, ownerId, ttlMs);
  }, heartbeatIntervalMs(ttlMs));
  timer.unref();
  _heartbeats.set(lockName, timer);
}

function stopHeartbeat(lockName: string): void {
  const timer = _heartbeats.get(lockName);
  if (timer) {
    clearInterval(timer);
    _heartbeats.delete(lockName);
  }
}


async function tryAcquire(
  lockDir: string,
  ownerId: string,
  ttlMs: number,
  lockName: string,
  filePath?: string,
): Promise<boolean> {
  try {
    await mkdir(lockDir);
    
    await writeFile(resolve(lockDir, "lock"), ownerId, "utf-8");
    await writeFile(resolve(lockDir, "owner"), ownerId, "utf-8");
    await writeFile(resolve(lockDir, "expires"), String(Date.now() + ttlMs), "utf-8");
    if (filePath) await writeFile(resolve(lockDir, "path"), filePath, "utf-8");
    acquiredFSLocks.add(lockName);
    
    startHeartbeat(lockName, ownerId, ttlMs);
    return true;
  } catch {
    return false; 
  }
}


async function readExpiry(lockDir: string): Promise<number | null> {
  try {
    const content = await readFile(resolve(lockDir, "expires"), "utf-8");
    return parseInt(content, 10);
  } catch {
    return null;
  }
}


async function readOwner(lockDir: string): Promise<string | null> {
  try {
    return await readFile(resolve(lockDir, "owner"), "utf-8");
  } catch {
    return null;
  }
}


async function removeStaleLock(lockDir: string): Promise<void> {
  stopHeartbeat(basename(lockDir));
  try {
    await unlink(resolve(lockDir, "lock"));
  } catch {

  }
  try {
    await unlink(resolve(lockDir, "owner"));
  } catch {

  }
  try {
    await unlink(resolve(lockDir, "expires"));
  } catch {

  }
  try {
    await unlink(resolve(lockDir, "path"));
  } catch {

  }
  try {
    await rmdir(lockDir);
  } catch {

  }
}


async function acquireFSLock(
  lockName: string,
  ownerId: string,
  ttlMs: number = LOCK_TIMEOUT_MS,
  filePath?: string,
): Promise<boolean> {
  try {
    registerExitCleanup();
    
    await mkdir(FS_LOCK_DIR, { recursive: true });
    await mkdir(resolve(FS_LOCK_DIR, shardId(lockName)), { recursive: true });
    const lockDir = lockDirFor(lockName);

    
    if (await tryAcquire(lockDir, ownerId, ttlMs, lockName, filePath)) return true;

    
    const expiry = await readExpiry(lockDir);
    if (expiry === null) {
      
      
      
      let dirAge = Infinity;
      try {
        dirAge = Date.now() - statSync(lockDir).birthtimeMs;
      } catch {

      }
      if (dirAge < 3000) return false;
      await removeStaleLock(lockDir);
      return tryAcquire(lockDir, ownerId, ttlMs, lockName, filePath);
    }
    if (!isNaN(expiry) && Date.now() <= expiry) return false;

    
    const currentOwner = await readOwner(lockDir);
    if (currentOwner) {
      const pidMatch = currentOwner.match(/(?:^|::)pid-(\d+)$/);
      if (pidMatch) {
        const pid = parseInt(pidMatch[1]!, 10);
        if (!isNaN(pid)) {
          if (isProcessAlive(pid)) return false; 

        }
      } else {
        
        return false;
      }
    }

    
    await removeStaleLock(lockDir);

    
    return tryAcquire(lockDir, ownerId, ttlMs, lockName, filePath);
  } catch (e) {
    logger.warn(`[file-lock] acquireFSLock failed for "${lockName}":`, e);
    return false;
  }
}


async function releaseFSLock(lockName: string, ownerId: string): Promise<boolean> {
  try {
    const lockDir = lockDirFor(lockName);
    try {
      await access(lockDir);
    } catch {
      return true;
    }
    const currentOwner = await readOwner(lockDir);
    
    
    
    
    if (!currentOwner || currentOwner !== ownerId) {
      return false;
    }
    
    try {
      await unlink(resolve(lockDir, "lock"));
    } catch {

    }
    try {
      await unlink(resolve(lockDir, "owner"));
    } catch {

    }
    try {
      await unlink(resolve(lockDir, "expires"));
    } catch {

    }
    try {
      await unlink(resolve(lockDir, "path"));
    } catch {

    }
    try {
      await rmdir(lockDir);
    } catch {

    }
    acquiredFSLocks.delete(lockName);
    
    stopHeartbeat(lockName);
    return true;
  } catch (e) {
    logger.warn(`[file-lock] releaseFSLock failed for "${lockName}":`, e);
    return false;
  }
}


async function checkFSLock(lockName: string): Promise<{ locked: boolean; owner?: string; expiresAt?: number }> {
  try {
    const lockDir = lockDirFor(lockName);
    try {
      await access(lockDir);
    } catch {
      return { locked: false };
    }
    const expiry = await readExpiry(lockDir);
    if (expiry !== null) {
      if (isNaN(expiry) || Date.now() > expiry) {
        
        const owner = await readOwner(lockDir);
        const pidMatch = owner?.match(/(?:^|::)pid-(\d+)$/);
        if (pidMatch) {
          const pid = parseInt(pidMatch[1]!, 10);
          if (!isNaN(pid)) {
            if (isProcessAlive(pid)) return { locked: true, owner: owner ?? undefined, expiresAt: expiry }; 

          }
        } else if (owner) {
          
          return { locked: true, owner, expiresAt: expiry };
        }
        
        await removeStaleLock(lockDir);
        return { locked: false };
      }
      const owner = await readOwner(lockDir);
      return { locked: true, owner: owner ?? undefined, expiresAt: expiry };
    }
    
    
    let dirAge = Infinity;
    try {
      dirAge = Date.now() - statSync(lockDir).birthtimeMs;
    } catch {
      return { locked: false };
    }
    if (dirAge < 3000) return { locked: true };
    await removeStaleLock(lockDir);
    return { locked: false };
  } catch (e) {
    logger.warn(`[file-lock] checkFSLock failed for "${lockName}":`, e);
    return { locked: false };
  }
}


function lockNameForFile(file: string): string {
  return createHash("sha256").update(file).digest("hex").slice(0, 32);
}



export { acquireFSLock, releaseFSLock, checkFSLock, removeFSLockDir, lockDirFor, LOCK_TIMEOUT_MS };


async function removeFSLockDir(lockName: string): Promise<boolean> {
  const lockDir = lockDirFor(lockName);
  try {
    await access(lockDir);
  } catch {
    return true;
  }
  const owner = await readOwner(lockDir);
  const ownerPid = owner?.match(/(?:^|::)pid-(\d+)$/)?.[1];
  if (ownerPid) {
    const pid = parseInt(ownerPid, 10);
    if (!isNaN(pid)) {
      if (isProcessAlive(pid)) return false; 
    }
  }
  try {
    await unlink(resolve(lockDir, "lock"));
  } catch {

  }
  try {
    await unlink(resolve(lockDir, "owner"));
  } catch {

  }
  try {
    await unlink(resolve(lockDir, "expires"));
  } catch {

  }
  try {
    await unlink(resolve(lockDir, "path"));
  } catch {

  }
  try {
    await rmdir(lockDir);
  } catch {

  }
  acquiredFSLocks.delete(lockName);
  
  stopHeartbeat(lockName);
  return true;
}

export class FileLockManager {
  private locks: Map<string, FileLock> = new Map();
  private fsLockEnabled: boolean;
  private _fsCheckCache = new Map<
    string,
    { result: { locked: boolean; owner?: string; expiresAt?: number }; ts: number }
  >();
  private static MAX_CACHE_ENTRIES = 500;
  private static CACHE_TTL_MS = 30000;

  constructor(enableFsLock: boolean = false) {
    this.fsLockEnabled = enableFsLock;
    if (this.fsLockEnabled) {
      
      mkdir(FS_LOCK_DIR, { recursive: true }).catch(() => {
        this.fsLockEnabled = false;
      });
      
      this.cleanExpiredFSLocks().catch((e) => {
        logger.debug("[tawassul] cleanExpiredFSLocks failed:", e);
      });
    }
  }

  invalidateFSCache(lockName?: string): void {
    if (lockName) {
      this._fsCheckCache.delete(lockName);
    } else {
      this._fsCheckCache.clear();
    }
  }

  private pruneCache(): void {
    if (this._fsCheckCache.size <= FileLockManager.MAX_CACHE_ENTRIES) return;
    const now = Date.now();
    for (const [k, v] of this._fsCheckCache) {
      if (now - v.ts > FileLockManager.CACHE_TTL_MS || this._fsCheckCache.size > FileLockManager.MAX_CACHE_ENTRIES) {
        this._fsCheckCache.delete(k);
      }
    }
  }

  private async cleanExpiredFSLocks(): Promise<void> {
    try {
      const shards = await readdir(FS_LOCK_DIR);
      for (const shard of shards) {
        const shardDir = resolve(FS_LOCK_DIR, shard);
        if (shard.length !== 1) continue; 
        let lockNames: string[];
        try {
          lockNames = await readdir(shardDir);
        } catch {
          continue;
        }
        for (const entry of lockNames) {
          const lockDir = resolve(FS_LOCK_DIR, shard, entry);
          const expiry = await readExpiry(lockDir);
          if (expiry !== null) {
            if (isNaN(expiry) || Date.now() > expiry) {
              
              
              
              const owner = await readOwner(lockDir);
              const pidMatch = owner?.match(/(?:^|::)pid-(\d+)$/);
              if (pidMatch) {
                const pid = parseInt(pidMatch[1]!, 10);
                if (!isNaN(pid) && isProcessAlive(pid)) continue; 
              }
              await removeStaleLock(lockDir);
            }
          } else {
            
            
            let dirAge = Infinity;
            try {
              dirAge = Date.now() - statSync(lockDir).birthtimeMs;
            } catch {
              await removeStaleLock(lockDir);
              continue;
            }
            if (dirAge >= 3000) await removeStaleLock(lockDir);
          }
        }
      }
    } catch {

    }
  }

  async acquireLock(
    file: string,
    agent: string,
    handoffId: string,
  ): Promise<{ acquired: boolean; existingLock?: FileLock }> {
    const existing = this.locks.get(file);

    if (existing) {
      if (new Date(existing.expiresAt) < new Date()) {
        this.locks.delete(file);
      } else if (existing.lockedBy === agent && existing.handoffId === handoffId) {
        
        
        return { acquired: true, existingLock: existing };
      } else {
        return { acquired: false, existingLock: existing };
      }
    }

    if (this.fsLockEnabled) {
      const lockName = lockNameForFile(file);
      
      
      
      
      const fsOwner = `${agent}::${handoffId}::pid-${process.pid}`;
      const acquired = await acquireFSLock(lockName, fsOwner, LOCK_TIMEOUT_MS, file);
      if (!acquired) {
        const fsStatus = await checkFSLock(lockName);
        if (fsStatus.locked) {
          return {
            acquired: false,
            existingLock: {
              file,
              lockedBy: fsStatus.owner?.split("::")[0] || "unknown",
              handoffId: fsStatus.owner?.split("::")[1] || "unknown",
              lockedAt: new Date().toISOString(),
              expiresAt: new Date(fsStatus.expiresAt || Date.now() + LOCK_TIMEOUT_MS).toISOString(),
            },
          };
        }
      }
    }

    const lock: FileLock = {
      file,
      lockedBy: agent,
      handoffId,
      lockedAt: new Date().toISOString(),
      
      
      expiresAt: new Date(Date.now() + MEM_LOCK_TIMEOUT_MS).toISOString(),
    };

    this.locks.set(file, lock);
    return { acquired: true };
  }

  async releaseLock(file: string, agent: string): Promise<boolean> {
    const lock = this.locks.get(file);
    if (lock && lock.lockedBy === agent) {
      this.locks.delete(file);
      if (this.fsLockEnabled) {
        const lockName = lockNameForFile(file);
        
        await releaseFSLock(lockName, `${agent}::${lock.handoffId}::pid-${process.pid}`);
      }
      return true;
    }
    return false;
  }

  async releaseAllForHandoff(handoffId: string): Promise<string[]> {
    const released: string[] = [];
    for (const [file, lock] of this.locks.entries()) {
      if (lock.handoffId === handoffId) {
        this.locks.delete(file);
        if (this.fsLockEnabled) {
          const lockName = lockNameForFile(file);
          await releaseFSLock(lockName, `${lock.lockedBy}::${handoffId}::pid-${process.pid}`);
        }
        released.push(file);
      }
    }
    return released;
  }

  clearAll(): void {
    this.locks.clear();
    this._fsCheckCache.clear();
    unregisterExitCleanup();
  }

  async isLocked(file: string): Promise<boolean> {
    const lock = this.locks.get(file);
    if (lock) {
      if (new Date(lock.expiresAt) < new Date()) {
        this.locks.delete(file);
      } else {
        return true;
      }
    }

    if (this.fsLockEnabled) {
      const lockName = lockNameForFile(file);
      const cached = this._fsCheckCache.get(lockName);
      const now = Date.now();
      if (cached && now - cached.ts < FileLockManager.CACHE_TTL_MS) {
        return cached.result.locked;
      }
      const fsStatus = await checkFSLock(lockName);
      this._fsCheckCache.set(lockName, { result: fsStatus, ts: now });
      this.pruneCache();
      return fsStatus.locked;
    }

    return false;
  }

  async getLockedFiles(): Promise<FileLock[]> {
    const now = new Date();
    const active: FileLock[] = [];

    for (const [file, lock] of this.locks.entries()) {
      if (new Date(lock.expiresAt) >= now) {
        active.push(lock);
      } else {
        this.locks.delete(file);
      }
    }

    let fsEnabled = this.fsLockEnabled;
    if (fsEnabled) {
      try {
        await access(FS_LOCK_DIR);
      } catch {
        fsEnabled = false;
      }
    }
    if (fsEnabled) {
      try {
        
        const shards = await readdir(FS_LOCK_DIR);
        for (const shard of shards) {
          const shardDir = resolve(FS_LOCK_DIR, shard);
          if (shard.length !== 1) continue; 
          let entries: string[];
          try {
            entries = await readdir(shardDir);
          } catch {
            continue;
          }
          for (const entry of entries) {
            const lockDir = resolve(FS_LOCK_DIR, shard, entry);
            const owner = await readOwner(lockDir);
            const expiry = await readExpiry(lockDir);
            if (owner && expiry !== null && !isNaN(expiry) && Date.now() < expiry) {
              const parts = owner.split("::");
              let originalFile: string;
              try {
                originalFile = await readFile(resolve(lockDir, "path"), "utf-8");
              } catch {
                originalFile = entry;
              }
              active.push({
                file: originalFile,
                lockedBy: parts[0] || "unknown",
                handoffId: parts[1] || "unknown",
                lockedAt: new Date().toISOString(),
                expiresAt: new Date(expiry).toISOString(),
              });
            }
          }
        }
      } catch {

      }
    }

    return active;
  }

  async getFilesLockedByAgent(agent: string): Promise<FileLock[]> {
    const all = await this.getLockedFiles();
    return all.filter((l) => l.lockedBy === agent);
  }

  async checkFileConflict(
    file: string,
    requestingAgent: string,
  ): Promise<{ conflict: boolean; lockedBy?: string; handoffId?: string }> {
    const lock = this.locks.get(file);
    if (lock) {
      if (new Date(lock.expiresAt) < new Date()) {
        this.locks.delete(file);
      } else if (lock.lockedBy !== requestingAgent) {
        return { conflict: true, lockedBy: lock.lockedBy, handoffId: lock.handoffId };
      }
    }

    if (this.fsLockEnabled) {
      const lockName = lockNameForFile(file);
      const fsStatus = await checkFSLock(lockName);
      if (fsStatus.locked && fsStatus.owner) {
        const parts = fsStatus.owner.split("::");
        const fsAgent = parts[0];
        if (fsAgent && fsAgent !== requestingAgent) {
          return { conflict: true, lockedBy: fsAgent, handoffId: parts[1] };
        }
      }
    }

    return { conflict: false };
  }
}
