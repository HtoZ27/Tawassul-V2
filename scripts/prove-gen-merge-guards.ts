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

async function proveRetiredMigration(): Promise<void> {
  if (RETIRED_MODEL_IDS.size === 0) fail("retired set is empty");
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
    copyFileSync(join(REPO, ".opencode", "deleted-agents.json"), join(dir, ".opencode", "deleted-agents.json"));
    const live = JSON.parse(readFileSync(join(REPO, "opencode.json"), "utf-8")) as {
      agent: Record<string, { model?: string }>;
    };
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await proveRetiredMigration();
await proveHybridPins();
console.log("PROOF PASS: retired migration + hybrid pins");
