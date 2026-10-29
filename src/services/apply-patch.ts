import path from "node:path";
import { writeFile, mkdir, readFile, copyFile, rename, unlink, realpath, stat, chmod } from "node:fs/promises";
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
const LOCK_DIR = path.join(os.tmpdir(), "tawassul-v2-locks");

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
    void 0;
  }
}

function isInside(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  if (rel === "" || rel === ".." || path.isAbsolute(rel)) return false;
  return !rel.startsWith(`..${path.sep}`);
}

function isInsideOrEqual(base: string, target: string): boolean {
  return target === base || isInside(base, target);
}

async function resolveAncestor(dir: string): Promise<{ real: string; missing: string[] }> {
  const missing: string[] = [];
  let current = dir;
  while (true) {
    try {
      const real = await realpath(current);
      return { real, missing };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const parent = path.dirname(current);
      if (parent === current) throw e;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

export async function applyPatch(filePath: string, content: string, options: PatchOptions): Promise<PatchResult> {
  if (TRAVERSAL_PATTERN.test(filePath) || URL_ENCODED_TRAVERSAL.test(filePath)) {
    return { applied: false, file: filePath, error: "⛔ Path traversal detected" };
  }

  const baseDir = path.resolve(options.baseDir);
  const fullPath = path.resolve(baseDir, filePath);

  if (!isInside(baseDir, fullPath)) {
    return { applied: false, file: filePath, error: "⛔ File outside base directory" };
  }

  let realBase: string;
  try {
    realBase = await realpath(baseDir);
  } catch {
    return { applied: false, file: filePath, error: "⛔ Base directory is not accessible" };
  }

  const parent = path.dirname(fullPath);
  let realAncestor: string;
  try {
    const resolved = await resolveAncestor(parent);
    realAncestor = resolved.real;
  } catch {
    return { applied: false, file: filePath, error: "⛔ Parent directory cannot be resolved" };
  }

  if (!isInsideOrEqual(realBase, realAncestor)) {
    return { applied: false, file: filePath, error: "⛔ Symlink escape detected" };
  }

  try {
    const realTarget = await realpath(fullPath);
    if (!isInside(realBase, realTarget)) {
      return { applied: false, file: filePath, error: "⛔ Symlink escape detected" };
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      return { applied: false, file: filePath, error: "⛔ Target cannot be resolved" };
    }
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

    let realDir: string;
    try {
      realDir = await realpath(dir);
    } catch {
      return { applied: false, file: filePath, error: "⛔ Parent directory cannot be resolved" };
    }
    if (!isInsideOrEqual(realBase, realDir)) {
      return { applied: false, file: filePath, error: "⛔ Symlink escape detected" };
    }

    let backupFile: string | undefined;
    let mode: number | undefined;
    try {
      const info = await stat(fullPath);
      if (!info.isFile()) {
        return { applied: false, file: filePath, error: "⛔ Target is not a regular file" };
      }
      mode = info.mode & 0o777;
      backupFile = fullPath + ".bak";
      try {
        await unlink(backupFile);
      } catch {
        void 0;
      }
      await copyFile(fullPath, backupFile);
      const realBackup = await realpath(backupFile);
      if (!isInside(realBase, realBackup)) {
        await unlink(backupFile).catch(() => undefined);
        return { applied: false, file: filePath, error: "⛔ Backup escape detected" };
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        return { applied: false, file: filePath, error: "⛔ Target cannot be prepared" };
      }
    }

    const tmpFile = path.join(dir, `.tawassul-patch-${Date.now()}-${secureId()}.tmp`);
    try {
      await writeFile(tmpFile, content, { encoding: "utf-8", mode: mode ?? 0o666 });
      if (mode !== undefined) await chmod(tmpFile, mode);
      await rename(tmpFile, fullPath);
    } catch (e) {
      await unlink(tmpFile).catch(() => undefined);
      return { applied: false, file: filePath, error: `⛔ Write failed: ${(e as Error).message}` };
    }

    return { applied: true, file: filePath, backupFile };
  } finally {
    await releaseLock(lockPath);
  }
}
