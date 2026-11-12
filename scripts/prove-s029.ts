import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildAddAgentTool, buildKickTool, computePinEntries, formatAddResult } from "../src/tools/agent-management.ts";
import type { TawassulContext } from "../src/context.ts";
import type { ToolContext, ToolResult } from "../src/tool.ts";
import { defaultAgentModelForRole } from "../src/services/proxy-fallback-chains.ts";
import { sameRoleDistributionGuard, deletedAgentGuard } from "../src/hooks/guards/dispatch-guards.ts";
import { isKnownDynamicAgent } from "../src/scripts/gen-opencode-config.ts";
import {
  buildAgents,
} from "../src/scripts/gen-opencode-config.ts";
import { setDynamicDeletedAgents } from "../src/security-policy.ts";
import type { Ctx, Input, StageOutput } from "../src/hooks/guards/shared/types.ts";

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`PROOF FAIL: ${msg}`);
    process.exit(1);
  }
  passed++;
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function toolOutput(result: ToolResult): string {
  return typeof result === "string" ? result : result.output;
}

const out1 = computePinEntries(
  ["analyst-fledge", "analyst-longcat", "analyst-ling-3.1-flash-free"],
  new Set(),
  "opencode/anything",
);
assert(
  eq(out1, [
    { name: "analyst-fledge", pinned: true },
    { name: "analyst-longcat", pinned: true },
    { name: "analyst-ling-3.1-flash-free", pinned: true },
  ]),
  "variants pin always as the explicit model choice",
);
const head = defaultAgentModelForRole("analyst");
assert(eq(computePinEntries(["analyst"], new Set(), head), [{ name: "analyst", pinned: false }]), "base role on-head unpins");
assert(
  eq(computePinEntries(["analyst"], new Set(), "someone/else-1"), [{ name: "analyst", pinned: true }]),
  "base role off-head pins",
);
const out2 = computePinEntries(["analyst-fledge", "dev"], new Set(["@dev"]), "opencode/x");
assert(eq(out2, [{ name: "analyst-fledge", pinned: true }]), "errored specs excluded");
assert(eq(computePinEntries(["xyzzy"], new Set(), "opencode/x"), []), "non-agent names excluded");
const skipped = formatAddResult({ added: [], skipped: ["analyst"], errors: [], warnings: ["pins exploded"] });
assert(skipped.includes("pins exploded"), "all-skipped still surfaces warnings");
const mixed = formatAddResult({
  added: [],
  skipped: ["@analyst"],
  errors: [],
  quiet: ["@analyst"],
  updated: [{ tag: "@dev", prev: "opencode/x", curr: "opencode/y" }],
});
assert(mixed.includes("@dev") && mixed.includes("→"), "mixed quiet-skip + update announces the update");
assert(!mixed.includes("All agents already exist"), "mixed batch is not reported as all-skipped");

const ctx = {} as unknown as Ctx;
function handoffTo(to: string): { input: Input; output: StageOutput } {
  return {
    input: { tool: "handoff", agent: "dev" } as unknown as Input,
    output: { args: { to } } as unknown as StageOutput,
  };
}
{
  setDynamicDeletedAgents(["dev-ling"]);
  const { input, output } = handoffTo("dev-ling");
  assert(await sameRoleDistributionGuard.check(ctx, input, output), "deleted target skipped by distribution guard");
  const d = handoffTo("dev-ling");
  assert(!(await deletedAgentGuard.check(ctx, d.input, d.output)), "deleted target refused by deleted-agent guard");
  assert(String((d.output as { error?: unknown }).error ?? "").includes("deleted"), "refusal names deletion, not specialty");
}
{
  const { input, output } = handoffTo("dev-mimo");
  assert(!(await sameRoleDistributionGuard.check(ctx, input, output)), "live same-specialty target still refused");
  assert(
    String((output as { error?: unknown }).error ?? "").includes("same specialty"),
    "live refusal keeps the specialty message",
  );
}

assert(isKnownDynamicAgent("analyst-ling-3.1-flash-free"), "dotted provider suffix accepted");
assert(isKnownDynamicAgent("analyst-ling"), "plain suffix accepted");
assert(!isKnownDynamicAgent("analyst-evil!"), "invalid characters rejected");
assert(!isKnownDynamicAgent("analyst"), "base name without suffix rejected");
assert(buildAgents()["analyst-ling"] !== undefined, "default generation keeps every variant");

const root = mkdtempSync(join(tmpdir(), "s029-"));
function runLoggerChild(extraEnv: Record<string, string>, dropKeys: string[] = []): number {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !dropKeys.includes(k)) env[k] = v;
  }
  Object.assign(env, extraEnv);
  const script = `import { logger } from "./src/utils/logger.ts"; logger.warn("s029-probe"); await new Promise((r) => setTimeout(r, 600));`;
  const res = spawnSync("bun", ["-e", script], { env, stdio: "ignore" });
  return res.status ?? 1;
}
{
  const custom = join(root, "custom.log");
  assert(runLoggerChild({ TAWASSUL_LOG_FILE: custom }) === 0, "logger child exits clean with custom path");
  assert(existsSync(custom) && readFileSync(custom, "utf8").includes("s029-probe"), "custom log path receives the probe");
}
{
  const home = join(root, "fakehome");
  assert(runLoggerChild({ HOME: home }, ["TAWASSUL_LOG_FILE", "XDG_DATA_HOME"]) === 0, "logger child exits clean with default path");
  const def = join(home, ".local", "share", "tawassul-v2", "tawassul", "tawassul.log");
  assert(existsSync(def) && readFileSync(def, "utf8").includes("s029-probe"), "default-on v2 path receives the probe");
}
{
  const data = join(root, "plain-data");
  assert(runLoggerChild({ XDG_DATA_HOME: data }, ["TAWASSUL_LOG_FILE"]) === 0, "logger child exits clean with XDG data");
  const def = join(data, "tawassul-v2", "tawassul", "tawassul.log");
  assert(existsSync(def) && readFileSync(def, "utf8").includes("s029-probe"), "XDG data home namespaces the log once");
}
{
  const profile = join(root, "profile", "tawassul-v2");
  assert(runLoggerChild({ XDG_DATA_HOME: profile }, ["TAWASSUL_LOG_FILE"]) === 0, "logger child exits clean in the v2 profile");
  const def = join(profile, "tawassul", "tawassul.log");
  assert(existsSync(def) && readFileSync(def, "utf8").includes("s029-probe"), "v2 profile log is not double-nested");
}
{
  const home = join(root, "fakehome2");
  assert(runLoggerChild({ TAWASSUL_LOG_FILE: "", HOME: home }, ["XDG_DATA_HOME"]) === 0, "logger child exits clean when opted out");
  assert(!existsSync(join(home, ".local", "share", "tawassul-v2", "tawassul", "tawassul.log")), "empty variable opts the sink out");
}

{
  const projectDir = mkdtempSync(join(tmpdir(), "s029-noconfig-"));
  const savedModelsEnv = process.env.TAWASSUL_MODELS_JSON;
  try {
    delete process.env.TAWASSUL_MODELS_JSON;
    const noconfigCtx = {
      config: { team: [] },
      dynamicAgents: [],
      agentModelMap: {},
      stateDir: projectDir,
      agentManager: {
        hasConfigAgent: () => false,
        clearReadCache: () => undefined,
        writeAgentMd: async () => undefined,
      },
      askChannelInstance: {
        hasPending: () => false,
        askForRoot: async () => false,
        currentSessionOverride: undefined,
      },
      saveState: () => undefined,
      modelManager: { markModelFailed: () => undefined },
    } as unknown as TawassulContext;
    const toolCtx = {
      sessionID: "s029-noconfig-session",
      messageID: "s029-noconfig-message",
      agent: "",
      directory: projectDir,
      worktree: projectDir,
      abort: new AbortController().signal,
      metadata: () => undefined,
      ask: async () => undefined,
    } as unknown as ToolContext;
    const addText = toolOutput(
      await buildAddAgentTool(noconfigCtx).execute(
        { name: "dev-ling with model ling-3.0-flash-fin-free from opencode" },
        toolCtx,
      ),
    );
    assert(addText.includes("refusing to write"), "a project add without a config refuses to write");
    assert(!addText.includes("Added"), "a refused project add is not reported as added");
    assert(!existsSync(join(projectDir, "opencode.json")), "a refused project add creates no config");
    const kickText = toolOutput(
      await buildKickTool(noconfigCtx).execute(
        { agent: "remove dev-ling with model ling-3.0-flash-fin-free from opencode" },
        toolCtx,
      ),
    );
    assert(kickText.includes("project config is missing"), "a project kick without a config refuses to write");
    assert(!kickText.includes("Removed"), "a refused project kick is not reported as removed");
  } finally {
    if (savedModelsEnv === undefined) delete process.env.TAWASSUL_MODELS_JSON;
    else process.env.TAWASSUL_MODELS_JSON = savedModelsEnv;
    rmSync(projectDir, { recursive: true, force: true });
  }
}

{
  const repo = dirname(dirname(fileURLToPath(import.meta.url)));
  const globalDir = mkdtempSync(join(tmpdir(), "s029-global-"));
  const configPath = join(globalDir, "opencode.jsonc");
  const rosterPath = join(globalDir, "tawassul.jsonc");
  const configBody =
    '{\n  "$schema": "https://opencode.ai/config.json",\n  "model": "opencode/big-pickle"\n}\n';
  writeFileSync(configPath, configBody);
  writeFileSync(rosterPath, '{\n  "agents": {}\n}\n');
  const childSource = `
import { buildAddAgentTool, buildKickTool } from ${JSON.stringify(join(repo, "src", "tools", "agent-management.ts"))};

const dir = process.env.TAWASSUL_PROOF_DIR as string;
const mode = process.env.TAWASSUL_PROOF_MODE;
const ctx = {
  config: { team: [] },
  dynamicAgents: [],
  agentModelMap: {},
  agentRatings: {},
  errorManager: { agentErrors: {} },
  seenAgents: new Map(),
  handoffs: new Map(),
  stateDir: dir,
  agentManager: {
    hasConfigAgent: () => false,
    clearReadCache: () => undefined,
    writeAgentMd: async () => undefined,
  },
  askChannelInstance: { hasPending: () => false, askForRoot: async () => false, currentSessionOverride: undefined },
  saveState: () => undefined,
  modelManager: { markModelFailed: () => undefined },
} as never;
const cctx = {
  sessionID: "s029-global-session",
  messageID: "s029-global-message",
  agent: "",
  directory: dir,
  worktree: dir,
  abort: new AbortController().signal,
  metadata: () => undefined,
  ask: async () => undefined,
} as never;
const out =
  mode === "add"
    ? await buildAddAgentTool(ctx).execute(
        { name: "dev-ling with model ling-3.0-flash-fin-free from opencode" },
        cctx,
      )
    : await buildKickTool(ctx).execute(
        { agent: "remove dev-ling with model ling-3.0-flash-fin-free from opencode" },
        cctx,
      );
const text = typeof out === "string" ? out : out.output;
console.log(text);
`;
  const childPath = join(root, "s029-global-child.ts");
  writeFileSync(childPath, childSource);
  const runChild = (mode: "add" | "kick"): { code: number; out: string } => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env.TAWASSUL_SCOPE = "global";
    env.TAWASSUL_GLOBAL_DIR = globalDir;
    env.TAWASSUL_PROOF_DIR = globalDir;
    env.TAWASSUL_PROOF_MODE = mode;
    env.TAWASSUL_LOG_FILE = join(root, `s029-global-${mode}.log`);
    const res = spawnSync("bun", [childPath], { env, encoding: "utf-8" });
    return { code: res.status ?? 1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
  };
  try {
    const add = runChild("add");
    assert(add.code === 0, `a global add child exits clean (${add.out.trim().slice(-200)})`);
    assert(add.out.includes("Added"), "a global add reports the addition");
    const afterAdd = JSON.parse(readFileSync(rosterPath, "utf-8")) as { agents?: Record<string, unknown> };
    assert(afterAdd.agents?.["dev-ling"] !== undefined, "a global add writes the roster to tawassul.jsonc");
    assert(readFileSync(configPath, "utf-8") === configBody, "a global add leaves global opencode.jsonc byte-identical");
    assert(!existsSync(join(globalDir, "opencode.json")), "a global add creates no global opencode.json");
    const kick = runChild("kick");
    assert(kick.code === 0, `a global kick child exits clean (${kick.out.trim().slice(-200)})`);
    assert(kick.out.includes("Removed"), "a global kick reports the removal");
    const afterKick = JSON.parse(readFileSync(rosterPath, "utf-8")) as {
      agents?: Record<string, unknown>;
      deleted?: unknown;
    };
    assert(afterKick.agents?.["dev-ling"] === undefined, "a global kick drops the roster entry from tawassul.jsonc");
    assert(
      Array.isArray(afterKick.deleted) && afterKick.deleted.includes("dev-ling"),
      "a global kick records the deletion in tawassul.jsonc",
    );
    assert(readFileSync(configPath, "utf-8") === configBody, "a global kick leaves global opencode.jsonc byte-identical");
    assert(!existsSync(join(globalDir, "opencode.json")), "a global kick creates no global opencode.json");
  } finally {
    rmSync(globalDir, { recursive: true, force: true });
  }
}

console.log(`PROOF PASS: s029 pins, dispatch precedence, dynamic suffix, log default, retire census (${passed} assertions)`);