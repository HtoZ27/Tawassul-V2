import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { generateAgentMd } from "../src/core/render-agent.ts";
import { ALL_AGENTS } from "../src/core/agent-data.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SRC = resolve(REPO, "src");
const AGENTS_DIR = resolve(REPO, ".opencode", "agents");
const MARKERS = ["R-011", "disk-proven", "genuinely blocked"];

const SILENT_CATCH_INVENTORY: Record<string, number> = {
  "bootstrap/event-integrations.ts": 4,
  "bootstrap/memory-integrations.ts": 2,
  "bootstrap/plugin-init.ts": 2,
  "bootstrap/service-factory.ts": 2,
  "context/managers/AgentManager.ts": 3,
  "context/managers/StateManager.ts": 9,
  "context/session-manager.ts": 1,
  "core/install-scope.ts": 1,
  "hooks/PipelineState.ts": 1,
  "hooks/guards/shared/factories.ts": 2,
  "hooks/session.ts": 4,
  "hooks/tool-execute.ts": 1,
  "infra/disk-utils.ts": 8,
  "infra/file-lock.ts": 23,
  "scripts/gen-opencode-config.ts": 1,
  "services/apply-patch.ts": 3,
  "services/ast-service.ts": 2,
  "services/background-notifier.ts": 2,
  "services/checkpoint-manager.ts": 1,
  "services/code-state-auto.ts": 1,
  "services/code-state.ts": 2,
  "services/goal-migration.ts": 1,
  "services/goal-store.ts": 1,
  "services/json-recovery.ts": 3,
  "services/keyring.ts": 2,
  "services/memory-watchdog.ts": 4,
  "services/metrics-collector.ts": 2,
  "services/mission-board.ts": 3,
  "services/persist-utils.ts": 1,
  "services/self-heal-engine.ts": 1,
  "services/session-observer.ts": 2,
  "services/spec-driven/manager.ts": 1,
  "services/state-loader.ts": 2,
  "services/state-persistence.ts": 2,
  "services/tool-run-log.ts": 2,
  "services/vector-retrieval.ts": 2,
  "tools/agent-management.ts": 6,
  "tools/dependency-map.ts": 4,
  "tools/handoff.ts": 1,
  "tools/image-gen.ts": 1,
  "tools/project-map.ts": 2,
  "tools/web.ts": 3,
  "utils/atomic.ts": 3,
  "utils/crypto.ts": 10,
  "utils/logger.ts": 1,
  "utils/opencode-config.ts": 5,
  "utils/path-resolver.ts": 1,
  "utils/path.ts": 4,
  "utils/validation.ts": 1,
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

function blankStrings(source: string): string {
  const sf = ts.createSourceFile("scan.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const spans: Array<[number, number]> = [];
  function walk(node: ts.Node): void {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isRegularExpressionLiteral(node) ||
      ts.isJsxText(node)
    ) {
      spans.push([node.getStart(sf), node.getEnd()]);
      return;
    }
    ts.forEachChild(node, walk);
  }
  for (const stmt of sf.statements) walk(stmt);
  const chars = source.split("");
  for (const [start, end] of spans) {
    for (let i = start; i < end; i++) {
      if (chars[i] !== "\n") chars[i] = " ";
    }
  }
  return chars.join("");
}

function extractCatchBodies(blanked: string): string[] {
  const bodies: string[] = [];
  const re = /\bcatch\b/g;
  let m = re.exec(blanked);
  while (m !== null) {
    let i = m.index + 5;
    while (i < blanked.length && /[\s]/.test(blanked[i]!)) i++;
    if (blanked[i] === "(") {
      let depth = 0;
      while (i < blanked.length) {
        if (blanked[i] === "(") depth++;
        else if (blanked[i] === ")") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
    }
    while (i < blanked.length && /[\s]/.test(blanked[i]!)) i++;
    if (blanked[i] !== "{") {
      m = re.exec(blanked);
      continue;
    }
    let depth = 0;
    let j = i;
    let lineComment = false;
    let blockComment = false;
    while (j < blanked.length) {
      const c = blanked[j]!;
      const n = blanked[j + 1] ?? "";
      if (lineComment) {
        if (c === "\n") lineComment = false;
      } else if (blockComment) {
        if (c === "*" && n === "/") {
          blockComment = false;
          j++;
        }
      } else if (c === "/" && n === "/") {
        lineComment = true;
        j++;
      } else if (c === "/" && n === "*") {
        blockComment = true;
        j++;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    bodies.push(blanked.slice(i + 1, j));
    m = re.exec(blanked);
  }
  return bodies;
}

function proveCensus(): void {
  const counts: Record<string, number> = {};
  for (const d of SCAN_DIRS) {
    for (const f of collectTsFiles(join(SRC, d))) {
      const src = readFileSync(f, "utf-8");
      const n = extractCatchBodies(blankStrings(src)).filter((body) => {
        const code = body
          .replace(/\/\/[^\n]*/g, "")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .trim();
        return code === "" || code === "void 0" || code === "void 0;";
      }).length;
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
