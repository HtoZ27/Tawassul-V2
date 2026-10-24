import { existsSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { globalConfigBaseDir, safeHomedir } from "./path-resolver.ts";

export const STATE_DIR_ENV = "TAWASSUL_V2_STATE_DIR";
export const LEGACY_STATE_DIR_ENV = "TAWASSUL_V2_LEGACY_STATE_DIR";
export const STATE_DIR_NAME = "tawassul-v2";
export const LEGACY_STATE_DIR_NAME = "tawassyl";
export const STATE_SUBDIR = "state";

export function v2NamespaceRoot(base: string): string {
  const resolved = resolve(base);
  if (basename(resolved) === STATE_DIR_NAME) return resolved;
  return resolve(resolved, STATE_DIR_NAME);
}

export function stateDir(): string {
  const override = process.env[STATE_DIR_ENV]?.trim();
  if (override) return resolve(override);
  return resolve(v2NamespaceRoot(globalConfigBaseDir()), STATE_SUBDIR);
}

export function legacyStateDir(): string {
  const override = process.env[LEGACY_STATE_DIR_ENV]?.trim();
  if (override) return resolve(override);
  return resolve(safeHomedir(), ".config", LEGACY_STATE_DIR_NAME, STATE_SUBDIR);
}

export function statePath(fileName: string): string {
  try {
    return resolve(stateDir(), fileName);
  } catch {
    return `~/.config/${STATE_DIR_NAME}/${STATE_SUBDIR}/${fileName}`;
  }
}

export function legacyStatePath(fileName: string): string {
  return resolve(legacyStateDir(), fileName);
}

export function stateReadPath(fileName: string): string {
  const primary = statePath(fileName);
  if (existsSync(primary)) return primary;
  const legacy = legacyStatePath(fileName);
  if (existsSync(legacy)) return legacy;
  return primary;
}

export function legacyFallbackFor(filePath: string): string | undefined {
  const target = resolve(filePath);
  const rel = relative(stateDir(), target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  const legacy = resolve(legacyStateDir(), rel);
  return legacy === target ? undefined : legacy;
}
