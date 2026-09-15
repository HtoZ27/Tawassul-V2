

import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { logger } from "../utils/logger.ts";

export const DB_ISOLATION_BASE_SUBDIR = "opencode-projects";
export const DB_ISOLATION_HASH_LEN = 16;


export function isolatedDbPathFor(projectRoot: string, keyFile = defaultKeyFile()): string | null {
  const key = readHmacKey(keyFile);
  if (!key) return null;
  const hash = createHmac("sha256", key)
    .update(resolve(projectRoot), "utf-8")
    .digest("hex")
    .slice(0, DB_ISOLATION_HASH_LEN);
  return resolve(homedir(), ".local", "share", DB_ISOLATION_BASE_SUBDIR, hash, "opencode.db");
}


export function defaultKeyFile(): string {
  const env = process.env.TAWASSUL_HMAC_KEY_DIR?.trim();
  const keyDir = env ? resolve(env) : resolve(homedir(), ".config", "tawassul");
  return resolve(keyDir, ".tawassul-hmac-key");
}


export function readHmacKey(keyFile = defaultKeyFile()): Buffer | null {
  try {
    if (!existsSync(keyFile)) return null;
    const k = readFileSync(keyFile);
    return k.length === 32 ? k : null;
  } catch {
    return null;
  }
}

const warnedProjects = new Set<string>();


export function warnIfUnisolatedDb(projectRoot: string): void {
  try {
    const env = process.env.OPENCODE_DB?.trim();
    if (env) {
      
      
      return;
    }
    const canonical = resolve(projectRoot);
    if (warnedProjects.has(canonical)) return;

    
    
    const sharedDb = resolve(homedir(), ".local", "share", "opencode", "opencode.db");
    if (!existsSync(sharedDb)) return;

    const isolated = isolatedDbPathFor(canonical);
    if (!isolated) {
      logger.warn(`[tawassul] ⚠️ Per-project DB isolation unavailable: no HMAC key at ${defaultKeyFile()}.`);
      return;
    }

    warnedProjects.add(canonical);
    logger.warn(
      `[tawassul] ⚠️ S8 DB isolation off for "${canonical}" — shared opencode.db: ` +
        `SQLITE_BUSY risk when many projects are open. ` +
        `Run opencode through scripts/opencode-iso.sh (per-project OPENCODE_DB → ${isolated}).`,
      { hint: `HMAC-keyed base: ~/.local/share/opencode/${DB_ISOLATION_BASE_SUBDIR}/<keyed> ` },
    );
  } catch {
    // Gauge must never throw into plugin init.
  }
}
