import "./proof-log-isolate.ts";
import { tawaFallbackPermission } from "../src/tools/agent-management.ts";
import { generateAgentMd } from "../src/core/render-agent.ts";
import { ALL_AGENTS } from "../src/core/agent-data.ts";
import { consume, refund, remaining, setBudget, resetBudgets, applyIterationBudgets } from "../src/services/iteration-budget.ts";
import { UNATTRIBUTED_MODEL_ID, DEFAULT_PRICING_MODELS } from "../src/services/cost-transparency/types.ts";
import { MODEL_PRIORITY } from "../src/services/proxy-models.ts";
import { TAWA_MENTION_REGEX, EXPLICIT_DISPATCH_REGEX, DISPATCH_QA_IN_ROOT } from "../src/hooks/message-updated.ts";
import { GoalStore } from "../src/services/goal-store.ts";
import { TimelineStore } from "../src/services/timeline-store.ts";
import { PipelineState } from "../src/hooks/PipelineState.ts";
import { mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

const fb1 = tawaFallbackPermission();
const fb2 = tawaFallbackPermission();
assert(typeof fb1.bash === "object" && fb1.bash !== null, "fallback carries bash record");
const bashRec = fb1.bash as Record<string, string>;
assert(Object.values(bashRec).some((v) => v === "allow"), "fallback bash declares allows");
assert(JSON.stringify(fb1.task) === JSON.stringify({ "*": "allow", "*tawa*": "deny" }), "fallback task composite");
(fb1.bash as Record<string, string>)["zzz"] = "allow";
assert(!("zzz" in ((fb2.bash ?? {}) as Record<string, string>)), "fallback fresh object per call");

const tawa = ALL_AGENTS.find((a) => a.name === "tawa");
if (!tawa) fail("tawa template missing");
const md = generateAgentMd(tawa);
assert(!/^bash: deny$/m.test(md), "rendered tawa md has no flat deny");
assert(/^\s*bash:$/m.test(md) && md.includes('"rg *"'), "rendered tawa md carries record");

resetBudgets();
setBudget("__s21x", 2);
assert(consume("__s21x", "sess-a") === true, "budget s1 consume 1");
assert(consume("__s21x", "sess-a") === true, "budget s1 consume 2");
assert(consume("__s21x", "sess-a") === false, "budget s1 exhausted");
assert(consume("__s21x", "sess-b") === true, "budget scoped per session");
assert(remaining("__s21x", "sess-b") === 1, "budget remaining scoped");
refund("__s21x", "sess-b");
assert(remaining("__s21x", "sess-b") === 2, "budget refund scoped");
resetBudgets();

assert(UNATTRIBUTED_MODEL_ID === "unattributed", "unattributed id");
const unatt = DEFAULT_PRICING_MODELS.find((m) => m.id === UNATTRIBUTED_MODEL_ID);
assert(unatt !== undefined && unatt.inputCostPer1MTokens === 0 && unatt.outputCostPer1MTokens === 0, "unattributed priced zero");

const tiers = Object.values(MODEL_PRIORITY);
assert(tiers.length > 0 && tiers.every((v) => v === MODEL_PRIORITY["complex"]), "max doctrine all tiers top");

assert(TAWA_MENTION_REGEX.test("@tawa fix this") === true, "mention at-mention");
assert(TAWA_MENTION_REGEX.test("ottawa meeting") === false, "mention ottawa guard");
assert(TAWA_MENTION_REGEX.test("fix the event dispatcher") === false, "mention dispatcher no false positive");
assert(EXPLICIT_DISPATCH_REGEX.test("redistribute the load") === false, "dispatch redistribute guard");
assert(EXPLICIT_DISPATCH_REGEX.test("fix the event dispatcher") === false, "dispatch dispatcher guard");
assert(EXPLICIT_DISPATCH_REGEX.test("please dispatch this to agents") === true, "dispatch real order matches");
assert(DISPATCH_QA_IN_ROOT === false, "dispatch qa not in root");

assert(typeof (GoalStore.prototype as unknown as { ensureLoaded?: unknown }).ensureLoaded === "function", "goal ensureLoaded");
assert(typeof (TimelineStore.prototype as unknown as { ensureLoaded?: unknown }).ensureLoaded === "function", "timeline ensureLoaded");

resetBudgets();
const bad: Array<[string, unknown]> = [];
assert(applyIterationBudgets(undefined) === 0, "budgets undefined zero");
assert(applyIterationBudgets({ "@dev": 80, "@tawa": 0, "@x": Number.NaN }, (a, v) => { bad.push([a, v]); }) === 1, "budgets one valid applied");
assert(bad.length === 2, "budgets two invalid reported");
assert(remaining("@dev") === 80, "budgets config ceiling live");
resetBudgets();

const analyst = ALL_AGENTS.find((a) => a.name === "analyst");
if (!analyst) fail("analyst template missing");
assert(generateAgentMd(analyst).includes("ONE summary of findings"), "analyst one-summary wording");
for (const agent of ALL_AGENTS) {
  if (agent.name === "tawa") continue;
  assert(generateAgentMd(agent).includes("ONCE PER TASK"), `${agent.name} once-per-task discipline`);
}

const calls: Array<"set" | "clear"> = [];
const fakeTimers: import("../src/types/timer-types.ts").TimerManagerLike = {
  setInterval: (_fn: (...args: unknown[]) => void) => { calls.push("set"); return 42 as unknown as ReturnType<typeof setInterval>; },
  setTimeout: (_fn: (...args: unknown[]) => void) => 43 as unknown as ReturnType<typeof setTimeout>,
  clear: (_t: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>) => { calls.push("clear"); },
};
const ps = new PipelineState(fakeTimers);
ps.initAutoSweep();
assert(calls.includes("set"), "pipeline sweep centrally registered");
ps.stopAutoSweep();
assert(calls.includes("clear"), "pipeline sweep centrally cleared");

const tornDir = mkdtempSync(join(tmpdir(), "s021-torn-"));
try {
  const goalsDir = join(tornDir, "goals");
  mkdirSync(goalsDir, { recursive: true });
  writeFileSync(join(goalsDir, "goals.jsonl"), '{"torn-fragment-no-newline', "utf-8");
  const torn = new GoalStore(tornDir);
  await torn.ensureLoaded();
  assert(torn.size === 0, "torn tail skipped, no goals");
  const created = await torn.create({ title: "after torn tail", owner: "@dev" });
  assert(created.ok === true, "create after torn tail");
  const raw = readFileSync(join(goalsDir, "goals.jsonl"), "utf-8");
  assert(raw.includes('{"torn-fragment-no-newline\n{"id"'), "append separated from fragment");
} finally {
  rmSync(tornDir, { recursive: true, force: true });
}

console.log("PROOF PASS: s021 invocation surface, budget, cost, max, priming hooks");
