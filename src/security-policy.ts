

import { TAWASSUL_TOOL_NAMES } from "./tool-names.ts";
import { logger } from "./utils/logger.ts";
import { sanitizeOutput, filterEnvKeys } from "./services/privacy.ts";
import { resolveRole } from "./utils/agent.ts";
import { normalizeName, normalizeToolName } from "./utils/name-utils.ts";
import { t } from "./translations.ts";


export const TAWA_AGENT = "tawa";


export const TASK_TOOL_NAMES: readonly string[] = ["task", "handoff", "fasttrack"];



export interface SecurityCheckInput {
  agent: string;
  tool: string;
  args: Record<string, unknown>;
}

export type SecurityCheckResult = { allowed: true } | { allowed: false; error: string; reason: string };

export interface TaskValidationInput {
  
  desc?: string;
  
  type?: string;
  
  prompt?: string;
}

export interface TaskValidationResult {
  allowed: boolean;
  error?: string;
  
  detectedRole?: string;
  
  agentName?: string;
  
  allowedAgents?: string[];
}




export const BLOCKED_TOOLS: readonly string[] = ["edit", "write", "bash", "addagent", "kick", "pause", "resume"];


const ROLE_BLOCKED_TOOLS: Record<string, Set<string>> = {};


const BLOCKED_HANDOFF_ACTIONS: readonly string[] = ["complete", "undo", "rescue", "helpRequest"];


const BLOCKED_FILE_EXTENSIONS =
  /\.(ts|js|tsx|jsx|json|py|rs|go|java|c|cpp|h|rb|php|swift|kt|sh|bash|zsh|bat|yaml|yml|toml|xml|env|vue|svelte)$/;


const ALLOWED_JSON_FILES = /jest\.config\.json$/i;


const SENSITIVE_PATHS = /(\.env(\..*)?|credentials|secrets|\.pem|\.key|\.p12|\.pfx|\.jks|\.keystore|\.secret)$/i;


const SENSITIVE_CONTENT_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*(?:["'][^"']{1,256}["']|\S{8,256})/i,
  /(?:password|passwd|pwd)\s*[:=]\s*(?:["'][^"']{1,256}["']|\S{4,256})/i,
  /(?:secret|token|auth[_-]?token|access[_-]?token)\s*[:=]\s*(?:["'][^"']{1,256}["']|\S{8,256})/i,
  /(?:private[_-]?key)\s*[:=]\s*(?:["'][^"']{1,256}["']|\S{8,256})/i,
  /(?:aws[_-]?access[_-]?key[_-]?id|aws[_-]?secret[_-]?access[_-]?key)\s*[:=]\s*(?:["'][^"']{1,256}["']|\S{8,256})/i,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
];


const ROLE_TO_AGENTS: Record<string, readonly string[]> = {
  dev: ["dev"],
  tester: ["tester"],
  reviewer: ["reviewer"],
  architect: ["architect"],
  analyst: ["analyst"],
  designer: ["designer"],
  doc: ["doc"],
} as const;


export const TASK_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  dev: ["explore", "general"],
  tester: ["explore", "general"],
  
  
  reviewer: ["explore", "general"],
  architect: ["explore", "general"],
  
  analyst: ["explore", "general"],
  designer: ["explore"],
  doc: ["explore"],
} as const;


export const GENERAL_REPORT_ONLY_CALLERS: ReadonlySet<string> = new Set(["analyst", "reviewer", "architect"]);


export const DELETED_AGENTS: ReadonlySet<string> = Object.freeze(
  new Set([
    "dev-north",
    "analyst-north",
    "tester-north",
    "reviewer-north",
    "architect-north",
    "dev-nemotron",
    "analyst-nemotron",
    "tester-nemotron",
    "reviewer-nemotron",
    "architect-nemotron",
    "dev-proxy",
    "analyst-hy3",
    "architect-hy3",
    "dev-hy3",
    "reviewer-hy3",
    "tester-hy3",
    "designer-hy3",
    "doc-hy3",
    "analyst-kimi",
    "architect-kimi",
    "dev-kimi",
    "reviewer-kimi",
    "tester-kimi",
    "designer-kimi",
    "doc-kimi",
  ]),
) as ReadonlySet<string>;


let dynamicDeletedAgents: ReadonlySet<string> = new Set<string>();

export function setDynamicDeletedAgents(agents: ReadonlySet<string> | string[]): void {
  dynamicDeletedAgents = new Set(agents);
}


let userPreservedAgents: ReadonlySet<string> = new Set<string>();

export function setUserPreservedAgents(agents: ReadonlySet<string> | string[]): void {
  userPreservedAgents = new Set(agents);
}


export function pruneUserPreservedAgents(agents: string[] | ReadonlySet<string>): void {
  const next = new Set(userPreservedAgents);
  for (const a of agents) next.delete(normalizeName(a));
  userPreservedAgents = next;
}


import { matchRole } from "./services/stem.ts";
export { matchRole } from "./services/stem.ts";





export class SecurityPolicy {
  
  static enforce(input: SecurityCheckInput): SecurityCheckResult {
    
    if (!input.agent) {
      return {
        allowed: false,
        error: t("spAgentIdReq"),
        reason: "Missing required input.agent field",
      };
    }

    if (!input.tool) {
      return {
        allowed: false,
        error: t("spToolIdReq"),
        reason: "Missing required input.tool field",
      };
    }

    
    const toolName = normalizeToolName(input.tool);
    
    const agentName = normalizeName(input.agent);

    
    if (input.args && typeof input.args !== "object") {
      return {
        allowed: false,
        error: t("spArgsObj"),
        reason: `Invalid args type: ${typeof input.args}`,
      };
    }

    
    const toolBlocked = SecurityPolicy.checkBlockedTools(agentName, toolName);
    if (!toolBlocked.allowed) return toolBlocked;

    
    const handoffBlocked = SecurityPolicy.checkHandoffActions(agentName, toolName, input.args);
    if (!handoffBlocked.allowed) return handoffBlocked;

    
    
    
    const pathBlocked = SecurityPolicy.checkSensitivePath(toolName, input.args);
    if (!pathBlocked.allowed) return pathBlocked;

    const contentBlocked = SecurityPolicy.checkSensitiveContent(toolName, input.args);
    if (!contentBlocked.allowed) return contentBlocked;

    
    const extBlocked = SecurityPolicy.checkBlockedFileExtensions(agentName, toolName, input.args);
    if (!extBlocked.allowed) return extBlocked;

    return { allowed: true };
  }

  

  
  static checkBlockedFileExtensions(agent: string, tool: string, args: Record<string, unknown>): SecurityCheckResult {
    if (tool !== "edit" && tool !== "write") return { allowed: true };
    const a = normalizeName(agent);
    if (a !== "tawa") return { allowed: true };

    const filePath: string = (typeof args.filePath === "string" ? args.filePath : "").toLowerCase();

    if (ALLOWED_JSON_FILES.test(filePath)) return { allowed: true };

    if (BLOCKED_FILE_EXTENSIONS.test(filePath)) {
      return {
        allowed: false,
        error: t("spTawaFileBlocked", { path: filePath }),
        reason: `Blocked @tawa from editing ${filePath}`,
      };
    }
    return { allowed: true };
  }

  
  static checkBlockedTools(agent: string, tool: string): SecurityCheckResult {
    const a = normalizeName(agent);
    const baseRole = resolveRole(a) ?? a;

    if (a === "tawa" && BLOCKED_TOOLS.includes(tool)) {
      return {
        allowed: false,
        error: t("spTawaBlocked"),
        reason: `Blocked @tawa from using ${tool}`,
      };
    }

    const roleBlocked = ROLE_BLOCKED_TOOLS[baseRole];
    if (roleBlocked?.has(tool)) {
      return {
        allowed: false,
        error: t("spRoleBlocked", { role: baseRole, tool }),
        reason: `Blocked @${baseRole} from using ${tool}`,
      };
    }
    return { allowed: true };
  }

  
  static checkHandoffActions(agent: string, tool: string, args: Record<string, unknown>): SecurityCheckResult {
    const a = normalizeName(agent);
    if (a === "tawa" && tool === "handoff") {
      const action = SecurityPolicy.extractHandoffAction(args);
      if (BLOCKED_HANDOFF_ACTIONS.includes(action)) {
        return {
          allowed: false,
          error: t("spTawaHandoffBlocked", { action }),
          reason: `Blocked @tawa from handoff action: ${action}`,
        };
      }
    }
    return { allowed: true };
  }

  
  private static extractHandoffAction(args: Record<string, unknown>): string {
    if (args.completeHandoff) return "complete";
    if (args.undo) return "undo";
    if (args.rescue) return "rescue";
    if (args.helpRequest) return "helpRequest";
    if (args.to && args.task && args.context) return "create";
    return "unknown";
  }

  
  static checkSensitivePath(tool: string, args: Record<string, unknown>): SecurityCheckResult {
    if (tool !== "edit" && tool !== "write") return { allowed: true };
    const candidates: string[] = [];
    if (typeof args.filePath === "string") candidates.push(args.filePath);
    if (typeof args.path === "string") candidates.push(args.path);
    if (typeof args.file === "string") candidates.push(args.file);
    if (Array.isArray(args.files)) {
      for (const f of args.files) if (typeof f === "string") candidates.push(f);
    }
    if (Array.isArray(args.paths)) {
      for (const f of args.paths) if (typeof f === "string") candidates.push(f);
    }
    for (const raw of candidates) {
      const filePath = raw.toLowerCase();
      if (SENSITIVE_PATHS.test(filePath)) {
        return {
          allowed: false,
          error: t("spSensitivePath", { path: raw }),
          reason: `Blocked sensitive path: ${raw}`,
        };
      }
    }
    return { allowed: true };
  }

  
  private static _collectStrings(value: unknown, out: string[], depth = 0, max = 200): void {
    if (out.length >= max || depth > 6) return;
    if (typeof value === "string") {
      out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) this._collectStrings(v, out, depth + 1, max);
    } else if (value && typeof value === "object") {
      
      
      
      
      let vals: unknown[];
      try {
        vals = Object.values(value as Record<string, unknown>);
      } catch {
        return;
      }
      for (const v of vals) this._collectStrings(v, out, depth + 1, max);
    }
  }

  
  static checkSensitiveContent(tool: string, args: Record<string, unknown>): SecurityCheckResult {
    if (tool !== "edit" && tool !== "write") return { allowed: true };
    const strings: string[] = [];
    SecurityPolicy._collectStrings(args, strings);
    for (const content of strings) {
      for (const pattern of SENSITIVE_CONTENT_PATTERNS) {
        if (pattern.test(content)) {
          return {
            allowed: false,
            error: t("spSensitiveContent"),
            
            
            reason: `Blocked sensitive content matching a protected pattern`,
          };
        }
      }
    }
    return { allowed: true };
  }

  

  
  static validateTaskRouting(input: TaskValidationInput): TaskValidationResult {
    const desc = (input.desc || "").toLowerCase();
    const type = (input.type || "").toLowerCase();
    const prompt = (input.prompt || "").toLowerCase();

    
    const agentName = normalizeName(desc);

    
    if (type && desc) {
      const allowedAgents = ROLE_TO_AGENTS[type];
      if (allowedAgents) {
        const resolvedRole = resolveRole(agentName);
        const isAllowed = allowedAgents.some((a) => agentName === a || resolvedRole === a);
        if (!isAllowed) {
          logger.debug(
            `validateTaskRouting: BLOCKED type="${type}", agent="${agentName}", allowed=[${allowedAgents.join(",")}]`,
          );
          return {
            allowed: false,
            error: t("spRoleMismatch", { type, agent: desc, allowed: allowedAgents.join(", ") }),
            detectedRole: type,
            agentName,
            allowedAgents: [...allowedAgents],
          };
        }
        logger.debug(`validateTaskRouting: OK type="${type}", agent="${agentName}"`);
        return { allowed: true, detectedRole: type };
      }
    }

    
    if (!type && prompt) {
      const detectedRole = matchRole(prompt).role;
      if (detectedRole && agentName) {
        const allowedAgents = ROLE_TO_AGENTS[detectedRole];
        if (allowedAgents) {
          const resolvedRole = resolveRole(agentName);
          const isAllowed = allowedAgents.some((a) => agentName === a || resolvedRole === a);
          if (!isAllowed) {
            logger.debug(
              `validateTaskRouting: WARN keyword-mismatch detectedRole="${detectedRole}", agent="${agentName}", suggested="${allowedAgents[0]}"`,
            );
          } else {
            logger.debug(`validateTaskRouting: OK algorithmic-detected role="${detectedRole}", agent="${agentName}"`);
          }
        }
      }
    }

    
    if (agentName) {
      const deleted =
        (DELETED_AGENTS.has(agentName) || dynamicDeletedAgents.has(agentName)) && !userPreservedAgents.has(agentName);
      if (deleted) {
        logger.debug(`validateTaskRouting: BLOCKED deleted agent="${agentName}"`);
        return {
          allowed: false,
          error: t("spDeletedAgent", { agent: desc }),
          detectedRole: type || undefined,
          agentName,
        };
      }
    }

    return { allowed: true, detectedRole: type || undefined };
  }

  static checkDeletedAgent(agentName: string): boolean {
    const normalized = normalizeName(agentName);
    if (userPreservedAgents.has(normalized)) return false;
    return DELETED_AGENTS.has(normalized) || dynamicDeletedAgents.has(normalized);
  }

  
  static checkTawassulToolPermission(agent: string, tool: string): SecurityCheckResult {
    const a = normalizeName(agent);
    const baseRole = resolveRole(a) ?? a;
    const permission = TAWASSUL_TOOL_ROLES[baseRole];
    
    const bareTool = normalizeToolName(tool);
    
    if (!permission) {
      const knownRoles = Object.keys(TAWASSUL_TOOL_ROLES).join(", ");
      return {
        allowed: false,
        error: t("spUnknownRole", { role: baseRole, tool: bareTool, roles: knownRoles }),
        reason: `Unknown role ${baseRole} blocked from tool ${bareTool}`,
      };
    }
    if (permission === "*") return { allowed: true };
    if (permission.has(bareTool) || permission.has("*")) return { allowed: true };
    const allowedTools = getAllowedToolsForRole(baseRole);
    return {
      allowed: false,
      error: t("spToolNotAllowed", {
        tool: bareTool,
        role: baseRole,
        allowed: allowedTools.join(", ") || t("spNoTools"),
      }),
      reason: `Blocked tool ${bareTool} for role ${baseRole}`,
    };
  }

  
  static sanitizeOutput(text: string): string {
    return sanitizeOutput(text);
  }

  
  static filterEnvKeys(env: Record<string, string | undefined>): Record<string, string> {
    return filterEnvKeys(env);
  }
}


const MANAGEMENT_TOOLS = new Set(["kick", "addagent"]);
const ALL_TAWASSUL_TOOLS = new Set(TAWASSUL_TOOL_NAMES);








const DISPATCH_TOOLS = new Set(["moa", "task_orchestrate", "fasttrack"]);


const READ_ONLY_TOOLS = new Set([
  "readsymbol",
  "batchread",
  "smartgrep",
  "projectmap",
  "gitdiff",
  "depmap",
  "astquery",
  "evidence",
  "report",
  "review",
  "qualityreport",
  "record",
  "goal",
  "help",
  "handoff",
  "status",
  "panic",
  "override",
  "evaluationreport",
]);

const DISCUSSION_TOOLS = new Set(["discussion", "propose", "vote", "divide", "evidence"]);

const VERIFY_TOOLS = new Set([...READ_ONLY_TOOLS, "check", "web"]);


const STANDARD_TOOLS = new Set(
  [...ALL_TAWASSUL_TOOLS].filter((t) => !MANAGEMENT_TOOLS.has(t) && !DISPATCH_TOOLS.has(t)),
);

const DOC_TOOLS = new Set([...READ_ONLY_TOOLS, "help", "status"]);


export const TAWASSUL_TOOL_ROLES: Record<string, Set<string> | "*"> = {
  
  tawa: new Set([...ALL_TAWASSUL_TOOLS].filter((t) => !MANAGEMENT_TOOLS.has(t) && !["pause", "resume"].includes(t))),
  
  dev: STANDARD_TOOLS,
  
  tester: VERIFY_TOOLS,
  
  analyst: new Set([...READ_ONLY_TOOLS, ...DISCUSSION_TOOLS]),
  
  reviewer: new Set([...READ_ONLY_TOOLS, ...DISCUSSION_TOOLS]),
  
  architect: new Set([...READ_ONLY_TOOLS, ...DISCUSSION_TOOLS]),
  
  designer: new Set([...READ_ONLY_TOOLS, ...DISCUSSION_TOOLS]),
  
  doc: DOC_TOOLS,
  
  addagent: new Set(["addagent", "kick"]),
};


export function getAllowedToolsForRole(role: string): string[] {
  const p = TAWASSUL_TOOL_ROLES[role];
  if (!p) return [];
  if (p === "*") return [...TAWASSUL_TOOL_NAMES];
  return [...p];
}

export default SecurityPolicy;
