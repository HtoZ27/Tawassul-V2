import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type GateStep = {
  name: string;
  cmd: string[];
  env?: Record<string, string>;
};

type GateManifest = Record<string, GateStep[]>;

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(repo, "scripts", "gate-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as GateManifest;
const args = process.argv.slice(2);

function fail(message: string): never {
  console.error(`GATE FAIL: ${message}`);
  process.exit(1);
}

let stage = "fast";
let timings = false;
let positionalSeen = false;
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

function runStep(step: GateStep): boolean {
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
    return true;
  }
  const reason = result.error ? result.error.message : `exit ${result.status ?? result.signal ?? "unknown"}`;
  console.error(`FAIL ${step.name}${suffix}: ${reason}`);
  return false;
}

function runStage(name: string): boolean {
  const steps = manifest[name] ?? [];
  const missing = only.filter((stepName) => !steps.some((step) => step.name === stepName));
  if (missing.length > 0) fail(`unknown step(s) for ${name}: ${missing.join(", ")}`);
  const selected = only.length === 0 ? steps : steps.filter((step) => only.includes(step.name));
  if (selected.length === 0) fail(`stage ${name} has no steps`);
  console.log(`GATE ${name}: ${selected.length} step(s)`);
  const started = Date.now();
  for (const step of selected) {
    if (!runStep(step)) return false;
  }
  const elapsed = Date.now() - started;
  console.log(`GATE PASS: ${name} (${selected.length} step(s), ${elapsed}ms)`);
  return true;
}

if (stage === "all") {
  const order = ["fast", "proofs", "smoke"];
  for (const name of order) {
    if (!manifest[name]) fail(`stage ${name} is missing from the manifest`);
    const flags = timings ? ["--timings"] : [];
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name, ...flags], {
      cwd: repo,
      stdio: "inherit",
      env: process.env,
    });
    if (result.status !== 0 || result.error) {
      const reason = result.error ? result.error.message : `exit ${result.status ?? result.signal ?? "unknown"}`;
      fail(`stage ${name} failed (${reason})`);
    }
  }
  console.log("GATE PASS: fast + proofs + smoke");
  process.exit(0);
}

if (!runStage(stage)) process.exit(1);
