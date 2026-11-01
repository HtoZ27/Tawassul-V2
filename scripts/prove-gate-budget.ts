import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "tawassul-budget-"));

type Run = { status: number | null; output: string };

function runWithBudget(budget: Record<string, { wallMs: number; rssMb?: number }>, label: string): Run {
  const file = join(work, `${label}.json`);
  writeFileSync(file, `${JSON.stringify({ version: 1, stages: budget }, null, 2)}\n`);
  const result = spawnSync("bun", ["scripts/gate.ts", "evals"], {
    cwd: repo,
    encoding: "utf-8",
    env: { ...process.env, TAWASSUL_GATE_BUDGET_FILE: file },
  });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

try {
  const generous = runWithBudget({ evals: { wallMs: 90_000, rssMb: 256 } }, "generous");
  assert(generous.status === 0, "a stage inside its budget passes");
  assert(generous.output.includes("GATE BUDGET: evals peak RSS"), "a measured stage reports its peak RSS");
  assert(generous.output.includes("EVAL PASS: pilot fixture"), "the stage runs the pilot fixture");

  const tightWall = runWithBudget({ evals: { wallMs: 1, rssMb: 256 } }, "tight-wall");
  assert(tightWall.status !== 0, "a stage over its wall budget fails");
  assert(tightWall.output.includes("exceeds the 1ms budget"), "the wall failure names the budget");

  const tightRss = runWithBudget({ evals: { wallMs: 90_000, rssMb: 1 } }, "tight-rss");
  assert(tightRss.status !== 0, "a stage over its RSS budget fails");
  assert(tightRss.output.includes("exceeds the 1MB budget"), "the RSS failure names the budget");

  const unmeasured = runWithBudget({ evals: { wallMs: 90_000 } }, "no-rss");
  assert(unmeasured.status === 0, "a stage with no RSS budget passes without the probe");
  assert(!unmeasured.output.includes("GATE BUDGET: evals peak RSS"), "a stage with no RSS budget reports no peak");

  console.log(`PROOF PASS: the gate enforces its stage budgets and fails closed (${passed} assertions)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
