import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { armDbMaintenanceTrigger, dbMaintenanceState } from "../src/services/db-maintenance-trigger.ts";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = mkdtempSync(join(tmpdir(), "tawassul-db-scheduler-"));
const DATA = join(ROOT, "data");
const STAMP_DIR = join(DATA, "tawassul-v2", "db-maintenance");
const SCHEDULED = join(REPO, "scripts", "opencode-db-scheduled.sh");

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

function stampEnv(dbPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: join(ROOT, "home"),
    XDG_DATA_HOME: DATA,
    XDG_CACHE_HOME: join(ROOT, "cache"),
    XDG_CONFIG_HOME: join(ROOT, "config"),
    XDG_STATE_HOME: join(ROOT, "state"),
    OPENCODE_DB: dbPath,
    TAWASSUL_REGISTER_TRIGGERS: "manual",
    TAWASSUL_DB_GAP_SECONDS: "0",
  };
}

function runScheduled(args: string[], env: NodeJS.ProcessEnv): { code: number; out: string } {
  const result = spawnSync("bash", [SCHEDULED, ...args], { env, encoding: "utf-8", timeout: 60_000 });
  return { code: result.status ?? -1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function schedulerStamps(): void {
  mkdirSync(join(ROOT, "home"), { recursive: true });
  mkdirSync(DATA, { recursive: true });
  const smoke = join(ROOT, "smoke.db");
  writeFileSync(smoke, "");
  const missing = join(ROOT, "missing.db");
  const okStamp = join(STAMP_DIR, "last-run.stamp");
  const failureStamp = join(STAMP_DIR, "last-failure.stamp");

  const first = runScheduled(["--run"], stampEnv(smoke));
  assert(first.code === 0, "a small quiescent DB finishes the scheduled run with exit 0");
  const laneLog = join(DATA, "tawassul-v2", "backups", "opencode-db-scheduled.log");
  assert(
    existsSync(laneLog) && readFileSync(laneLog, "utf-8").includes("nothing to do"),
    "the scheduled run reports nothing to do",
  );
  assert(existsSync(okStamp), "a successful run writes the last-run stamp");
  assert(readFileSync(okStamp, "utf-8").includes("rc=0"), "the last-run stamp records rc=0");
  assert(!existsSync(failureStamp), "a successful run leaves no failure stamp");
  const okBefore = readFileSync(okStamp, "utf-8");

  const failed = runScheduled(["--run"], stampEnv(missing));
  assert(failed.code === 2, "a missing OPENCODE_DB fails the scheduled run with exit 2");
  assert(existsSync(failureStamp), "a failed run writes the failure stamp");
  assert(readFileSync(failureStamp, "utf-8").includes("rc=2"), "the failure stamp records the actual exit code");
  assert(readFileSync(okStamp, "utf-8") === okBefore, "a failed run leaves the last-run stamp untouched");

  const recovered = runScheduled(["--run"], stampEnv(smoke));
  assert(recovered.code === 0, "a later successful run exits 0 again");
  assert(!existsSync(failureStamp), "a successful run clears the failure stamp");
  assert(readFileSync(okStamp, "utf-8").includes("rc=0"), "the last-run stamp survives the recovery");

  rmSync(okStamp, { force: true });
  rmSync(failureStamp, { force: true });
  const check = runScheduled(["--check"], stampEnv(smoke));
  assert(check.code === 0, "check mode exits 0");
  assert(check.out.includes("ladder:"), "check mode prints the ladder decision");
  assert(!existsSync(okStamp) && !existsSync(failureStamp), "check mode writes no stamp");
}

function laneLogText(): string {
  const file = join(DATA, "tawassul-v2", "backups", "opencode-db-scheduled.log");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function gateCases(): void {
  const db = join(ROOT, "gate.db");
  writeFileSync(db, "");
  const stamp = join(STAMP_DIR, "last-run.stamp");
  const env = stampEnv(db);
  delete env.TAWASSUL_DB_GAP_SECONDS;
  rmSync(stamp, { force: true });

  const first = runScheduled(["--run"], env);
  assert(first.code === 0, "the default gap still allows the first scheduled run");
  assert(existsSync(stamp), "the default gap still writes the stamp");

  const recent = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(stamp, recent, recent);
  const beforeGap = laneLogText().length;
  const gapped = runScheduled(["--run"], env);
  assert(gapped.code === 0, "a run inside the 24h gap exits cleanly");
  assert(laneLogText().slice(beforeGap).includes("skipping:") && laneLogText().slice(beforeGap).includes("gap"), "a gapped run explains the skip");
  assert(statSync(stamp).mtimeMs === recent.getTime(), "a gapped run leaves the stamp untouched");

  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  utimesSync(stamp, old, old);
  const due = runScheduled(["--run"], env);
  assert(due.code === 0, "a run past the 24h gap executes");
  assert(statSync(stamp).mtimeMs > old.getTime(), "a due run refreshes the stamp");

  rmSync(stamp, { force: true });
  const lock = join(STAMP_DIR, "trigger.lock");
  mkdirSync(lock, { recursive: true });
  const beforeLock = laneLogText().length;
  const held = runScheduled(["--run"], env);
  assert(held.code === 0, "a run blocked by another lock exits cleanly");
  assert(laneLogText().slice(beforeLock).includes("holds the lock"), "a locked run explains the skip");
  assert(!existsSync(stamp), "a locked run writes no stamp");
  rmSync(lock, { recursive: true, force: true });
}

async function waitFor(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return existsSync(path);
}

async function waitForGone(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(path)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !existsSync(path);
}

const LOCK = join(STAMP_DIR, "trigger.lock");
const STAMP = join(STAMP_DIR, "last-run.stamp");

function stagedLane(gap: number | string): string {
  const dir = join(ROOT, "staged");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const name of ["opencode-db-scheduled.sh", "db-env.sh"]) {
    copyFileSync(join(REPO, "scripts", name), join(dir, name));
  }
  writeFileSync(join(dir, "MAINTENANCE"), `${JSON.stringify({ gapSeconds: gap })}\n`);
  return join(dir, "opencode-db-scheduled.sh");
}

function runStaged(script: string, args: string[], env: NodeJS.ProcessEnv): { code: number; out: string } {
  const result = spawnSync("bash", [script, ...args], { env, encoding: "utf-8", timeout: 60_000 });
  return { code: result.status ?? -1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function shellGapCases(): void {
  const db = join(ROOT, "gap-shell.db");
  writeFileSync(db, "");
  const base = stampEnv(db);
  delete base.TAWASSUL_DB_GAP_SECONDS;
  mkdirSync(STAMP_DIR, { recursive: true });
  const caseRun = (gap: number | string, extra: NodeJS.ProcessEnv = {}): string => {
    const script = stagedLane(gap);
    const now = new Date();
    writeFileSync(STAMP, "rc=0\n");
    utimesSync(STAMP, now, now);
    const before = laneLogText().length;
    const result = runStaged(script, ["--run"], { ...base, ...extra });
    const segment = laneLogText().slice(before);
    assert(result.code === 0, `the staged lane exits 0 with gap ${JSON.stringify(gap)}`);
    return segment;
  };

  const marker = caseRun(86400);
  assert(
    marker.includes("skipping:") && marker.includes("86400s gap"),
    "the staged lane reads gapSeconds from MAINTENANCE",
  );
  const env = caseRun(86400, { TAWASSUL_DB_GAP_SECONDS: "0" });
  assert(
    env.includes("scheduled run") && !env.includes("skipping:"),
    "the staged lane lets the environment gap win over the marker",
  );
  const zero = caseRun(0);
  assert(zero.includes("scheduled run") && !zero.includes("skipping:"), "a zero marker gap lets the staged lane run");
  const malformed = caseRun("soon");
  assert(
    malformed.includes("skipping:") && malformed.includes("86400s gap"),
    "a malformed marker gap falls back to 86400",
  );
  const badEnv = caseRun(86400, { TAWASSUL_DB_GAP_SECONDS: "soon" });
  assert(
    badEnv.includes("skipping:") && badEnv.includes("86400s gap"),
    "an invalid environment gap falls back to the marker value",
  );

  const lockScript = stagedLane(0);
  rmSync(LOCK, { recursive: true, force: true });
  mkdirSync(LOCK, { recursive: true });
  writeFileSync(join(LOCK, "pid"), "not-a-pid\n");
  rmSync(STAMP, { force: true });
  const heldRun = runStaged(lockScript, ["--run"], base);
  assert(heldRun.code === 0, "a corrupt-pid lock does not fail the staged lane");
  assert(
    laneLogText().includes("skipping: another maintenance run holds the lock"),
    "a fresh corrupt-pid lock is not reclaimed",
  );
  assert(existsSync(LOCK), "the fresh corrupt-pid lock is left in place");
  const oldLock = new Date(Date.now() - 4 * 60 * 60 * 1000);
  utimesSync(LOCK, oldLock, oldLock);
  const reclaimed = runStaged(lockScript, ["--run"], base);
  assert(reclaimed.code === 0, "an old corrupt-pid lock is reclaimed by the staged lane");
  assert(!existsSync(LOCK), "the staged lane removes the old corrupt-pid lock after the run");

  rmSync(join(ROOT, "staged"), { recursive: true, force: true });
  rmSync(STAMP, { force: true });
}

async function triggerCases(): Promise<void> {
  const db = join(ROOT, "trigger.db");
  writeFileSync(db, "");
  process.env.OPENCODE_DB = db;
  const proofDir = join(ROOT, "project");
  const scriptDir = join(proofDir, "scripts");
  const shim = join(scriptDir, "opencode-db-scheduled.sh");
  mkdirSync(scriptDir, { recursive: true });
  writeFileSync(shim, '#!/bin/sh\nsleep 1\nprintf "ran\\n" >> "$TAWASSUL_PROOF_EVIDENCE"\n');
  chmodSync(shim, 0o755);

  const arm = async (label: string): Promise<boolean> => {
    const evidence = join(ROOT, `${label}.evidence`);
    rmSync(evidence, { force: true });
    process.env.TAWASSUL_PROOF_EVIDENCE = evidence;
    process.env.XDG_DATA_HOME = DATA;
    mkdirSync(STAMP_DIR, { recursive: true });
    armDbMaintenanceTrigger(proofDir);
    return waitFor(evidence, 5000);
  };

  delete process.env.TAWASSUL_DB_SCRIPT;
  const nonCanonical = await arm("non-canonical");
  assert(!nonCanonical, "a non-canonical project cannot supply the lane script");

  process.env.TAWASSUL_DB_SCRIPT = shim;
  if (process.platform !== "win32") {
    process.env.TAWASSUL_DB_MAINTENANCE = "off";
    assert(dbMaintenanceState() === "disabled", "TAWASSUL_DB_MAINTENANCE=off reports disabled");
    const disabled = await arm("disabled");
    assert(!disabled, "TAWASSUL_DB_MAINTENANCE=off skips the lane");
    delete process.env.TAWASSUL_DB_MAINTENANCE;
    assert(dbMaintenanceState() === "enabled", "the trigger is enabled by default");
  }

  const markerFile = join(scriptDir, "MAINTENANCE");
  const freshStamp = (): void => {
    const now = new Date();
    writeFileSync(STAMP, "rc=0\n");
    utimesSync(STAMP, now, now);
  };
  delete process.env.TAWASSUL_DB_GAP_SECONDS;

  writeFileSync(markerFile, `${JSON.stringify({ gapSeconds: 0 })}\n`);
  freshStamp();
  const markerZero = await arm("trigger-gap-zero");
  assert(markerZero, "the trigger reads gapSeconds from the marker");
  assert(await waitForGone(LOCK, 5000), "the trigger releases the lock after a marker-gap run");

  writeFileSync(markerFile, `${JSON.stringify({ gapSeconds: 3600 })}\n`);
  freshStamp();
  const gappedMtime = statSync(STAMP).mtimeMs;
  const gapped = await arm("trigger-gap-skip");
  assert(!gapped, "the trigger honours a marker gap");
  assert(statSync(STAMP).mtimeMs === gappedMtime, "a gapped trigger leaves the stamp untouched");

  process.env.TAWASSUL_DB_GAP_SECONDS = "0";
  const envWins = await arm("trigger-gap-env");
  assert(envWins, "the trigger lets the environment gap win over the marker");
  assert(await waitForGone(LOCK, 5000), "the trigger releases the lock after an environment-gap run");
  delete process.env.TAWASSUL_DB_GAP_SECONDS;

  writeFileSync(markerFile, `${JSON.stringify({ gapSeconds: "soon" })}\n`);
  freshStamp();
  const malformed = await arm("trigger-gap-malformed");
  assert(!malformed, "the trigger falls back to 86400 when the marker gap is malformed");
  rmSync(markerFile, { force: true });

  rmSync(STAMP, { force: true });
  mkdirSync(LOCK, { recursive: true });
  writeFileSync(join(LOCK, "pid"), "999999\n");
  const deadOwner = await arm("dead-owner");
  assert(deadOwner, "a lock held by a dead pid is reclaimed and the lane runs");
  assert(await waitForGone(LOCK, 5000), "the trigger releases the reclaimed lock after the child exits");

  rmSync(STAMP, { force: true });
  mkdirSync(LOCK, { recursive: true });
  writeFileSync(join(LOCK, "pid"), `${process.pid}\n`);
  const liveOwner = await arm("live-owner");
  assert(!liveOwner, "a lock held by a live pid is not reclaimed");
  assert(existsSync(LOCK), "the live lock is left in place");
  rmSync(LOCK, { recursive: true, force: true });

  rmSync(STAMP, { force: true });
  mkdirSync(LOCK, { recursive: true });
  const freshUntagged = await arm("fresh-untagged");
  assert(!freshUntagged, "a fresh lock without a pid file is not reclaimed");
  rmSync(LOCK, { recursive: true, force: true });

  rmSync(STAMP, { force: true });
  mkdirSync(LOCK, { recursive: true });
  const old = new Date(Date.now() - 4 * 60 * 60 * 1000);
  utimesSync(LOCK, old, old);
  const staleUntagged = await arm("stale-untagged");
  assert(staleUntagged, "an old lock without a pid file is reclaimed");
  assert(await waitForGone(LOCK, 5000), "the trigger releases the pid-less lock it reclaimed");

  rmSync(STAMP, { force: true });
  mkdirSync(LOCK, { recursive: true });
  writeFileSync(join(LOCK, "pid"), "999999\n");
  mkdirSync(`${LOCK}.reclaim`, { recursive: true });
  writeFileSync(join(`${LOCK}.reclaim`, "pid"), "999998\n");
  const staleMutex = await arm("stale-mutex");
  assert(staleMutex, "a stale reclaim mutex is cleared and the lane runs");
  assert(await waitForGone(LOCK, 5000), "the stale-mutex recovery releases the lock");

  rmSync(STAMP, { force: true });
  const evidence = join(ROOT, "concurrent.evidence");
  rmSync(evidence, { force: true });
  process.env.TAWASSUL_PROOF_EVIDENCE = evidence;
  armDbMaintenanceTrigger(proofDir);
  armDbMaintenanceTrigger(proofDir);
  const concurrentRan = await waitFor(evidence, 5000);
  const concurrentGone = await waitForGone(LOCK, 5000);
  const concurrentRuns = existsSync(evidence)
    ? readFileSync(evidence, "utf-8")
        .split("\n")
        .filter((line) => line.trim() !== "").length
    : 0;
  assert(
    concurrentRan && concurrentGone && concurrentRuns === 1,
    "two concurrent actors never both run",
  );
  const leftovers = readdirSync(STAMP_DIR).filter((name) => name.startsWith("trigger.lock"));
  assert(leftovers.length === 0, "a clean lock directory remains after every trigger run");
  delete process.env.TAWASSUL_DB_SCRIPT;
}

try {
  schedulerStamps();
  gateCases();
  shellGapCases();
  await triggerCases();
  console.log(
    `PROOF PASS: the scheduled lane stamps only real runs and one gap source and lock protocol govern both actors (${passed} assertions)`,
  );
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
