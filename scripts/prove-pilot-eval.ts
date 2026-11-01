import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGoalTool } from "../src/tools/goal.ts";
import { buildHandoffTool } from "../src/tools/handoff.ts";
import { buildRecordTool } from "../src/tools/record.ts";
import { buildShowBoardTool } from "../src/tools/tawa/show-board.ts";
import { buildThreadTool } from "../src/tools/thread.ts";
import { buildTimelineTool } from "../src/tools/timeline.ts";
import type { ToolDefinition } from "../src/tool.ts";
import { callSignature, parseProcedure, type ProcedureCall } from "./skill-procedure.ts";

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
  directory: string;
  tools: string[];
  evalId: string;
  loadRateThreshold: number;
  killCriterion: string;
};

type Manifest = {
  version: number;
  skills: SkillEntry[];
  commands: Array<{ name: string; skillId: string; description: string }>;
};

type EvalEntry = { id: string; skillId: string; fixture: string; receipt: string; verdict: string };

type Ledger = { version: number; method: string; evals: EvalEntry[] };

type FixtureCall = { tool: string; args: Record<string, unknown> };

type FixtureSession = {
  name: string;
  request: string;
  relevant: boolean;
  loaded: boolean;
  calls: FixtureCall[];
};

type Fixture = { id: string; skillId: string; sessions: FixtureSession[] };

type ReceiptEntry = {
  evalId: string;
  skillId: string;
  sessions: number;
  relevant: number;
  loaded: number;
  procedureExecuted: boolean;
  calls: number;
};

type LiveSession = {
  evalId: string;
  session: string;
  agent: string;
  loaded: boolean;
};

type Receipt = {
  date: string;
  method: string;
  fixtures: ReceiptEntry[];
  replayLoadRate: { relevant: number; loaded: number; rate: number };
  liveLoadRate: {
    sessions: LiveSession[];
    relevant: number;
    loaded: number;
    rate: number;
    skillsOff: number;
  };
  command: {
    name: string;
    registered: boolean;
    expandedInRun: boolean;
    skillLoaded: boolean;
    procedureExecuted: boolean;
  };
  notes: string;
};

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

const executed: FixtureCall[] = [];

function dispatch(call: FixtureCall): void {
  const definition = definitions[call.tool];
  if (!definition) fail(`the replay names an unregistered tool ${call.tool}`);
  const available = Object.keys(definition.args);
  for (const key of Object.keys(call.args)) {
    if (!available.includes(key)) fail(`the replay passes ${call.tool}.${key}, which is not declared`);
  }
  executed.push({ tool: call.tool, args: call.args });
}

function normalize(calls: readonly FixtureCall[]): string {
  return callSignature(calls.map((call, index) => ({ ...call, line: index + 1 })));
}

assert(ledger.version === 1, "the eval ledger uses schema version 1");
assert(ledger.evals.length === manifest.skills.length, "the ledger carries one eval per pilot skill");

let totalRelevant = 0;
let totalLoaded = 0;

for (const skill of manifest.skills) {
  const label = skill.id;
  const entry = ledger.evals.find((candidate) => candidate.id === skill.evalId);
  if (!entry) fail(`${label} has no ledger entry`);
  const fixture = JSON.parse(readFileSync(join(repo, entry.fixture), "utf8")) as Fixture;
  const receipt = JSON.parse(readFileSync(join(repo, entry.receipt), "utf8")) as Receipt;
  assert(fixture.id === skill.evalId, `${label} fixture id matches the eval id`);
  assert(fixture.skillId === skill.id, `${label} fixture names the skill`);

  const body = readFileSync(join(repo, skill.directory, "SKILL.md"), "utf8");
  const procedure = parseProcedure(body);
  assert(procedure.length > 0, `${label} procedure carries ${procedure.length} calls`);

  const relevant = fixture.sessions.filter((session) => session.relevant);
  const loaded = relevant.filter((session) => session.loaded);
  assert(relevant.length > 0, `${label} has at least one relevant fixture session`);
  assert(loaded.length > 0, `${label} is loaded in at least one fixture session`);
  const rate = loaded.length / relevant.length;
  assert(
    rate >= skill.loadRateThreshold,
    `${label} load rate ${rate.toFixed(2)} meets the declared threshold ${skill.loadRateThreshold}`,
  );
  totalRelevant += relevant.length;
  totalLoaded += loaded.length;

  for (const session of loaded) {
    executed.length = 0;
    for (const call of session.calls) dispatch(call);
    const expected: ProcedureCall[] = procedure;
    assert(
      normalize(session.calls) === callSignature(expected),
      `${label} session ${session.name} replays the procedure call sequence`,
    );
    assert(
      normalize(executed) === callSignature(expected),
      `${label} session ${session.name} executes every sequenced call against the registry`,
    );
    const callTools = [...new Set(session.calls.map((call) => call.tool))];
    assert(
      JSON.stringify([...callTools].sort()) === JSON.stringify([...skill.tools].sort()),
      `${label} session ${session.name} calls exactly the declared tools`,
    );
  }

  const recorded = receipt.fixtures.find((fixtureEntry) => fixtureEntry.evalId === skill.evalId);
  if (!recorded) fail(`${label} has no receipt entry`);
  assert(recorded.skillId === skill.id, `${label} receipt entry names the skill`);
  assert(recorded.sessions === fixture.sessions.length, `${label} receipt records every fixture session`);
  assert(recorded.relevant === relevant.length, `${label} receipt records the relevant session count`);
  assert(recorded.loaded === loaded.length, `${label} receipt records the loaded session count`);
  assert(recorded.procedureExecuted, `${label} receipt records procedure execution`);
  assert(
    recorded.calls === procedure.length,
    `${label} receipt records the full call count (${recorded.calls}/${procedure.length})`,
  );
  assert(entry.verdict === "pass", `${label} eval verdict is pass`);
}

const receipt = JSON.parse(
  readFileSync(join(repo, ledger.evals[0]!.receipt), "utf8"),
) as Receipt;
assert(receipt.replayLoadRate.relevant === totalRelevant, "the replay aggregate covers every relevant fixture session");
assert(receipt.replayLoadRate.loaded === totalLoaded, "the replay aggregate covers every loaded fixture session");
assert(
  receipt.replayLoadRate.rate === totalLoaded / totalRelevant,
  `the replay load rate matches the fixtures (${receipt.replayLoadRate.rate})`,
);
assert(
  typeof receipt.method === "string" && receipt.method.includes("E1"),
  "the receipt names the live measurement that E1 owns",
);
assert(
  receipt.fixtures.length === manifest.skills.length,
  "the receipt carries one entry per pilot skill",
);

const live = receipt.liveLoadRate;
assert(live.sessions.length === live.relevant, "the live table carries one row per relevant live session");
assert(live.sessions.every((session) => typeof session.loaded === "boolean"), "every live row records its load result");
assert(
  live.sessions.every((session) => manifest.skills.some((skill) => skill.evalId === session.evalId)),
  "the live table names only manifest eval ids",
);
const liveLoaded = live.sessions.filter((session) => session.loaded).length;
assert(live.loaded === liveLoaded, "the live aggregate counts the loaded rows");
assert(live.rate === liveLoaded / live.relevant, `the live load rate matches the rows (${live.rate})`);
assert(live.skillsOff === 0, "the skills-off control loads zero by construction");
for (const skill of manifest.skills) {
  const rows = live.sessions.filter((session) => session.evalId === skill.evalId);
  assert(rows.length > 0, `${skill.id} has a live load measurement`);
  const rate = rows.filter((session) => session.loaded).length / rows.length;
  assert(
    rate >= skill.loadRateThreshold,
    `${skill.id} live load rate ${rate.toFixed(2)} meets the declared threshold ${skill.loadRateThreshold}`,
  );
}
assert(receipt.command.name === manifest.commands[0]?.name, "the receipt names the shipped command");
assert(receipt.command.registered, "the command was registered on the installed host");
assert(receipt.command.skillLoaded, "the command path loaded the goal-review skill");
assert(receipt.command.procedureExecuted, "the command path executed the goal-review procedure");

console.log(`PROOF PASS: the pilot procedures replay and their load rate is recorded (${passed} assertions)`);
