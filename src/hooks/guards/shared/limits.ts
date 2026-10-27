
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


export const SHELL_TOOL_NAMES = new Set<string>(["bash", "shell"]);

export const CONSENT_TOOLS = new Set<string>(["bash", "shell", "delete", "kick"]);

export function isShellTool(name: string): boolean {
  return SHELL_TOOL_NAMES.has(normalizeToolName(name));
}

export const CONSENT_DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+(\/\s*$|~(\/|\s|$)|(\$HOME|\$\{HOME\})(\/|\s|$)|\/(etc|usr|var|boot)(\/|\s|$)|\/root(\/|\s|$)|\/home\s*$|\/home\/[^/\s]+\s*$)/i,
  /(curl|wget)\s+[^|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i,
  /sudo/,
  /fdisk/,
  /mkfs/,
  /:\(\)\s*\{/,
  /dd\s+if=/,
];

export function requiresConsent(inputTool: string, args: Record<string, unknown>): boolean {
  const tool = normalizeToolName(inputTool);
  if (!CONSENT_TOOLS.has(tool)) return false;
  if (tool === "delete" || tool === "kick") return true;
  if (isShellTool(tool)) {
    const command = typeof args?.command === "string" ? args.command : "";
    return CONSENT_DANGEROUS_PATTERNS.some((p) => p.test(command));
  }
  return false;
}
