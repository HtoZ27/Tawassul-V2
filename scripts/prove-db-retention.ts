import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
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

function run(args: string[], extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync("bash", [maintenance, ...args], {
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, TMPDIR: work, ...extraEnv },
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
assert(check.includes("with --event-delete"), "check mode names the flag that applies event retention");
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

const dryWork = mkdtempSync(join(tmpdir(), "tawassul-event-dry-"));
const dryBackups = join(dryWork, "backups");
mkdirSync(dryBackups, { recursive: true });
const dry = run(["--db", db, "--prune-days", "0", "--tool-retention-days", "0", "--reasoning-retention-days", "0", "--backup-dir", dryBackups, "--ignore-low-ram"]);
assert(dry.includes("nothing to do"), "event rows without --event-delete are not counted as work");
assert(readdirSync(dryBackups).filter((name) => name.endsWith(".db")).length === 0, "a dry-run event pass writes no backup");
assert(sqlite(db, "SELECT count(*) FROM event;") === "4", "a dry-run event pass deletes nothing");
const noSurplus = run(["--db", db, "--prune-days", "0", "--tool-retention-days", "0", "--reasoning-retention-days", "0", "--event-delete", "--event-keep", "10", "--backup-dir", dryBackups, "--ignore-low-ram"]);
assert(noSurplus.includes("nothing to do"), "explicit event retention with no surplus is not work");
assert(readdirSync(dryBackups).filter((name) => name.endsWith(".db")).length === 0, "a no-surplus event pass writes no backup");
assert(sqlite(db, "SELECT count(*) FROM event;") === "4", "a no-surplus event pass deletes nothing");

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

const liveSessions = sqlite(db, "SELECT count(*) FROM session;");
const liveV2Sessions = sqlite(db, "SELECT count(*) FROM session_v2;");
rmSync(db, { force: true });
rmSync(`${db}-wal`, { force: true });
rmSync(`${db}-shm`, { force: true });
copyFileSync(backupPath, db);
assert(sqlite(db, "PRAGMA quick_check;") === "ok", "the restored database passes quick_check");
assert(sqlite(db, "SELECT count(*) FROM session;") === liveSessions, "restore keeps the legacy session count");
assert(sqlite(db, "SELECT count(*) FROM session_v2;") === liveV2Sessions, "restore keeps the v2 session count");
assert(sqlite(db, "SELECT count(*) FROM message WHERE id='m-old';") === "1", "restore brings back the pruned message");

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

const toolWork = mkdtempSync(join(tmpdir(), "tawassul-tool-payload-"));
const toolDb = join(toolWork, "opencode.db");
const toolBackups = join(toolWork, "backups");
mkdirSync(toolBackups, { recursive: true });
const payload = "R".repeat(5000);
sqlite(
  toolDb,
  `
  CREATE TABLE session_v2 (id TEXT PRIMARY KEY);
  CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
  INSERT INTO session_v2 VALUES ('ts1');
  INSERT INTO session_message VALUES ('old_read', 'ts1', 'assistant', 1, ${old}, ${old}, '{"content":[{"type":"text","text":"before"},{"type":"tool","name":"read","state":{"status":"completed","input":{"path":"/tmp/old"},"content":[{"type":"text","text":"${payload}"}]}}]}');
  INSERT INTO session_message VALUES ('new_read', 'ts1', 'assistant', 2, ${now}, ${now}, '{"content":[{"type":"tool","name":"read","state":{"status":"completed","input":{"path":"/tmp/new"},"content":[{"type":"text","text":"${payload}"}]}}]}');
  INSERT INTO session_message VALUES ('old_shell', 'ts1', 'assistant', 3, ${old}, ${old}, '{"content":[{"type":"tool","name":"shell","state":{"status":"completed","output":"KEEPME"}}]}');
  INSERT INTO session_message VALUES ('bad_json', 'ts1', 'assistant', 4, ${old}, ${old}, 'not json');
  INSERT INTO session_message VALUES ('str_content', 'ts1', 'assistant', 5, ${old}, ${old}, '{"content":"plain"}');
  INSERT INTO session_message VALUES ('mixed_content', 'ts1', 'assistant', 6, ${old}, ${old}, '{"content":[null,true,false,"plain",{"type":"tool","name":"read","state":{"input":{"path":"/tmp/mixed"},"content":[{"type":"text","text":"${payload}"}]}}]}');
  INSERT INTO session_message VALUES ('old_reason', 'ts1', 'assistant', 7, ${old}, ${old}, '{"content":[{"type":"reasoning","text":"OLD TRACE"},{"type":"text","text":"answer"}]}');
  INSERT INTO session_message VALUES ('new_reason', 'ts1', 'assistant', 8, ${now}, ${now}, '{"content":[{"type":"reasoning","text":"NEW TRACE"},{"type":"text","text":"fresh"}]}');
`,
);
const toolCheck = run(["--db", toolDb, "--check", "--prune-days", "0", "--tool-retention-days", "1", "--ignore-low-ram"]);
assert(toolCheck.includes("2 messages hold read results older than 1d"), "check mode counts old read payloads");
const toolFull = run(["--db", toolDb, "--prune-days", "0", "--tool-retention-days", "1", "--backup-dir", toolBackups, "--ignore-low-ram"]);
assert(toolFull.includes("tool payloads: rewrote 2 messages"), "the read-payload rewrite reports both messages");
assert(toolFull.includes("reasoning: rewrote 1 messages"), "the reasoning rewrite reports one message");
assert(sqlite(toolDb, "SELECT data FROM session_message WHERE id='old_read';").includes("[read output pruned: /tmp/old]"), "the old read result becomes a placeholder");
assert(!sqlite(toolDb, "SELECT data FROM session_message WHERE id='old_read';").includes(payload), "the old read bytes are gone");
assert(sqlite(toolDb, "SELECT data FROM session_message WHERE id='new_read';").includes(payload), "a fresh read result is kept");
assert(sqlite(toolDb, "SELECT data FROM session_message WHERE id='old_shell';").includes("KEEPME"), "non-read tool output is kept");
assert(sqlite(toolDb, "SELECT data FROM session_message WHERE id='bad_json';") === "not json", "invalid JSON is never rewritten");
assert(sqlite(toolDb, "SELECT data FROM session_message WHERE id='str_content';") === '{"content":"plain"}', "non-array content is never rewritten");
assert(sqlite(toolDb, "SELECT json_valid(data) FROM session_message WHERE id='mixed_content';") === "1", "mixed content stays valid JSON");
assert(sqlite(toolDb, "SELECT data FROM session_message WHERE id='mixed_content';").includes("[read output pruned: /tmp/mixed]"), "a read inside mixed content is rewritten");
assert(sqlite(toolDb, "SELECT data FROM session_message WHERE id='mixed_content';").includes('"plain"'), "a string sibling survives the rewrite");
assert(sqlite(toolDb, "SELECT json_type(data,'$.content[1]') FROM session_message WHERE id='mixed_content';") === "true", "a boolean true sibling survives the rewrite");
assert(sqlite(toolDb, "SELECT json_type(data,'$.content[2]') FROM session_message WHERE id='mixed_content';") === "false", "a boolean false sibling survives the rewrite");
assert(sqlite(toolDb, "SELECT data FROM session_message WHERE id='old_reason';").includes("[reasoning pruned]"), "old reasoning becomes a placeholder");
assert(sqlite(toolDb, "SELECT data FROM session_message WHERE id='old_reason';").includes("answer"), "the answer text survives reasoning pruning");
assert(sqlite(toolDb, "SELECT data FROM session_message WHERE id='new_reason';").includes("NEW TRACE"), "fresh reasoning is kept");
assert(sqlite(toolDb, "SELECT count(*) FROM session_message;") === "8", "the rewrite keeps every message row");
assert(sqlite(toolDb, "SELECT json_valid(data) FROM session_message WHERE id='old_read';") === "1", "the rewritten message stays valid JSON");
assert(sqlite(toolDb, "SELECT count(*) FROM session_v2;") === "1", "the rewrite keeps the session row");
const toolBackupFiles = readdirSync(toolBackups).filter((name) => name.endsWith(".db"));
assert(toolBackupFiles.length === 1, "the read-payload run writes one backup");
const toolBackupPath = join(toolBackups, toolBackupFiles[0] ?? "");
assert(sqlite(toolBackupPath, "SELECT data FROM session_message WHERE id='old_read';").includes(payload), "the backup carries the original read payload");
const toolAgain = run(["--db", toolDb, "--prune-days", "0", "--tool-retention-days", "1", "--backup-dir", toolBackups, "--ignore-low-ram"]);
assert(toolAgain.includes("nothing to do"), "a second read-payload run is a no-op");

const inUseWork = mkdtempSync(join(tmpdir(), "tawassul-in-use-"));
const inUseDb = join(inUseWork, "opencode.db");
const inUseBackups = join(inUseWork, "backups");
mkdirSync(inUseBackups, { recursive: true });
sqlite(
  inUseDb,
  `
  CREATE TABLE session_v2 (id TEXT PRIMARY KEY);
  CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
  INSERT INTO session_v2 VALUES ('iu1');
  INSERT INTO session_message VALUES ('iu_old', 'iu1', 'assistant', 1, ${old}, ${old}, '{"content":[{"type":"tool","name":"read","state":{"input":{"path":"/tmp/iu"},"content":[{"type":"text","text":"${payload}"}]}}]}');
`,
);
const inUseRun = run([
  "--db", inUseDb, "--allow-in-use", "--prune-days", "0", "--tool-retention-days", "1",
  "--backup-dir", inUseBackups, "--ignore-low-ram",
]);
assert(inUseRun.includes("tool payloads: rewrote 1 messages"), "in-use mode rewrites read payloads");
assert(
  sqlite(inUseDb, "SELECT data FROM session_message WHERE id='iu_old';").includes("[read output pruned: /tmp/iu]"),
  "the in-use rewrite lands without quiescence",
);
assert(sqlite(inUseDb, "SELECT count(*) FROM session_message;") === "1", "the in-use rewrite keeps the message row");
sqlite(
  inUseDb,
  `INSERT INTO session_message VALUES ('iu_cap', 'iu1', 'assistant', 2, ${old}, ${old}, '{"content":[{"type":"tool","name":"read","state":{"input":{"path":"/tmp/iu-cap"},"content":[{"type":"text","text":"${payload}"}]}}]}');`,
);
const capHolder = spawn("bash", ["-c", `exec 3<"${inUseDb}"; sleep 20`], { stdio: "ignore" });
try {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  const inUseCap = run([
    "--db", inUseDb, "--allow-in-use", "--prune-days", "0", "--tool-retention-days", "1",
    "--cap-bytes", "1", "--backup-dir", inUseBackups, "--ignore-low-ram",
  ]);
  assert(inUseCap.includes("note: VACUUM was skipped"), "an in-use run exits 0 with a note when the cap cannot be reclaimed");
} finally {
  capHolder.kill();
}

const solverWork = mkdtempSync(join(tmpdir(), "tawassul-solver-retention-"));
const solverDb = join(solverWork, "opencode.db");
const solverBackups = join(solverWork, "backups");
mkdirSync(solverBackups, { recursive: true });
sqlite(
  solverDb,
  `
  CREATE TABLE session_v2 (id TEXT PRIMARY KEY);
  CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
  INSERT INTO session_v2 VALUES ('sv1');
  INSERT INTO session_message VALUES ('sv_old', 'sv1', 'assistant', 1, ${old}, ${old}, '{"content":[{"type":"tool","name":"read","state":{"input":{"path":"/tmp/solver"},"content":[{"type":"text","text":"${payload}"}]}}]}');
`,
);
const solverRun = run([
  "--db", solverDb, "--target-bytes", "10485760", "--tool-retention-days", "1",
  "--backup-dir", solverBackups, "--ignore-low-ram",
]);
assert(solverRun.includes("message pruning skipped, VACUUM follows"), "a retention pass that meets the target skips message pruning");
assert(!solverRun.includes("prune: deleted"), "no message row is deleted when retention meets the target");
assert(sqlite(solverDb, "SELECT count(*) FROM session_message WHERE id='sv_old';") === "1", "the old message row survives the solver run");
assert(
  sqlite(solverDb, "SELECT data FROM session_message WHERE id='sv_old';").includes("[read output pruned: /tmp/solver]"),
  "the solver run rewrote the read payload",
);
assert(solverRun.includes("vacuum into-swap") || solverRun.includes("vacuum ("), "the solver run still vacuums after retention");

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

const headroomRefused = runFailEnv(
  ["--db", spDb, "--prune-days", "3", "--backup-dir", spBackups, "--ignore-low-ram"],
  { ...process.env, TMPDIR: spWork, TAWASSUL_VACUUM_MIN_FREE: "1G" },
);
assert(headroomRefused.status === 2, "an invalid VACUUM headroom is refused with rc 2");
assert(headroomRefused.output.includes("TAWASSUL_VACUUM_MIN_FREE"), "the refusal names the invalid headroom variable");
assert(sqlite(spDb, "SELECT count(*) FROM session_message;") === "1", "an invalid headroom refusal mutates nothing");

const rcWork = mkdtempSync(join(tmpdir(), "tawassul-reclaim-"));
const rcDb = join(rcWork, "opencode.db");
const rcBackups = join(rcWork, "backups");
mkdirSync(rcBackups, { recursive: true });
sqlite(
  rcDb,
  `CREATE TABLE session_v2 (id TEXT PRIMARY KEY);
   CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
   CREATE TABLE filler (id TEXT PRIMARY KEY, payload BLOB);
   INSERT INTO session_v2 VALUES ('rc1');
   INSERT INTO session_message VALUES ('rcm', 'rc1', 'text', 0, ${now}, ${now}, 'x');
   INSERT INTO filler VALUES ('big', zeroblob(2097152));
   DELETE FROM filler WHERE id='big';`,
);
const rcFree = Number(sqlite(rcDb, "PRAGMA freelist_count;")) * Number(sqlite(rcDb, "PRAGMA page_size;"));
assert(rcFree >= 1048576, "the fixture carries a freelist of at least 1 MiB");
const rcBefore = statSync(rcDb).size;
const rcIdle = run(["--db", rcDb, "--prune-days", "0", "--backup-dir", rcBackups, "--ignore-low-ram"]);
assert(rcIdle.includes("nothing to do"), "a freelist below the reclaim floor is not worth a copy");
assert(readdirSync(rcBackups).filter((name) => name.endsWith(".db")).length === 0, "the idle reclaim check writes no backup");
const rcRun = run(["--db", rcDb, "--prune-days", "0", "--backup-dir", rcBackups, "--ignore-low-ram"], {
  TAWASSUL_RECLAIM_MIN_FREE: "1048576",
});
assert(rcRun.includes("reclaim: freelist holds"), "a freelist above the reclaim floor is reported");
assert(rcRun.includes("vacuum into-swap") || rcRun.includes("vacuum ("), "the reclaim run still vacuums");
assert(!rcRun.includes("prune: deleted"), "the reclaim run deletes no message rows");
assert(sqlite(rcDb, "PRAGMA freelist_count;") === "0", "the reclaim VACUUM returns every free page");
assert(statSync(rcDb).size < rcBefore, "the reclaim VACUUM shrinks the file");
assert(readdirSync(rcBackups).filter((name) => name.endsWith(".db")).length === 1, "the reclaim run writes one backup");

rmSync(work, { recursive: true, force: true });
rmSync(v2work, { recursive: true, force: true });
rmSync(floorWork, { recursive: true, force: true });
rmSync(spWork, { recursive: true, force: true });
rmSync(rcWork, { recursive: true, force: true });
rmSync(dryWork, { recursive: true, force: true });
rmSync(inUseWork, { recursive: true, force: true });
rmSync(toolWork, { recursive: true, force: true });
rmSync(solverWork, { recursive: true, force: true });
console.log("PROOF PASS: v2 DB retention, session anchor, protected tables, explicit target, cap and space gates");
