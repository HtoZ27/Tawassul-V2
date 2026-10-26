import { BLOCKED_TOOLS } from "../security-policy.ts";
import { getAutoGrantableTools } from "./permission-rules.ts";

export type PermissionRepairTarget = { agent?: Record<string, unknown> };

export function ensureTawaToolPermissions(cfg: PermissionRepairTarget): boolean {
  const tawa = (cfg.agent as Record<string, unknown> | undefined)?.tawa as Record<string, unknown> | undefined;
  if (!tawa || typeof tawa !== "object") return false;
  const perm = tawa.permission as Record<string, unknown> | undefined;
  if (!perm || typeof perm !== "object") return false;
  const tawaInnovations = tawa.innovations as Record<string, unknown> | undefined;
  const autoGrantMode = (tawaInnovations?.autoGrantMode as "all" | "safe-only" | "none") ?? "all";
  const granted = getAutoGrantableTools(perm, autoGrantMode);
  let changed = false;
  for (const name of granted) {
    if (perm[name] !== "allow") {
      perm[name] = "allow";
      changed = true;
    }
  }
  for (const b of BLOCKED_TOOLS) {
    const current = perm[b];
    if (current && typeof current === "object" && !Array.isArray(current)) continue;
    if (current !== "deny") {
      perm[b] = "deny";
      changed = true;
    }
  }
  return changed;
}

export function ensureAddAgentToolPermissions(cfg: PermissionRepairTarget): boolean {
  const addagent = (cfg.agent as Record<string, unknown> | undefined)?.addagent as Record<string, unknown> | undefined;
  if (!addagent || typeof addagent !== "object") return false;
  const perm = addagent.permission as Record<string, unknown> | undefined;
  if (!perm || typeof perm !== "object") return false;
  let changed = false;
  if (perm.addagent !== "allow") {
    perm.addagent = "allow";
    changed = true;
  }
  if (perm.kick !== "allow") {
    perm.kick = "allow";
    changed = true;
  }
  return changed;
}

export function applyPermissionRepairs(cfg: PermissionRepairTarget): boolean {
  const tawa = ensureTawaToolPermissions(cfg);
  const addagent = ensureAddAgentToolPermissions(cfg);
  return tawa || addagent;
}
