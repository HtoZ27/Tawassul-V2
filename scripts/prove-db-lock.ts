import "./proof-log-isolate.ts";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = mkdtempSync(join(tmpdir(), "tawassul-db-lock-"));
const DATA = join(ROOT, "data");
const DB_DIR = join(DATA, "opencode");
const DB = join(DB_DIR, "opencode.db");
const LOCK = join(DB_DIR, ".opencode-db-maintenance.lock");
const BACKUPS = join(DATA, "tawassul-v2", "backups");
const FILES = [
  "opencode-db-maintenance.sh",
  "guard-db-generation.sh",
  "opencode-db-scheduled.sh",
  "db-env.sh",
  "doctor-v2.sh",
];

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

function env(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: join(ROOT, "home"),
    XDG_DATA_HOME: DATA,
    XDG_CACHE_HOME: join(ROOT, "cache"),
    XDG_CONFIG_HOME: join(ROOT, "config"),
    XDG_STATE_HOME: join(ROOT, "state"),
    OPENCODE_DB: DB,
    TAWASSUL_BACKUP_DIR: BACKUPS,
    PATH: "/usr/bin:/bin",
  };
}

function stage(project: string): string {
  const dir = join(ROOT, project, "scripts");
  mkdirSync(dir, { recursive: true });
  for (const file of FILES) {
    const dest = join(dir, file);
    cpSync(join(REPO, "scripts", file), dest);
    chmodSync(dest, 0o755);
  }
  return join(dir, "opencode-db-maintenance.sh");
}

function script(project: string): string {
  return join(ROOT, project, "scripts", "opencode-db-maintenance.sh");
}

function run(project: string): { code: number; out: string } {
  const result = spawnSync(
    "bash",
    [script(project), "--db", DB, "--ignore-low-ram", "--keep-backups", "1"],
    { env: env(), encoding: "utf-8", timeout: 120_000 },
  );
  return { code: result.status ?? -1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function runAsync(project: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "bash",
      [script(project), "--db", DB, "--ignore-low-ram", "--keep-backups", "1"],
      { env: env() },
    );
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}

function sha(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function integrity(): string {
  const result = spawnSync("sqlite3", [DB, "PRAGMA integrity_check;"], { encoding: "utf-8" });
  return (result.stdout ?? "").trim();
}

function createDb(): void {
  const sql = [
    "CREATE TABLE session_v2 (id TEXT PRIMARY KEY);",
    "CREATE TABLE session (id TEXT PRIMARY KEY);",
    "CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);",
    "CREATE TABLE event (id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, created INTEGER DEFAULT 0 NOT NULL);",
    "CREATE TABLE event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, owner_id TEXT);",
    "CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    "INSERT INTO session_v2 VALUES ('sm-s1');",
    `INSERT INTO kv VALUES ('migration.v1-v2','{"phase":"completed"}');`,
  ].join("");
  const result = spawnSync("sqlite3", [DB, sql], { env: env(), encoding: "utf-8" });
  if (result.status !== 0) fail(`synthetic v2 DB creation failed: ${result.stderr ?? ""}`);
}

function holderLock(pid: string): void {
  rmSync(LOCK, { recursive: true, force: true });
  mkdirSync(LOCK, { recursive: true });
  writeFileSync(join(LOCK, `pid.${pid}`), `${pid}\n`);
}

try {
  mkdirSync(DB_DIR, { recursive: true });
  mkdirSync(BACKUPS, { recursive: true });
  createDb();
  stage("proj-a");
  stage("proj-b");

  const baseline = run("proj-a");
  assert(baseline.code === 0, "a quiescent synthetic DB completes a full run");
  assert(!existsSync(LOCK), "the winner releases its own lock");
  assert(integrity() === "ok", "the DB stays integrity-clean after the baseline run");

  const hashBefore = sha(DB);
  holderLock(String(process.pid));
  const loserA = run("proj-a");
  assert(loserA.code === 8, "a run facing a live holder exits 8");
  assert(loserA.out.includes("another maintenance run holds"), "the loser names the holder lock");
  assert(existsSync(LOCK), "the loser leaves the holder lock in place");
  assert(sha(DB) === hashBefore, "the blocked run leaves the DB byte-identical");

  const loserB = run("proj-b");
  assert(loserB.code === 8, "a second project copy is blocked by the same holder");
  assert(existsSync(LOCK), "the second loser also preserves the holder lock");
  assert(sha(DB) === hashBefore, "the second blocked run leaves the DB byte-identical");

  rmSync(LOCK, { recursive: true, force: true });
  const afterHolder = run("proj-b");
  assert(afterHolder.code === 0, "the lane proceeds once the holder releases");

  holderLock("999999");
  const deadOwner = run("proj-a");
  assert(deadOwner.code === 0, "a lock held by a dead pid is reclaimed");
  assert(deadOwner.out.includes("reclaiming stale lock"), "the reclaim is reported");
  assert(!existsSync(LOCK), "the reclaimed run releases its lock on exit");

  const parallel = await Promise.all([
    runAsync("proj-a"),
    runAsync("proj-b"),
    runAsync("proj-a"),
    runAsync("proj-b"),
  ]);
  for (const [index, outcome] of parallel.entries()) {
    assert(
      outcome.code === 0 || outcome.code === 8,
      `concurrent run ${index + 1} exits 0 or 8 (saw ${outcome.code})`,
    );
  }
  assert(
    parallel.some((outcome) => outcome.code === 0),
    "at least one concurrent run wins",
  );
  const losers = parallel.filter((outcome) => outcome.code === 8);
  for (const [index, outcome] of losers.entries()) {
    assert(
      outcome.out.includes("another maintenance run holds") ||
        outcome.out.includes("contested after reclaim"),
      `concurrent loser ${index + 1} names the contended lock`,
    );
  }
  assert(integrity() === "ok", "the DB stays integrity-clean after concurrent runs");
  assert(!existsSync(LOCK), "no lock survives the concurrent wave");

  const final = run("proj-a");
  assert(final.code === 0, "the lane stays healthy after the concurrent wave");
  assert(integrity() === "ok", "the DB stays integrity-clean at the end");

  console.log(
    `PROOF PASS: the DB maintenance lock preserves live holders across project copies, reclaims dead owners, and serializes concurrent runs (${passed} assertions)`,
  );
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
