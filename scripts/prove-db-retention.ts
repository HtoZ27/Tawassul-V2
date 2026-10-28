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

function runFailEnv(args: string[], env: NodeJS.ProcessEnv): { status: number; output: string } {
  try {
    const output = execFileSync("bash", [maintenance, ...args], {
      encoding: "utf8",
      stdio: "pipe",
      env,
    });
    fail(`expected failure but command succeeded: ${args.join(" ")}\n${output}`);
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const now = Date.now();
const old = now - 200 * 86400000;
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
const guard = join(repo, "guard-db-generation.sh");
function guardRun(args: string[]): { status: number; output: string } {
  try {
    const output = execFileSync("bash", [guard, ...args], { encoding: "utf8", stdio: "pipe" });
    return { status: 0, output };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}
const guardEnforce = guardRun(["--db", foreignDb, "--expect", "v2", "--json"]);
assert(guardEnforce.status === 2, "the guard in enforce mode still refuses a non-v2 path");
assert(guardEnforce.output.includes("non-v2-path"), "guard enforce refusal names the path rule");
const foreignWarn = run(["--db", foreignDb, "--event-only", "--ignore-low-ram"]);
assert(foreignWarn.includes("would delete 1 of 3 rows"), "warn mode runs a bounded dry-run at a foreign path");
assert(foreignWarn.includes("keeps the newest 1 per aggregate"), "the bounded dry-run names its keep rule");
assert(sqlite(foreignDb, "SELECT count(*) FROM event;") === "3", "the dry-run deletes nothing at a foreign path");
const foreignDelete = run(["--db", foreignDb, "--event-only", "--event-delete", "--ignore-low-ram"]);
assert(foreignDelete.includes("deleted 1 rows"), "an explicit --event-delete applies the bounded retention");
assert(sqlite(foreignDb, "SELECT count(*) FROM event;") === "2", "bounded retention keeps the newest per aggregate");
const v1Foreign = join(foreign, "v1.db");
sqlite(
  v1Foreign,
  `CREATE TABLE session (id TEXT PRIMARY KEY);
CREATE TABLE message (id TEXT PRIMARY KEY, time_updated INTEGER);
INSERT INTO message VALUES ('m1', ${old});`,
);
const foreignV1 = runFail(["--db", v1Foreign, "--event-only", "--ignore-low-ram"]);
assert(foreignV1.status === 2, "warn mode still refuses v1 content at a foreign path");
assert(foreignV1.output.includes("generation guard refused"), "v1 refusal names the generation guard");
assert(sqlite(v1Foreign, "SELECT count(*) FROM message;") === "1", "refused v1 DB keeps every row");
rmSync(foreign, { recursive: true, force: true });

const off = run(["--db", db, "--event-only", "--event-retention", "off", "--ignore-low-ram"]);
assert(off.includes("event retention disabled"), "event retention can be disabled");
assert(sqlite(db, "SELECT count(*) FROM event;") === "3", "disabled retention keeps rows");

const eventOnly = run(["--db", db, "--event-only", "--ignore-low-ram"]);
assert(eventOnly.includes("would delete 1 of 3 rows"), "event-only is a dry-run by default (P2.10)");
assert(sqlite(db, "SELECT count(*) FROM event;") === "3", "the dry-run event-only deletes nothing");
const eventOnlyDelete = run(["--db", db, "--event-only", "--event-delete", "--ignore-low-ram"]);
assert(eventOnlyDelete.includes("deleted 1 rows"), "explicit event-only applies the bounded delete");
assert(sqlite(db, "SELECT count(*) FROM event;") === "2", "bounded event-only keeps the newest per aggregate");
assert(sqlite(db, "SELECT count(*) FROM session;") === "1", "event-only keeps legacy sessions");
assert(sqlite(db, "SELECT count(*) FROM session_v2;") === "1", "event-only keeps v2 sessions");

sqlite(db, `INSERT INTO event VALUES ('e4', 's-old', 4, 't', '{}', ${old}), ('e5', 's-new', 2, 't', '{}', ${now});`);

const full = run(["--db", db, "--prune-days", "90", "--event-delete", "--backup-dir", backups, "--ignore-low-ram"]);
assert(full.includes("session_v2=1, session=1"), "backup probe counts both session tables");
assert(full.includes("deleted 2 rows"), "full run applies bounded event retention (--event-delete)");
assert(full.includes("event rows after: 2"), "full run reports the kept rows after retention");
assert(sqlite(db, "SELECT count(*) FROM event;") === "2", "full run keeps the newest per aggregate");
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
assert(sqlite(backupPath, "SELECT count(*) FROM event;") === "4", "backup preserves pre-retention events");

const plan = run(["--plan"]);
assert(plan.includes("mutation-targets: message part session_message event"), "mutation allowlist is explicit");
assert(plan.includes("protected-tables:"), "protected table census is explicit");
assert(plan.includes("session_v2") && plan.includes("project") && plan.includes("permission") && plan.includes("credential"), "protected tables include sessions, projects, permissions, credentials");

const noDb = runFailEnv(["--check", "--ignore-low-ram"], { ...process.env, OPENCODE_DB: "" });
assert(noDb.status === 2, "implicit DB selection is refused");
assert(noDb.output.includes("implicit selection is disabled"), "implicit DB refusal names D-01");

const v2work = mkdtempSync(join(tmpdir(), "tawassul-v2-only-"));
const v2db = join(v2work, "opencode.db");
const v2backups = join(v2work, "backups");
mkdirSync(v2backups, { recursive: true });
sqlite(
  v2db,
  `
  CREATE TABLE session_v2 (id TEXT PRIMARY KEY);
  CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
  CREATE TABLE project (id TEXT PRIMARY KEY);
  CREATE TABLE permission (id TEXT PRIMARY KEY);
  CREATE TABLE credential (id TEXT PRIMARY KEY);
  CREATE TABLE migration (id TEXT PRIMARY KEY);
  INSERT INTO session_v2 VALUES ('v-old'), ('v-new');
  INSERT INTO session_message VALUES ('vm-old', 'v-old', 'text', 1, ${old}, ${old}, '{}');
  INSERT INTO session_message VALUES ('vm-new', 'v-new', 'text', 1, ${now}, ${now}, '{}');
  INSERT INTO project VALUES ('p1');
  INSERT INTO permission VALUES ('perm1');
  INSERT INTO credential VALUES ('cred1');
  INSERT INTO migration VALUES ('mig1');
`,
);
const v2check = run(["--db", v2db, "--check", "--prune-days", "90", "--ignore-low-ram"]);
assert(v2check.includes("v2 1 messages"), "check mode measures the v2 session_message delta");
const v2full = run(["--db", v2db, "--prune-days", "90", "--backup-dir", v2backups, "--ignore-low-ram"]);
assert(v2full.includes("history schema: message=0 session_message=1"), "v2-only schema is detected without message/part");
assert(v2full.includes("session_message=2"), "backup probe counts v2 history rows");
assert(sqlite(v2db, "SELECT count(*) FROM session_message WHERE id='vm-old';") === "0", "old v2 message is pruned");
assert(sqlite(v2db, "SELECT count(*) FROM session_message WHERE id='vm-new';") === "1", "fresh v2 message is kept");
assert(sqlite(v2db, "SELECT count(*) FROM session_v2;") === "2", "v2-only prune keeps every session");
assert(sqlite(v2db, "SELECT count(*) FROM project;") === "1", "project row survives maintenance");
assert(sqlite(v2db, "SELECT count(*) FROM permission;") === "1", "permission row survives maintenance");
assert(sqlite(v2db, "SELECT count(*) FROM credential;") === "1", "credential row survives maintenance");
assert(sqlite(v2db, "SELECT count(*) FROM migration;") === "1", "migration row survives maintenance");
const v2backupFiles = readdirSync(v2backups).filter((name) => name.endsWith(".db"));
assert(v2backupFiles.length === 1, "v2-only run writes one backup");
const v2backupPath = join(v2backups, v2backupFiles[0] ?? "");
assert(sqlite(v2backupPath, "SELECT count(*) FROM session_message;") === "2", "v2 backup carries both history rows");
const cap = runFail(["--db", v2db, "--event-only", "--cap-bytes", "1", "--ignore-low-ram"]);
assert(cap.status === 9, "event-only exits 9 when the cap remains");
assert(cap.output.includes("cap remains"), "cap refusal names the remaining cap");

rmSync(work, { recursive: true, force: true });
rmSync(v2work, { recursive: true, force: true });
console.log("PROOF PASS: v2 DB retention, protected tables, explicit target, and cap guard");
