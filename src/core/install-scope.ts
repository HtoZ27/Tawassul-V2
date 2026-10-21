

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

type CoexistenceRegistry = Map<string, CoexistenceEntry>;

function coexistenceRegistry(): CoexistenceRegistry | undefined {
  const existing = (globalThis as Record<symbol, unknown>)[COEXISTENCE_KEY];
  return existing instanceof Map ? (existing as CoexistenceRegistry) : undefined;
}

function ensureCoexistenceRegistry(): CoexistenceRegistry {
  const existing = coexistenceRegistry();
  if (existing) return existing;
  const registry: CoexistenceRegistry = new Map();
  (globalThis as Record<symbol, unknown>)[COEXISTENCE_KEY] = registry;
  return registry;
}

export interface CoexistenceDecision {
  shouldRegister: boolean;
  reason?: string;
}


export function claimCoexistence(
  scope: InstallScope,
  token = "default",
  directory = "",
): CoexistenceDecision {
  const registry = ensureCoexistenceRegistry();
  const existing = registry.get(directory);

  if (!existing) {
    registry.set(directory, { scope, pid: process.pid, token, refs: 1 });
    return { shouldRegister: true };
  }

  if (existing.pid === process.pid && existing.scope === scope) {
    if (existing.token === token) {
      existing.refs += 1;
      return { shouldRegister: true };
    }
    return {
      shouldRegister: false,
      reason: `duplicate ${scope}-scope install (${token}) — copy ${existing.token} already registered for ${directory || "this process"}`,
    };
  }

  if (SCOPE_PRIORITY[scope] > SCOPE_PRIORITY[existing.scope]) {
    
    registry.set(directory, { scope, pid: process.pid, token, refs: 1 });
    return {
      shouldRegister: true,
      reason: `scope ${scope} supersedes ${existing.scope} (pid ${existing.pid}) for ${directory || "this process"}`,
    };
  }

  return {
    shouldRegister: false,
    reason: `scope ${scope} superseded by ${existing.scope} (pid ${existing.pid}) for ${directory || "this process"} — skipping registration`,
  };
}


export function isCoexistenceOwner(scope: InstallScope, token: string, directory = ""): boolean {
  const existing = coexistenceRegistry()?.get(directory);
  return existing !== undefined && existing.pid === process.pid && existing.scope === scope && existing.token === token;
}


export function releaseCoexistence(scope: InstallScope, token: string, directory = ""): void {
  const store = globalThis as Record<symbol, unknown>;
  const registry = coexistenceRegistry();
  if (registry === undefined) return;
  const existing = registry.get(directory);
  if (existing !== undefined && existing.pid === process.pid && existing.scope === scope && existing.token === token) {
    
    
    
    existing.refs = Math.max(0, existing.refs - 1);
    if (existing.refs <= 0) {
      registry.delete(directory);
      if (registry.size === 0) delete store[COEXISTENCE_KEY];
    }
  }
}
