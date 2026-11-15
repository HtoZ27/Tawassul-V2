import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getInitReady, initPlugin } from "../src/bootstrap/plugin-init.ts";
import { createV2Setup } from "../src/v2/setup.ts";
import { measureDescriptionText } from "../src/v2/adapters.ts";
import type { ToolDefinition } from "../src/tool.ts";
import type { V2Context, V2ToolContext, V2ToolDefinition } from "../src/v2/types.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

type Constraint = {
  id: string;
  kind: string;
  baseline: string;
  require: string[];
};

type Probe = {
  args: Record<string, unknown>;
  expect: string;
  sequence?: string;
};

type FixtureTool = {
  name: string;
  constraints: Constraint[];
  probe: Probe;
};

type Fixture = {
  version: number;
  date: string;
  baseline: string;
  method: string;
  probeMethod: string;
  tools: FixtureTool[];
};

type Baseline = {
  date: string;
  descriptionText: { bytes: number; lines: Array<{ name: string; bytes: number }> };
};

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(repo, "docs", "experiments", "fixtures", "constraint-retention.json");
const BASELINE = join(repo, "docs", "experiments", "baselines", "2026-10-31-context-baseline.json");
const KINDS = new Set(["prohibition", "prerequisite", "failure_mode"]);

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function resultText(result: unknown): string {
  const rec = result as { content?: Array<{ text?: string }> };
  if (Array.isArray(rec?.content)) return rec.content.map((part) => part.text ?? "").join("");
  return typeof result === "string" ? result : JSON.stringify(result);
}

assert(existsSync(FIXTURE), "the frozen constraint-retention fixture exists");
assert(existsSync(BASELINE), "the frozen pre-diet baseline exists");
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture;
const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline;

assert(fixture.version === 1, "the fixture uses schema version 1");
assert(fixture.date === "2026-11-01", "the fixture is dated to the diet window");
assert(fixture.baseline.length > 0 && existsSync(join(repo, fixture.baseline)), "the fixture names an existing baseline");
assert(fixture.tools.length === 11, `the fixture covers the eleven slimmed tools (${fixture.tools.length})`);

const fixtureNames = fixture.tools.map((tool) => tool.name);
assert(new Set(fixtureNames).size === fixtureNames.length, "each tool appears once in the fixture");
const constraintIds = fixture.tools.flatMap((tool) => tool.constraints.map((constraint) => constraint.id));
assert(new Set(constraintIds).size === constraintIds.length, "every constraint id is globally unique");

let phraseCount = 0;
for (const tool of fixture.tools) {
  assert(tool.constraints.length > 0, `${tool.name} carries at least one constraint`);
  for (const constraint of tool.constraints) {
    assert(KINDS.has(constraint.kind), `${constraint.id} declares a known constraint kind`);
    assert(constraint.baseline.trim().length > 0, `${constraint.id} records the baseline wording`);
    assert(constraint.require.length > 0, `${constraint.id} names at least one retained phrase`);
    phraseCount += constraint.require.length;
  }
  assert(tool.probe !== undefined, `${tool.name} carries an executor refusal probe`);
  assert(tool.probe.expect.trim().length > 0, `${tool.name} probe expects a refusal`);
}
assert(phraseCount >= 100, `the fixture pins a broad phrase set (${phraseCount})`);

const work = mkdtempSync(join(tmpdir(), "tawassul-retention-"));
const keyDir = join(work, "keys");
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
process.env.XDG_CONFIG_HOME = join(work, "config");
process.env.XDG_DATA_HOME = join(work, "data");
process.env.XDG_STATE_HOME = join(work, "state");
process.env.XDG_CACHE_HOME = join(work, "cache");
process.env.OPENCODE_DB = join(work, "opencode.db");
delete process.env.TAWASSUL_ISOLATED;
delete process.env.TAWASSUL_CONTEXT_HANDOFF;

const registry = new Map<string, V2ToolDefinition>();

try {
  mkdirSync(join(work, ".opencode"), { recursive: true });
  const hooks = await initPlugin({ client: {}, directory: work, worktree: work } as never);
  const probe = getInitReady(hooks as never);
  assert(probe !== undefined, "the isolated boot exposes the init readiness probe");
  const status = await probe!();
  assert(status.ready, `the isolated boot completes init (${status.error?.message ?? "ready"})`);
  const tools = (hooks.tool ?? {}) as Record<string, ToolDefinition>;
  const measured = measureDescriptionText(tools);
  assert(
    measured.lines.length === baseline.descriptionText.lines.length,
    `the live surface matches the baseline tool count (${measured.lines.length}/${baseline.descriptionText.lines.length})`,
  );

  const slimmed = measured.lines
    .filter((line) => {
      const before = baseline.descriptionText.lines.find((entry) => entry.name === line.name);
      return before !== undefined && line.bytes < before.bytes;
    })
    .map((line) => line.name)
    .sort();
  assert(
    slimmed.length === fixture.tools.length,
    `the diet touched the fixture's tool count (${slimmed.length}/${fixture.tools.length})`,
  );
  assert(
    JSON.stringify(slimmed) === JSON.stringify([...fixtureNames].sort()),
    `the fixture covers exactly the slimmed tools (${slimmed.join(", ")})`,
  );

  for (const tool of fixture.tools) {
    const description = normalize(tools[tool.name]?.description ?? "");
    assert(description.length > 0, `${tool.name} still publishes a description`);
    for (const constraint of tool.constraints) {
      for (const phrase of constraint.require) {
        assert(
          description.includes(normalize(phrase)),
          `${tool.name} keeps ${constraint.id} phrase "${phrase}"`,
        );
      }
    }
  }

  const host = {
    app: { version: "2.3.0" },
    location: { directory: work },
    session: {
      hook: async () => ({ dispose: async () => undefined }),
      prompt: async () => undefined,
      context: async () => [],
      wait: async () => undefined,
      synthetic: async () => undefined,
      interrupt: async () => undefined,
    },
    tool: {
      transform: async (callback: (editor: { add: (tool: V2ToolDefinition) => void }) => void) => {
        const local = new Map<string, V2ToolDefinition>();
        callback({ add: (tool) => local.set(tool.name, tool) });
        for (const [name, tool] of local) registry.set(name, tool);
        return {
          dispose: async () => {
            for (const name of local.keys()) registry.delete(name);
          },
        };
      },
      reload: async () => undefined,
      list: async () => [...registry.values()],
      hook: async () => ({ dispose: async () => undefined }),
    },
    event: {
      subscribe: async function* () {
        yield* [];
      },
    },
  } as unknown as V2Context;
  const cleanup = await createV2Setup({
    init: () => hooks,
    refresh: { initialWaitMs: 5_000, attempts: 2, delayMs: 10 },
  })(host);
  assert(registry.size === measured.lines.length, `the V2 executor registers every tool (${registry.size})`);

  const context = {
    sessionID: "ses-retention",
    messageID: "msg-retention",
    agent: "",
    id: "call-retention",
    signal: new AbortController().signal,
    progress: async () => undefined,
  } as unknown as V2ToolContext;

  try {
    for (const tool of fixture.tools) {
      const def = registry.get(tool.name);
      assert(def !== undefined, `${tool.name} is callable through the live V2 executor`);
      if (!def) continue;
      let output = "";
      if (tool.probe.sequence === "create-then-close") {
        const created = resultText(await def.execute(tool.probe.args, context));
        const id = created.match(/G-\d+/)?.[0];
        assert(id !== undefined, `${tool.name} creates a goal for the close probe (${id ?? "none"})`);
        if (!id) continue;
        try {
          output = resultText(await def.execute({ close: id }, context));
        } catch (e) {
          output = (e as Error).message;
        }
      } else {
        try {
          output = resultText(await def.execute(tool.probe.args, context));
        } catch (e) {
          output = (e as Error).message;
        }
      }
      assert(
        normalize(output).includes(normalize(tool.probe.expect)),
        `${tool.name} refuses the prohibited input ("${tool.probe.expect}")`,
      );
    }
  } finally {
    await cleanup();
  }

  console.log(
    `INFO  ${fixture.tools.length} slimmed tools, ${phraseCount} retained phrases, ${fixture.tools.length} refused probes`,
  );
  console.log(`PROOF PASS: every slimmed description keeps its constraints and a real refusal (${passed} assertions)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
