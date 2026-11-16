import { resolve, isAbsolute, sep, dirname, basename, join } from "node:path";
import { realpath, stat, readdir } from "node:fs/promises";
import { realpathSync, statSync } from "node:fs";
import { sanitizeFilePath } from "./validation.ts";
import { t } from "../translations.ts";
import { logger } from "./logger.ts";


export async function resolveSafePath(targetPath: string, baseDir: string): Promise<string | null> {
  const resolved = isAbsolute(targetPath) ? targetPath : resolve(baseDir, targetPath);
  
  
  let realChecked: string;
  try {
    realChecked = await realpath(resolved);
  } catch {
    
    let realDir: string;
    try {
      realDir = await realpath(dirname(resolved));
    } catch {
      realDir = dirname(resolved);
    }
    realChecked = join(realDir, basename(resolved));
  }
  let realBase: string;
  try {
    realBase = await realpath(baseDir);
  } catch {
    realBase = baseDir;
  }
  
  try {
    const resolvedStat = await stat(resolved);
    const baseStat = await stat(baseDir);
    if (resolvedStat.ino === baseStat.ino && resolvedStat.dev === baseStat.dev) {
      return realChecked;
    }
  } catch {

  }
  if (!realChecked.startsWith(realBase + sep) && realChecked !== realBase) return null;

  
  try {
    const resolvedStat = await stat(realChecked);
    if (resolvedStat.nlink > 1) {
      const parentDir = dirname(realChecked);
      const entries = await readdir(parentDir, { withFileTypes: true });
      const maxScan = 500;
      if (entries.length > maxScan) {
        logger.warn(`Hardlink scan skipped: ${entries.length} entries in ${parentDir} exceeds maxScan=${maxScan}`);
        return realChecked;
      }
      for (const entry of entries) {
        if (entry.name === basename(realChecked)) continue;
        if (entry.isDirectory() || entry.isSymbolicLink()) continue;
        const entryPath = join(parentDir, entry.name);
        try {
          const entryStat = await stat(entryPath);
          if (entryStat.ino === resolvedStat.ino && entryStat.dev === resolvedStat.dev) {
            let otherReal: string;
            try {
              otherReal = await realpath(entryPath);
            } catch {
              otherReal = entryPath;
            }
            if (!otherReal.startsWith(realBase + sep) && otherReal !== realBase) {
              logger.warn(`Hardlink escape blocked: ${realChecked} shares inode with ${otherReal} outside baseDir`);
              return null;
            }
          }
        } catch {

        }
      }
    }
  } catch {

  }

  return realChecked;
}


export async function resolveSafe(base: string, userPath: string): Promise<{ resolved: string; error?: string }> {
  const sanitized = sanitizeFilePath(userPath);
  if (!sanitized.safe) {
    return { resolved: userPath, error: t("pathOutOfBounds") };
  }
  const resolved = resolve(base, sanitized.decoded);

  let realResolved: string;
  try {
    realResolved = await realpath(resolved);
  } catch {
    try {
      realResolved = join(await realpath(dirname(resolved)), basename(resolved));
    } catch {
      realResolved = resolved;
    }
  }
  let realBase: string;
  try {
    realBase = await realpath(base);
  } catch {
    realBase = base;
  }

  if (!realResolved.startsWith(realBase + sep) && realResolved !== realBase) {
    return { resolved: userPath, error: t("pathOutOfBounds") };
  }
  return { resolved };
}


export function resolveSafePathSync(targetPath: string, baseDir: string): string | null {
  const resolved = isAbsolute(targetPath) ? targetPath : resolve(baseDir, targetPath);
  let realChecked: string;
  try {
    realChecked = realpathSync(resolved);
  } catch {
    let realDir: string;
    try {
      realDir = realpathSync(dirname(resolved));
    } catch {
      realDir = dirname(resolved);
    }
    realChecked = join(realDir, basename(resolved));
  }
  let realBase: string;
  try {
    realBase = realpathSync(baseDir);
  } catch {
    realBase = baseDir;
  }
  try {
    const resolvedStat = statSync(resolved);
    const baseStat = statSync(baseDir);
    if (resolvedStat.ino === baseStat.ino && resolvedStat.dev === baseStat.dev) {
      return realChecked;
    }
  } catch {

  }
  if (!realChecked.startsWith(realBase + sep) && realChecked !== realBase) return null;
  return realChecked;
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function toErrorMessage(e: unknown, fallback?: string): string {
  if (fallback === undefined) fallback = t("unknownError");
  let msg: string;
  if (e instanceof Error) msg = e.message;
  else if (typeof e === "string") msg = e;
  else if (e && typeof e === "object" && "message" in e) msg = String((e as { message: unknown }).message);
  else msg = fallback;

  
  msg = msg.replace(/\/[^\s:]*\//g, "<path>/");
  return msg;
}
