import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAgents,
  buildExpectedConfig,
  buildMergedAgents,
  checkGeneratedConfig,
} from "../src/scripts/gen-opencode-config.ts";
import { buildKickTool } from "../src/tools/agent-management.ts";
import { RETIRED_MODEL_IDS, MODEL_SUFFIX_MAP } from "../src/core/variant-names.ts";
import { SecurityPolicy, setDynamicDeletedAgents, setUserPreservedAgents } from "../src/security-policy.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const BASE_AGENTS = ["tawa", "dev", "analyst", "tester", "reviewer", "architect", "designer", "doc"];

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

const modelsDir = mkdtempSync(join(tmpdir(), "tawassul-gen-models-"));
const savedModelsEnv = process.env.TAWASSUL_MODELS_JSON;
function writeFixture(name: string, body: unknown): string {
  const path = join(modelsDir, name);
  writeFileSync(path, JSON.stringify(body), "utf-8");
  return path;
}
const absentFixture = writeFixture("absent.json", {
  opencode: { models: {} },
  "cloudflare-workers-ai": { models: {} },
});
const servedFixture = writeFixture("served.json", {
  opencode: { models: { "mimo-v2.5-free": {} } },
  "cloudflare-workers-ai": { models: { "@cf/moonshotai/kimi-k2.7-code": {} } },
});
const unknownFixture = writeFixture("unknown.json", { "cloudflare-workers-ai": { models: {} } });
const emptyPins = writeFixture("pins-empty.json", { pinned: [] });
const devPins = writeFixture("pins-dev.json", { pinned: ["dev"] });

function liveConfig(): { agent: Record<string, { model?: string }> } {
  return JSON.parse(readFileSync(join(REPO, "opencode.json"), "utf-8")) as {
    agent: Record<string, { model?: string }>;
  };
}

async function proveRetiredMigration(): Promise<void> {
  if (RETIRED_MODEL_IDS.size === 0) fail("retired set is empty");
  process.env.TAWASSUL_MODELS_JSON = absentFixture;
  let n = 0;
  for (const retired of RETIRED_MODEL_IDS) {
    const raw = JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      subagent_depth: 3,
      agent: {
        "dev-gemini": {
          description: "Developer — stale",
          model: retired,
          mode: "subagent",
          permission: { edit: "allow", bash: "deny" },
        },
      },
    });
    const merged = buildMergedAgents(raw, { projectRoot: REPO });
    const got = (merged["dev-gemini"] as { model?: string } | undefined)?.model;
    if (got !== MODEL_SUFFIX_MAP["gemini"]) {
      fail(`retired ${retired} did not migrate (got ${String(got)})`);
    }
    n++;
  }
  console.log(`A3 ok (${n} retired ids migrate)`);
}

async function proveHybridPins(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-hybrid-"));
  try {
    mkdirSync(join(dir, ".opencode", "agents"), { recursive: true });
    for (const name of BASE_AGENTS) {
      copyFileSync(join(REPO, ".opencode", "agents", `${name}.md`), join(dir, ".opencode", "agents", `${name}.md`));
    }
    const live = liveConfig();
    live.agent["analyst"] = { ...live.agent["analyst"], model: "someone/else-1" };
    const raw = JSON.stringify({ $schema: "https://opencode.ai/config.json", agent: live.agent });
    const noPins = join(dir, "pins-empty.json");
    writeFileSync(noPins, JSON.stringify({ pinned: [] }), "utf-8");
    const refused = checkGeneratedConfig(raw, { projectRoot: dir, pinsPath: noPins });
    if (refused.ok) fail("unpinned drift passed check");
    if (!(refused.diff ?? "").includes("pins sidecar")) fail("unpinned drift message missing pins sidecar hint");
    console.log("A5-hybrid unpinned-drift-fails ok");
    const withPins = join(dir, "pins-analyst.json");
    writeFileSync(withPins, JSON.stringify({ pinned: Object.keys(live.agent) }), "utf-8");
    const allowed = checkGeneratedConfig(raw, { projectRoot: dir, pinsPath: withPins });
    if (!allowed.ok) fail(`pinned drift must pass: ${allowed.diff ?? ""}`);
    console.log("A5-hybrid pinned-drift-passes ok");
    const absent = checkGeneratedConfig(undefined, { projectRoot: dir });
    if (!absent.ok || !absent.missing) fail("a missing project config must pass as nothing to compare");
    console.log("A5-hybrid missing-config-passes ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function subsetConfig(): { agent: Record<string, { model?: string }> } {
  const live = liveConfig();
  const agent: Record<string, { model?: string }> = {};
  for (const name of [...BASE_AGENTS, "addagent"]) {
    agent[name] = live.agent[name]!;
  }
  return { agent };
}

function proveEmptyAndSubset(): void {
  const emptyRaw = JSON.stringify({ $schema: "https://opencode.ai/config.json", agent: {} });
  const emptyMerged = buildMergedAgents(emptyRaw, { projectRoot: REPO });
  const emptyCount = Object.keys(emptyMerged).length;
  if (emptyCount !== 16) fail(`an empty agent container must yield 16, got ${emptyCount}`);
  const subset = subsetConfig();
  const subsetRaw = JSON.stringify({ $schema: "https://opencode.ai/config.json", agent: subset.agent });
  const subsetMerged = buildMergedAgents(subsetRaw, { projectRoot: REPO });
  const subsetNames = Object.keys(subsetMerged).sort();
  const expected = [...BASE_AGENTS, "addagent"].sort();
  if (JSON.stringify(subsetNames) !== JSON.stringify(expected)) {
    fail(`a subset config must keep only its own keys, got ${subsetNames.join(", ")}`);
  }
  console.log("empty-container-and-subset ok");
}

function proveNonObjectAgent(): void {
  const raw = JSON.stringify({ $schema: "https://opencode.ai/config.json", agent: [] });
  let threw = false;
  try {
    buildMergedAgents(raw, { projectRoot: REPO });
  } catch (e) {
    threw = String((e as Error).message).includes("agent must be an object");
  }
  if (!threw) fail("a non-object agent container must throw in buildMergedAgents");
  const check = checkGeneratedConfig(raw, { projectRoot: REPO });
  if (check.ok || check.diff !== "agent must be an object") {
    fail(`a non-object agent container must be reported verbatim, got ${String(check.diff)}`);
  }
  console.log("non-object-agent ok");
}

async function proveKickOmission(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-kick-omission-"));
  try {
    const emptyRaw = JSON.stringify({ $schema: "https://opencode.ai/config.json", agent: {} });
    const seeded = buildMergedAgents(emptyRaw, { projectRoot: REPO });
    const withVariant: Record<string, unknown> = {
      ...seeded,
      "dev-ling": { description: "Developer ling", model: "opencode/ling-3.0-flash-fin-free", mode: "subagent" },
    };
    const configPath = join(dir, "opencode.json");
    const preKickRaw = JSON.stringify({ $schema: "https://opencode.ai/config.json", agent: withVariant });
    writeFileSync(configPath, preKickRaw);
    const before = buildExpectedConfig(preKickRaw, { projectRoot: REPO });
    if (!("dev-ling" in (JSON.parse(before) as { agent: Record<string, unknown> }).agent)) {
      fail("the kick fixture must start with dev-ling");
    }
    const ctx = {
      config: { team: [] },
      dynamicAgents: [],
      agentRatings: {},
      agentModelMap: {},
      errorManager: { agentErrors: {} },
      seenAgents: new Map(),
      handoffs: new Map(),
      stateDir: dir,
      agentManager: { hasConfigAgent: () => true, clearReadCache: () => undefined },
      askChannelInstance: {
        hasPending: () => false,
        askForRoot: async () => false,
        currentSessionOverride: undefined,
      },
      saveState: () => undefined,
      modelManager: { markModelFailed: () => undefined },
    } as never;
    const toolCtx = {
      sessionID: "kick-omission-session",
      messageID: "kick-omission-message",
      agent: "",
      directory: dir,
      worktree: dir,
      abort: new AbortController().signal,
      metadata: () => undefined,
      ask: async () => undefined,
    } as never;
    const result = (await buildKickTool(ctx).execute(
      { agent: "remove dev-ling with model ling-3.0-flash-fin-free from opencode" },
      toolCtx,
    )) as { output: string };
    if (!result.output.includes("Removed") || !result.output.includes("@dev-ling")) {
      fail(`the kick must report the removal, got ${result.output}`);
    }
    const kickedRaw = readFileSync(configPath, "utf-8");
    const kickedConfig = JSON.parse(kickedRaw) as { agent: Record<string, unknown> };
    if ("dev-ling" in kickedConfig.agent) fail("the kick must remove dev-ling from the config");
    if (!SecurityPolicy.checkDeletedAgent("dev-ling")) {
      fail("a removed ad-hoc variant must be recorded as deleted so the roster is not treated as truncated");
    }
    const first = JSON.parse(buildExpectedConfig(kickedRaw, { projectRoot: REPO })) as {
      agent: Record<string, unknown>;
    };
    const second = JSON.parse(buildExpectedConfig(kickedRaw, { projectRoot: REPO })) as {
      agent: Record<string, unknown>;
    };
    if ("dev-ling" in first.agent || "dev-ling" in second.agent) {
      fail("both post-kick generations must omit dev-ling");
    }
    console.log("kick-omission ok");
  } finally {
    setDynamicDeletedAgents([]);
    setUserPreservedAgents([]);
    rmSync(dir, { recursive: true, force: true });
  }
}

function proveServedRetired(): void {
  process.env.TAWASSUL_MODELS_JSON = servedFixture;
  const config = subsetConfig();
  config.agent["dev"] = { ...config.agent["dev"], model: "opencode/mimo-v2.5-free" };
  config.agent["addagent"] = { ...config.agent["addagent"], model: "opencode/mimo-v2.5-free" };
  const raw = JSON.stringify({ $schema: "https://opencode.ai/config.json", agent: config.agent });
  const merged = buildMergedAgents(raw, { projectRoot: REPO, pinsPath: emptyPins });
  if (merged["dev"]?.model !== "opencode/mimo-v2.5-free") fail("a served retired dev model must be kept");
  if (merged["addagent"]?.model !== "opencode/mimo-v2.5-free") fail("a served retired addagent model must be kept");
  const check = checkGeneratedConfig(raw, { projectRoot: REPO, pinsPath: emptyPins });
  if (!check.ok) fail(`served-retired config must pass the check: ${check.diff ?? ""}`);
  console.log("served-retired kept ok");
}

function proveUnknownRetired(): void {
  process.env.TAWASSUL_MODELS_JSON = unknownFixture;
  const addagentConfig = subsetConfig();
  addagentConfig.agent["addagent"] = {
    ...addagentConfig.agent["addagent"],
    model: "opencode/mimo-v2.5-free",
  };
  const addagentRaw = JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    agent: addagentConfig.agent,
  });
  const merged = buildMergedAgents(addagentRaw, { projectRoot: REPO, pinsPath: devPins });
  if (merged["addagent"]?.model !== "opencode/mimo-v2.5-free") {
    fail("an unknown retired addagent model must be kept");
  }
  const check = checkGeneratedConfig(addagentRaw, { projectRoot: REPO, pinsPath: devPins });
  if (!check.ok) fail(`unknown-retired addagent config must pass the check: ${check.diff ?? ""}`);
  const driftConfig = subsetConfig();
  driftConfig.agent["analyst"] = { ...driftConfig.agent["analyst"], model: "someone/else-1" };
  const driftRaw = JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    agent: driftConfig.agent,
  });
  const drift = checkGeneratedConfig(driftRaw, { projectRoot: REPO, pinsPath: devPins });
  if (drift.ok) fail("an unpinned non-retired unknown model must still fail");
  console.log("unknown-retired kept + drift guard ok");
}

function proveManualAndGeneratedDrift(): void {
  process.env.TAWASSUL_MODELS_JSON = absentFixture;
  const template = buildAgents([], { projectRoot: REPO });
  const baseAgent = (): Record<string, unknown> => JSON.parse(JSON.stringify(template)) as Record<string, unknown>;

  const manual = baseAgent();
  manual["my-helper"] = { model: "acme/private-1" };
  const manualRaw = JSON.stringify({ $schema: "https://opencode.ai/config.json", agent: manual });
  const manualCheck = checkGeneratedConfig(manualRaw, { projectRoot: REPO, pinsPath: emptyPins });
  if (!manualCheck.ok) fail(`a manual config key must pass the check: ${manualCheck.diff ?? ""}`);
  console.log("P2-6 manual-key-passes ok");

  const variantDrift = baseAgent();
  variantDrift["dev-gemini"] = { model: "acme/private-1", mode: "subagent" };
  const variantRaw = JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    agent: variantDrift,
  });
  const variantCheck = checkGeneratedConfig(variantRaw, { projectRoot: REPO, pinsPath: emptyPins });
  if (variantCheck.ok) fail("generated variant drift must fail the check");
  if (!(variantCheck.diff ?? "").includes("model mismatches")) {
    fail(`generated variant drift must report a model mismatch: ${variantCheck.diff ?? ""}`);
  }
  console.log("P2-6 generated-drift-fails ok");

  const baseDrift = baseAgent();
  baseDrift["dev"] = { ...(baseDrift["dev"] as Record<string, unknown>), model: "acme/private-1" };
  const baseRaw = JSON.stringify({ $schema: "https://opencode.ai/config.json", agent: baseDrift });
  const baseCheck = checkGeneratedConfig(baseRaw, { projectRoot: REPO, pinsPath: emptyPins });
  if (baseCheck.ok) fail("base drift must fail the check");
  console.log("P2-6 base-drift-fails ok");

  const missing: string[] = [];
  for (const base of BASE_AGENTS) {
    if (base === "tawa") continue;
    for (const suffix of Object.keys(MODEL_SUFFIX_MAP)) {
      if (template[`${base}-${suffix}`] === undefined) missing.push(`${base}-${suffix}`);
    }
  }
  if (missing.length > 0) fail(`generated-shape names absent from the template catalog: ${missing.join(", ")}`);
  console.log("P2-6 generated-shape-catalog-complete ok");
}

try {
  await proveRetiredMigration();
  proveEmptyAndSubset();
  proveNonObjectAgent();
  await proveKickOmission();
  await proveHybridPins();
  proveServedRetired();
  proveUnknownRetired();
  proveManualAndGeneratedDrift();
} finally {
  if (savedModelsEnv === undefined) delete process.env.TAWASSUL_MODELS_JSON;
  else process.env.TAWASSUL_MODELS_JSON = savedModelsEnv;
  rmSync(modelsDir, { recursive: true, force: true });
}
console.log("PROOF PASS: retired migration + hybrid pins");
