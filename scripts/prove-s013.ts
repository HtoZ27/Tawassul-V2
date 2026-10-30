import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FeatureIndex } from "../src/services/feature-index.ts";
import { EvaluationTracker } from "../src/services/evaluation-tracker.ts";
import { buildRecordTool } from "../src/tools/record.ts";
import { buildEvaluationReportTool } from "../src/tools/evaluation-report.ts";
import { SecurityPolicy } from "../src/security-policy.ts";
import { TAWASSUL_TOOL_ROLES, getAllowedToolsForRole } from "../src/role-matrix.ts";
import { SYSTEM_CONCORDANCE_TEXT } from "../src/hooks/message-updated.ts";
import { ensureMinimalProjectContract } from "../src/utils/opencode-config.ts";

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

const roles = ["tawa", "dev", "tester", "analyst", "reviewer", "architect", "designer", "doc", "addagent"];
assert(roles.every((role) => role in TAWASSUL_TOOL_ROLES), "the matrix names every base role");
assert(getAllowedToolsForRole("dev").includes("handoff"), "dev receives the handoff tool");
assert(getAllowedToolsForRole("dev").includes("record"), "dev receives the record tool");
assert(!getAllowedToolsForRole("tawa").includes("addagent"), "tawa never receives management tools");
assert(!getAllowedToolsForRole("dev").includes("addagent"), "dev never receives management tools");
assert(getAllowedToolsForRole("addagent").includes("addagent"), "the addagent role owns its tool");
assert(!getAllowedToolsForRole("addagent").includes("handoff"), "the addagent role stays management-only");
assert(getAllowedToolsForRole("unknown-role").length === 0, "an unknown role receives no tools");
assert(SecurityPolicy.checkTawassulToolPermission("dev", "handoff").allowed === true, "the policy allows dev handoff");
assert(SecurityPolicy.checkTawassulToolPermission("tawa", "goal").allowed === true, "the policy allows tawa goal");
assert(SecurityPolicy.checkTawassulToolPermission("dev", "addagent").allowed === false, "the policy denies dev addagent");
assert(SecurityPolicy.checkTawassulToolPermission("unknown-role", "handoff").allowed === false, "the policy denies an unknown role");

const matrixSource = readFileSync(join(repo, "src", "role-matrix.ts"), "utf8");
assert(matrixSource.includes("export const TAWASSUL_TOOL_ROLES"), "the role matrix module is present");
assert(!/\bt\(/.test(matrixSource), "the matrix module never calls the translation helper");
assert(!/matchRole|stem|nlp|translations|arabic/i.test(matrixSource), "the matrix module has no i18n or NLP dependency");

const records: Array<{ id: string; type: string; title: string; detail: string; agent: string; timestamp: string }> = [];
let stale = false;
let recSeq = 0;
const recordCtx = {
  records,
  get recSeq(): number {
    return recSeq;
  },
  set recSeq(value: number) {
    recSeq = value;
  },
  getMaxRecords: () => 5000,
  recordRecordCreated: () => undefined,
  saveState: async () => undefined,
  getSaveHealth: () => ({ stale, failureCount: stale ? 2 : 0 }),
} as never;
const recordTool = buildRecordTool(recordCtx);
const recordAgent = { agent: "dev" } as never;
const written = (await recordTool.execute(
  { type: "note", title: "Read-back record", detail: "stored detail" },
  recordAgent,
)) as { output: string };
assert(written.output.includes("Read-back record"), "a record write reports the stored entry");
const readBack = (await recordTool.execute({ get: "R-001" }, recordAgent)) as { output: string };
assert(readBack.output.includes("Read-back record"), "record(get) reads the stored entry back");
assert(readBack.output.includes("stored detail"), "record(get) returns the stored detail");
const listed = (await recordTool.execute({ list: true }, recordAgent)) as { output: string };
assert(listed.output.includes("R-001"), "record(list) lists the stored entry");
stale = true;
const warned = (await recordTool.execute(
  { type: "fix", title: "Stale record", detail: "memory only", severity: "minor" },
  recordAgent,
)) as { output: string };
assert(warned.output.includes("Persistence warning"), "record writes disclose a stale on-disk save");

const featureIndex = new FeatureIndex();
const feature = featureIndex.register({ name: "Proof feature", description: "S-013 read-back" });
const tracker = new EvaluationTracker(featureIndex);
stale = false;
const evalCtx = {
  featureIndex,
  evaluationTracker: tracker,
  sessionId: "sess-s013",
  saveState: async () => undefined,
  getSaveHealth: () => ({ stale, failureCount: stale ? 3 : 0 }),
} as never;
const evalTool = buildEvaluationReportTool(evalCtx);
const evalAgent = { agent: "tester" } as never;
await evalTool.execute(
  {
    featureId: feature.id,
    issues: [
      {
        severity: "major",
        category: "correctness",
        dedupKey: "s013-readback",
        description: "read-back issue",
        recommendation: "read it back",
      },
    ],
  },
  evalAgent,
);
const evalRead = (await evalTool.execute({ get: true, featureId: feature.id }, evalAgent)) as { output: string };
assert(evalRead.output.includes("read-back issue"), "evaluationreport(get) reads the stored round back");
stale = true;
await evalTool.execute(
  {
    featureId: feature.id,
    issues: [
      {
        severity: "minor",
        category: "maintainability",
        dedupKey: "s013-stale",
        description: "stale issue",
        recommendation: "disclose the save",
      },
    ],
  },
  evalAgent,
);
const evalStale = (await evalTool.execute({ get: true, featureId: feature.id }, evalAgent)) as { output: string };
assert(evalStale.output.includes("stale issue"), "the stale round is still readable from memory");

assert(!existsSync(join(repo, ".opencode", "mcp")), "the v2 tree has no MCP directory");
assert(!existsSync(join(repo, ".opencode", "mcp", "tawassul.mjs")), "the v2 tree ships no MCP entrypoint");
const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
assert(!Object.keys(deps).some((name) => /mcp/i.test(name)), "no MCP package is installed");
const liveConfig = JSON.parse(readFileSync(join(repo, "opencode.json"), "utf8")) as Record<string, unknown>;
assert(!("mcp" in liveConfig), "the live config registers no MCP server");
assert(
  SYSTEM_CONCORDANCE_TEXT.includes("Never search plugin files or the MCP server"),
  "the boundary guidance still deflects MCP hunting",
);

const work = mkdtempSync(join(tmpdir(), "tawassul-s013-"));
const previousNoAuto = process.env.TAWASSUL_NO_AUTOCONFIG;
try {
  delete process.env.TAWASSUL_NO_AUTOCONFIG;
  mkdirSync(join(work, ".opencode", "mcp"), { recursive: true });
  writeFileSync(join(work, ".opencode", "mcp", "tawassul.mjs"), "export default {};\n", "utf-8");
  const contract = await ensureMinimalProjectContract(work, "project");
  assert(contract.created && contract.configPath !== null, "the minimal contract is generated for an empty project");
  const generated = JSON.parse(readFileSync(contract.configPath!, "utf8")) as Record<string, unknown>;
  assert(!("mcp" in generated), "the legacy MCP entrypoint is ignored");
} finally {
  if (previousNoAuto === undefined) delete process.env.TAWASSUL_NO_AUTOCONFIG;
  else process.env.TAWASSUL_NO_AUTOCONFIG = previousNoAuto;
  rmSync(work, { recursive: true, force: true });
}

console.log(`PROOF PASS: role permissions, record/eval read-back, and the absent MCP surface (${passed} assertions)`);
