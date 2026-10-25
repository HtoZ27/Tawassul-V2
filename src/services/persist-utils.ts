

import { readFile, mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname } from "node:path";
import { wrapWithHmac, unwrapWithHmac } from "../utils/crypto.ts";
import { getWriteBlockReason } from "./isolation.ts";
import { logger } from "../utils/logger.ts";
import { atomicWriteFile } from "../utils/atomic.ts";
import { legacyFallbackFor } from "../utils/state-paths.ts";



const debounceEntries = new Map<string, { timer: ReturnType<typeof setTimeout>; fn: () => Promise<void> }>();
const DEBOUNCE_MS = 30_000; 


export function schedulePersist(key: string, fn: () => Promise<void>): void {
  const existing = debounceEntries.get(key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(async () => {
    debounceEntries.delete(key);
    try {
      await fn();
    } catch (err) {
      logger.warn(`[persist] ${key} failed:`, err);
    }
  }, DEBOUNCE_MS);
  timer.unref?.();
  debounceEntries.set(key, { timer, fn });
}


export function cancelPersist(key: string): void {
  const existing = debounceEntries.get(key);
  if (existing) {
    clearTimeout(existing.timer);
    debounceEntries.delete(key);
  }
}


export async function flushAllPersists(): Promise<void> {
  const pending = Array.from(debounceEntries.entries());
  debounceEntries.clear();
  for (const [key, entry] of pending) {
    clearTimeout(entry.timer);
    try {
      await entry.fn();
    } catch (err) {
      logger.error(`[persist] ${key} flush failed:`, err);
    }
  }
}


export function countPendingPersists(): number {
  return debounceEntries.size;
}

export function resolveConfigPath(path: string): string {
  if (!path.includes("~")) return path;
  const home = process.env.HOME || "~";
  return path.replace("~", home);
}

export async function writeIfChanged(
  filePath: string,
  data: string,
  opts: { backup?: boolean } = {},
): Promise<boolean> {
  try {
    if ((await readFile(filePath, "utf8")) === data) return false;
  } catch {
    logger.debug(`[persist] compare-read unavailable for ${basename(filePath)} — writing unconditionally`);
  }
  await atomicWriteFile(filePath, data, { backup: opts.backup ?? false });
  return true;
}




export async function hmacWriteFile(filePath: string, data: unknown): Promise<void> {
  const reason = getWriteBlockReason(filePath);
  if (reason !== null) {
    logger.warn(
      reason === "foreign-key"
        ? `⛔ hmacWriteFile blocked for ${filePath}: signed by an unknown key (foreign-key) with no local host key — read-only on this device, no key created.`
        : `⛔ hmacWriteFile blocked for ${filePath}: session is isolated (read-only fail-safe).`,
    );
    return;
  }
  const json = JSON.stringify(data, null, 2);
  const signed = wrapWithHmac(json);
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  await atomicWriteFile(filePath, signed, { backup: true });
}


async function preserveRejectedState(filePath: string, raw: string): Promise<void> {
  if (raw.trim().length < 2) return;
  try {
    const { readdir, writeFile } = await import("node:fs/promises");
    const { quarantinePath } = await import("../utils/state-paths.ts");
    const base = basename(filePath);
    const dest = quarantinePath(`${base}.rejected.${Date.now()}`);
    const qdir = dirname(dest);
    await mkdir(qdir, { recursive: true });
    const siblings = await readdir(qdir);
    if (siblings.some((f) => f.startsWith(`${base}.rejected.`))) return;
    await writeFile(dest, raw, "utf-8");
    logger.warn(
      `[tawassul] M-2: rejected state preserved for recovery at ${dest} — review and restore manually if needed`,
    );
  } catch (e) {
    logger.warn(`[tawassul] M-2: rejected state could not be preserved for ${filePath}:`, e);
  }
}


export async function hmacReadFile<T>(filePath: string): Promise<T | null> {
  let source = filePath;
  try {
    await access(source, constants.F_OK);
  } catch {
    const legacy = legacyFallbackFor(filePath);
    if (legacy === undefined) return null;
    try {
      await access(legacy, constants.F_OK);
    } catch {
      return null;
    }
    logger.info(`[persist] reading legacy state file ${legacy} (namespaced file absent)`);
    source = legacy;
  }
  try {
    const raw = await readFile(source, "utf-8");
    const json = unwrapWithHmac(raw);
    if (json === null) {
      
      
      
      await preserveRejectedState(source, raw);
      logger.warn(`Invalid signature for ${source}, treating as empty`);
      return null;
    }
    return JSON.parse(json) as T;
  } catch (err) {
    logger.warn(`Failed to read ${source}:`, err);
    return null;
  }
}
