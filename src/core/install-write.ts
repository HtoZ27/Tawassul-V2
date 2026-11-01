import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export type WriteOps = {
  writeFileSync: typeof writeFileSync;
  openSync: typeof openSync;
  closeSync: typeof closeSync;
  fsyncSync: typeof fsyncSync;
  renameSync: typeof renameSync;
  chmodSync: typeof chmodSync;
  unlinkSync: typeof unlinkSync;
  lstatSync: typeof lstatSync;
  randomHex: (bytes: number) => string;
};

export const realWriteOps: WriteOps = {
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  chmodSync,
  unlinkSync,
  lstatSync,
  randomHex: (bytes: number) => randomBytes(bytes).toString("hex"),
};

const DIR_FSYNC_UNSUPPORTED = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP", "EISDIR", "EPERM", "EACCES"]);

function codeOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

export function fsyncFileDescriptor(descriptor: number, ops: WriteOps): void {
  while (true) {
    try {
      ops.fsyncSync(descriptor);
      return;
    } catch (error) {
      if (codeOf(error) !== "EINTR") throw error;
    }
  }
}

export function fsyncDirectory(directory: string, ops: WriteOps, platform: NodeJS.Platform): void {
  if (platform === "win32") return;
  let descriptor: number;
  try {
    descriptor = ops.openSync(directory, "r");
  } catch (error) {
    if (DIR_FSYNC_UNSUPPORTED.has(codeOf(error) ?? "")) return;
    throw error;
  }
  try {
    fsyncFileDescriptor(descriptor, ops);
  } catch (error) {
    if (!DIR_FSYNC_UNSUPPORTED.has(codeOf(error) ?? "")) throw error;
  } finally {
    ops.closeSync(descriptor);
  }
}

export function assertNotSymlink(file: string, ops: WriteOps): void {
  try {
    const stats = ops.lstatSync(file);
    if (stats.isSymbolicLink()) {
      throw new Error(`refusing to write through a symlink: ${file}`);
    }
  } catch (error) {
    if (codeOf(error) === "ENOENT") return;
    throw error;
  }
}

export function durableWriteFile(
  file: string,
  data: string | Buffer,
  mode = 0o600,
  ops: WriteOps = realWriteOps,
  platform: NodeJS.Platform = process.platform,
): void {
  const target = resolve(file);
  assertNotSymlink(target, ops);
  const temp = `${target}.tmp-${process.pid}-${ops.randomHex(8)}`;
  try {
    ops.writeFileSync(temp, data, { mode, flag: "wx" });
    const descriptor = ops.openSync(temp, "r");
    try {
      fsyncFileDescriptor(descriptor, ops);
    } finally {
      ops.closeSync(descriptor);
    }
    ops.renameSync(temp, target);
    ops.chmodSync(target, mode);
    fsyncDirectory(dirname(target), ops, platform);
  } catch (error) {
    try {
      ops.unlinkSync(temp);
    } catch {

    }
    throw error;
  }
}
