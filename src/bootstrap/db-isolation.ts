

import { createHmac } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { homedir } from "node:os";

export const DB_ISOLATION_BASE_SUBDIR = "opencode-projects";
export const DB_ISOLATION_HASH_LEN = 16;

const SHARED_DB_SUFFIXES = [`${sep}opencode${sep}opencode.db`, `${sep}opencode${sep}opencode-desktop.db`];

export const dataRoot = (): string => {
  const env = process.env.XDG_DATA_HOME?.trim();
  return env ? resolve(env) : resolve(homedir(), ".local", "share");
};

export function canonicalize(projectRoot: string): string {
  try {
    return realpathSync(projectRoot);
  } catch {
    return resolve(projectRoot);
  }
}

export function isSharedDbPath(dbPath: string): boolean {
  const canon = canonicalize(dbPath);
  return SHARED_DB_SUFFIXES.some((s) => canon.endsWith(s));
}

export type DbLane = "desktop-sidecar" | "host-default" | "isolated" | "custom" | "unset";

export function isDesktopSidecarDbPath(dbPath: string): boolean {
  const canon = canonicalize(dbPath);
  const base = resolve(dataRoot(), "opencode", "tawassul-v2");
  return canon === base || canon.startsWith(`${base}${sep}`);
}

export function classifyDbLane(dbPath: string | undefined): DbLane {
  const trimmed = dbPath?.trim() ?? "";
  if (!trimmed) return "unset";
  if (isSharedDbPath(trimmed)) return "host-default";
  if (isDesktopSidecarDbPath(trimmed)) return "desktop-sidecar";
  const isolatedBase = resolve(dataRoot(), DB_ISOLATION_BASE_SUBDIR);
  const canon = canonicalize(trimmed);
  if (canon === isolatedBase || canon.startsWith(`${isolatedBase}${sep}`)) return "isolated";
  return "custom";
}

export function isolatedDbPathFor(projectRoot: string, keyFile = defaultKeyFile()): string | null {
  const key = readHmacKey(keyFile);
  if (!key) return null;
  const hash = createHmac("sha256", key)
    .update(canonicalize(projectRoot), "utf-8")
    .digest("hex")
    .slice(0, DB_ISOLATION_HASH_LEN);
  return resolve(dataRoot(), DB_ISOLATION_BASE_SUBDIR, hash, "opencode.db");
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
