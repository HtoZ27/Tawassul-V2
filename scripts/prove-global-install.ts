import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  claimCoexistence,
  detectInstallScope,
  isCoexistenceOwner,
  releaseCoexistence,
} from "../src/core/install-scope.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = mkdtempSync(join(tmpdir(), "tawassul-global-install-"));
const HOME = join(ROOT, "home");
const CONFIG = join(HOME, ".config");
const GLOBAL = join(CONFIG, "opencode");
const PLUGIN_DIR = join(GLOBAL, "plugins");
const TARGET = join(PLUGIN_DIR, "tawassul.js");
const LEGACY = join(GLOBAL, "plugins", "tawassul");
const RUNTIME = join(GLOBAL, "tawassul-runtime");
const MARKER = join(RUNTIME, "VERSION");
const WASM = join(RUNTIME, "wasm");
const USER_CONFIG = join(GLOBAL, "opencode.jsonc");
const BODY = `{\n  "$schema": "https://opencode.ai/config.json",\n  "model": "opencode/big-pickle"\n}\n`;
const WASM_FILES = [
  join(WASM, "web-tree-sitter", "web-tree-sitter.wasm"),
  join(WASM, "tree-sitter-javascript", "tree-sitter-javascript.wasm"),
  join(WASM, "tree-sitter-typescript", "tree-sitter-typescript.wasm"),
  join(WASM, "tree-sitter-typescript", "tree-sitter-tsx.wasm"),
];
const DB_DIR = join(RUNTIME, "db");
const DB_FILES: Array<[string, string]> = [
  ["maintenance", "opencode-db-maintenance.sh"],
  ["guard", "guard-db-generation.sh"],
  ["scheduled", "opencode-db-scheduled.sh"],
  ["db-env", "db-env.sh"],
  ["doctor", "doctor-v2.sh"],
];
const SMOKE_ROOT = join(ROOT, "smoke");
const SMOKE_DB = join(SMOKE_ROOT, "opencode.db");

type Marker = {
  package?: string;
  version?: string;
  host?: string;
  bundle?: { path?: string; sha256?: string; bytes?: number };
  wasm?: Record<string, { path?: string; sha256?: string; bytes?: number }>;
  db?: Record<string, { path?: string; sha256?: string; bytes?: number }>;
  preflight?: Record<string, string>;
  trigger?: string;
};

function proofEnv(): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {
    ...process.env,
    HOME,
    XDG_CONFIG_HOME: CONFIG,
    XDG_DATA_HOME: join(HOME, ".local", "share"),
    XDG_STATE_HOME: join(HOME, ".local", "state"),
    XDG_CACHE_HOME: join(HOME, ".cache"),
    PATH: "/usr/bin:/bin",
    TAWASSUL_OPENCODE_VERSION: "2.2.0",
    TAWASSUL_REGISTER_TRIGGERS: "off",
    OPENCODE_DB: SMOKE_DB,
  };
  delete next.TAWASSUL_GLOBAL_DIR;
  delete next.TAWASSUL_SCOPE;
  delete next.OPENCODE_BIN;
  return next;
}

function runWith(args: string[], env: NodeJS.ProcessEnv, cwd?: string): { code: number; out: string } {
  const result = spawnSync(
    process.execPath,
    [join(REPO, "scripts", "install-global.ts"), ...args],
    { env, encoding: "utf-8", ...(cwd ? { cwd } : {}) },
  );
  return {
    code: result.status ?? -1,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function run(args: string[]): { code: number; out: string } {
  return runWith(args, proofEnv());
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function marker(): Marker {
  return JSON.parse(readFileSync(MARKER, "utf-8")) as Marker;
}

function selfContainedBundle(text: string): boolean {
  return !/(?:from|import\()\s*["'](?:@opencode|zod|web-tree-sitter|effect)(?:\/[^"']*)?["']/.test(
    text,
  );
}

function createSyntheticDb(): string {
  const result = spawnSync(
    "sqlite3",
    [
      SMOKE_DB,
      [
        "CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY);",
        "CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY);",
        "CREATE TABLE IF NOT EXISTS session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);",
        "CREATE TABLE IF NOT EXISTS event (id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, created INTEGER DEFAULT 0 NOT NULL);",
        "CREATE TABLE IF NOT EXISTS event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, owner_id TEXT);",
        "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        "INSERT INTO session_v2 VALUES ('sm-s1');",
        "INSERT INTO kv VALUES ('migration.v1-v2','{\"phase\":\"completed\"}');",
      ].join(""),
    ],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) fail(`synthetic v2 DB creation failed: ${result.stderr ?? ""}`);
  return SMOKE_DB;
}

function runInstalledMaintenance(args: string[]): { code: number; out: string } {
  const result = spawnSync(
    "bash",
    [join(DB_DIR, "opencode-db-maintenance.sh"), ...args],
    { encoding: "utf-8" },
  );
  return {
    code: result.status ?? -1,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

try {
  const build = spawnSync("npm", ["run", "build"], { cwd: REPO, encoding: "utf-8", timeout: 300_000 });
  assert(build.status === 0, "the bundle builds before the install trials");
  const help = run(["--help"]);
  assert(help.code === 0 && help.out.includes("--takeover"), "help documents --takeover");
  assert(help.out.includes("--purge --yes"), "help documents the purge confirmation");
  assert(help.out.includes("agent roster"), "help states that purge keeps the agent roster");
  assert(help.out.includes("pre-force"), "help documents the pre-force target backup");
  mkdirSync(GLOBAL, { recursive: true });
  writeFileSync(USER_CONFIG, BODY);
  mkdirSync(SMOKE_ROOT, { recursive: true });
  createSyntheticDb();

  const dupGlobal = join(ROOT, "dup-global");
  const dupProject = join(ROOT, "dup-project");
  const dupCopy = join(dupProject, ".opencode", "plugins", "tawassul.js");
  mkdirSync(dirname(dupCopy), { recursive: true });
  writeFileSync(dupCopy, "// project duplicate\n");
  const dupEnv: NodeJS.ProcessEnv = { ...proofEnv(), TAWASSUL_GLOBAL_DIR: dupGlobal };
  const dup = runWith(["--force"], dupEnv, dupProject);
  assert(dup.code !== 0, "install refuses a project that already carries the plugin");
  assert(dup.out.includes(dupCopy), "the refusal names the project copy path");
  assert(dup.out.includes(join(dupGlobal, "plugins", "tawassul.js")), "the refusal names the global target path");
  assert(
    !existsSync(join(dupGlobal, "plugins", "tawassul.js")),
    "no global bundle is written while the project copy exists",
  );
  rmSync(join(dupProject, ".opencode"), { recursive: true, force: true });
  const dupOk = runWith(["--force"], dupEnv, dupProject);
  assert(dupOk.code === 0, "install proceeds once the project copy is removed");
  assert(existsSync(join(dupGlobal, "plugins", "tawassul.js")), "the global bundle lands once the duplicate is gone");

  const singDir = join(dupProject, ".opencode", "plugin");
  mkdirSync(singDir, { recursive: true });
  writeFileSync(join(singDir, "tawassul.js"), "// singular duplicate\n");
  const singularDup = runWith(["--force"], dupEnv, dupProject);
  assert(singularDup.code !== 0, "install refuses a duplicate in the singular plugin directory");
  assert(singularDup.out.includes(join(singDir, "tawassul.js")), "the singular refusal names the copy path");
  rmSync(join(dupProject, ".opencode"), { recursive: true, force: true });

  const renamedDir = join(dupProject, ".opencode", "plugins");
  mkdirSync(renamedDir, { recursive: true });
  writeFileSync(join(renamedDir, "renamed-copy.js"), 'const id = "tawassul-v2";\n');
  const renamedDup = runWith(["--force"], dupEnv, dupProject);
  assert(renamedDup.code !== 0, "install refuses a renamed copy that carries the plugin id");
  assert(renamedDup.out.includes(join(renamedDir, "renamed-copy.js")), "the renamed refusal names the copy path");
  rmSync(join(dupProject, ".opencode"), { recursive: true, force: true });

  const installed = run([]);
  assert(installed.code === 0, "install exits 0");
  assert(existsSync(TARGET), "flat plugin file is written");
  assert(!existsSync(LEGACY), "no package directory is created");
  assert(!existsSync(join(GLOBAL, "node_modules")), "no node_modules is created");
  assert(!existsSync(join(GLOBAL, "package.json")), "installer does not create a global package.json");
  assert(sha256(TARGET) === sha256(join(REPO, "dist", "global.js")), "plugin hash matches dist/global.js");
  assert(selfContainedBundle(readFileSync(TARGET, "utf-8")), "plugin bundle has no bare runtime imports");
  assert(existsSync(MARKER), "runtime marker is written");
  const record = marker();
  assert(record.package === "tawassul-v2", "marker identifies the plugin");
  assert(record.host === "2.2.0", "marker records the host override");
  assert(record.bundle?.sha256 === sha256(TARGET), "marker records the bundle hash");
  assert(record.bundle?.path === "plugins/tawassul.js", "marker records the plugin path");
  assert(Object.keys(record.wasm ?? {}).length === WASM_FILES.length, "marker records every wasm asset");
  for (const file of WASM_FILES) {
    assert(existsSync(file), `wasm asset exists (${file.split("/").slice(-1)[0]})`);
  }
  for (const [id, entry] of Object.entries(record.wasm ?? {})) {
    assert(Boolean(entry.sha256), `${id} has a recorded hash`);
    assert(existsSync(join(GLOBAL, entry.path ?? "")), `${id} path resolves under the global config`);
  }
  assert(readFileSync(USER_CONFIG, "utf-8") === BODY, "install leaves the user config byte-identical");
  assert(installed.out.includes("smoke ok"), "the installer smoke checked the synthetic v2 DB");
  assert(Object.keys(record.db ?? {}).length === DB_FILES.length, "marker records every db script");
  assert(record.preflight !== undefined && Object.keys(record.preflight).length >= 4, "marker records the dependency probe");
  for (const [id, file] of DB_FILES) {
    const dest = join(DB_DIR, file);
    assert(existsSync(dest), `db script is staged (${file})`);
    assert(
      (statSync(dest).mode & 0o100) !== 0,
      `db script keeps its exec bit (${file})`,
    );
    assert(sha256(dest) === sha256(join(REPO, "scripts", file)), `db script is byte-identical to the repo (${file})`);
    const entry = record.db?.[id];
    assert(Boolean(entry?.sha256), `marker db record carries a hash for ${id}`);
    assert(entry?.sha256 === sha256(dest), `marker db hash matches the staged file for ${id}`);
    assert(existsSync(join(GLOBAL, entry?.path ?? "")), `marker db path resolves for ${id}`);
  }
  assert(record.trigger === "manual", "marker records the manual trigger under the off mode");
  assert(installed.out.includes("trigger registration skipped"), "install prints the registration-skip notice");
  assert(runInstalledMaintenance(["--db", SMOKE_DB, "--check", "--ignore-low-ram"]).code === 0, "installed maintenance --check exits 0 against the synthetic v2 DB");

  const doctor = spawnSync("bash", [join(DB_DIR, "doctor-v2.sh")], { env: proofEnv(), encoding: "utf-8" });
  const doctorOut = `${doctor.stdout ?? ""}`;
  assert(doctor.status === 0, "installed doctor exits 0");
  assert(doctorOut.includes("database census"), "installed doctor keeps the census sections");
  assert(doctorOut.includes("db maintenance contract"), "installed doctor reports the maintenance contract section");
  assert(doctorOut.includes("installed marker:") && doctorOut.includes("trigger=manual"), "installed doctor reports the marker trigger state");
  assert(doctorOut.includes("db:maintenance: hash ok"), "installed doctor hash-checks the staged maintenance script");
  assert(doctorOut.includes("systemd trigger:"), "installed doctor reports the systemd trigger");
  assert(doctorOut.includes("cron trigger:"), "installed doctor reports the cron trigger");
  assert(doctorOut.includes("last scheduled run:"), "installed doctor reports the maintenance stamp");
  assert(doctorOut.includes("resolved DB:") && doctorOut.includes("DB path drift:"), "installed doctor reports the resolved path and drift");
  assert(doctorOut.includes("contract quick_check: ok"), "installed doctor quick-checks the DB");
  assert(doctorOut.includes("other DB files seen:"), "installed doctor lists other DB files it saw");

  const contract = spawnSync("bash", [join(DB_DIR, "doctor-v2.sh"), "--db-contract"], { env: proofEnv(), encoding: "utf-8" });
  const contractOut = `${contract.stdout ?? ""}`;
  assert(contract.status === 0, "installed doctor --db-contract exits 0");
  assert(contractOut.includes("== db maintenance contract =="), "--db-contract prints the contract section");
  assert(contractOut.includes("resolved DB:") && contractOut.includes("contract DB size:"), "--db-contract prints path, source, size and WAL");
  assert(contractOut.includes("systemd trigger:") && contractOut.includes("cron trigger:"), "--db-contract prints every trigger");
  assert(contractOut.includes("db:maintenance: hash ok"), "--db-contract hash-checks the staged artifacts");
  assert(contractOut.includes("other DB files seen:"), "--db-contract lists the other DB files seen (F16)");
  assert(contractOut.includes("== database census ==") === false, "--db-contract skips the heavy census sections");

  const rangeEnv = proofEnv();
  delete rangeEnv.TAWASSUL_OPENCODE_VERSION;
  assert(runWith(["--verify"], rangeEnv).code === 0, "verify accepts a marker inside the supported range");

  const badPin = proofEnv();
  badPin.TAWASSUL_OPENCODE_VERSION = "2.1.4";
  const refusedPin = runWith(["--verify"], badPin);
  assert(
    refusedPin.code !== 0 && refusedPin.out.includes("outside the supported range"),
    "verify refuses an out-of-range pin",
  );

  const newer = marker();
  newer.host = "2.2.1";
  writeFileSync(MARKER, `${JSON.stringify(newer, null, 2)}\n`);
  assert(runWith(["--verify"], rangeEnv).code === 0, "verify accepts a newer 2.x marker");
  assert(run([]).code === 0, "install restores the selected host marker");

  const again = run([]);
  assert(again.code === 0 && again.out.includes("already installed"), "second install is a no-op");

  const ownerFile = join(GLOBAL, "tawassul-install-owner");
  assert(readFileSync(ownerFile, "utf-8").trim() === REPO, "install records this tree as the owner");
  mkdirSync(join(ROOT, "other-tree"), { recursive: true });
  writeFileSync(ownerFile, `${join(ROOT, "other-tree")}\n`);
  const foreignOwner = run([]);
  assert(
    foreignOwner.code !== 0 && foreignOwner.out.includes("owns the global install"),
    "install refuses a live owner from another tree",
  );
  const takeover = run(["--takeover"]);
  assert(takeover.code === 0, "--takeover transfers the global install");
  assert(readFileSync(ownerFile, "utf-8").trim() === REPO, "takeover rewrites the owner record");

  process.env.HOME = HOME;
  process.env.XDG_CONFIG_HOME = CONFIG;
  delete process.env.TAWASSUL_GLOBAL_DIR;
  assert(detectInstallScope(pathToFileURL(TARGET).href) === "global", "installed file resolves to global scope");
  assert(
    detectInstallScope(pathToFileURL(join(REPO, ".opencode", "plugin", "tawassul.js")).href) ===
      "project",
    "project bundle resolves to project scope",
  );

  const workspace = join(ROOT, "workspace");
  const globalClaim = claimCoexistence("global", "global-token", workspace);
  const projectClaim = claimCoexistence("project", "project-token", workspace);
  assert(globalClaim.shouldRegister, "global claims the workspace first");
  assert(projectClaim.shouldRegister, "project copy supersedes the global copy");
  assert(isCoexistenceOwner("project", "project-token", workspace), "project copy owns the workspace");
  assert(!isCoexistenceOwner("global", "global-token", workspace), "global copy yields to the project copy");
  releaseCoexistence("project", "project-token", workspace);

  mkdirSync(join(HOME, ".opencode"), { recursive: true });
  const refused = run([]);
  assert(
    refused.code !== 0 && refused.out.includes("v1 artifacts"),
    "install refuses while a v1 artifact exists",
  );
  assert(existsSync(TARGET), "refusal leaves the install intact");
  rmSync(join(HOME, ".opencode"), { recursive: true, force: true });

  mkdirSync(LEGACY, { recursive: true });
  writeFileSync(join(LEGACY, "index.js"), "export default 1;\n");
  const legacyRefused = run([]);
  assert(
    legacyRefused.code !== 0 && legacyRefused.out.includes("legacy package-directory"),
    "install refuses a legacy package directory",
  );
  rmSync(LEGACY, { recursive: true, force: true });

  appendFileSync(WASM_FILES[1] as string, Buffer.from([0]));
  const tampered = run(["--verify"]);
  assert(tampered.code !== 0 && tampered.out.includes("wasm size mismatch"), "verify fails on a tampered wasm asset");
  const repaired = run([]);
  assert(repaired.code === 0 && !repaired.out.includes("already installed"), "install repairs a tampered wasm asset");
  assert(run(["--verify"]).code === 0, "verify passes after repair");

  appendFileSync(join(DB_DIR, "db-env.sh"), Buffer.from("\n"));
  const tamperedDb = run(["--verify"]);
  assert(tamperedDb.code !== 0 && tamperedDb.out.includes("db size mismatch for db-env"), "verify names a tampered db script");
  const repairedDb = run([]);
  assert(repairedDb.code === 0 && !repairedDb.out.includes("already installed"), "install repairs a tampered db script");
  assert(run(["--verify"]).code === 0, "verify passes after the db repair");

  const staleDir = join(WASM, "legacy-tree");
  mkdirSync(staleDir, { recursive: true });
  const staleFile = join(staleDir, "old.wasm");
  writeFileSync(staleFile, "stale-wasm\n");
  const staleRun = run([]);
  assert(staleRun.code === 0, "install succeeds while a stale wasm file exists");
  assert(staleRun.out.includes("removed 1 stale wasm file"), "install reports the stale wasm pruning");
  assert(!existsSync(staleFile), "install removes a wasm file that the marker does not record");
  assert(!existsSync(staleDir), "install prunes the empty stale wasm directory");

  const dryStaleDir = join(WASM, "dry-tree");
  mkdirSync(dryStaleDir, { recursive: true });
  const dryStaleFile = join(dryStaleDir, "old.wasm");
  writeFileSync(dryStaleFile, "stale-wasm\n");
  const staleDry = run(["--dry-run"]);
  assert(staleDry.code === 0 && staleDry.out.includes("would remove 1 stale wasm file"), "dry run reports stale wasm pruning");
  assert(existsSync(dryStaleFile), "dry run removes no stale wasm file");
  assert(run([]).code === 0 && !existsSync(dryStaleFile), "a real run prunes the dry-run stale file");

  chmodSync(join(DB_DIR, "guard-db-generation.sh"), 0o600);
  const execBit = run(["--verify"]);
  assert(execBit.code !== 0 && execBit.out.includes("lost its exec bit"), "verify fails when a db script loses its exec bit");
  assert(run([]).code === 0, "install restores db script permissions");

  const guardDest = join(DB_DIR, "guard-db-generation.sh");
  const siblingRun = runInstalledMaintenance(["--db", SMOKE_DB, "--event-only", "--ignore-low-ram"]);
  assert(
    siblingRun.out.includes("generation guard: ok (V2)"),
    "the installed maintenance resolves its sibling guard from dirname($0) (P1.5)",
  );
  const guardBak = `${guardDest}.bak`;
  renameSync(guardDest, guardBak);
  const noGuard = runInstalledMaintenance(["--db", SMOKE_DB, "--event-only", "--ignore-low-ram"]);
  assert(
    noGuard.code !== 0 && noGuard.out.includes("generation guard missing"),
    "the installed maintenance refuses when its sibling guard is absent",
  );
  renameSync(guardBak, guardDest);
  assert(run([]).code === 0, "install restores the guard after the sibling probe");

  const stripped = marker();
  delete stripped.db;
  writeFileSync(MARKER, `${JSON.stringify(stripped, null, 2)}\n`);
  const noPayload = run(["--verify"]);
  assert(noPayload.code !== 0 && noPayload.out.includes("no db payload"), "verify refuses a marker without the db payload");
  assert(run([]).code === 0, "install rewrites the marker with the db payload");

  const backupDir = join(HOME, ".local", "share", "tawassul-v2", "backups");
  mkdirSync(backupDir, { recursive: true });
  const backupFile = join(backupDir, "opencode-20260101-000000.db");
  writeFileSync(backupFile, "sentinel-backup\n");
  const dbHashBefore = sha256(SMOKE_DB);
  const backupHashBefore = sha256(backupFile);
  const userNote = join(RUNTIME, "notes.txt");
  writeFileSync(userNote, "keep me\n");
  const removed = run(["--uninstall"]);
  assert(removed.code === 0 && !existsSync(TARGET), "uninstall removes the flat plugin file");
  assert(!existsSync(MARKER), "uninstall removes the marker it wrote");
  assert(existsSync(userNote), "uninstall keeps a runtime file it did not write");
  assert(removed.out.includes("did not write"), "the uninstall report names the kept user files");
  assert(!existsSync(DB_DIR), "uninstall removes the staged db scripts with the runtime");
  assert(readFileSync(USER_CONFIG, "utf-8") === BODY, "uninstall leaves the user config byte-identical");
  assert(sha256(SMOKE_DB) === dbHashBefore, "uninstall leaves the database byte-identical (P3.7)");
  assert(
    existsSync(backupFile) && sha256(backupFile) === backupHashBefore,
    "uninstall leaves every backup byte-identical (P3.7)",
  );
  rmSync(userNote, { force: true });
  rmSync(RUNTIME, { recursive: true, force: true });

  const dry = run(["--dry-run"]);
  assert(dry.code === 0 && !existsSync(TARGET) && !existsSync(RUNTIME), "dry run writes nothing");

  mkdirSync(dirname(TARGET), { recursive: true });
  const previousTarget = "export default 1;\n";
  writeFileSync(TARGET, previousTarget);
  const unmarked = run([]);
  assert(
    unmarked.code !== 0 && unmarked.out.includes("without a Tawassul marker"),
    "install refuses an unmarked target",
  );
  const unmarkedRemove = run(["--uninstall"]);
  assert(unmarkedRemove.code !== 0, "uninstall refuses an unmarked target");
  const forced = run(["--force"]);
  assert(forced.code === 0, "--force replaces an unmarked target");
  const preForce = readdirSync(PLUGIN_DIR).filter((name) => name.startsWith("tawassul.js.pre-force-"));
  assert(preForce.length === 1, "--force keeps exactly one pre-force backup");
  assert(forced.out.includes("kept the previous target at"), "the installer reports the pre-force backup");
  assert(
    readFileSync(join(PLUGIN_DIR, preForce[0] as string), "utf-8") === previousTarget,
    "the pre-force backup keeps the replaced file byte-identical",
  );
  assert(run(["--uninstall"]).code === 0, "uninstall removes a forced install");
  assert(
    existsSync(join(PLUGIN_DIR, preForce[0] as string)),
    "a plain uninstall keeps the pre-force backup",
  );

  assert(run([]).code === 0, "install succeeds before the marker-loss trial");
  const orphanNote = join(RUNTIME, "notes.txt");
  writeFileSync(orphanNote, "keep me\n");
  rmSync(MARKER, { force: true });
  const noMarker = run(["--uninstall", "--force"]);
  assert(noMarker.code === 0, "uninstall --force proceeds without a marker");
  assert(!existsSync(DB_DIR), "uninstall --force removes the staged db scripts without a marker");
  assert(existsSync(orphanNote), "uninstall --force keeps a runtime file it did not write");
  rmSync(RUNTIME, { recursive: true, force: true });

  const stateRoot = join(CONFIG, "tawassul-v2", "state");
  const runtimeRoot = join(GLOBAL, "tawassul-v2-state");
  mkdirSync(stateRoot, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(join(stateRoot, "state.json"), "{}\n");
  writeFileSync(join(runtimeRoot, "metrics.json"), "{}\n");
  writeFileSync(join(GLOBAL, "tawassul.jsonc"), "{}\n");
  mkdirSync(join(GLOBAL, "agent"), { recursive: true });
  writeFileSync(join(GLOBAL, "agent", "keeper.md"), "# keeper\n");

  const cronDir = join(ROOT, "bin");
  mkdirSync(cronDir, { recursive: true });
  const cronState = join(ROOT, "crontab.txt");
  const cronShim = join(cronDir, "crontab");
  writeFileSync(
    cronShim,
    `#!/bin/sh\nif [ "$1" = "-l" ]; then\n  if [ -f "${cronState}" ]; then cat "${cronState}"; exit 0; fi\n  echo "no crontab for tester" >&2\n  exit 1\nfi\ncat > "${cronState}"\n`,
  );
  chmodSync(cronShim, 0o755);
  const cronEnv: NodeJS.ProcessEnv = {
    ...proofEnv(),
    PATH: `${cronDir}:/usr/bin:/bin`,
    TAWASSUL_REGISTER_TRIGGERS: "cron",
  };
  const cronInstall = runWith([], cronEnv);
  assert(cronInstall.code === 0, "install registers through a fresh crontab account");
  assert(cronInstall.out.includes("registered cron line"), "the installer reports cron registration");
  const cronText = readFileSync(cronState, "utf-8");
  assert(cronText.includes(`OPENCODE_DB='${SMOKE_DB}'`), "the cron line pins the resolved OPENCODE_DB");
  assert(
    cronText.includes(`'${join(DB_DIR, "opencode-db-scheduled.sh")}' --run`),
    "the cron line quotes the scheduled script path",
  );
  assert(cronInstall.out.includes("smoke ok"), "the cron install still smoke-checks the DB");
  assert(runWith(["--uninstall"], cronEnv).code === 0, "uninstall through the cron account exits 0");
  assert(
    !readFileSync(cronState, "utf-8").includes("tawassul-db-maintenance"),
    "uninstall removes the tagged cron line",
  );

  assert(run([]).code === 0, "install succeeds before purge");
  const purged = run(["--uninstall", "--purge"]);
  assert(purged.code !== 0 && purged.out.includes("--yes"), "purge without --yes refuses and moves nothing");
  assert(
    existsSync(TARGET) && existsSync(join(stateRoot, "state.json")) && existsSync(join(GLOBAL, "tawassul.jsonc")),
    "the purge refusal leaves the install and state intact",
  );
  const purgedYes = run(["--uninstall", "--purge", "--yes"]);
  assert(purgedYes.code === 0, "uninstall --purge --yes exits 0");
  assert(!existsSync(TARGET) && !existsSync(RUNTIME), "purge still removes the plugin and runtime");
  assert(
    !existsSync(stateRoot) && !existsSync(runtimeRoot) && !existsSync(join(GLOBAL, "tawassul.jsonc")),
    "purge moves the state paths off their names",
  );
  const archives = readdirSync(CONFIG).filter((name) => name.startsWith("tawassul-v2.purged-"));
  assert(archives.length === 1, "purge leaves exactly one archived state directory");
  assert(
    existsSync(join(CONFIG, archives[0] as string, "state", "state.json")),
    "the archived state keeps the original payload",
  );
  assert(existsSync(join(GLOBAL, "agent", "keeper.md")), "purge keeps the global agent roster");
  assert(purgedYes.out.includes("kept 1 agent file"), "purge reports the kept agent roster");
  assert(
    !readdirSync(PLUGIN_DIR).some((name) => name.startsWith("tawassul.js.pre-force-")),
    "purge removes the pre-force target backup",
  );

  const emptyAssets = join(ROOT, "empty-assets");
  const noAssetsGlobal = join(ROOT, "no-assets-global");
  mkdirSync(emptyAssets, { recursive: true });
  const noAssets = runWith([], {
    ...proofEnv(),
    TAWASSUL_GLOBAL_DIR: noAssetsGlobal,
    TAWASSUL_ASSET_ROOTS: emptyAssets,
  });
  assert(noAssets.code !== 0, "install fails when the wasm asset roots are empty");
  assert(noAssets.out.includes("missing wasm assets"), "the failure names the missing wasm assets");
  assert(noAssets.out.includes("run npm install"), "the failure prints the exact npm install command");
  assert(!noAssets.out.includes("running npm install"), "the installer never runs npm install on its own");
  assert(
    !existsSync(join(noAssetsGlobal, "plugins", "tawassul.js")),
    "the missing-asset failure writes no bundle",
  );

  const verifiedMissing = run(["--verify"]);
  assert(verifiedMissing.code !== 0, "verify fails when nothing is installed");

  console.log("PROOF PASS: global installation");
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
