

import { evaluateIsolationSync, isIsolatedSession } from "../utils/path-resolver.ts";
import {
  unwrapWithHmacReadOnly,
  hmacKeyFileExists,
  resetHmacKeyCache,
  isHmacSigned,
  isHmacIsolationActive,
} from "../utils/crypto.ts";
import { existsSync, readFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";


export function isIsolationActiveSync(): boolean {
  return evaluateIsolationSync().isolated;
}


export async function isSaveIsolated(stateDir?: string, statePath?: () => string): Promise<boolean> {
  if (!stateDir) return isIsolationActiveSync();
  const signal = await isIsolatedSession({
    stateDir,
    stateFile: statePath ? statePath() : undefined,
    verifySigned: (signed) => unwrapWithHmacReadOnly(signed),
    hasLocalKey: () => hmacKeyFileExists(),
    isSigned: (signed) => isHmacSigned(signed),
  });
  return signal.isolated;
}

export type SaveIsolationVerdict = "isolated" | "foreign-key" | null;


export async function getSaveIsolationVerdict(
  stateDir?: string,
  statePath?: () => string,
): Promise<SaveIsolationVerdict> {
  if (!stateDir) return isIsolationActiveSync() ? "isolated" : null;
  const signal = await isIsolatedSession({
    stateDir,
    stateFile: statePath ? statePath() : undefined,
    verifySigned: (signed) => unwrapWithHmacReadOnly(signed),
    hasLocalKey: () => hmacKeyFileExists(),
    isSigned: (signed) => isHmacSigned(signed),
  });
  if (signal.isolated) return "isolated";
  if (!signal.isolated && signal.signal === "foreign-key") return "foreign-key";
  return null;
}


export function isForeignKeyTargetSync(filePath?: string): boolean {
  if (hmacKeyFileExists()) return false;
  if (!filePath || !existsSync(filePath)) return false;
  try {
    const signed = readFileSync(filePath, "utf-8");
    return isHmacSigned(signed) && unwrapWithHmacReadOnly(signed) === null;
  } catch {
    return false;
  }
}

export type WriteBlockReason = "isolated" | "foreign-key" | null;


export function getWriteBlockReason(filePath?: string): WriteBlockReason {
  if (isForeignKeyTargetSync(filePath)) return "foreign-key";
  if (isHmacIsolationActive()) return "isolated";
  return null;
}


export async function recheckIsolationBeforeResume(stateDir?: string, statePath?: () => string): Promise<boolean> {
  resetHmacKeyCache();
  return !(await isSaveIsolated(stateDir, statePath));
}






const WORKTREE_ROOT_ENV = "TAWASSUL_WORKTREE_ROOT";


export function getWorktreeRoot(): string | undefined {
  const v = process.env[WORKTREE_ROOT_ENV];
  if (!v) return undefined;
  return isAbsolute(v) ? resolve(v) : undefined;
}


export function isWithinWorktreeScope(filePath: string, root: string): boolean {
  const abs = resolve(filePath);
  const rel = relative(resolve(root), abs);
  return !rel.startsWith("..") && !isAbsolute(rel);
}


export function getWorktreeBlockReason(stateDir?: string): "worktree" | null {
  const root = getWorktreeRoot();
  if (!root || !stateDir) return null;
  return isWithinWorktreeScope(stateDir, root) ? null : "worktree";
}
