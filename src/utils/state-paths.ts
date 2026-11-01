import { existsSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { globalConfigBaseDir, safeHomedir, type InstallScope } from "./path-resolver.ts";

export const STATE_DIR_ENV = "TAWASSUL_V2_STATE_DIR";
export const LEGACY_STATE_DIR_ENV = "TAWASSUL_V2_LEGACY_STATE_DIR";
export const LEGACY_READS_ENV = "TAWASSUL_V2_LEGACY_READS";
export const STATE_DIR_NAME = "tawassul-v2";
export const LEGACY_STATE_DIR_NAME = "tawassyl";
export const LEGACY_ROUTER_DIR_NAME = "tawassul";
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

export function legacyStateDir(): string {
  const override = process.env[LEGACY_STATE_DIR_ENV]?.trim();
  if (override) return resolve(override);
  return resolve(safeHomedir(), ".config", LEGACY_STATE_DIR_NAME, STATE_SUBDIR);
}

export function legacyReadsEnabled(): boolean {
  return process.env[LEGACY_READS_ENV]?.trim() === "1";
}

function legacyStateCandidateDirs(): string[] {
  const override = process.env[LEGACY_STATE_DIR_ENV]?.trim();
  if (override) return [resolve(override)];
  const home = safeHomedir();
  return [
    resolve(home, ".config", LEGACY_STATE_DIR_NAME, STATE_SUBDIR),
    resolve(home, ".config", LEGACY_ROUTER_DIR_NAME, STATE_SUBDIR),
  ];
}

function legacyStateCandidates(fileName: string): string[] {
  return legacyStateCandidateDirs().map((dir) => resolve(dir, fileName));
}

function newestExisting(candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestMtime = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    try {
      const mtime = statSync(candidate).mtimeMs;
      if (best === undefined || mtime >= bestMtime) {
        best = candidate;
        bestMtime = mtime;
      }
    } catch {}
  }
  return best;
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

export function legacyStatePath(fileName: string): string {
  const candidates = legacyStateCandidates(fileName);
  return newestExisting(candidates) ?? candidates[0] ?? resolve(legacyStateDir(), fileName);
}

export function stateReadPath(fileName: string): string {
  const primary = statePath(fileName);
  if (existsSync(primary)) return primary;
  if (!legacyReadsEnabled()) return primary;
  const legacy = legacyStatePath(fileName);
  if (existsSync(legacy)) return legacy;
  return primary;
}

export function legacyFallbackFor(filePath: string): string | undefined {
  const target = resolve(filePath);
  const rel = relative(stateDir(), target);
  if (rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
    if (!legacyReadsEnabled()) return undefined;
    const hit = newestExisting(legacyStateCandidates(rel).filter((candidate) => candidate !== target));
    return hit;
  }
  const parent = dirname(target);
  if (basename(parent) !== ".opencode") return undefined;
  const rootCandidate = resolve(dirname(parent), basename(target));
  if (rootCandidate === target || !existsSync(rootCandidate)) return undefined;
  return rootCandidate;
}
