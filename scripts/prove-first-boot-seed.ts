import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMinimalProjectContract, ensureGlobalRosterSeed } from "../src/utils/opencode-config.ts";
import { defaultAgentModelForRole } from "../src/services/proxy-fallback-chains.ts";
import { StaleDetector } from "../src/services/stale-detector/index.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function proveMinimalContract(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-seed-"));
  try {
    const first = await ensureMinimalProjectContract(dir, "project");
    if (!first.created) fail("minimal contract not created in empty project dir");
    const doc = JSON.parse(readFileSync(join(dir, "opencode.json"), "utf-8")) as Record<string, unknown>;
    if (doc["$schema"] !== "https://opencode.ai/config.json") fail("schema missing");
    if ("subagent_depth" in doc) fail("v1 subagent_depth must not be written");
    if (!doc["agent"] || typeof doc["agent"] !== "object" || Object.keys(doc["agent"] as object).length !== 0) {
      fail("agent container must exist and be empty");
    }
    if ("mcp" in doc) fail("mcp must be absent without a bundle");
    const second = await ensureMinimalProjectContract(dir, "project");
    if (second.created || second.reason !== "exists") fail("second call must report exists");
    const scoped = await ensureMinimalProjectContract(dir, "global");
    if (scoped.created || scoped.reason !== "non-project-scope") fail("global scope must refuse");
    console.log("minimal-contract ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function proveOptOut(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-seed-"));
  try {
    process.env.TAWASSUL_NO_AUTOCONFIG = "1";
    const r = await ensureMinimalProjectContract(dir, "project");
    if (r.created || r.reason !== "opted-out") fail("opt-out must refuse");
    if (existsSync(join(dir, "opencode.json"))) fail("opt-out must not write");
    console.log("opt-out ok");
  } finally {
    delete process.env.TAWASSUL_NO_AUTOCONFIG;
    rmSync(dir, { recursive: true, force: true });
  }
}

async function proveGlobalSeed(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-seed-global-"));
  try {
    process.env.TAWASSUL_GLOBAL_DIR = dir;
    const first = await ensureGlobalRosterSeed();
    if (!first.created) fail("global roster not seeded");
    if (first.path !== join(dir, "tawassul.jsonc")) fail("seed must write the canonical .jsonc roster");
    const roster = JSON.parse(readFileSync(join(dir, "tawassul.jsonc"), "utf-8")) as {
      agents?: Record<string, { model?: string }>;
      deleted?: unknown[];
    };
    if (!roster.agents || Object.keys(roster.agents).length !== 8) fail("seed must carry the 8 bases");
    if (!Array.isArray(roster.deleted) || roster.deleted.length !== 0) fail("seed deleted must be empty");
    for (const [name, entry] of Object.entries(roster.agents)) {
      if (entry.model !== defaultAgentModelForRole(name)) fail(`seed model for ${name} must match the role default`);
    }
    const second = await ensureGlobalRosterSeed();
    if (second.created) fail("second call must report exists");
    if (existsSync(join(dir, "tawassul.json"))) fail("seed must not write the legacy name");
    console.log("global-seed ok");
  } finally {
    delete process.env.TAWASSUL_GLOBAL_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}

async function proveGlobalSeedPreservesManualRoster(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-seed-manual-"));
  try {
    process.env.TAWASSUL_GLOBAL_DIR = dir;
    const manual = {
      agents: {
        "dev-custom": { description: "Manually added during the v2 migration", model: "opencode/big-pickle" },
      },
      deleted: [],
    };
    writeFileSync(join(dir, "tawassul.json"), JSON.stringify(manual, null, 2) + "\n", "utf-8");
    const result = await ensureGlobalRosterSeed();
    if (result.created) fail("an existing legacy roster must stop the seed");
    if (existsSync(join(dir, "tawassul.jsonc"))) fail("seed must not add a canonical roster over a manual one");
    const after = JSON.parse(readFileSync(join(dir, "tawassul.json"), "utf-8")) as typeof manual;
    if (JSON.stringify(after) !== JSON.stringify(manual)) fail("seed must not touch manually added agents");
    console.log("global-seed-manual ok");
  } finally {
    delete process.env.TAWASSUL_GLOBAL_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}

async function proveGlobalSeedOptOut(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-seed-optout-"));
  try {
    process.env.TAWASSUL_GLOBAL_DIR = dir;
    process.env.TAWASSUL_NO_AUTOCONFIG = "1";
    const result = await ensureGlobalRosterSeed();
    if (result.created) fail("opt-out must stop the global seed");
    if (existsSync(join(dir, "tawassul.jsonc")) || existsSync(join(dir, "tawassul.json"))) {
      fail("opt-out must not write a roster");
    }
    console.log("global-seed-optout ok");
  } finally {
    delete process.env.TAWASSUL_GLOBAL_DIR;
    delete process.env.TAWASSUL_NO_AUTOCONFIG;
    rmSync(dir, { recursive: true, force: true });
  }
}

async function proveMcpBundleIgnored(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-seed-"));
  try {
    mkdirSync(join(dir, ".opencode", "mcp"), { recursive: true });
    writeFileSync(join(dir, ".opencode", "mcp", "tawassul.mjs"), "export default {};\n", "utf-8");
    const r = await ensureMinimalProjectContract(dir, "project");
    if (!r.created) fail("contract with a legacy bundle not created");
    const doc = JSON.parse(readFileSync(join(dir, "opencode.json"), "utf-8")) as { mcp?: unknown };
    if (doc.mcp) fail("a legacy MCP bundle must not be registered");
    console.log("mcp-bundle-ignored ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function proveStaleSignal(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-stale-"));
  const previous = process.cwd();
  const detector = new StaleDetector({ trackedFiles: ["AGENTS.md", "codemap.md"] });
  try {
    process.chdir(dir);
    if (detector.findStaleFiles().length !== 0) fail("an empty project must report no stale documents");
    if (detector.getSummary().missing !== 2) fail("missing documents stay visible in the summary");
    writeFileSync(join(dir, "AGENTS.md"), "# notes\n", "utf-8");
    const aged = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    utimesSync(join(dir, "AGENTS.md"), aged, aged);
    const stale = detector.findStaleFiles();
    if (stale.length !== 1 || stale[0]?.path !== "AGENTS.md") fail("an aged document is reported as stale");
    if (stale[0]?.freshness !== "stale") fail("the aged document carries the stale freshness");
    console.log("stale-signal ok");
  } finally {
    process.chdir(previous);
    rmSync(dir, { recursive: true, force: true });
  }
}

await proveMinimalContract();
await proveOptOut();
await proveGlobalSeed();
await proveGlobalSeedPreservesManualRoster();
await proveGlobalSeedOptOut();
await proveMcpBundleIgnored();
await proveStaleSignal();
console.log("PROOF PASS: first-boot seeding");
