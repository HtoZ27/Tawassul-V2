import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMinimalProjectContract, ensureGlobalRosterSeed } from "../src/utils/opencode-config.ts";

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
    if (doc["subagent_depth"] !== 3) fail("subagent_depth missing");
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
    const roster = JSON.parse(readFileSync(join(dir, "tawassul.json"), "utf-8")) as {
      agents?: Record<string, unknown>;
      deleted?: unknown[];
    };
    if (!roster.agents || Object.keys(roster.agents).length !== 8) fail("seed must carry the 8 bases");
    if (!Array.isArray(roster.deleted) || roster.deleted.length !== 0) fail("seed deleted must be empty");
    const second = await ensureGlobalRosterSeed();
    if (second.created) fail("second call must report exists");
    console.log("global-seed ok");
  } finally {
    delete process.env.TAWASSUL_GLOBAL_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}

async function proveMcpBundle(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-seed-"));
  try {
    mkdirSync(join(dir, ".opencode", "mcp"), { recursive: true });
    writeFileSync(join(dir, ".opencode", "mcp", "tawassul.mjs"), "export default {};\n", "utf-8");
    const r = await ensureMinimalProjectContract(dir, "project");
    if (!r.created) fail("contract with bundle not created");
    const doc = JSON.parse(readFileSync(join(dir, "opencode.json"), "utf-8")) as { mcp?: unknown };
    if (!doc.mcp) fail("mcp must be present with a bundle");
    console.log("mcp-bundle ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await proveMinimalContract();
await proveOptOut();
await proveGlobalSeed();
await proveMcpBundle();
console.log("PROOF PASS: first-boot seeding");
