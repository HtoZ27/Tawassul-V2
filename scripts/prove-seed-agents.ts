import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_AGENTS } from "../src/core/agent-data.ts";
import { generateAgentMd } from "../src/core/render-agent.ts";
import { seedAgents } from "./seed-agents.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

function tempDir(tag: string): string {
  return mkdtempSync(join(tmpdir(), `tawassul-seed-agents-${tag}-`));
}

function proveFreshSeed(): void {
  const root = tempDir("fresh");
  const dir = join(root, "agents");
  try {
    const dry = seedAgents({ dir });
    assert(dry.missing.length === ALL_AGENTS.length, "dry run reports every missing base");
    assert(dry.written.length === 0, "dry run writes nothing");
    assert(!existsSync(dir), "dry run creates no directory");

    const first = seedAgents({ dir, write: true });
    assert(first.written.length === ALL_AGENTS.length, "write creates every base");
    assert(first.missing.length === ALL_AGENTS.length, "write reports the originally missing bases");
    for (const agent of ALL_AGENTS) {
      const content = readFileSync(join(dir, `${agent.name}.md`), "utf-8");
      assert(content === generateAgentMd(agent), `${agent.name} content matches the generator`);
    }
    console.log("fresh-seed ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function proveManualPreservation(): void {
  const root = tempDir("manual");
  const dir = join(root, "agents");
  try {
    seedAgents({ dir, write: true });
    const variant = join(dir, "dev-custom.md");
    const variantBody = "---\nname: \"dev-custom\"\n---\nmanual variant\n";
    writeFileSync(variant, variantBody, "utf-8");
    const dev = join(dir, "dev.md");
    const edited = `${readFileSync(dev, "utf-8")}\nmanual note\n`;
    writeFileSync(dev, edited, "utf-8");

    const second = seedAgents({ dir, write: true });
    assert(second.written.length === 0, "existing bases are not rewritten");
    assert(second.kept.length === ALL_AGENTS.length, "existing bases are kept");
    assert(readFileSync(dev, "utf-8") === edited, "a manual base edit survives the seed");
    assert(readFileSync(variant, "utf-8") === variantBody, "a manually added variant survives the seed");
    assert(second.drifted.includes(dev), "drift is reported for the edited base");
    assert(!second.drifted.includes(variant), "manual variants are outside the base inventory");

    const forced = seedAgents({ dir, write: true, force: true });
    assert(forced.written.includes(dev), "force regenerates an edited base");
    assert(readFileSync(dev, "utf-8") === generateAgentMd(ALL_AGENTS.find((a) => a.name === "dev")!), "force restores the generator content");
    assert(readFileSync(variant, "utf-8") === variantBody, "force never touches a manual variant");
    console.log("manual-preservation ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function proveInventory(): void {
  assert(ALL_AGENTS.length === 8, "the seed inventory carries exactly the 8 base agents");
  const names = new Set(ALL_AGENTS.map((agent) => agent.name));
  for (const expected of ["tawa", "dev", "analyst", "tester", "reviewer", "architect", "designer", "doc"]) {
    assert(names.has(expected), `inventory includes ${expected}`);
  }
  console.log("inventory ok");
}

proveFreshSeed();
proveManualPreservation();
proveInventory();
console.log("PROOF PASS: agent seed preserves manual agents");
