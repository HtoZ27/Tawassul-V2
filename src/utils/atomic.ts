

import { copyFile, unlink, readdir, readFile, stat, chmod, open } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { randomBytes } from "node:crypto";
import { atomicWriteFile as atomicWriteFs } from "../infra/disk-utils.ts";
import { logger } from "./logger.ts";

const MAX_BACKUPS = 2;

export interface AtomicWriteResult {
  path: string;
  bytes: number;
  backupPath: string | null;
  replaced: boolean;
}

async function pruneOldBackups(filePath: string): Promise<void> {
  try {
    const dir = dirname(filePath);
    const base = basename(filePath);
    const entries = await readdir(dir);
    const backups = entries
      .filter((e) => e.startsWith(`${base}.bak.`))
      .sort()
      .reverse();
    for (const stale of backups.slice(MAX_BACKUPS)) {
      
      
      await unlink(join(dir, stale)).catch(() => undefined);
    }
  } catch (e) {
    logger.debug(`atomicWriteFile: backup prune skipped for ${filePath}:`, e);
  }
}


export async function atomicWriteFile(
  filePath: string,
  content: string,
  opts: { backup?: boolean } = {},
): Promise<AtomicWriteResult> {
  const { backup = true } = opts;
  let backupPath: string | null = null;
  let replaced = false;

  
  
  
  let originalMode: number | null = null;
  try {
    originalMode = (await stat(filePath)).mode & 0o777;
  } catch (e) {
    logger.debug(`atomicWriteFile: mode read skipped for ${filePath}:`, e);
  }

  if (backup) {
    const candidate = `${filePath}.bak.${Date.now()}.${randomBytes(6).toString("hex")}`;
    try {
      const bfh = await open(candidate, "w", 0o600);
      try {
        await bfh.writeFile(await readFile(filePath));
      } finally {
        await bfh.close();
      }
      backupPath = candidate;
      replaced = true;
    } catch (e) {
      await unlink(candidate).catch(() => undefined);
      backupPath = null;
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") logger.debug(`atomicWriteFile: no prior file to back up for ${filePath}`);
      else logger.warn(`atomicWriteFile: backup requested but not created for ${filePath}:`, e);
    }
  }

  await atomicWriteFs(filePath, content);

  
  if (originalMode !== null) {
    try {
      await chmod(filePath, originalMode);
    } catch (e) {
      logger.debug(`atomicWriteFile: mode restore skipped for ${filePath}:`, e);
    }
  }

  try {
    
    
    const finalVerify = await readFile(filePath, "utf-8");
    if (finalVerify !== content) {
      throw new Error(`atomicWriteFile: verification failed for ${filePath}`);
    }
  } catch (err) {
    if (backupPath) {
      try {
        await copyFile(backupPath, filePath);
        await unlink(backupPath);
        logger.warn(`atomicWriteFile: rolled back ${filePath} from backup`);
      } catch (e) {
        logger.warn(`atomicWriteFile: rollback failed for ${filePath}:`, e);
      }
    }
    throw err;
  }

  await pruneOldBackups(filePath);

  return { path: filePath, bytes: Buffer.byteLength(content), backupPath, replaced };
}


export async function rollbackFile(filePath: string, backupPath: string): Promise<boolean> {
  try {
    await copyFile(backupPath, filePath);
    await unlink(backupPath);
    return true;
  } catch (err) {
    logger.warn(`rollbackFile: failed to restore ${filePath} from ${backupPath}:`, err);
    return false;
  }
}
