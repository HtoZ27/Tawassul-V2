import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { armDbMaintenanceTrigger } from "../src/services/db-maintenance-trigger.ts";

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

async function waitFor(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return existsSync(path);
}

async function lockCases(): Promise<void> {
  const db = join(ROOT, "trigger.db");
  writeFileSync(db, "");
  process.env.OPENCODE_DB = db;
  const proofDir = join(ROOT, "project");
  const shim = join(proofDir, "scripts", "opencode-db-scheduled.sh");
  mkdirSync(dirname(shim), { recursive: true });
  writeFileSync(
    shim,
    '#!/bin/sh\nrm -rf "$TAWASSUL_TRIGGER_LOCK"\nprintf "ran\\n" >> "$TAWASSUL_PROOF_EVIDENCE"\n',
  );
  chmodSync(shim, 0o755);

  const lock = join(STAMP_DIR, "trigger.lock");
  const arm = async (label: string): Promise<{ evidence: string; ran: boolean }> => {
    const evidence = join(ROOT, `${label}.evidence`);
    rmSync(evidence, { force: true });
    process.env.TAWASSUL_PROOF_EVIDENCE = evidence;
    process.env.XDG_DATA_HOME = DATA;
    mkdirSync(STAMP_DIR, { recursive: true });
    armDbMaintenanceTrigger(proofDir);
    const ran = await waitFor(evidence, 5000);
    return { evidence, ran };
  };

  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, "pid"), "999999\n");
  const deadOwner = await arm("dead-owner");
  assert(deadOwner.ran, "a lock held by a dead pid is reclaimed and the lane runs");
  assert(!existsSync(lock), "the reclaimed lock is released by the lane");

  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, "pid"), `${process.pid}\n`);
  const liveOwner = await arm("live-owner");
  assert(!liveOwner.ran, "a lock held by a live pid is not reclaimed");
  assert(existsSync(lock), "the live lock is left in place");
  rmSync(lock, { recursive: true, force: true });

  mkdirSync(lock, { recursive: true });
  const freshUntagged = await arm("fresh-untagged");
  assert(!freshUntagged.ran, "a fresh lock without a pid file is not reclaimed");
  rmSync(lock, { recursive: true, force: true });

  mkdirSync(lock, { recursive: true });
  const old = new Date(Date.now() - 4 * 60 * 60 * 1000);
  utimesSync(lock, old, old);
  const staleUntagged = await arm("stale-untagged");
  assert(staleUntagged.ran, "an old lock without a pid file is reclaimed");
}

try {
  schedulerStamps();
  await lockCases();
  console.log(`PROOF PASS: the scheduled lane stamps only real runs and the trigger lock reclaims dead owners (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
