import path from "node:path";
import { writeFile, mkdir, readFile, copyFile, rename, unlink, access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import { secureId } from "../utils/crypto.ts";
import { isProcessAlive } from "../utils/process.ts";
import { t } from "../translations.ts";

export interface PatchOptions {
  baseDir: string;
  dryRun?: boolean;
}

export interface PatchResult {
  applied: boolean;
  file: string;
  error?: string;
  backupFile?: string;
}

const TRAVERSAL_PATTERN = /\.\.\//;
const URL_ENCODED_TRAVERSAL = /%2e%2e[/%2f]/i;
const LOCK_DIR = path.join(os.tmpdir(), "tawassul-locks");

async function acquireLock(lockPath: string): Promise<boolean> {
  try {
    await mkdir(LOCK_DIR, { recursive: true });
    await writeFile(lockPath, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    try {
      const raw = await readFile(lockPath, "utf-8");
      const pid = parseInt(raw.trim(), 10);
      if (!isProcessAlive(pid)) {
        await writeFile(lockPath, String(process.pid));
        return true;
      }
    } catch {
      
      try {
        await writeFile(lockPath, String(process.pid), { flag: "wx" });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

async function releaseLock(lockPath: string): Promise<void> {
  try {
    const raw = await readFile(lockPath, "utf-8");
    if (raw.trim() === String(process.pid)) {
      await unlink(lockPath);
    }
  } catch {

  }
}

export async function applyPatch(filePath: string, content: string, options: PatchOptions): Promise<PatchResult> {
  const fullPath = path.resolve(options.baseDir, filePath);

  if (TRAVERSAL_PATTERN.test(filePath) || URL_ENCODED_TRAVERSAL.test(filePath)) {
    return { applied: false, file: filePath, error: "⛔ Path traversal detected" };
  }

  if (!fullPath.startsWith(path.resolve(options.baseDir))) {
    return { applied: false, file: filePath, error: "⛔ File outside base directory" };
  }

  try {
    const realBase = await realpath(options.baseDir);
    const realFull = await realpath(fullPath);
    if (!realFull.startsWith(realBase)) {
      return { applied: false, file: filePath, error: "⛔ Symlink escape detected" };
    }
  } catch {

  }

  if (options.dryRun) {
    return { applied: true, file: filePath };
  }

  const lockPath = path.join(LOCK_DIR, Buffer.from(fullPath).toString("base64url"));
  if (!(await acquireLock(lockPath))) {
    return { applied: false, file: filePath, error: t("apFileLocked") };
  }

  try {
    const dir = path.dirname(fullPath);
    await mkdir(dir, { recursive: true });

    let backupFile: string | undefined;
    try {
      await access(fullPath, constants.F_OK);
      backupFile = fullPath + ".bak";
      await copyFile(fullPath, backupFile);
    } catch {

    }

    const tmpFile = path.join(os.tmpdir(), `.tawassul-patch-${Date.now()}-${secureId()}`);
    await writeFile(tmpFile, content, "utf-8");
    await rename(tmpFile, fullPath);
    return { applied: true, file: filePath, backupFile };
  } finally {
    await releaseLock(lockPath);
  }
}
