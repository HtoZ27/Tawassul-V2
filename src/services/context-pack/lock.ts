import { randomBytes } from "node:crypto";
import { open, mkdir, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { LOCK_STALE_MS } from "./types.ts";

export class PackLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackLockError";
  }
}

type HeldLock = {
  path: string;
  token: string;
  release: () => Promise<void>;
};

async function tryAcquire(path: string): Promise<HeldLock | undefined> {
  const token = `${process.pid}:${randomBytes(8).toString("hex")}`;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return undefined;
  }
  try {
    await handle.writeFile(`${token}\n${Date.now()}\n`, "utf-8");
  } catch (error) {
    await handle.close();
    await unlink(path).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return {
    path,
    token,
    release: async () => {
      try {
        const content = await readFile(path, "utf-8");
        if (content.startsWith(`${token}\n`)) await unlink(path);
      } catch {
        void 0;
      }
    },
  };
}

export async function acquirePackLock(root: string): Promise<HeldLock> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, "lock");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const held = await tryAcquire(path);
    if (held) return held;
    const info = await stat(path).catch(() => undefined);
    if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
      await unlink(path).catch(() => undefined);
      continue;
    }
    await delay(20 + attempt * 5);
  }
  throw new PackLockError(`could not acquire the context pack lock at ${path}`);
}

export async function withPackLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const held = await acquirePackLock(root);
  try {
    return await fn();
  } finally {
    await held.release();
  }
}
