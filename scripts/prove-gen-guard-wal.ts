import "./proof-log-isolate.ts";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const guard = join(repo, "scripts", "guard-db-generation.sh");
const work = mkdtempSync(join(tmpdir(), "gen-guard-"));

let passed = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`PROOF FAIL: ${msg}`);
    process.exit(1);
  }
  passed++;
  console.log(`ok ${msg}`);
}

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

type GuardRun = { status: number; stdout: string; stderr: string; ms: number };

function runGuard(db: string, expect: "v1" | "v2", env: Record<string, string> = {}): GuardRun {
  const started = Date.now();
  const r = spawnSync("bash", [guard, "--db", db, "--expect", expect, "--json"], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    status: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    ms: Date.now() - started,
  };
}

function guardJson(run: GuardRun): Record<string, unknown> {
  const line = run.stdout
    .trim()
    .split("\n")
    .filter((part) => part.startsWith("{"))
    .pop();
  assert(line !== undefined, "guard emitted a JSON line");
  return JSON.parse(line as string) as Record<string, unknown>;
}

function makeWalFixture(label: string, profile = "tawassul-v2"): { db: string; wal: string } {
  const dir = join(work, label, profile);
  mkdirSync(dir, { recursive: true });
  const db = join(dir, "opencode.db");
  spawnSync("python3", [
    "-c",
    [
      "import os, sqlite3, sys",
      "c = sqlite3.connect(sys.argv[1])",
      'c.execute("PRAGMA journal_mode=WAL")',
      'c.execute("PRAGMA wal_autocheckpoint=0")',
      'c.execute("CREATE TABLE session_v2(id INTEGER PRIMARY KEY)")',
      'c.execute("INSERT INTO session_v2 DEFAULT VALUES")',
      "c.commit()",
      "os._exit(0)",
    ].join("\n"),
    db,
  ]);
  const wal = `${db}-wal`;
  assert(existsSync(wal), `${label}: committed frames live in a WAL sidecar`);
  const shm = `${db}-shm`;
  if (existsSync(shm)) rmSync(shm);
  assert(!existsSync(shm), `${label}: WAL is orphaned (no -shm companion)`);
  return { db, wal };
}

function makeRollbackFixture(label: string): string {
  const dir = join(work, label, "tawassul-v2");
  mkdirSync(dir, { recursive: true });
  const db = join(dir, "opencode.db");
  spawnSync("sqlite3", [db, "CREATE TABLE session_v2(id INTEGER PRIMARY KEY);"]);
  assert(!existsSync(`${db}-wal`), `${label}: fixture has no WAL sidecar`);
  return db;
}

function mainFileMarkerCount(db: string): number {
  const dir = mkdtempSync(join(work, "main-only-"));
  const copy = join(dir, "db");
  copyFileSync(db, copy);
  const out = spawnSync(
    "sqlite3",
    ["-readonly", "--", copy, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='session_v2';"],
    { encoding: "utf8" },
  );
  return Number((out.stdout ?? "").trim());
}

async function withLock<T>(db: string, holdMs: number, fn: () => T | Promise<T>): Promise<T> {
  const holder = spawn(
    "python3",
    [
      "-c",
      [
        "import fcntl, os, sys, time",
        "fd = os.open(sys.argv[1], os.O_RDWR)",
        "fcntl.lockf(fd, fcntl.LOCK_EX, 0, 0)",
        'sys.stdout.write("locked\\n")',
        "sys.stdout.flush()",
        "time.sleep(float(sys.argv[2]))",
      ].join("\n"),
      db,
      String(holdMs / 1000),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise<void>((resolve, reject) => {
    let seen = "";
    const timer = setTimeout(() => reject(new Error("lock holder did not signal readiness")), 10000);
    holder.stdout?.on("data", (chunk: Buffer) => {
      seen += chunk.toString();
      if (seen.includes("locked")) {
        clearTimeout(timer);
        resolve();
      }
    });
    holder.on("exit", (code) => {
      if (!seen.includes("locked")) {
        clearTimeout(timer);
        reject(new Error(`lock holder exited before locking (code ${String(code)})`));
      }
    });
  });
  try {
    return await fn();
  } finally {
    holder.kill("SIGKILL");
  }
}

async function caseOrphan(): Promise<void> {
  const f = makeWalFixture("orphan");
  assert(mainFileMarkerCount(f.db) === 0, "orphan: session_v2 lives only in the WAL, not the main file");
  const dbBefore = digest(f.db);
  const walBefore = digest(f.wal);
  const run = runGuard(f.db, "v2");
  assert(run.status === 0, `orphan: guard exits 0 (got ${run.status})`);
  assert(guardJson(run).generation === "v2", "orphan: WAL-inclusive read reports the v2 marker");
  assert(run.stderr.includes("orphaned -wal sidecar"), "orphan: stderr warns about the orphaned -wal");
  assert(digest(f.db) === dbBefore, "orphan: main DB is byte-identical after the guard");
  assert(digest(f.wal) === walBefore, "orphan: WAL is byte-identical after the guard");
}

async function caseLockedSnapshot(): Promise<void> {
  const f = makeWalFixture("locked-copy");
  const dbBefore = digest(f.db);
  const walBefore = digest(f.wal);
  const run = await withLock(f.db, 20000, () => runGuard(f.db, "v2"));
  assert(run.status === 0, `locked: guard exits 0 through the snapshot (got ${run.status})`);
  assert(guardJson(run).generation === "v2", "locked: snapshot copy reads the v2 marker from the WAL");
  assert(run.stderr.includes("retried on a WAL-inclusive snapshot copy"), "locked: stderr names the snapshot copy");
  assert(run.ms >= 3000, `locked: direct probe is retried before copying (${run.ms}ms)`);
  assert(!existsSync(`${f.db}-shm`), "locked: direct probe never touched the live files");
  assert(digest(f.db) === dbBefore, "locked: main DB is byte-identical after the copy");
  assert(digest(f.wal) === walBefore, "locked: WAL is byte-identical after the copy");
}

async function caseLockedNoWal(): Promise<void> {
  const db = makeRollbackFixture("locked-nowal");
  const run = await withLock(db, 20000, () => runGuard(db, "v2"));
  assert(run.status === 3, `no-wal: failed probe exits 3, never fail-open (got ${run.status})`);
  assert(guardJson(run).verdict === "probe-failed", "no-wal: JSON verdict is probe-failed");
  assert(run.stderr.includes("fail-closed"), "no-wal: stderr states the fail-closed policy");
}

async function caseCopyFails(): Promise<void> {
  const f = makeWalFixture("copy-fails");
  const brokenTmp = join(work, "no-such-tmp", "nested");
  const run = await withLock(f.db, 20000, () => runGuard(f.db, "v2", { TMPDIR: brokenTmp }));
  assert(run.status === 3, `copy-fails: unusable snapshot dir exits 3 (got ${run.status})`);
  assert(guardJson(run).verdict === "probe-failed", "copy-fails: JSON verdict is probe-failed");
  assert(run.stderr.includes("fail-closed"), "copy-fails: a missing copy never reads as no markers");
}

async function caseTransientLock(): Promise<void> {
  const f = makeWalFixture("transient");
  const run = await withLock(f.db, 2500, () => runGuard(f.db, "v2"));
  assert(run.status === 0, `transient: guard exits 0 (got ${run.status})`);
  assert(guardJson(run).generation === "v2", "transient: generation is v2");
  assert(
    !run.stderr.includes("retried on a WAL-inclusive snapshot copy"),
    "transient: a lock that clears is retried without a copy",
  );
  assert(run.ms >= 1800, `transient: at least one retry sleep happened (${run.ms}ms)`);
}

async function caseV1LaneWalMarker(): Promise<void> {
  const f = makeWalFixture("v1-lane", "legacy-profile");
  assert(mainFileMarkerCount(f.db) === 0, "v1-lane: marker is invisible without the WAL");
  const run = await withLock(f.db, 20000, () => runGuard(f.db, "v1"));
  assert(run.status === 2, `v1-lane: WAL-only v2 marker is refused (got ${run.status})`);
  const json = guardJson(run);
  assert(json.generation === "v2", "v1-lane: snapshot reports the v2 generation");
  assert(json.reason === "marker-session_v2", "v1-lane: refusal reason is the session_v2 marker");
  assert(run.stderr.includes("V1 lane refuses a DB with V2 markers"), "v1-lane: stderr states the refusal");
}

try {
  await caseOrphan();
  await caseLockedSnapshot();
  await caseLockedNoWal();
  await caseCopyFails();
  await caseTransientLock();
  await caseV1LaneWalMarker();
  console.log(`PROOF PASS: generation guard WAL snapshot (${passed} assertions)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
