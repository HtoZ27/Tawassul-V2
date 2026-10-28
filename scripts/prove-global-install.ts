import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
const TARGET = join(GLOBAL, "plugins", "tawassul.js");
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
    OPENCODE_DB: SMOKE_DB,
  };
  delete next.TAWASSUL_GLOBAL_DIR;
  delete next.TAWASSUL_SCOPE;
  delete next.OPENCODE_BIN;
  return next;
}

function runWith(args: string[], env: NodeJS.ProcessEnv): { code: number; out: string } {
  const result = spawnSync(
    process.execPath,
    [join(REPO, "scripts", "install-global.ts"), ...args],
    { env, encoding: "utf-8" },
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
  mkdirSync(GLOBAL, { recursive: true });
  writeFileSync(USER_CONFIG, BODY);
  mkdirSync(SMOKE_ROOT, { recursive: true });
  createSyntheticDb();

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
  assert(runInstalledMaintenance(["--db", SMOKE_DB, "--check", "--ignore-low-ram"]).code === 0, "installed maintenance --check exits 0 against the synthetic v2 DB");

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

  chmodSync(join(DB_DIR, "guard-db-generation.sh"), 0o600);
  const execBit = run(["--verify"]);
  assert(execBit.code !== 0 && execBit.out.includes("lost its exec bit"), "verify fails when a db script loses its exec bit");
  assert(run([]).code === 0, "install restores db script permissions");

  const stripped = marker();
  delete stripped.db;
  writeFileSync(MARKER, `${JSON.stringify(stripped, null, 2)}\n`);
  const noPayload = run(["--verify"]);
  assert(noPayload.code !== 0 && noPayload.out.includes("no db payload"), "verify refuses a marker without the db payload");
  assert(run([]).code === 0, "install rewrites the marker with the db payload");

  const removed = run(["--uninstall"]);
  assert(removed.code === 0 && !existsSync(TARGET), "uninstall removes the flat plugin file");
  assert(!existsSync(RUNTIME), "uninstall removes the runtime directory");
  assert(!existsSync(DB_DIR), "uninstall removes the staged db scripts with the runtime");
  assert(readFileSync(USER_CONFIG, "utf-8") === BODY, "uninstall leaves the user config byte-identical");

  const dry = run(["--dry-run"]);
  assert(dry.code === 0 && !existsSync(TARGET) && !existsSync(RUNTIME), "dry run writes nothing");

  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, "export default 1;\n");
  const unmarked = run([]);
  assert(
    unmarked.code !== 0 && unmarked.out.includes("without a Tawassul marker"),
    "install refuses an unmarked target",
  );
  const unmarkedRemove = run(["--uninstall"]);
  assert(unmarkedRemove.code !== 0, "uninstall refuses an unmarked target");
  const forced = run(["--force"]);
  assert(forced.code === 0, "--force replaces an unmarked target");
  assert(run(["--uninstall"]).code === 0, "uninstall removes a forced install");

  const stateRoot = join(CONFIG, "tawassul-v2", "state");
  const runtimeRoot = join(GLOBAL, "tawassul-v2-state");
  mkdirSync(stateRoot, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(join(stateRoot, "state.json"), "{}\n");
  writeFileSync(join(runtimeRoot, "metrics.json"), "{}\n");
  writeFileSync(join(GLOBAL, "tawassul.jsonc"), "{}\n");
  assert(run([]).code === 0, "install succeeds before purge");
  const purged = run(["--uninstall", "--purge"]);
  assert(purged.code === 0, "uninstall --purge exits 0");
  assert(
    !existsSync(TARGET) &&
      !existsSync(RUNTIME) &&
      !existsSync(stateRoot) &&
      !existsSync(runtimeRoot) &&
      !existsSync(join(GLOBAL, "tawassul.jsonc")),
    "uninstall --purge removes the runtime, state, and roster",
  );

  const verifiedMissing = run(["--verify"]);
  assert(verifiedMissing.code !== 0, "verify fails when nothing is installed");

  console.log("PROOF PASS: global installation");
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
