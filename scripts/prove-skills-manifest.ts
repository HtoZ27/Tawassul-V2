import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PILOT_SKILLS } from "../src/skills/pilot.ts";
import { buildGoalTool } from "../src/tools/goal.ts";
import { buildHandoffTool } from "../src/tools/handoff.ts";
import { buildRecordTool } from "../src/tools/record.ts";
import { buildShowBoardTool } from "../src/tools/tawa/show-board.ts";
import { buildThreadTool } from "../src/tools/thread.ts";
import { buildTimelineTool } from "../src/tools/timeline.ts";
import type { ToolDefinition } from "../src/tool.ts";
import { callSignature, findForbidden, parseProcedure } from "./skill-procedure.ts";

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

type SkillEntry = {
  id: string;
  name: string;
  directory: string;
  description: string;
  scope: string;
  tools: string[];
  evalId: string;
  loadRateThreshold: number;
  killCriterion: string;
};

type CommandEntry = { name: string; skillId: string; description: string };

type Manifest = { version: number; skills: SkillEntry[]; commands: CommandEntry[] };

type EvalEntry = {
  id: string;
  skillId: string;
  fixture: string;
  receipt: string;
  verdict: string;
};

type Ledger = { version: number; method: string; evals: EvalEntry[] };

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(
  readFileSync(join(repo, "skills", "manifest.json"), "utf8"),
) as Manifest;
const ledger = JSON.parse(
  readFileSync(join(repo, "docs", "experiments", "evals.json"), "utf8"),
) as Ledger;

const fake = {} as never;
const definitions: Record<string, ToolDefinition> = {
  goal: buildGoalTool(fake),
  show_board: buildShowBoardTool(fake),
  timeline: buildTimelineTool(fake),
  record: buildRecordTool(fake),
  handoff: buildHandoffTool(fake),
  thread: buildThreadTool(fake),
};

assert(manifest.version === 1, "the skills manifest uses schema version 1");
assert(manifest.skills.length === 3, `the pilot ships three skills (${manifest.skills.length})`);
assert(manifest.commands.length === 1, `the pilot ships one command (${manifest.commands.length})`);
assert(ledger.version === 1, "the eval ledger uses schema version 1");

const ids = manifest.skills.map((skill) => skill.id);
assert(new Set(ids).size === ids.length, "skill ids are unique");
assert(
  ids.every((id) => id.startsWith("tawassul-")),
  "shipped skill ids use the tawassul- prefix",
);
assert(
  manifest.commands.every((command) => command.name.startsWith("tawassul-")),
  "shipped command names use the tawassul- prefix",
);
assert(
  manifest.commands.every((command) => ids.includes(command.skillId)),
  "every command names a shipped skill",
);

for (const skill of manifest.skills) {
  const label = skill.id;
  assert(typeof skill.name === "string" && skill.name.length > 0, `${label} carries a name`);
  assert(
    typeof skill.description === "string" && skill.description.length > 0,
    `${label} carries a description`,
  );
  assert(typeof skill.scope === "string" && skill.scope.length > 0, `${label} declares its scope`);
  assert(
    typeof skill.loadRateThreshold === "number" &&
      skill.loadRateThreshold > 0 &&
      skill.loadRateThreshold <= 1,
    `${label} declares a load-rate threshold in (0, 1]`,
  );
  assert(
    typeof skill.killCriterion === "string" && skill.killCriterion.length > 0,
    `${label} declares a kill criterion`,
  );
  assert(
    typeof skill.evalId === "string" && skill.evalId.length > 0,
    `${label} declares an eval id`,
  );

  const directory = join(repo, skill.directory);
  const bodyPath = join(directory, "SKILL.md");
  assert(existsSync(bodyPath), `${label} ships ${skill.directory}/SKILL.md`);
  const body = readFileSync(bodyPath, "utf8");
  const forbidden = findForbidden(body);
  assert(
    forbidden.length === 0,
    `${label} states no prohibition, prerequisite or tool contract (found ${forbidden.join(", ") || "none"})`,
  );

  const calls = parseProcedure(body);
  assert(calls.length > 0, `${label} carries a numbered procedure (${calls.length} calls)`);
  const callTools = [...new Set(calls.map((call) => call.tool))];
  assert(
    JSON.stringify([...callTools].sort()) === JSON.stringify([...skill.tools].sort()),
    `${label} tool list matches the procedure (${callTools.join(", ")})`,
  );
  for (const call of calls) {
    const definition = definitions[call.tool];
    if (!definition) fail(`${label} names an unregistered tool ${call.tool} at line ${call.line}`);
    const available = Object.keys(definition.args);
    for (const key of Object.keys(call.args)) {
      if (!available.includes(key)) {
        fail(`${label} ${call.tool} does not accept ${key} at line ${call.line}`);
      }
    }
  }

  const moduleSkill = PILOT_SKILLS.find((entry) => entry.id === skill.id);
  if (!moduleSkill) fail(`${label} is registered by the skills module`);
  assert(moduleSkill.content === body, `${label} registered content matches the file byte for byte`);
  assert(moduleSkill.description === skill.description, `${label} registered description matches the manifest`);
  assert(moduleSkill.directory === skill.directory, `${label} registered directory matches the manifest`);

  const entry = ledger.evals.find((evalEntry) => evalEntry.id === skill.evalId);
  if (!entry) fail(`${label} eval id resolves in docs/experiments/evals.json`);
  assert(entry.skillId === skill.id, `${label} eval entry names the skill`);
  assert(entry.verdict === "pass", `${label} eval verdict is pass`);
  assert(existsSync(join(repo, entry.fixture)), `${label} eval fixture exists`);
  assert(existsSync(join(repo, entry.receipt)), `${label} eval receipt exists`);
  const fixture = JSON.parse(readFileSync(join(repo, entry.fixture), "utf8")) as {
    id: string;
    skillId: string;
    sessions: Array<{ calls: Array<{ tool: string; args: Record<string, unknown> }> }>;
  };
  assert(fixture.id === skill.evalId, `${label} fixture id matches the eval id`);
  assert(fixture.skillId === skill.id, `${label} fixture names the skill`);
  const loaded = fixture.sessions.filter((session) => session.calls.length > 0);
  assert(loaded.length > 0, `${label} fixture carries a loaded session`);  assert(
    callSignature(loaded[0]!.calls.map((call, index) => ({ ...call, line: index + 1 }))) ===
      callSignature(calls),
    `${label} fixture replays the procedure call sequence`,
  );
}

assert(
  PILOT_SKILLS.length === manifest.skills.length,
  `the module registers exactly the manifest ids (${PILOT_SKILLS.length}/${manifest.skills.length})`,
);
assert(
  PILOT_SKILLS.every((skill) => ids.includes(skill.id)),
  "the module registers no id outside the manifest",
);
assert(
  ledger.evals.length === manifest.skills.length,
  `the ledger carries one eval per skill (${ledger.evals.length}/${manifest.skills.length})`,
);

const readme = readFileSync(join(repo, "README.md"), "utf8");
const table = readme.match(/<!-- generated:skills-table -->([\s\S]*?)<!-- \/generated -->/);
if (!table) fail("the README carries the generated skill table");
const expectedTable = [
  "| Skill | Scope | Tools | Eval | Load threshold |",
  "| --- | --- | --- | --- | --- |",
  ...manifest.skills.map(
    (skill) =>
      `| \`${skill.id}\` | ${skill.scope} | ${skill.tools.map((tool) => `\`${tool}\``).join(", ")} | \`${skill.evalId}\` | ${skill.loadRateThreshold} |`,
  ),
].join("\n") + "\n";
assert(table[1] === expectedTable, "the README skill table matches the manifest");

console.log(`PROOF PASS: the skills manifest matches the files, the registry, the eval ledger and the README table (${passed} assertions)`);
