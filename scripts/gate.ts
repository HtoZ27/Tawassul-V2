import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { setPriority, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type GateStep = {
  name: string;
  cmd: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
};

type GateManifest = Record<string, GateStep[]>;

type ShardDefinition = {
  name: string;
  estimateMs: number;
  steps: string[];
};

type ShardFile = {
  version: number;
  totalEstimateMs: number;
  shards: ShardDefinition[];
};

type StageBudget = {
  wallMs: number;
  rssMb?: number;
};

type BudgetFile = {
  version: number;
  stages: Record<string, StageBudget>;
};

type StepResult = {
  name: string;
  status: "pass" | "fail";
  durationMs: number;
  exit: string;
  timedOut?: boolean;
};

type StageRecord = {
  stage: string;
  startedAt: string;
  elapsedMs: number;
  ok: boolean;
  steps: StepResult[];
};

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = process.env.TAWASSUL_GATE_MANIFEST_FILE
  ? process.env.TAWASSUL_GATE_MANIFEST_FILE
  : join(repo, "scripts", "gate-manifest.json");
const shardsPath = join(repo, "scripts", "proof-shards.json");
const budgetsPath = process.env.TAWASSUL_GATE_BUDGET_FILE
  ? process.env.TAWASSUL_GATE_BUDGET_FILE
  : join(repo, "scripts", "gate-budgets.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as GateManifest;
const args = process.argv.slice(2);
const STATE_DIR = join(repo, ".opencode", "state");
const TRANSCRIPT = join(repo, "docs", "CI-TRANSCRIPT.md");
const STEP_TIMEOUT_MS = positiveEnv("TAWASSUL_GATE_STEP_TIMEOUT_MS", 240_000);
const TOTAL_TIMEOUT_MS = positiveEnv("TAWASSUL_GATE_TOTAL_TIMEOUT_MS", 1_800_000);
const KILL_GRACE_MS = 5_000;

function positiveEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) fail(`${name} must be a positive integer`);
  return value;
}

function fail(message: string): never {
  console.error(`GATE FAIL: ${message}`);
  process.exit(1);
}

let stage = "fast";
let activeBudget: StageBudget | null = null;
let activeMaxRssKb = 0;
let activeRssMeasured = false;
let activeTimeWarned = false;
let timings = false;
let positionalSeen = false;
let shard: string | null = null;
let niceLevel: number | null = null;
const only: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i] ?? "";
  if (arg === "--timings") {
    timings = true;
    continue;
  }
  if (arg === "--only") {
    const value = args[i + 1];
    if (!value || value.startsWith("--")) fail("--only requires a step name");
    only.push(value);
    i++;
    continue;
  }
  if (arg === "--shard") {
    const value = args[i + 1];
    if (!value || value.startsWith("--")) fail("--shard requires a shard name");
    if (shard !== null) fail("--shard may be given once");
    shard = value;
    i++;
    continue;
  }
  if (arg === "--nice") {
    const value = args[i + 1];
    if (!value || value.startsWith("--")) fail("--nice requires a level");
    if (niceLevel !== null) fail("--nice may be given once");
    const level = Number(value);
    if (!Number.isInteger(level) || level < 0 || level > 19) fail("--nice requires an integer from 0 to 19");
    niceLevel = level;
    i++;
    continue;
  }
  if (arg.startsWith("--")) fail(`unknown flag ${arg}`);
  if (positionalSeen) fail(`unexpected argument ${arg}`);
  positionalSeen = true;
  stage = arg;
}

const stageNames = Object.keys(manifest);
if (stage === "all" && only.length > 0) fail("--only requires a single stage");
if (stage !== "all" && !stageNames.includes(stage)) {
  fail(`unknown stage ${stage} (expected ${stageNames.join(", ")} or all)`);
}
if (shard !== null) {
  if (stage !== "proofs") fail("--shard is only supported for the proofs stage");
  if (only.length > 0) fail("--shard cannot be combined with --only");
}
if (niceLevel !== null) {
  try {
    setPriority(0, niceLevel);
  } catch (error) {
    fail(`--nice ${niceLevel} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`GATE nice: ${niceLevel}`);
}

function resolveShell(command: string): string {
  if (process.platform !== "win32" || command !== "bash") return command;
  const candidates: string[] = [];
  const located = spawnSync("where.exe", ["git"], { encoding: "utf-8" });
  const git = (located.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (git) {
    const root = dirname(dirname(git));
    candidates.push(join(root, "bin", "bash.exe"), join(root, "usr", "bin", "sh.exe"));
  }
  if (process.env.ProgramFiles) candidates.push(join(process.env.ProgramFiles, "Git", "bin", "bash.exe"));
  return candidates.find((candidate) => existsSync(candidate)) ?? command;
}

function shellBinPaths(shell: string): string[] {
  const match = shell.match(/^(.*?)[\\/](?:usr[\\/])?bin[\\/][^\\/]+$/i);
  const root = match?.[1];
  return root ? [join(root, "usr", "bin"), dirname(shell)] : [dirname(shell)];
}

function toPosixPath(value: string): string {
  const drive = value.match(/^([A-Za-z]):[\\/](.*)$/);
  const letter = drive?.[1];
  const rest = drive?.[2];
  return letter !== undefined && rest !== undefined
    ? `/${letter.toLowerCase()}/${rest.replace(/\\/g, "/")}`
    : value.replace(/\\/g, "/");
}

type ChildOutcome = {
  code: number | null;
  signal: NodeJS.Signals | null;
  error: Error | null;
  timedOut: boolean;
  elapsedMs: number;
};

let activeChildPid: number | null = null;

function killTree(pid: number | undefined, force: boolean): void {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  const signal = force ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}

function abortActiveChild(): void {
  if (activeChildPid === null) return;
  const pid = activeChildPid;
  activeChildPid = null;
  killTree(pid, true);
}

process.on("SIGINT", () => {
  abortActiveChild();
  process.exit(130);
});
process.on("SIGTERM", () => {
  abortActiveChild();
  process.exit(143);
});

function runChild(argv: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<ChildOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(argv[0] as string, argv.slice(1), {
      cwd: repo,
      stdio: "inherit",
      env,
      detached: process.platform !== "win32",
    });
    activeChildPid = child.pid ?? null;
    let timedOut = false;
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid, false);
      graceTimer = setTimeout(() => killTree(child.pid, true), KILL_GRACE_MS);
    }, timeoutMs);
    const finish = (code: number | null, signal: NodeJS.Signals | null, error: Error | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer !== null) clearTimeout(graceTimer);
      if (activeChildPid === (child.pid ?? null)) activeChildPid = null;
      resolve({ code, signal, error, timedOut, elapsedMs: Date.now() - started });
    };
    child.once("error", (error) => finish(null, null, error));
    child.once("exit", (code, signal) => finish(code, signal, null));
  });
}

async function runStep(step: GateStep, stageRemainingMs: number | null): Promise<StepResult> {
  const command = resolveShell(step.cmd[0] ?? "");
  if (!command) fail(`step ${step.name} has no command`);
  const requested = step.timeoutMs ?? STEP_TIMEOUT_MS;
  const stageCapped = stageRemainingMs !== null && stageRemainingMs < requested;
  const timeoutMs = stageCapped ? stageRemainingMs : requested;
  if (timeoutMs <= 0) {
    const reason = "stage budget exhausted";
    console.error(`FAIL ${step.name}: ${reason}`);
    return { name: step.name, status: "fail", durationMs: 0, exit: reason };
  }
  const timeBin = activeBudget?.rssMb !== undefined ? "/usr/bin/time" : null;
  if (timeBin !== null && !existsSync(timeBin) && !activeTimeWarned) {
    activeTimeWarned = true;
    console.warn(`GATE BUDGET: ${timeBin} is unavailable; the peak RSS budget cannot be enforced`);
  }
  const useTime = timeBin !== null && existsSync(timeBin);
  const rssFile = useTime
    ? join(tmpdir(), `tawassul-gate-rss-${process.pid}-${Date.now()}-${Math.round(Math.random() * 1_000_000)}.txt`)
    : null;
  const base = [command, ...step.cmd.slice(1)];
  const argv = useTime ? [timeBin, "-f", "%M", "-o", rssFile as string, ...base] : base;
  const env: NodeJS.ProcessEnv = { ...process.env, ...step.env };
  if (process.versions.bun) env.TAWASSUL_BUN = process.execPath;
  if (process.platform === "win32" && command !== step.cmd[0]) {
    const entries = [...shellBinPaths(command), ...(env.PATH ?? "").split(";")]
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map(toPosixPath);
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === "PATH") delete env[key];
    }
    env.PATH = [...new Set(entries)].join(":");
  }
  const outcome = await runChild(argv, env, timeoutMs);
  const elapsed = outcome.elapsedMs;
  if (rssFile) {
    try {
      const measured = Number.parseInt(readFileSync(rssFile, "utf-8").trim(), 10);
      if (Number.isFinite(measured)) {
        activeRssMeasured = true;
        if (measured > activeMaxRssKb) activeMaxRssKb = measured;
      }
    } catch {
      console.warn(`GATE BUDGET: ${step.name} did not report a peak RSS`);
    }
    rmSync(rssFile, { force: true });
  }
  const suffix = timings ? ` (${elapsed}ms)` : "";
  if (!outcome.timedOut && outcome.code === 0 && !outcome.error) {
    console.log(`PASS ${step.name}${suffix}`);
    return { name: step.name, status: "pass", durationMs: elapsed, exit: "0" };
  }
  const reason = outcome.timedOut
    ? stageCapped
      ? `stage budget ${timeoutMs}ms exhausted`
      : `timeout after ${timeoutMs}ms`
    : outcome.error
      ? outcome.error.message
      : `exit ${outcome.code ?? outcome.signal ?? "unknown"}`;
  console.error(`FAIL ${step.name}${suffix}: ${reason}`);
  return {
    name: step.name,
    status: "fail",
    durationMs: elapsed,
    exit: reason,
    ...(outcome.timedOut ? { timedOut: true } : {}),
  };
}

function readBudgets(): BudgetFile {
  if (!existsSync(budgetsPath)) return { version: 1, stages: {} };
  try {
    return JSON.parse(readFileSync(budgetsPath, "utf-8")) as BudgetFile;
  } catch {
    fail("gate budget file is not valid JSON");
  }
}

function statePath(stageName: string): string {
  return join(STATE_DIR, `gate-${stageName}.json`);
}

function writeStageRecord(
  name: string,
  startedAt: string,
  elapsedMs: number,
  ok: boolean,
  steps: StepResult[],
): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(statePath(name), `${JSON.stringify({ stage: name, startedAt, elapsedMs, ok, steps }, null, 2)}\n`);
}

function readStageRecord(name: string): StageRecord | undefined {
  const file = statePath(name);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as StageRecord;
  } catch {
    return undefined;
  }
}

function readShards(): ShardFile {
  if (!existsSync(shardsPath)) fail("proof shard file is missing");
  try {
    return JSON.parse(readFileSync(shardsPath, "utf-8")) as ShardFile;
  } catch {
    fail("proof shard file is not valid JSON");
  }
}

function writeTranscript(order: string[], ran: Map<string, boolean>): void {
  const lines: string[] = [
    "# CI Transcript",
    "",
    "Generated by `npm run ci` (`scripts/gate.ts`). Do not edit by hand.",
    "",
    `- date: ${new Date().toISOString()}`,
    `- node: ${process.versions.node ?? "unknown"}`,
    `- bun: ${process.versions.bun ?? "n/a"}`,
    `- platform: ${process.platform} ${process.arch}`,
  ];
  const records = order.map((name) => ({ name, record: readStageRecord(name), ran: ran.get(name) === true }));
  const complete = records.every((entry) => entry.ran && entry.record?.ok === true);
  lines.push(`- result: ${complete ? "PASS" : "FAIL"}`, "");
  for (const { name, record, ran: executed } of records) {
    if (!executed) {
      lines.push(`## ${name}`, "", "not run", "");
      continue;
    }
    if (!record) {
      lines.push(`## ${name}`, "", "no stage record", "");
      continue;
    }
    lines.push(`## ${name} — ${record.ok ? "PASS" : "FAIL"}`, "", `${record.steps.length} step(s), ${record.elapsedMs} ms`, "");
    lines.push("| Step | Result | Duration |", "| --- | --- | --- |");
    for (const step of record.steps) {
      lines.push(`| ${step.name} | ${step.status.toUpperCase()} | ${step.durationMs} ms |`);
    }
    lines.push("");
  }
  mkdirSync(dirname(TRANSCRIPT), { recursive: true });
  writeFileSync(TRANSCRIPT, `${lines.join("\n")}\n`);
  console.log(`GATE TRANSCRIPT: ${TRANSCRIPT}`);
}

async function runStage(name: string): Promise<boolean> {
  const stageSteps = manifest[name] ?? [];
  let steps = stageSteps;
  let label = name;
  let recordName = name;
  let estimateMs: number | null = null;
  if (shard !== null) {
    const shardFile = readShards();
    const definition = shardFile.shards.find((entry) => entry.name === shard);
    if (!definition) {
      fail(`unknown shard ${shard} (expected ${shardFile.shards.map((entry) => entry.name).join(", ")})`);
    }
    const shardSteps = definition.steps;
    const byName = new Map(stageSteps.map((step) => [step.name, step]));
    const unknown = shardSteps.filter((stepName) => !byName.has(stepName));
    if (unknown.length > 0) fail(`shard ${shard} names unknown step(s): ${unknown.join(", ")}`);
    steps = shardSteps.map((stepName) => {
      const step = byName.get(stepName);
      if (!step) fail(`shard ${shard} lost step ${stepName}`);
      return step;
    });
    label = `${name}[${shard}]`;
    recordName = `${name}-${shard}`;
    estimateMs = definition.estimateMs;
  }
  const missing = only.filter((stepName) => !steps.some((step) => step.name === stepName));
  if (missing.length > 0) fail(`unknown step(s) for ${label}: ${missing.join(", ")}`);
  const selected = only.length === 0 ? steps : steps.filter((step) => only.includes(step.name));
  if (selected.length === 0) fail(`stage ${label} has no steps`);
  const estimate = estimateMs === null ? "" : `, est ${estimateMs}ms`;
  const budget = shard === null ? readBudgets().stages[name] ?? null : null;
  const budgetLabel = budget === null ? "" : `, budget ${budget.wallMs}ms${budget.rssMb === undefined ? "" : ` / ${budget.rssMb}MB`}`;
  console.log(`GATE ${label}: ${selected.length} step(s)${estimate}${budgetLabel}`);
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const results: StepResult[] = [];
  activeBudget = budget;
  activeMaxRssKb = 0;
  activeRssMeasured = false;
  for (const step of selected) {
    const remaining = budget === null ? null : budget.wallMs - (Date.now() - started);
    const result = await runStep(step, remaining);
    results.push(result);
    if (result.status !== "pass") {
      activeBudget = null;
      writeStageRecord(recordName, startedAt, Date.now() - started, false, results);
      return false;
    }
  }
  const elapsed = Date.now() - started;
  activeBudget = null;
  if (budget !== null && elapsed > budget.wallMs) {
    console.error(`FAIL ${label}: ${elapsed}ms exceeds the ${budget.wallMs}ms budget`);
    writeStageRecord(recordName, startedAt, elapsed, false, results);
    return false;
  }
  if (budget !== null && budget.rssMb !== undefined && !activeRssMeasured) {
    console.error(`FAIL ${label}: the ${budget.rssMb}MB peak RSS budget was not measured`);
    writeStageRecord(recordName, startedAt, elapsed, false, results);
    return false;
  }
  if (budget !== null && budget.rssMb !== undefined && activeMaxRssKb > budget.rssMb * 1024) {
    console.error(`FAIL ${label}: peak RSS ${activeMaxRssKb}KB exceeds the ${budget.rssMb}MB budget`);
    writeStageRecord(recordName, startedAt, elapsed, false, results);
    return false;
  }
  if (budget !== null && budget.rssMb !== undefined) {
    console.log(`GATE BUDGET: ${label} peak RSS ${Math.round(activeMaxRssKb / 1024)}MB of ${budget.rssMb}MB`);
  }
  writeStageRecord(recordName, startedAt, elapsed, true, results);
  console.log(`GATE PASS: ${label} (${selected.length} step(s), ${elapsed}ms)`);
  return true;
}

if (stage === "all") {
  const order = ["fast", "proofs", "smoke"];
  for (const name of order) {
    if (!manifest[name]) fail(`stage ${name} is missing from the manifest`);
    rmSync(statePath(name), { force: true });
  }
  const ran = new Map<string, boolean>();
  const totalStarted = Date.now();
  for (const name of order) {
    const remaining = TOTAL_TIMEOUT_MS - (Date.now() - totalStarted);
    if (remaining <= 0) {
      writeTranscript(order, ran);
      fail(`total budget ${TOTAL_TIMEOUT_MS}ms exhausted before ${name}`);
    }
    const flags = timings ? ["--timings"] : [];
    const outcome = await runChild(
      [process.execPath, fileURLToPath(import.meta.url), name, ...flags],
      process.env,
      remaining,
    );
    ran.set(name, true);
    if (outcome.code !== 0 || outcome.error || outcome.timedOut) {
      writeTranscript(order, ran);
      const reason = outcome.timedOut
        ? `timeout after ${remaining}ms`
        : outcome.error
          ? outcome.error.message
          : `exit ${outcome.code ?? outcome.signal ?? "unknown"}`;
      fail(`stage ${name} failed (${reason})`);
    }
  }
  writeTranscript(order, ran);
  for (const name of order) rmSync(statePath(name), { force: true });
  console.log("GATE PASS: fast + proofs + smoke");
  process.exit(0);
}

if (!(await runStage(stage))) process.exit(1);
