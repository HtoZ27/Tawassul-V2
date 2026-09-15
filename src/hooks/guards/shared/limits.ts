
import { TAWASSUL_TOOL_NAMES } from "../../../tool-names.ts";
import { TAWASSUL_TOOL_ROLES } from "../../../security-policy.ts";
import { normalizeToolName } from "../../../utils/name-utils.ts";


export const ALL_TAWASSUL_TOOLS = new Set(TAWASSUL_TOOL_NAMES);



export const PAUSE_BYPASS_TOOLS = new Set(["resume", "status"]);

export let MAX_CALL_DEPTH = 3;
export let MAX_TOTAL_TASKS = 25;
export const setMaxCallDepth = (n: number) => {
  if (n > 0) MAX_CALL_DEPTH = n;
};
export const setMaxTotalTasks = (n: number) => {
  if (n > 0) MAX_TOTAL_TASKS = n;
};

export function isTawassulTool(name: string): boolean {
  return ALL_TAWASSUL_TOOLS.has(normalizeToolName(name));
}

export const TAWASSUL_ROLES = Object.keys(TAWASSUL_TOOL_ROLES);


export const CONSENT_TOOLS = new Set<string>(["bash", "delete", "kick"]);

export const CONSENT_DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /git\s+push/,
  /git\s+push\s+\S+\s+--force/,
  /sudo/,
  /fdisk/,
  /mkfs/,
  /:\(\)\s*\{/,
  /dd\s+if=/,
];

export function requiresConsent(inputTool: string, args: Record<string, unknown>): boolean {
  if (!CONSENT_TOOLS.has(inputTool)) return false;
  if (inputTool === "delete" || inputTool === "kick") return true;
  if (inputTool === "bash") {
    const command = typeof args?.command === "string" ? args.command : "";
    return CONSENT_DANGEROUS_PATTERNS.some((p) => p.test(command));
  }
  return false;
}
