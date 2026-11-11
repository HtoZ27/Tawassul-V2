import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMergedAgents, checkGeneratedConfig } from "../src/scripts/gen-opencode-config.ts";
import { RETIRED_MODEL_IDS, MODEL_SUFFIX_MAP } from "../src/core/variant-names.ts";

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

try {
  await proveRetiredMigration();
  await proveHybridPins();
  proveServedRetired();
  proveUnknownRetired();
} finally {
  if (savedModelsEnv === undefined) delete process.env.TAWASSUL_MODELS_JSON;
  else process.env.TAWASSUL_MODELS_JSON = savedModelsEnv;
  rmSync(modelsDir, { recursive: true, force: true });
}
console.log("PROOF PASS: retired migration + hybrid pins");
