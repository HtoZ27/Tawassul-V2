import "./proof-log-isolate.ts";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

const repo = dirname(fileURLToPath(import.meta.url));
const doctorScript = process.env.TAWASSUL_DOCTOR_SCRIPT ?? join(repo, "doctor-v2.sh");
const work = mkdtempSync(join(tmpdir(), "tawassul-d05-"));
const home = join(work, "home");
const project = join(work, "project");
const data = join(home, ".local/share");
const sidecar = join(data, "opencode/tawassul-v2/opencode.db");
const shared = join(data, "opencode/opencode.db");
const launcher = join(data, "tawassul-v2/opencode-v2.db");
const hmac = join(data, "opencode-projects/c9f1bc47443da701/opencode.db");

mkdirSync(join(project, ".opencode/plugins"), { recursive: true });
writeFileSync(join(project, ".opencode/plugins/tawassul.js"), "export default {};\n", "utf8");

function sql(dbPath: string, script: string): string {
  mkdirSync(dirname(dbPath), { recursive: true });
  return execFileSync("sqlite3", [dbPath], { input: script, encoding: "utf8" });
}

function v2(dbPath: string, sessions: number, directory: string, start = 0): void {
  sql(
    dbPath,
    "CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY, directory TEXT, project_id TEXT); CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, worktree TEXT);",
  );
  if (sessions === 0) return;
  const rows = Array.from({ length: sessions }, (_, index) => `('s${start + index}', '${directory}', NULL)`).join(", ");
  sql(dbPath, `INSERT INTO session_v2 (id, directory, project_id) VALUES ${rows};`);
}

function legacy(dbPath: string, sessions: number): void {
  sql(dbPath, "CREATE TABLE session (id TEXT);");
  if (sessions === 0) return;
  const rows = Array.from({ length: sessions }, (_, index) => `('v${index}')`).join(", ");
  sql(dbPath, `INSERT INTO session (id) VALUES ${rows};`);
}

type RunResult = { status: number; out: string };

function run(extra: Record<string, string> = {}, args: string[] = []): RunResult {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    "OPENCODE_DB",
    "TAWASSUL_SCOPE",
    "TAWASSUL_DOCTOR_ROOT",
    "TAWASSUL_DOCTOR_DB_CAP",
    "TAWASSUL_ALLOW_LEGACY_GROWTH",
  ]) {
    delete env[key];
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, ".config");
  env.XDG_STATE_HOME = join(home, ".local/state");
  env.XDG_CACHE_HOME = join(home, ".cache");
  env.TMPDIR = work;
  env.TAWASSUL_DOCTOR_ROOT = project;
  Object.assign(env, extra);
  const result = spawnSync("bash", [doctorScript, ...args], { env, encoding: "utf8" });
  return { status: result.status ?? -1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function hashes(paths: string[]): string {
  return paths
    .map((path) => `${path}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`)
    .join("\n");
}

async function main(): Promise<void> {
  v2(sidecar, 2, project);
  v2(shared, 14, "/legacy/project");
  v2(launcher, 14, "/legacy/project");
  v2(hmac, 0, "/legacy/project");
  const dbFiles = [sidecar, shared, launcher, hmac];
  const before = hashes(dbFiles);

  const clean = run();
  assert(clean.status === 0, "a clean declared layout passes");
  assert(clean.out.includes("bounded census found 4"), "the census counts every declared role");
  assert(clean.out.includes("PASS  one canonical session DB: canonical 2/2"), "the canonical DB is the only session owner");
  assert(
    clean.out.includes("shared(legacy-read-only) 0/14") && clean.out.includes("launcher(test-only) 0/14"),
    "the shared and launcher baselines are reported",
  );
  assert(hashes(dbFiles) === before, "the census never writes to the source databases");

  const redacted = run({}, ["--redact"]);
  assert(redacted.status === 0, "the redacted report still passes");
  assert(!redacted.out.includes(home), "the redacted report hides the home directory");
  assert(redacted.out.includes("~"), "the redacted report uses the home placeholder");
  assert(!redacted.out.includes(work), "the redacted report hides the scratch root");
  const redactedContract = run({}, ["--db-contract", "--redact"]);
  assert(redactedContract.status === 0, "the redacted DB contract still passes");
  assert(!redactedContract.out.includes(home), "the redacted DB contract hides the home directory");
  const help = run({}, ["--help"]);
  assert(help.status === 0 && help.out.includes("--redact"), "doctor --help lists --redact");
  assert(help.out.includes("--json"), "doctor --help lists --json");
  const bogus = run({}, ["--bogus"]);
  assert(bogus.status === 64, "an unknown doctor flag exits 64");

  const json = run({}, ["--json"]);
  assert(json.status === 0, "the JSON report passes on a clean layout");
  const report = JSON.parse(json.out) as {
    schema: number;
    redacted: boolean;
    summary: { failures: number; warnings: number };
    sections: Array<{ name: string; entries: Array<{ level: string; message: string }> }>;
  };
  assert(report.schema === 1, "the JSON report carries a schema version");
  assert(report.redacted === true, "the JSON report is redacted by default");
  assert(report.summary.failures === 0, "the JSON summary counts no failure on a clean layout");
  assert(report.sections.some((section) => section.name === "project"), "the JSON report keeps its sections");
  assert(
    report.sections.some((section) => section.name === "database census"),
    "the JSON report includes the database census",
  );
  assert(!json.out.includes(home), "the JSON report hides the home directory");
  assert(!json.out.includes(work), "the JSON report hides the scratch root");

  const jsonContract = run({}, ["--db-contract", "--json"]);
  assert(jsonContract.status === 0, "the JSON DB contract passes");
  const contractReport = JSON.parse(jsonContract.out) as {
    sections: Array<{ name: string }>;
  };
  assert(
    contractReport.sections.some((section) => section.name === "db maintenance contract"),
    "the JSON DB contract keeps its section",
  );

  const orphan = join(data, "opencode-projects/deadbeef/opencode.db");
  v2(orphan, 1, "/legacy/project");
  const orphanRun = run();
  assert(orphanRun.status === 1, "an undeclared database with sessions fails the doctor");
  assert(orphanRun.out.includes("undeclared database contains sessions"), "the failure names the undeclared database");
  assert(orphanRun.out.includes("deadbeef"), "the failure names the undeclared path");
  const orphanJson = run({}, ["--json"]);
  assert(orphanJson.status === 1, "the JSON report carries the failing exit code");
  const orphanReport = JSON.parse(orphanJson.out) as {
    summary: { failures: number };
    sections: Array<{ entries: Array<{ level: string; message: string }> }>;
  };
  assert(orphanReport.summary.failures > 0, "the JSON summary counts the failure");
  assert(
    orphanReport.sections.some((section) =>
      section.entries.some(
        (entry) => entry.level === "fail" && entry.message.includes("undeclared database contains sessions"),
      ),
    ),
    "the JSON report names the failing check",
  );
  rmSync(dirname(orphan), { recursive: true, force: true });

  v2(shared, 1, "/legacy/project", 14);
  const grown = run();
  assert(grown.status === 1, "growth of the legacy shared copy fails closed");
  assert(grown.out.includes("shared copy grew to 15"), "the shared growth failure names the count");
  const allowed = run({ TAWASSUL_ALLOW_LEGACY_GROWTH: "1" });
  assert(allowed.status === 0, "an explicit flag allows one deliberate legacy import");
  assert(
    allowed.out.includes("allowed by TAWASSUL_ALLOW_LEGACY_GROWTH=1"),
    "the allowed growth is reported as a warning",
  );
  sql(shared, "DELETE FROM session_v2 WHERE id='s14';");

  v2(launcher, 1, "/legacy/project", 14);
  const launcherGrown = run();
  assert(launcherGrown.status === 1, "growth of the launcher test copy fails closed");
  assert(launcherGrown.out.includes("launcher copy grew to 15"), "the launcher growth failure names the count");
  sql(launcher, "DELETE FROM session_v2 WHERE id='s14';");
  sql(launcher, "DELETE FROM session_v2 WHERE id='s13';");
  const shrunk = run();
  assert(shrunk.status === 0, "a session-count shrink does not fail the doctor");
  assert(
    shrunk.out.includes("launcher copy holds 13 session(s), below the 14 baseline"),
    "the shrink is reported as a warning",
  );
  v2(launcher, 1, "/legacy/project", 13);

  const cliDb = join(data, "opencode/tawassul-v2/projects/20744975b9574157/opencode.db");
  v2(cliDb, 1, project);
  const cliRun = run();
  assert(cliRun.status === 1, "a v2 CLI namespace database with sessions fails closed");
  assert(cliRun.out.includes("v2 CLI project namespace holds sessions"), "the CLI failure names the namespace");
  rmSync(dirname(cliDb), { recursive: true, force: true });

  const capped = run({ TAWASSUL_DOCTOR_DB_CAP: "2" });
  assert(capped.status === 1, "the census fails closed at the configured cap");
  assert(capped.out.includes("2-file cap"), "the cap failure names the configured cap");

  const outside = join(work, "outside");
  v2(join(outside, "hidden/opencode.db"), 1, "/legacy/project");
  symlinkSync(join(outside, "hidden"), join(data, "opencode/linked-projects"), "dir");
  const linked = run();
  assert(linked.status === 0, "the census does not follow symlinked directories");
  assert(!linked.out.includes(outside), "a database behind a symlink is not classified");
  rmSync(join(data, "opencode/linked-projects"), { force: true });
  rmSync(outside, { recursive: true, force: true });

  const v1only = join(data, "opencode-projects/v1only/opencode.db");
  legacy(v1only, 1);
  const legacyRun = run();
  assert(legacyRun.status === 1, "a legacy-only database with sessions fails closed");
  assert(legacyRun.out.includes("undeclared database contains sessions"), "the legacy-only database is named");
  rmSync(dirname(v1only), { recursive: true, force: true });

  const unreadable = join(data, "opencode-projects/unreadable/opencode.db");
  v2(unreadable, 1, "/legacy/project");
  chmodSync(unreadable, 0o000);
  const unreadableRun = run();
  assert(unreadableRun.status === 1, "an unreadable database fails closed");
  assert(unreadableRun.out.includes("could not be snapshotted or read"), "the unreadable census fails closed");
  chmodSync(unreadable, 0o600);
  rmSync(dirname(unreadable), { recursive: true, force: true });

  const junk = join(data, "opencode-projects/junk/opencode.db");
  sql(junk, "CREATE TABLE t (x TEXT);");
  const junkRun = run();
  assert(junkRun.status === 0, "a non-OpenCode opencode.db is ignored");
  assert(junkRun.out.includes("not an OpenCode database"), "the census labels a non-OpenCode file");
  rmSync(dirname(junk), { recursive: true, force: true });

  rmSync(work, { recursive: true, force: true });
  console.log(`PROOF PASS: ${passed} assertions`);
}

await main();
