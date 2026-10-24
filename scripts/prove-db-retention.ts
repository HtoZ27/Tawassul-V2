import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

const repo = dirname(fileURLToPath(import.meta.url));
const maintenance = join(repo, "opencode-db-maintenance.sh");
const work = mkdtempSync(join(tmpdir(), "tawassul-v2-retention-"));
const db = join(work, "opencode.db");
const backups = join(work, "backups");
mkdirSync(backups, { recursive: true });

function sqlite(target: string, sql: string): string {
  return execFileSync("sqlite3", [target, sql], { encoding: "utf8", stdio: "pipe" }).trim();
}

function run(args: string[]): string {
  return execFileSync("bash", [maintenance, ...args], {
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, TMPDIR: work },
  });
}

function runFail(args: string[]): { status: number; output: string } {
  try {
    const output = run(args);
    fail(`expected failure but command succeeded: ${args.join(" ")}\n${output}`);
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const now = Math.floor(Date.now() / 1000);
const old = now - 200 * 86400;
sqlite(
  db,
  `
  PRAGMA foreign_keys = ON;
  CREATE TABLE session (id TEXT PRIMARY KEY, time_updated INTEGER);
  CREATE TABLE session_v2 (id TEXT PRIMARY KEY);
  CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_updated INTEGER);
  CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT REFERENCES message(id) ON DELETE CASCADE);
  CREATE TABLE event (id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, created INTEGER DEFAULT 0 NOT NULL);
  CREATE TABLE event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, owner_id TEXT);
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT);
  INSERT INTO session VALUES ('s-old', ${old});
  INSERT INTO session_v2 VALUES ('s-new');
  INSERT INTO message VALUES ('m-old', 's-old', ${old});
  INSERT INTO message VALUES ('m-new', 's-new', ${now});
  INSERT INTO part VALUES ('p-old', 'm-old');
  INSERT INTO part VALUES ('p-new', 'm-new');
  INSERT INTO event VALUES ('e1', 's-old', 1, 't', '{}', ${old});
  INSERT INTO event VALUES ('e2', 's-old', 2, 't', '{}', ${old});
  INSERT INTO event VALUES ('e3', 's-new', 1, 't', '{}', ${now});
  INSERT INTO kv VALUES ('migration.v1-v2', '{"phase":"completed"}');
`,
);

const check = run(["--db", db, "--check", "--prune-days", "0", "--ignore-low-ram"]);
assert(check.includes("event retention: 3 rows"), "check mode reports existing event rows");
assert(check.includes("dry-run only, nothing modified"), "check mode is read-only");

const foreign = mkdtempSync(join(tmpdir(), "tawassul-probe-"));
const foreignDb = join(foreign, "opencode.db");
copyFileSync(db, foreignDb);
const refused = runFail(["--db", foreignDb, "--event-only", "--ignore-low-ram"]);
assert(refused.status === 2, "event retention refuses a non-v2 path");
assert(refused.output.includes("generation guard refused"), "refusal names the generation guard");
assert(sqlite(foreignDb, "SELECT count(*) FROM event;") === "3", "refused DB keeps every event row");
rmSync(foreign, { recursive: true, force: true });

const off = run(["--db", db, "--event-only", "--event-retention", "off", "--ignore-low-ram"]);
assert(off.includes("event retention disabled"), "event retention can be disabled");
assert(sqlite(db, "SELECT count(*) FROM event;") === "3", "disabled retention keeps rows");

const eventOnly = run(["--db", db, "--event-only", "--ignore-low-ram"]);
assert(eventOnly.includes("deleted 3 rows"), "event-only deletes the previous run's events");
assert(sqlite(db, "SELECT count(*) FROM event;") === "0", "event table is empty after event-only");
assert(sqlite(db, "SELECT count(*) FROM session;") === "1", "event-only keeps legacy sessions");
assert(sqlite(db, "SELECT count(*) FROM session_v2;") === "1", "event-only keeps v2 sessions");

sqlite(db, `INSERT INTO event VALUES ('e4', 's-old', 4, 't', '{}', ${old}), ('e5', 's-new', 2, 't', '{}', ${now});`);

const full = run(["--db", db, "--prune-days", "90", "--backup-dir", backups, "--ignore-low-ram"]);
assert(full.includes("session_v2=1, session=1"), "backup probe counts both session tables");
assert(full.includes("deleted 2 rows"), "full run applies event retention");
assert(full.includes("event rows after: 0"), "full run reports zero event rows after retention");
assert(sqlite(db, "SELECT count(*) FROM event;") === "0", "full run leaves no event rows");
assert(sqlite(db, "SELECT count(*) FROM message WHERE id='m-old';") === "0", "old message is pruned");
assert(sqlite(db, "SELECT count(*) FROM message WHERE id='m-new';") === "1", "fresh message is kept");
assert(sqlite(db, "SELECT count(*) FROM part WHERE id='p-old';") === "0", "old part cascades with its message");
assert(sqlite(db, "SELECT count(*) FROM part WHERE id='p-new';") === "1", "fresh part is kept");
assert(sqlite(db, "SELECT count(*) FROM session;") === "1", "sessions are never deleted");
assert(sqlite(db, "SELECT count(*) FROM session_v2;") === "1", "v2 sessions are never deleted");

const backupFiles = readdirSync(backups).filter((name) => name.endsWith(".db"));
assert(backupFiles.length === 1 && existsSync(join(backups, backupFiles[0] ?? "")), "one verified backup is written");
const backupPath = join(backups, backupFiles[0] ?? "");
assert(sqlite(backupPath, "PRAGMA quick_check;") === "ok", "backup passes quick_check");
assert(sqlite(backupPath, "SELECT count(*) FROM session_v2;") === "1", "backup carries the v2 session table");
assert(sqlite(backupPath, "SELECT count(*) FROM event;") === "2", "backup preserves pre-retention events");

rmSync(work, { recursive: true, force: true });
console.log("PROOF PASS: v2 DB retention and dual-session backup probe");
