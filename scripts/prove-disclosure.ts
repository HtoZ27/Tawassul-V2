import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateAgentMd } from "../src/core/render-agent.ts";
import { ALL_AGENTS } from "../src/core/agent-data.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SRC = resolve(REPO, "src");
const AGENTS_DIR = resolve(REPO, ".opencode", "agents");
const MARKERS = ["R-011", "disk-proven", "genuinely blocked"];

const SILENT_CATCH_INVENTORY: Record<string, number> = {
  "tools/image-gen.ts": 1,
  "tools/handoff.ts": 1,
  "tools/agent-management.ts": 6,
  "tools/web.ts": 2,
  "tools/dependency-map.ts": 4,
  "services/code-state.ts": 1,
  "services/mission-board.ts": 2,
  "services/persist-utils.ts": 1,
  "services/ast-service.ts": 2,
  "services/session-observer.ts": 1,
  "services/checkpoint-manager.ts": 2,
  "utils/validation.ts": 1,
  "utils/logger.ts": 1,
  "utils/opencode-config.ts": 4,
  "bootstrap/plugin-init.ts": 4,
  "bootstrap/event-integrations.ts": 2,
  "context/model-utils.ts": 1,
  "context/managers/AgentManager.ts": 3,
  "scripts/gen-opencode-config.ts": 1,
  "hooks/PipelineState.ts": 1,
  "hooks/validation-pipeline.ts": 2,
  "hooks/guards/shared/factories.ts": 2,
};
const SCAN_DIRS = ["tools", "services", "utils", "bootstrap", "context", "core", "scripts", "infra", "hooks"];

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function proveOnDiskPrompts(): void {
  for (const a of ALL_AGENTS) {
    const md = readFileSync(join(AGENTS_DIR, `${a.name}.md`), "utf-8");
    for (const m of MARKERS) {
      if (!md.includes(m)) fail(`${a.name}.md missing disclosure marker ${m}`);
    }
  }
  console.log(`on-disk prompts ok (${ALL_AGENTS.length} base agents)`);
}

function proveRenderer(): void {
  for (const a of ALL_AGENTS) {
    const md = generateAgentMd(a, "proof-model");
    for (const m of MARKERS) {
      if (!md.includes(m)) fail(`rendered ${a.name} missing disclosure marker ${m}`);
    }
  }
  console.log("renderer ok (future writes carry the clause)");
}

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) collectTsFiles(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function proveCensus(): void {
  const counts: Record<string, number> = {};
  for (const d of SCAN_DIRS) {
    for (const f of collectTsFiles(join(SRC, d))) {
      const src = readFileSync(f, "utf-8");
      const n = [...src.matchAll(/catch[^{]*\{([^}]*)\}/g)].filter((m) =>
        ["", "void 0", "void 0;"].includes((m[1] ?? "").trim()),
      ).length;
      if (n > 0) counts[f.slice(SRC.length + 1).replace(/\\/g, "/")] = n;
    }
  }
  const live = JSON.stringify(counts, Object.keys(counts).sort());
  const pinned = JSON.stringify(SILENT_CATCH_INVENTORY, Object.keys(SILENT_CATCH_INVENTORY).sort());
  if (live !== pinned) fail(`silent-catch census drifted:\nlive: ${live}\nreviewed: ${pinned}`);
  console.log(`census ok (${Object.keys(counts).length} files, reviewed inventory matches)`);
}

proveOnDiskPrompts();
proveRenderer();
proveCensus();
console.log("PROOF PASS: disclosure rule + silent-catch census");
