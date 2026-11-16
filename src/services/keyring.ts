

import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../utils/logger.ts";
import { safeHomedir } from "../utils/path-resolver.ts";
import { isIsolationActiveSync } from "./isolation.ts";
import { atomicWriteFile } from "../infra/disk-utils.ts";
import { acquireFSLock, releaseFSLock } from "../infra/file-lock.ts";
import { opencodeConfigLockName } from "../utils/opencode-config.ts";


function resolveSecretsDir(): string {
  return join(safeHomedir(), ".tawassul");
}


async function readSecretsFile(file: string): Promise<Record<string, string>> {
  const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, string>;
}


export async function getSecret(name: string): Promise<string | null> {
  
  const envValue = process.env[name];
  if (envValue) {
    return envValue;
  }

  
  if (process.env.TAWASSUL_KEYRING === "1") {
    
    
    
    const safeName = /^[A-Za-z0-9_-]+$/.test(name) ? name : null;
    if (safeName) {
      try {
        const { execFileSync } = await import("node:child_process");
        
        const value = execFileSync("secret-tool", ["lookup", "tawassul", safeName], {
          encoding: "utf8",
          timeout: 5000,
        }).trim();
        if (value) return value;
      } catch {
        
        try {
          const { execFileSync } = await import("node:child_process");
          const value = execFileSync("security", ["find-generic-password", "-s", "tawassul", "-a", safeName, "-w"], {
            encoding: "utf8",
            timeout: 5000,
          }).trim();
          if (value) return value;
        } catch {

        }
      }
    }
  }

  
  const file = join(resolveSecretsDir(), "secrets.json");
  if (existsSync(file)) {
    const lockName = opencodeConfigLockName(file);
    const owner = `keyring-read::pid-${process.pid}`;
    const locked = await acquireFSLock(lockName, owner, 10000);
    try {
      const data = await readSecretsFile(file);
      if (Object.hasOwn(data, name)) {
        const value = data[name];
        if (typeof value === "string") return value;
      }
    } catch (err) {
      logger.warn(`[keyring] Failed to read secrets file: ${err}`);
    } finally {
      if (locked) {
        try {
          await releaseFSLock(lockName, owner);
        } catch (e) {
          logger.debug(`[keyring] read lock release failed: ${String(e)}`);
        }
      }
    }
  }

  return null;
}


export async function setSecret(name: string, value: string): Promise<void> {
  if (isIsolationActiveSync()) {
    logger.warn(
      `[keyring] setSecret("${name}") blocked: isolated session (fail-safe read-only) — secret not persisted`,
    );
    return;
  }

  const dir = resolveSecretsDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }

  const file = join(dir, "secrets.json");
  const lockName = opencodeConfigLockName(file);
  const owner = `keyring-write::pid-${process.pid}`;
  const locked = await acquireFSLock(lockName, owner, 10000);
  if (!locked) {
    logger.warn(
      `[keyring] setSecret("${name}") blocked: secrets lock busy — refusing an unlocked write`,
    );
    return;
  }
  try {
    let data: Record<string, string> = {};
    try {
      if (existsSync(file)) {
        data = await readSecretsFile(file);
      }
    } catch {

    }

    data[name] = value;
    await atomicWriteFile(file, JSON.stringify(data, null, 2));
  } finally {
    try {
      await releaseFSLock(lockName, owner);
    } catch (e) {
      logger.debug(`[keyring] write lock release failed: ${String(e)}`);
    }
  }
}


export async function hasSecret(name: string): Promise<boolean> {
  return (await getSecret(name)) !== null;
}
