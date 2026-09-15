
import { BLOCKED_TOOLS } from "../security-policy.ts";
import { TAWASSUL_TOOL_NAMES } from "../tool-names.ts";


export function hasUserPermissionRule(permission: Record<string, unknown> | undefined, name: string): boolean {
  if (!permission) return false;
  return Object.keys(permission).some((key) => {
    if (key === name) return true;
    if (!key.includes("*")) return false;
    const re = new RegExp("^" + key.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, ".*") + "$");
    return re.test(name);
  });
}






const SAFE_ONLY_TOOLS = new Set([
  "help",
  "review",
  "status",
  "check",
  "dashboard",
  "timeline",
  "projectmap",
  "depmap",
  "gitdiff",
  "readsymbol",
  "astquery",
  "smartgrep",
  "batchread",
]);

export function getAutoGrantableTools(
  permission?: Record<string, unknown>,
  mode: "all" | "safe-only" | "none" = "all",
): Set<string> {
  if (mode === "none") return new Set();
  const blocked = new Set(BLOCKED_TOOLS);
  const granted = new Set<string>();
  for (const name of TAWASSUL_TOOL_NAMES) {
    if (blocked.has(name)) continue;
    if (hasUserPermissionRule(permission, name)) continue;
    if (mode === "safe-only" && !SAFE_ONLY_TOOLS.has(name)) continue;
    granted.add(name);
  }
  return granted;
}
