import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as matrix from "../src/role-matrix.ts";
import * as policy from "../src/security-policy.ts";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed += 1;
  console.log(`ok ${name}`);
}

function canonical(tools: readonly string[]): string {
  return [...tools].sort().join(",");
}

const ROLE_SNAPSHOT: Record<string, string[]> = {
  addagent: ["addagent", "kick"],
  analyst: [
    "astquery",
    "batchread",
    "depmap",
    "discussion",
    "divide",
    "evaluationreport",
    "evidence",
    "gitdiff",
    "goal",
    "handoff",
    "help",
    "override",
    "panic",
    "projectmap",
    "propose",
    "qualityreport",
    "readsymbol",
    "record",
    "report",
    "review",
    "smartgrep",
    "status",
    "vote",
  ],
  architect: [
    "astquery",
    "batchread",
    "depmap",
    "discussion",
    "divide",
    "evaluationreport",
    "evidence",
    "gitdiff",
    "goal",
    "handoff",
    "help",
    "override",
    "panic",
    "projectmap",
    "propose",
    "qualityreport",
    "readsymbol",
    "record",
    "report",
    "review",
    "smartgrep",
    "status",
    "vote",
  ],
  designer: [
    "astquery",
    "batchread",
    "depmap",
    "discussion",
    "divide",
    "evaluationreport",
    "evidence",
    "gitdiff",
    "goal",
    "handoff",
    "help",
    "override",
    "panic",
    "projectmap",
    "propose",
    "qualityreport",
    "readsymbol",
    "record",
    "report",
    "review",
    "smartgrep",
    "status",
    "vote",
  ],
  dev: [
    "astquery",
    "batchread",
    "check",
    "checkpoint",
    "codestate",
    "dashboard",
    "depmap",
    "directresponse",
    "discussion",
    "divide",
    "evaluationreport",
    "evidence",
    "gitdiff",
    "goal",
    "handoff",
    "health",
    "help",
    "image_route",
    "imagegen",
    "override",
    "panic",
    "pause",
    "projectmap",
    "propose",
    "qualityreport",
    "readsymbol",
    "record",
    "report",
    "resume",
    "review",
    "self_heal",
    "show_board",
    "smartgrep",
    "status",
    "thread",
    "timeline",
    "vote",
    "web",
  ],
  doc: [
    "astquery",
    "batchread",
    "depmap",
    "evaluationreport",
    "evidence",
    "gitdiff",
    "goal",
    "handoff",
    "help",
    "override",
    "panic",
    "projectmap",
    "qualityreport",
    "readsymbol",
    "record",
    "report",
    "review",
    "smartgrep",
    "status",
  ],
  reviewer: [
    "astquery",
    "batchread",
    "depmap",
    "discussion",
    "divide",
    "evaluationreport",
    "evidence",
    "gitdiff",
    "goal",
    "handoff",
    "help",
    "override",
    "panic",
    "projectmap",
    "propose",
    "qualityreport",
    "readsymbol",
    "record",
    "report",
    "review",
    "smartgrep",
    "status",
    "vote",
  ],
  tawa: [
    "astquery",
    "batchread",
    "check",
    "checkpoint",
    "codestate",
    "dashboard",
    "depmap",
    "directresponse",
    "discussion",
    "divide",
    "evaluationreport",
    "evidence",
    "fasttrack",
    "gitdiff",
    "goal",
    "handoff",
    "health",
    "help",
    "image_route",
    "imagegen",
    "moa",
    "override",
    "panic",
    "projectmap",
    "propose",
    "qualityreport",
    "readsymbol",
    "record",
    "report",
    "review",
    "self_heal",
    "show_board",
    "smartgrep",
    "status",
    "task_orchestrate",
    "thread",
    "timeline",
    "vote",
    "web",
  ],
  tester: [
    "astquery",
    "batchread",
    "check",
    "depmap",
    "evaluationreport",
    "evidence",
    "gitdiff",
    "goal",
    "handoff",
    "help",
    "override",
    "panic",
    "projectmap",
    "qualityreport",
    "readsymbol",
    "record",
    "report",
    "review",
    "smartgrep",
    "status",
    "web",
  ],
};

assert(
  Object.keys(matrix.TAWASSUL_TOOL_ROLES).sort().join(",") === Object.keys(ROLE_SNAPSHOT).sort().join(","),
  "the matrix exposes exactly the nine base roles",
);

for (const [role, expected] of Object.entries(ROLE_SNAPSHOT)) {
  assert(canonical(matrix.getAllowedToolsForRole(role)) === canonical(expected), `the ${role} role keeps its exact tool set`);
}

assert(!matrix.getAllowedToolsForRole("tawa").includes("addagent"), "tawa never receives addagent");
assert(!matrix.getAllowedToolsForRole("tawa").includes("kick"), "tawa never receives kick");
assert(!matrix.getAllowedToolsForRole("tawa").includes("pause"), "tawa never receives pause");
assert(!matrix.getAllowedToolsForRole("tawa").includes("resume"), "tawa never receives resume");
assert(matrix.getAllowedToolsForRole("tawa").includes("goal"), "tawa keeps goal");
assert(matrix.getAllowedToolsForRole("tawa").includes("directresponse"), "tawa keeps directresponse");

assert(matrix.getAllowedToolsForRole("dev").includes("handoff"), "dev receives handoff");
assert(matrix.getAllowedToolsForRole("dev").includes("record"), "dev receives record");
assert(matrix.getAllowedToolsForRole("dev").includes("goal"), "dev receives goal");
assert(!matrix.getAllowedToolsForRole("dev").includes("addagent"), "dev never receives addagent");
assert(!matrix.getAllowedToolsForRole("dev").includes("kick"), "dev never receives kick");
assert(!matrix.getAllowedToolsForRole("dev").includes("moa"), "dev never receives moa");
assert(!matrix.getAllowedToolsForRole("dev").includes("task_orchestrate"), "dev never receives task_orchestrate");
assert(!matrix.getAllowedToolsForRole("dev").includes("fasttrack"), "dev never receives fasttrack");

assert(matrix.getAllowedToolsForRole("tester").includes("check"), "tester receives check");
assert(matrix.getAllowedToolsForRole("tester").includes("web"), "tester receives web");
assert(!matrix.getAllowedToolsForRole("tester").includes("discussion"), "tester stays outside discussion");

assert(matrix.getAllowedToolsForRole("analyst").includes("discussion"), "analyst receives discussion");
assert(matrix.getAllowedToolsForRole("analyst").includes("propose"), "analyst receives propose");
assert(matrix.getAllowedToolsForRole("analyst").includes("vote"), "analyst receives vote");
assert(matrix.getAllowedToolsForRole("analyst").includes("divide"), "analyst receives divide");
assert(matrix.getAllowedToolsForRole("analyst").includes("evidence"), "analyst receives evidence");
assert(!matrix.getAllowedToolsForRole("analyst").includes("check"), "analyst never receives check");
assert(!matrix.getAllowedToolsForRole("analyst").includes("web"), "analyst never receives web");

assert(matrix.getAllowedToolsForRole("doc").includes("help"), "doc receives help");
assert(matrix.getAllowedToolsForRole("doc").includes("status"), "doc receives status");
assert(!matrix.getAllowedToolsForRole("doc").includes("check"), "doc never receives check");
assert(!matrix.getAllowedToolsForRole("doc").includes("discussion"), "doc never receives discussion");

assert(canonical(matrix.getAllowedToolsForRole("addagent")) === "addagent,kick", "the addagent role is management-only");
assert(matrix.getAllowedToolsForRole("unknown-role").length === 0, "an unknown role receives no tools");

assert(policy.TAWASSUL_TOOL_ROLES === matrix.TAWASSUL_TOOL_ROLES, "the policy re-exports the same role matrix");
assert(policy.getAllowedToolsForRole === matrix.getAllowedToolsForRole, "the policy re-exports the same lookup function");
assert(policy.SecurityPolicy.checkTawassulToolPermission("dev", "handoff").allowed === true, "the policy allows dev handoff");
assert(policy.SecurityPolicy.checkTawassulToolPermission("tawa", "goal").allowed === true, "the policy allows tawa goal");
assert(policy.SecurityPolicy.checkTawassulToolPermission("dev", "addagent").allowed === false, "the policy denies dev addagent");
assert(
  policy.SecurityPolicy.checkTawassulToolPermission("unknown-role", "handoff").allowed === false,
  "the policy denies an unknown role",
);

const matrixSource = readFileSync(join(repo, "src", "role-matrix.ts"), "utf8");
const matrixImports = matrixSource.split("\n").filter((line) => line.startsWith("import "));
assert(matrixImports.length === 1, "the matrix module has exactly one import");
assert(
  matrixImports[0] === 'import { TAWASSUL_TOOL_NAMES } from "./tool-names.ts";',
  "the matrix module imports only the tool-name list",
);
assert(!/\bt\(/.test(matrixSource), "the matrix module never calls the translation helper");
assert(!/matchRole|stem|nlp|translations|arabic/i.test(matrixSource), "the matrix module has no i18n or NLP token");
assert(!/security-policy/.test(matrixSource), "the matrix module has no dependency cycle");

const policySource = readFileSync(join(repo, "src", "security-policy.ts"), "utf8");
assert(
  policySource.includes('import { TAWASSUL_TOOL_ROLES, getAllowedToolsForRole } from "./role-matrix.ts";'),
  "the policy module imports the matrix module",
);
assert(
  policySource.includes("export { TAWASSUL_TOOL_ROLES, getAllowedToolsForRole };"),
  "the policy module re-exports both matrix symbols",
);

const consumers = [
  "src/core/render-agent.ts",
  "src/scripts/gen-opencode-config.ts",
  "src/tools/agent-add-helpers.ts",
  "src/hooks/guards/shared/limits.ts",
];
for (const file of consumers) {
  const source = readFileSync(join(repo, file), "utf8");
  assert(source.includes("role-matrix.ts"), `${file} imports the matrix module directly`);
  const policyImports = source.split("\n").filter((line) => line.startsWith("import ") && line.includes("security-policy.ts"));
  assert(
    policyImports.every((line) => !/\b(getAllowedToolsForRole|TAWASSUL_TOOL_ROLES)\b/.test(line)),
    `${file} never pulls the matrix through the policy module`,
  );
}

const probe = [
  'require("./src/role-matrix.ts");',
  'const keys = Object.keys(require.cache).map((k) => k.split("\\\\").join("/"));',
  'const banned = keys.filter((k) => /translations|stem|nlp|en\\.json|english-keywords/.test(k));',
  'if (banned.length) { console.error(banned.join(",")); process.exit(1); }',
  'if (!keys.some((k) => k.endsWith("/src/tool-names.ts"))) process.exit(2);',
].join("\n");
const runtime = spawnSync(process.execPath, ["-e", probe], { cwd: repo, encoding: "utf8" });
assert(runtime.status === 0, "loading the matrix module pulls no i18n or NLP module at runtime");
assert((runtime.stdout ?? "").length === 0, "the runtime probe stays silent");

console.log(`PROOF PASS: S-005 role matrix extracted with no i18n or NLP dependency (${passed} assertions)`);
