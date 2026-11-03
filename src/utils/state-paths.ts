import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { globalConfigBaseDir, safeHomedir, type InstallScope } from "./path-resolver.ts";

export const STATE_DIR_ENV = "TAWASSUL_V2_STATE_DIR";
export const STATE_DIR_NAME = "tawassul-v2";
export const STATE_SUBDIR = "state";
export const QUARANTINE_SUBDIR = "quarantine";

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

export function v2DataRoot(): string {
  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg && isAbsolute(xdg)) return v2NamespaceRoot(xdg);
  let home = process.env.HOME?.trim();
  if (!home || home === "/") {
    try {
      home = safeHomedir();
    } catch {
      return "";
    }
  }
  return v2NamespaceRoot(resolve(home, ".local", "share"));
}

export function quarantinePath(fileName: string): string {
  return resolve(stateDir(), QUARANTINE_SUBDIR, fileName);
}

export function statePath(fileName: string): string {
  try {
    return resolve(stateDir(), fileName);
  } catch {
    return `~/.config/${STATE_DIR_NAME}/${STATE_SUBDIR}/${fileName}`;
  }
}

export function scopedStatePath(base: string, scope: InstallScope | undefined, fileName: string): string {
  if (scope === "global") return statePath(fileName);
  return resolve(base, ".opencode", fileName);
}

export function projectRootFallback(filePath: string): string | undefined {
  const target = resolve(filePath);
  const parent = dirname(target);
  if (basename(parent) !== ".opencode") return undefined;
  const rootCandidate = resolve(dirname(parent), basename(target));
  if (rootCandidate === target || !existsSync(rootCandidate)) return undefined;
  return rootCandidate;
}
