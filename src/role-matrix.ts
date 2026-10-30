import { TAWASSUL_TOOL_NAMES } from "./tool-names.ts";

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
