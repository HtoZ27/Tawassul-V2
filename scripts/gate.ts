import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { setPriority } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type GateStep = {
  name: string;
  cmd: string[];
  env?: Record<string, string>;
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

type StepResult = {
  name: string;
  status: "pass" | "fail";
  durationMs: number;
  exit: string;
};

type StageRecord = {
  stage: string;
  startedAt: string;
  elapsedMs: number;
  ok: boolean;
  steps: StepResult[];
};

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(repo, "scripts", "gate-manifest.json");
const shardsPath = join(repo, "scripts", "proof-shards.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as GateManifest;
const args = process.argv.slice(2);
const STATE_DIR = join(repo, ".opencode", "state");
const TRANSCRIPT = join(repo, "docs", "CI-TRANSCRIPT.md");

function fail(message: string): never {
  console.error(`GATE FAIL: ${message}`);
  process.exit(1);
}

let stage = "fast";
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

function runStep(step: GateStep): StepResult {
  const command = step.cmd[0];
  if (!command) fail(`step ${step.name} has no command`);
  const started = Date.now();
  const result = spawnSync(command, step.cmd.slice(1), {
    cwd: repo,
    stdio: "inherit",
    env: { ...process.env, ...step.env },
  });
  const elapsed = Date.now() - started;
  const suffix = timings ? ` (${elapsed}ms)` : "";
  if (result.status === 0 && !result.error) {
    console.log(`PASS ${step.name}${suffix}`);
    return { name: step.name, status: "pass", durationMs: elapsed, exit: "0" };
  }
  const reason = result.error ? result.error.message : `exit ${result.status ?? result.signal ?? "unknown"}`;
  console.error(`FAIL ${step.name}${suffix}: ${reason}`);
  return { name: step.name, status: "fail", durationMs: elapsed, exit: reason };
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

function runStage(name: string): boolean {
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
  console.log(`GATE ${label}: ${selected.length} step(s)${estimate}`);
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const results: StepResult[] = [];
  for (const step of selected) {
    const result = runStep(step);
    results.push(result);
    if (result.status !== "pass") {
      writeStageRecord(recordName, startedAt, Date.now() - started, false, results);
      return false;
    }
  }
  const elapsed = Date.now() - started;
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
  for (const name of order) {
    const flags = timings ? ["--timings"] : [];
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name, ...flags], {
      cwd: repo,
      stdio: "inherit",
      env: process.env,
    });
    ran.set(name, true);
    if (result.status !== 0 || result.error) {
      writeTranscript(order, ran);
      const reason = result.error ? result.error.message : `exit ${result.status ?? result.signal ?? "unknown"}`;
      fail(`stage ${name} failed (${reason})`);
    }
  }
  writeTranscript(order, ran);
  for (const name of order) rmSync(statePath(name), { force: true });
  console.log("GATE PASS: fast + proofs + smoke");
  process.exit(0);
}

if (!runStage(stage)) process.exit(1);
