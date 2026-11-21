import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

type Run = { status: number | null; signal: NodeJS.Signals | null; output: string };

type GateRunOptions = {
  stage: string;
  budget?: Record<string, { wallMs: number; rssMb?: number }>;
  manifest?: string;
  only?: string;
  env?: Record<string, string>;
};

function runGate(options: GateRunOptions): Run {
  let budgetFile: string | null = null;
  if (options.budget !== undefined) {
    budgetFile = join(work, `budget-${Date.now()}-${Math.round(Math.random() * 1_000_000)}.json`);
    writeFileSync(budgetFile, `${JSON.stringify({ version: 1, stages: options.budget }, null, 2)}\n`);
  }
  const gateArgs = ["scripts/gate.ts", options.stage, ...(options.only === undefined ? [] : ["--only", options.only])];
  const result = spawnSync(process.execPath, gateArgs, {
    cwd: repo,
    encoding: "utf-8",
    timeout: 60_000,
    env: {
      ...process.env,
      ...(options.manifest === undefined ? {} : { TAWASSUL_GATE_MANIFEST_FILE: options.manifest }),
      ...(budgetFile === null ? {} : { TAWASSUL_GATE_BUDGET_FILE: budgetFile }),
      ...options.env,
    },
  });
  return {
    status: result.status,
    signal: result.signal,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return true;
  }
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
      const close = stat.lastIndexOf(")");
      return stat.slice(close + 2, close + 3) === "Z";
    } catch {
      return true;
    }
  }
  return false;
}

async function waitGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processGone(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return processGone(pid);
}

const hangScript = [
  'const { spawn } = require("node:child_process");',
  'const { writeFileSync } = require("node:fs");',
  'const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });',
  'writeFileSync(process.env.PIDFILE, String(child.pid));',
  "setTimeout(() => {}, 30000);",
].join("\n");

const stubbornScript = [
  'const { spawn } = require("node:child_process");',
  'const { writeFileSync } = require("node:fs");',
  'const child = spawn(process.execPath, ["-e", "process.on(\\"SIGTERM\\", () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });',
  'writeFileSync(process.env.PIDFILE, String(child.pid));',
  "setTimeout(() => {}, 30000);",
].join("\n");

const inheritScript = [
  'const { spawn } = require("node:child_process");',
  'const { writeFileSync } = require("node:fs");',
  'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });',
  "child.unref();",
  'writeFileSync(process.env.PIDFILE, String(child.pid));',
].join("\n");

try {
  const generous = runGate({ stage: "evals", budget: { evals: { wallMs: 90_000, rssMb: 256 } } });
  assert(generous.status === 0, "a stage inside its budget passes");
  assert(generous.output.includes("GATE BUDGET: evals peak RSS"), "a measured stage reports its peak RSS");
  assert(generous.output.includes("EVAL PASS: pilot fixture"), "the stage runs the pilot fixture");

  const tightWall = runGate({ stage: "evals", budget: { evals: { wallMs: 1, rssMb: 256 } } });
  assert(tightWall.status !== 0, "a stage over its wall budget fails");
  assert(
    tightWall.output.includes("stage budget") && tightWall.output.includes("eval-pilot"),
    "the wall failure names the stage budget",
  );

  const tightRss = runGate({ stage: "evals", budget: { evals: { wallMs: 90_000, rssMb: 1 } } });
  assert(tightRss.status !== 0, "a stage over its RSS budget fails");
  assert(tightRss.output.includes("exceeds the 1MB budget"), "the RSS failure names the budget");

  const unmeasured = runGate({ stage: "evals", budget: { evals: { wallMs: 90_000 } } });
  assert(unmeasured.status === 0, "a stage with no RSS budget passes without the probe");
  assert(!unmeasured.output.includes("GATE BUDGET: evals peak RSS"), "a stage with no RSS budget reports no peak");

  const pidFile = join(work, "grandchild.pid");
  const stubbornPid = join(work, "stubborn.pid");
  const inheritPid = join(work, "inherit.pid");
  const manifest = join(work, "timeout-manifest.json");
  writeFileSync(
    manifest,
    `${JSON.stringify(
      {
        timeout: [
          { name: "quick", cmd: [process.execPath, "-e", "process.exit(0)"] },
          {
            name: "hang",
            cmd: [process.execPath, "-e", hangScript],
            env: { PIDFILE: pidFile },
          },
          {
            name: "stubborn",
            cmd: [process.execPath, "-e", stubbornScript],
            env: { PIDFILE: stubbornPid },
          },
          {
            name: "inherit",
            cmd: [process.execPath, "-e", inheritScript],
            env: { PIDFILE: inheritPid },
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const quick = runGate({ stage: "timeout", manifest, only: "quick" });
  assert(quick.status === 0, "a step inside its timeout passes");
  assert(quick.output.includes("PASS quick"), "the passing step is named");

  rmSync(pidFile, { force: true });
  const timedOut = runGate({
    stage: "timeout",
    manifest,
    only: "hang",
    env: { TAWASSUL_GATE_STEP_TIMEOUT_MS: "800" },
  });
  assert(timedOut.status !== 0, "a step over its timeout fails");
  assert(timedOut.output.includes("FAIL hang"), "the timed-out step is named");
  assert(timedOut.output.includes("timeout after 800ms"), "the timeout failure names the limit");
  assert(existsSync(pidFile), "the hanging step recorded its grandchild");
  const grandchild = Number.parseInt(readFileSync(pidFile, "utf-8"), 10);
  assert(Number.isInteger(grandchild) && grandchild > 0, "the recorded grandchild pid is valid");
  assert(await waitGone(grandchild, 5_000), "the timed-out step's grandchild is gone");

  rmSync(pidFile, { force: true });
  const stageCapped = runGate({
    stage: "timeout",
    manifest,
    only: "hang",
    budget: { timeout: { wallMs: 1_500 } },
    env: { TAWASSUL_GATE_STEP_TIMEOUT_MS: "10000" },
  });
  assert(stageCapped.status !== 0, "a step over the stage budget fails");
  const capped = stageCapped.output.match(/stage budget (\d+)ms exhausted/);
  assert(capped !== null, "the stage-capped failure names the stage budget");
  const cappedMs = Number(capped?.[1]);
  assert(cappedMs > 0 && cappedMs <= 1_500, `the stage budget caps the step (${cappedMs} <= 1500)`);
  assert(existsSync(pidFile), "the stage-capped step recorded its grandchild");
  const cappedChild = Number.parseInt(readFileSync(pidFile, "utf-8"), 10);
  assert(await waitGone(cappedChild, 5_000), "the stage-capped step's grandchild is gone");

  rmSync(stubbornPid, { force: true });
  const stubborn = runGate({
    stage: "timeout",
    manifest,
    only: "stubborn",
    env: { TAWASSUL_GATE_STEP_TIMEOUT_MS: "800" },
  });
  assert(stubborn.status !== 0, "a step that ignores the timeout signal fails");
  assert(existsSync(stubbornPid), "the stubborn step recorded its grandchild");
  const stubbornChild = Number.parseInt(readFileSync(stubbornPid, "utf-8"), 10);
  assert(await waitGone(stubbornChild, 8_000), "the timed-out step's SIGTERM-ignoring grandchild is killed");

  rmSync(inheritPid, { force: true });
  const inheritStarted = Date.now();
  const inherited = runGate({ stage: "timeout", manifest, only: "inherit" });
  const inheritElapsed = Date.now() - inheritStarted;
  assert(inherited.status === 0, "a step that leaves an inherited-stdio child passes");
  assert(inheritElapsed < 10_000, `the gate returns without waiting for the inherited child (${inheritElapsed}ms)`);
  assert(existsSync(inheritPid), "the inheriting step recorded its grandchild");
  const inheritChild = Number.parseInt(readFileSync(inheritPid, "utf-8"), 10);
  assert(await waitGone(inheritChild, 5_000), "the step's inherited-stdio grandchild is reaped");

  console.log(`PROOF PASS: the gate enforces its stage budgets and step timeouts and fails closed (${passed} assertions)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
