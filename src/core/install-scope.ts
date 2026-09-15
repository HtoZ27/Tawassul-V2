

import { fileURLToPath } from "node:url";
import { isInsideGlobalConfigDir, type InstallScope } from "../utils/path-resolver.ts";


export function detectInstallScope(metaUrl?: string): InstallScope {
  const override = process.env.TAWASSUL_SCOPE?.trim().toLowerCase();
  if (override === "global" || override === "project") return override;
  if (metaUrl) {
    try {
      const modPath = fileURLToPath(metaUrl);
      if (isInsideGlobalConfigDir(modPath)) return "global";
    } catch {
      /* malformed metaUrl — fall through to project */
    }
  }
  return "project";
}


const COEXISTENCE_KEY = Symbol.for("tawassul.plugin.warmedup");

interface CoexistenceEntry {
  scope: InstallScope;
  pid: number;
  
  token: string;
  
  refs: number;
}

const SCOPE_PRIORITY: Record<InstallScope, number> = { project: 2, global: 1 };

export interface CoexistenceDecision {
  shouldRegister: boolean;
  reason?: string;
}


export function claimCoexistence(scope: InstallScope, token = "default"): CoexistenceDecision {
  const store = globalThis as Record<symbol, unknown>;
  const existing = store[COEXISTENCE_KEY] as CoexistenceEntry | undefined;

  if (!existing) {
    store[COEXISTENCE_KEY] = { scope, pid: process.pid, token, refs: 1 };
    return { shouldRegister: true };
  }

  if (existing.pid === process.pid && existing.scope === scope) {
    if (existing.token === token) {
      existing.refs += 1;
      return { shouldRegister: true };
    }
    return {
      shouldRegister: false,
      reason: `duplicate ${scope}-scope install (${token}) — copy ${existing.token} already registered`,
    };
  }

  if (SCOPE_PRIORITY[scope] > SCOPE_PRIORITY[existing.scope]) {
    
    store[COEXISTENCE_KEY] = { scope, pid: process.pid, token, refs: 1 };
    return {
      shouldRegister: true,
      reason: `scope ${scope} supersedes ${existing.scope} (pid ${existing.pid})`,
    };
  }

  return {
    shouldRegister: false,
    reason: `scope ${scope} superseded by ${existing.scope} (pid ${existing.pid}) — skipping registration`,
  };
}


export function isCoexistenceOwner(scope: InstallScope, token: string): boolean {
  const store = globalThis as Record<symbol, unknown>;
  const existing = store[COEXISTENCE_KEY] as CoexistenceEntry | undefined;
  return existing !== undefined && existing.pid === process.pid && existing.scope === scope && existing.token === token;
}


export function releaseCoexistence(scope: InstallScope, token: string): void {
  const store = globalThis as Record<symbol, unknown>;
  const existing = store[COEXISTENCE_KEY] as CoexistenceEntry | undefined;
  if (existing !== undefined && existing.pid === process.pid && existing.scope === scope && existing.token === token) {
    
    
    
    existing.refs = Math.max(0, existing.refs - 1);
    if (existing.refs <= 0) {
      delete store[COEXISTENCE_KEY];
    }
  }
}
