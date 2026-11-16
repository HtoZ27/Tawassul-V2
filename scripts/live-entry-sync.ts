import * as nodeFs from "node:fs";
import { dirname, basename } from "node:path";

export type LiveEntryFs = {
  readFileSync: typeof nodeFs.readFileSync;
  lstatSync: typeof nodeFs.lstatSync;
  statSync: typeof nodeFs.statSync;
  realpathSync: typeof nodeFs.realpathSync;
  openSync: typeof nodeFs.openSync;
  writeFileSync: typeof nodeFs.writeFileSync;
  fsyncSync: typeof nodeFs.fsyncSync;
  closeSync: typeof nodeFs.closeSync;
  renameSync: typeof nodeFs.renameSync;
  unlinkSync: typeof nodeFs.unlinkSync;
  existsSync: typeof nodeFs.existsSync;
};

export type LiveEntrySyncOptions = {
  fs?: Partial<LiveEntryFs>;
  attempts?: number;
  retryDelayMs?: number;
};

export type LiveEntrySyncResult = {
  written: boolean;
  target: string;
};

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 100;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export function syncLiveEntry(
  sourcePath: string,
  livePath: string,
  options: LiveEntrySyncOptions = {},
): LiveEntrySyncResult {
  const f: LiveEntryFs = { ...(nodeFs as LiveEntryFs), ...options.fs };
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  let bytes: Buffer;
  try {
    bytes = f.readFileSync(sourcePath) as Buffer;
  } catch (error) {
    throw new Error(`live entry sync: cannot read source ${sourcePath}: ${String(error)}`);
  }

  let target = livePath;
  let liveStat: nodeFs.Stats | null = null;
  try {
    liveStat = f.lstatSync(livePath);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  if (liveStat && liveStat.isSymbolicLink()) {
    try {
      target = f.realpathSync(livePath);
    } catch (error) {
      throw new Error(`live entry sync: dangling symlink at ${livePath}: ${String(error)}`);
    }
  }

  const existing = f.statSync(target, { throwIfNoEntry: false });
  if (existing && existing.isFile()) {
    try {
      if ((f.readFileSync(target) as Buffer).equals(bytes)) {
        return { written: false, target };
      }
    } catch {}
  }

  let mode = 0o644;
  if (existing && existing.isFile()) {
    mode = existing.mode & 0o7777;
  } else {
    try {
      mode = (f.statSync(sourcePath).mode & 0o7777) & ~process.umask();
    } catch {
      mode = 0o644;
    }
  }

  const directory = dirname(target);
  const name = basename(target);
  let tempPath: string | null = null;
  let descriptor: number | null = null;
  let lastError: unknown = null;
  for (let counter = 0; counter < attempts && descriptor === null; counter += 1) {
    const candidate = `${directory}/${name}.${process.pid}.${counter}.tmp`;
    try {
      descriptor = f.openSync(candidate, "wx", mode);
      tempPath = candidate;
    } catch (error) {
      lastError = error;
      if (errorCode(error) === "EEXIST") continue;
      throw error;
    }
  }
  if (descriptor === null || tempPath === null) {
    throw new Error(`live entry sync: cannot create a temp file beside ${target}: ${String(lastError)}`);
  }

  try {
    f.writeFileSync(descriptor, bytes);
    f.fsyncSync(descriptor);
  } finally {
    f.closeSync(descriptor);
  }

  try {
    try {
      f.renameSync(tempPath, target);
    } catch (error) {
      const code = errorCode(error);
      if (code !== "EPERM" && code !== "EBUSY") throw error;
      sleepSync(retryDelayMs);
      f.renameSync(tempPath, target);
    }
  } finally {
    if (tempPath && f.existsSync(tempPath)) {
      try {
        f.unlinkSync(tempPath);
      } catch {}
    }
  }

  try {
    const directoryDescriptor = f.openSync(directory, "r");
    try {
      f.fsyncSync(directoryDescriptor);
    } finally {
      f.closeSync(directoryDescriptor);
    }
  } catch {}

  return { written: true, target };
}
