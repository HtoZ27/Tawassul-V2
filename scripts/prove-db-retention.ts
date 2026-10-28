import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
const old2 = now - 190 * 86400000;
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
  INSERT INTO message VALUES ('m-old2', 's-old', ${old2});
  INSERT INTO message VALUES ('m-new', 's-new', ${now});
  INSERT INTO part VALUES ('p-old', 'm-old');
  INSERT INTO part VALUES ('p-old2', 'm-old2');
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
const guardWarn = guardRun(["--db", foreignDb, "--expect", "v2", "--path-rule", "warn", "--json"]);
assert(guardWarn.status === 0, "the guard in warn mode accepts v2 content at a foreign path (P0.3)");
assert(guardWarn.output.includes('"verdict":"ok"'), "warn mode reports an ok verdict for v2 content");
assert(guardWarn.output.includes('"warnings":["non-v2-path'), "warn mode records the path suspicion in warnings[]");
assert(guardWarn.output.includes('"generation":"v2"'), "warn mode proves the v2 generation by content");
const guardBadRule = guardRun(["--db", foreignDb, "--expect", "v2", "--path-rule", "loose", "--json"]);
assert(guardBadRule.status === 2, "an unknown --path-rule value is refused");
assert(guardBadRule.output.includes("--path-rule must be enforce|warn"), "the refusal names the allowed path rules");
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
assert(sqlite(db, "SELECT count(*) FROM message WHERE id='m-old2';") === "1", "the session anchor (newest old message) survives");
assert(sqlite(db, "SELECT count(*) FROM message WHERE session_id='s-old';") === "1", "the dormant session keeps exactly one message");
assert(sqlite(db, "SELECT count(*) FROM message WHERE id='m-new';") === "1", "fresh message is kept");
assert(sqlite(db, "SELECT count(*) FROM part WHERE id='p-old';") === "0", "old part cascades with its message");
assert(sqlite(db, "SELECT count(*) FROM part WHERE id='p-old2';") === "1", "the anchor message keeps its part");
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
const planMutation = (plan.match(/mutation-targets: (.*)/) ?? [])[1]?.trim() ?? "";
const planProtected = (plan.match(/protected-tables: (.*)/) ?? [])[1]?.trim() ?? "";
assert(planMutation === "message part session_message event", "the mutation allowlist is exactly the four history/event tables");
assert(planProtected.length > 0, "protected table census is explicit");
assert(
  ["session_v2", "project", "permission", "credential", "blob", "blob_ref", "instruction_blob"].every((t) =>
    planProtected.split(/\s+/).includes(t),
  ),
  "protected tables include sessions, projects, permissions, credentials, blob, blob_ref, instruction_blob",
);
const mutationSet = planMutation.split(/\s+/).filter(Boolean);
const protectedSet = planProtected.split(/\s+/).filter(Boolean);
assert(mutationSet.every((t) => !protectedSet.includes(t)), "no mutable table is also on the protected list");
const maintenanceSrc = readFileSync(maintenance, "utf-8");
assert(
  maintenanceSrc.includes("refusing mutation target") && maintenanceSrc.includes("*\" $1 \"*) return 0"),
  "the script refuses any table that is not on the allowlist (static contract)",
);

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
  INSERT INTO session_message VALUES ('vm-old2', 'v-old', 'text', 2, ${old2}, ${old2}, '{}');
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
assert(v2full.includes("session_message=3"), "backup probe counts v2 history rows");
assert(sqlite(v2db, "SELECT count(*) FROM session_message WHERE id='vm-old';") === "0", "old v2 message is pruned");
assert(sqlite(v2db, "SELECT count(*) FROM session_message WHERE id='vm-old2';") === "1", "the v2 session anchor survives");
assert(sqlite(v2db, "SELECT count(*) FROM session_message WHERE id='vm-new';") === "1", "fresh v2 message is kept");
assert(sqlite(v2db, "SELECT count(*) FROM session_v2;") === "2", "v2-only prune keeps every session");
assert(sqlite(v2db, "SELECT count(*) FROM project;") === "1", "project row survives maintenance");
assert(sqlite(v2db, "SELECT count(*) FROM permission;") === "1", "permission row survives maintenance");
assert(sqlite(v2db, "SELECT count(*) FROM credential;") === "1", "credential row survives maintenance");
assert(sqlite(v2db, "SELECT count(*) FROM migration;") === "1", "migration row survives maintenance");
const v2backupFiles = readdirSync(v2backups).filter((name) => name.endsWith(".db"));
assert(v2backupFiles.length === 1, "v2-only run writes one backup");
const v2backupPath = join(v2backups, v2backupFiles[0] ?? "");
assert(sqlite(v2backupPath, "SELECT count(*) FROM session_message;") === "3", "v2 backup carries every history row");
const cap = runFail(["--db", v2db, "--event-only", "--cap-bytes", "1", "--ignore-low-ram"]);
assert(cap.status === 9, "event-only exits 9 when the cap remains");
assert(cap.output.includes("cap remains"), "cap refusal names the remaining cap");

const floorWork = mkdtempSync(join(tmpdir(), "tawassul-floor-"));
const floorDb = join(floorWork, "opencode.db");
const floorBackups = join(floorWork, "backups");
mkdirSync(floorBackups, { recursive: true });
const dormant = 11;
const active = 63;
const activeRows = 3;
const floorSql: string[] = [
  "CREATE TABLE session_v2 (id TEXT PRIMARY KEY);",
  "CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);",
];
for (let i = 0; i < dormant; i += 1) {
  floorSql.push(`INSERT INTO session_v2 VALUES ('dorm${i}');`);
  for (let j = 0; j < 3; j += 1) {
    floorSql.push(
      `INSERT INTO session_message VALUES ('dm${i}-${j}', 'dorm${i}', 'text', ${j}, ${old + j}, ${old + j}, '${"x".repeat(64)}');`,
    );
  }
}
for (let i = 0; i < active; i += 1) {
  floorSql.push(`INSERT INTO session_v2 VALUES ('act${i}');`);
  floorSql.push(
    `INSERT INTO session_message VALUES ('am${i}', 'act${i}', 'text', 9, ${now}, ${now}, '${"x".repeat(64)}');`,
  );
  for (let j = 0; j < activeRows - 1; j += 1) {
    floorSql.push(
      `INSERT INTO session_message VALUES ('ao${i}-${j}', 'act${i}', 'text', ${j}, ${old + j}, ${old + j}, '${"x".repeat(64)}');`,
    );
  }
}
sqlite(floorDb, floorSql.join("\n"));
assert(sqlite(floorDb, "SELECT count(*) FROM session_v2;") === "74", "the synthetic database carries 74 sessions");
const floorRun = run(["--db", floorDb, "--prune-days", "3", "--backup-dir", floorBackups, "--ignore-low-ram"]);
assert(floorRun.includes("deleted 22 rows"), "the 3-day floor prunes every dormant session's history but the anchor");
assert(
  sqlite(floorDb, "SELECT count(*) FROM session_v2 s WHERE NOT EXISTS (SELECT 1 FROM session_message m WHERE m.session_id = s.id);") ===
    "0",
  "after the 3-day floor every session still holds at least one message (DoD 11)",
);
assert(
  sqlite(floorDb, "SELECT count(*) FROM session_message;") === `${dormant + active * activeRows}`,
  "each dormant session keeps exactly one anchor message; active sessions are untouched",
);
assert(sqlite(floorDb, "SELECT count(*) FROM session_v2;") === "74", "no session_v2 row is deleted by the floor prune");
assert(
  sqlite(floorDb, "SELECT count(*) FROM session_message WHERE session_id = 'dorm0';") === "1",
  "a dormant session reopens with its newest message, never empty",
);

const spWork = mkdtempSync(join(tmpdir(), "tawassul-space-"));
const spDb = join(spWork, "opencode.db");
const spBackups = join(spWork, "backups");
mkdirSync(spBackups, { recursive: true });
sqlite(
  spDb,
  `CREATE TABLE session_v2 (id TEXT PRIMARY KEY);
   CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
   INSERT INTO session_v2 VALUES ('s1');
   INSERT INTO session_message VALUES ('m0', 's1', 'text', 0, ${old}, ${old}, 'x');
   INSERT INTO session_message VALUES ('m1', 's1', 'text', 1, ${old + 1}, ${old + 1}, 'x');`,
);
const spaceRefused = runFailEnv(
  ["--db", spDb, "--prune-days", "3", "--backup-dir", spBackups, "--ignore-low-ram"],
  { ...process.env, TMPDIR: spWork, TAWASSUL_VACUUM_MIN_FREE: "999999999999" },
);
assert(spaceRefused.status === 7, "VACUUM refuses with rc 7 when free space is below the db+wal+1GiB gate (F27)");
assert(spaceRefused.output.includes("free space"), "the space-gate refusal names free space");
assert(spaceRefused.output.includes("db+wal+1GiB gate"), "the refusal names the db+wal+1GiB gate");
assert(sqlite(spDb, "PRAGMA quick_check;") === "ok", "the refused VACUUM leaves the database intact");
assert(sqlite(spDb, "SELECT count(*) FROM session_message;") === "1", "the prune still applied before the refused VACUUM");

rmSync(work, { recursive: true, force: true });
rmSync(v2work, { recursive: true, force: true });
rmSync(floorWork, { recursive: true, force: true });
rmSync(spWork, { recursive: true, force: true });
console.log("PROOF PASS: v2 DB retention, session anchor, protected tables, explicit target, cap and space gates");
