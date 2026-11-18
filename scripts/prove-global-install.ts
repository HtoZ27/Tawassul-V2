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
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  claimCoexistence,
  detectInstallScope,
  isCoexistenceOwner,
  releaseCoexistence,
} from "../src/core/install-scope.ts";
import {
  HMAC_KEY_FILE,
  dependencyProbeCommand,
  installLane,
  operatorKeyProblem,
  usesPosixDatabaseLane,
  windowsAclPath,
  windowsKeyAclArgv,
  windowsKeyDirectory,
} from "../src/core/install-lane.ts";
import { hostProbeCommand } from "../src/core/install-host.ts";
import {
  durableWriteFile,
  fsyncDirectory,
  fsyncFileDescriptor,
  realWriteOps,
} from "../src/core/install-write.ts";

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
    TAWASSUL_OPENCODE_VERSION: "2.3.0",
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

function buildReleaseAssets(outDir: string): void {
  const version = "0.0.0";
  mkdirSync(outDir, { recursive: true });
  const bundle = join(outDir, `tawassul-${version}.global.js`);
  writeFileSync(bundle, `${"// release installer proof bundle\n"}${"x".repeat(2048)}`);

  const runtimeStage = join(outDir, "stage-runtime", "tawassul-runtime", "wasm");
  const wasm = [
    "web-tree-sitter/web-tree-sitter.wasm",
    "tree-sitter-javascript/tree-sitter-javascript.wasm",
    "tree-sitter-typescript/tree-sitter-typescript.wasm",
    "tree-sitter-typescript/tree-sitter-tsx.wasm",
  ];
  for (const rel of wasm) {
    const file = join(runtimeStage, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "wasm proof payload");
  }
  const runtime = join(outDir, `tawassul-runtime-${version}.tar.gz`);
  spawnSync("tar", ["-czf", runtime, "-C", join(outDir, "stage-runtime"), "tawassul-runtime"]);

  const dbStage = join(outDir, "stage-db", "tawassul-db-maintenance");
  mkdirSync(dbStage, { recursive: true });
  const scripts = [
    "db-env.sh",
    "doctor-v2.sh",
    "guard-db-generation.sh",
    "opencode-db-maintenance.sh",
    "opencode-db-scheduled.sh",
  ];
  for (const name of scripts) writeFileSync(join(dbStage, name), "#!/bin/sh\n");
  const maintenance = join(outDir, `tawassul-db-maintenance-${version}.tar.gz`);
  spawnSync("tar", ["-czf", maintenance, "-C", join(outDir, "stage-db"), "tawassul-db-maintenance"]);

  const sum = (file: string): string =>
    createHash("sha256").update(readFileSync(file)).digest("hex");
  const names = [bundle, runtime, maintenance].map((file) => file.split("/").pop() as string);
  writeFileSync(
    join(outDir, "SHA256SUMS"),
    `${[bundle, runtime, maintenance].map((file, i) => `${sum(file)}  ${names[i]}`).join("\n")}\n`,
  );
}

function releaseInstallerCases(): void {
  const dir = join(ROOT, "release-installer");
  const release = join(dir, "assets");
  buildReleaseAssets(release);
  const project = join(dir, "project");
  const hostHome = join(dir, "host-home");
  const sidecarDir = join(hostHome, ".local", "share", "opencode", "tawassul-v2");
  mkdirSync(sidecarDir, { recursive: true });
  writeFileSync(join(sidecarDir, "opencode.db"), "");

  const env = proofEnv();
  delete env.OPENCODE_DB;
  env.TAWASSUL_REGISTER_TRIGGERS = "manual";
  const run = (args: string[]): { code: number; out: string } => {
    const result = spawnSync("sh", [join(REPO, "install.sh"), ...args, "--from", release, "--release", "0.0.0"], {
      env,
      encoding: "utf8",
    });
    return { code: result.status ?? -1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  };

  const installedProject = run(["--project", project]);
  assert(installedProject.code === 0, "the release installer still installs a project scope");
  assert(existsSync(join(project, ".opencode", "plugins", "tawassul.js")), "project scope still writes the bundle");
  assert(existsSync(join(project, ".opencode", "tawassul-runtime", "VERSION")), "project scope still writes VERSION");

  const installedGlobal = run(["--global", "--prefix", hostHome]);
  assert(installedGlobal.code === 0, "the release installer still installs a global scope");
  const globalBundle = join(hostHome, ".config", "opencode", "plugins", "tawassul.js");
  const globalRuntime = join(hostHome, ".config", "opencode", "tawassul-runtime");
  assert(existsSync(globalBundle), "global scope still writes the bundle");
  assert(existsSync(join(globalRuntime, "VERSION")), "global scope still writes VERSION");

  const installedDb = run(["--db-maintenance", "--prefix", hostHome]);
  assert(installedDb.code === 0, "the release installer installs the database maintenance lane");
  const dbDir = join(globalRuntime, "db");
  for (const name of ["db-env.sh", "doctor-v2.sh", "guard-db-generation.sh", "opencode-db-maintenance.sh", "opencode-db-scheduled.sh"]) {
    assert(existsSync(join(dbDir, name)), `the maintenance lane stages ${name}`);
  }
  const marker = readFileSync(join(dbDir, "MAINTENANCE"), "utf8");
  assert(marker.includes('"lane": "install.sh --db-maintenance"'), "the maintenance lane uses a dedicated marker");
  assert(marker.includes(sidecarDir), "the marker records the resolved sidecar DB");
  assert(!existsSync(join(dbDir, "VERSION")), "the maintenance lane never writes the shared VERSION marker");

  const removedDb = run(["--db-maintenance", "--prefix", hostHome, "--uninstall"]);
  assert(removedDb.code === 0, "the maintenance lane uninstalls cleanly");
  assert(!existsSync(dbDir), "uninstall removes the database scripts");
  assert(existsSync(globalBundle), "uninstall keeps a live plugin bundle");
  assert(existsSync(join(globalRuntime, "VERSION")), "uninstall keeps the shared VERSION marker");
}

function doctorMaintenanceCases(): void {
  const doctorScript = join(DB_DIR, "doctor-v2.sh");
  const maintFile = join(DB_DIR, "MAINTENANCE");
  const stampDir = join(HOME, ".local", "share", "tawassul-v2", "db-maintenance");
  const stampFile = join(stampDir, "last-run.stamp");
  const bin = join(ROOT, "doctor-bin");
  const crontabFile = join(ROOT, "doctor-crontab.txt");
  const unitDir = join(CONFIG, "systemd", "user");
  const serviceFile = join(unitDir, "tawassul-db-maintenance.service");
  const timerFile = join(unitDir, "tawassul-db-maintenance.timer");
  const missingScript = join(ROOT, "deleted-runtime", "opencode-db-scheduled.sh");
  mkdirSync(bin, { recursive: true });
  mkdirSync(unitDir, { recursive: true });
  mkdirSync(stampDir, { recursive: true });
  writeFileSync(
    join(bin, "crontab"),
    `#!/bin/sh\nif [ "$1" = "-l" ]; then cat "${crontabFile}" 2>/dev/null; exit 0; fi\ncat > "${crontabFile}"\n`,
  );
  chmodSync(join(bin, "crontab"), 0o755);
  writeFileSync(join(bin, "systemctl"), '#!/bin/sh\nprintf "disabled\\n"\n');
  chmodSync(join(bin, "systemctl"), 0o755);
  writeFileSync(crontabFile, "");
  const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    ...proofEnv(),
    PATH: `${bin}:/usr/bin:/bin`,
    ...extra,
  });
  const doctor = (extra: NodeJS.ProcessEnv = {}): string => {
    const result = spawnSync("bash", [doctorScript], { env: env(extra), encoding: "utf-8" });
    if (result.status !== 0) {
      fail(`maintenance doctor exited ${result.status}: ${result.stdout ?? ""}${result.stderr ?? ""}`);
    }
    return `${result.stdout ?? ""}`;
  };
  const writeMaintenance = (gap: number): void => {
    writeFileSync(
      maintFile,
      `${JSON.stringify(
        {
          package: "tawassul-v2",
          lane: "install.sh --db-maintenance",
          version: "0.1.4-experimental",
          db: SMOKE_DB,
          trigger: "manual",
          gapSeconds: gap,
          installedAt: "2026-11-17T00:00:00Z",
        },
        null,
        2,
      )}\n`,
    );
  };
  writeFileSync(stampFile, "rc=0\nat=2026-11-17 00:00:00\n");
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(stampFile, twoHoursAgo, twoHoursAgo);

  try {
    writeMaintenance(86400);
    const fresh = doctor();
    assert(fresh.includes("installed marker:") && fresh.includes("maintenance lane:"), "doctor reports both markers");
    assert(fresh.includes("gap=86400s"), "doctor reads gapSeconds from the maintenance marker");
    assert(fresh.includes("maintenance db:") && fresh.includes(SMOKE_DB), "doctor prints the maintenance DB path");
    assert(
      fresh.includes("last scheduled run:") && fresh.includes("(fresh)"),
      "doctor reports a fresh stamp under a non-default gap",
    );
    const stale = doctor({ TAWASSUL_DB_GAP_SECONDS: "60" });
    assert(stale.includes("(stale)"), "doctor lets the environment gap win for stamp freshness");

    writeFileSync(
      serviceFile,
      `# tawassul-owner: install.sh-db-maintenance\n[Unit]\nDescription=Tawassul v2 DB maintenance lane\n\n[Service]\nType=oneshot\nExecStart=/usr/bin/env bash "${missingScript}" --run\n`,
    );
    writeFileSync(
      timerFile,
      `# tawassul-owner: install.sh-db-maintenance\n[Unit]\nDescription=Tawassul v2 DB maintenance schedule\n\n[Timer]\nOnCalendar=daily\n`,
    );
    const unitStale = doctor();
    assert(
      unitStale.includes(`stale maintenance schedule: systemd -> ${missingScript} (missing)`),
      "doctor warns about a stale systemd schedule",
    );
    assert(
      unitStale.includes("systemd trigger:") && unitStale.includes("owner=install.sh-db-maintenance"),
      "doctor names the stamped systemd owner",
    );
    assert(
      unitStale.includes("systemctl --user disable --now tawassul-db-maintenance.timer") &&
        !unitStale.includes("crontab -l | grep -vF"),
      "doctor prints only the systemd cleanup command for a stale unit",
    );

    rmSync(serviceFile, { force: true });
    rmSync(timerFile, { force: true });
    writeFileSync(
      crontabFile,
      `17 4 * * * OPENCODE_DB='${SMOKE_DB}' /usr/bin/env bash '${missingScript}' --run # tawassul-db-maintenance owner=install-global\n`,
    );
    const cronStale = doctor();
    assert(
      cronStale.includes(`stale maintenance schedule: cron -> ${missingScript} (missing)`),
      "doctor warns about a stale cron schedule",
    );
    assert(cronStale.includes("cron trigger:") && cronStale.includes("owner=install-global"), "doctor names the stamped cron owner");
    assert(cronStale.includes("owner=install-global' | crontab -"), "doctor prints the cron owner's cleanup command");
    assert(
      !cronStale.includes("systemctl --user disable") &&
        !cronStale.includes("owner=install.sh-db-maintenance' | crontab -"),
      "doctor prints only the cron cleanup command for a stale cron line",
    );

    writeFileSync(crontabFile, "");
    const guard = join(DB_DIR, "guard-db-generation.sh");
    const guardBackup = `${guard}.doctor-bak`;
    renameSync(guard, guardBackup);
    try {
      const incomplete = doctor();
      assert(
        incomplete.includes(`maintenance lane incomplete: ${guard}`),
        "doctor warns about an incomplete maintenance lane",
      );
    } finally {
      renameSync(guardBackup, guard);
    }

    const bundleBackup = `${TARGET}.doctor-bak`;
    renameSync(TARGET, bundleBackup);
    try {
      const standalone = doctor();
      assert(
        standalone.includes("standalone maintenance lane (no plugin required)"),
        "doctor reports a standalone maintenance lane",
      );
      assert(
        standalone.includes("install.sh --db-maintenance --uninstall"),
        "doctor prints the standalone removal command",
      );
    } finally {
      renameSync(bundleBackup, TARGET);
    }
  } finally {
    rmSync(maintFile, { force: true });
    rmSync(serviceFile, { force: true });
    rmSync(timerFile, { force: true });
    rmSync(stampFile, { force: true });
    rmSync(bin, { recursive: true, force: true });
    rmSync(crontabFile, { force: true });
  }
}

type TriggerShim = { dir: string; cron: string };

function triggerShim(label: string): TriggerShim {
  const dir = join(ROOT, `shim-${label}`);
  const cron = join(dir, "crontab.txt");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "crontab"),
    `#!/bin/sh\nif [ "$1" = "-l" ]; then cat "${cron}" 2>/dev/null; exit 0; fi\nif [ -n "$1" ] && [ "$1" != "-" ]; then cp "$1" "${cron}"; exit 0; fi\ncat > "${cron}"\n`,
  );
  chmodSync(join(dir, "crontab"), 0o755);
  writeFileSync(join(dir, "systemctl"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, "systemctl"), 0o755);
  writeFileSync(cron, "");
  return { dir, cron };
}

function fiveFileSetCases(): void {
  const expected = [
    "db-env.sh",
    "doctor-v2.sh",
    "guard-db-generation.sh",
    "opencode-db-maintenance.sh",
    "opencode-db-scheduled.sh",
  ].sort();
  const scriptSetIn = (file: string, start: string, end: string): string[] => {
    const text = readFileSync(join(REPO, file), "utf-8");
    const from = text.indexOf(start);
    const to = from < 0 ? -1 : text.indexOf(end, from + start.length);
    if (from < 0 || to < 0) fail(`cannot locate the five-file list in ${file}`);
    return [...new Set(text.slice(from, to).match(/[A-Za-z0-9_-]+\.sh/g) ?? [])].sort();
  };
  const sets: Array<[string, string[]]> = [
    ["scripts/release/pack.sh", scriptSetIn("scripts/release/pack.sh", 'DB_FILES="', '"\n')],
    ["scripts/release/verify-artifact.ts", scriptSetIn("scripts/release/verify-artifact.ts", "const DB_FILES = [", "];")],
    ["install.sh", scriptSetIn("install.sh", 'MAINT_FILES="', '"\n')],
    [
      "scripts/prove-global-install.ts",
      scriptSetIn("scripts/prove-global-install.ts", "const DB_FILES: Array<[string, string]> = [", "];"),
    ],
    ["scripts/install-global.ts", scriptSetIn("scripts/install-global.ts", "const DB_SHIP", "];")],
    ["build-v2.mjs", scriptSetIn("build-v2.mjs", "const localRuntimeDir", "]) {")],
    ["scripts/prove-db-lock.ts", scriptSetIn("scripts/prove-db-lock.ts", "const FILES = [", "];")],
  ];
  for (const [file, set] of sets) {
    assert(JSON.stringify(set) === JSON.stringify(expected), `${file} ships the same five database scripts`);
  }
}

function installShLaneCases(): void {
  const assets = join(ROOT, "lane-assets");
  buildReleaseAssets(assets);
  const shim = triggerShim("install-sh");
  const lane = (label: string) => {
    const home = join(ROOT, "lane", label);
    const db = join(home, ".local", "share", "opencode", "tawassul-v2", "opencode.db");
    mkdirSync(dirname(db), { recursive: true });
    writeFileSync(db, "");
    return {
      home,
      db,
      config: join(home, ".config"),
      runtime: join(home, ".config", "opencode", "tawassul-runtime"),
    };
  };
  const runLane = (home: string, args: string[], extra: NodeJS.ProcessEnv = {}): { code: number; out: string } => {
    const env: NodeJS.ProcessEnv = { ...proofEnv(), HOME: home, PATH: `${shim.dir}:/usr/bin:/bin`, ...extra };
    if (!("XDG_CONFIG_HOME" in extra)) delete env.XDG_CONFIG_HOME;
    if (!("XDG_DATA_HOME" in extra)) delete env.XDG_DATA_HOME;
    if (!("XDG_STATE_HOME" in extra)) delete env.XDG_STATE_HOME;
    if (!("OPENCODE_DB" in extra)) delete env.OPENCODE_DB;
    const result = spawnSync("sh", [join(REPO, "install.sh"), ...args, "--from", assets, "--release", "0.0.0"], {
      env,
      encoding: "utf-8",
    });
    return { code: result.status ?? -1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  };
  const systemdPath = (config: string, name: string): string => join(config, "systemd", "user", name);
  const serviceName = "tawassul-db-maintenance.service";
  const timerName = "tawassul-db-maintenance.timer";
  const markerOf = (runtime: string): { trigger?: string; gapSeconds?: number } =>
    JSON.parse(readFileSync(join(runtime, "db", "MAINTENANCE"), "utf-8")) as { trigger?: string; gapSeconds?: number };

  const auto = lane("auto");
  writeFileSync(shim.cron, "");
  const autoRun = runLane(auto.home, ["--db-maintenance"], {
    TAWASSUL_REGISTER_TRIGGERS: "auto",
    TAWASSUL_DB_GAP_SECONDS: "120",
  });
  assert(autoRun.code === 0, "install.sh registers an auto maintenance schedule");
  const service = systemdPath(auto.config, serviceName);
  const timer = systemdPath(auto.config, timerName);
  assert(existsSync(service) && existsSync(timer), "the maintenance lane writes the systemd unit pair");
  assert(
    readFileSync(service, "utf-8").startsWith("# tawassul-owner: install.sh-db-maintenance\n") &&
      readFileSync(timer, "utf-8").startsWith("# tawassul-owner: install.sh-db-maintenance\n"),
    "both units carry the lane owner stamp",
  );
  assert(
    readFileSync(service, "utf-8").includes(
      `ExecStart=/usr/bin/env bash "${join(auto.runtime, "db", "opencode-db-scheduled.sh")}" --run`,
    ),
    "the unit quotes the scheduled script path",
  );
  assert(
    readFileSync(service, "utf-8").includes('Environment="TAWASSUL_DB_GAP_SECONDS=120"'),
    "the unit exports the captured gap",
  );
  assert(markerOf(auto.runtime).trigger === "systemd" && markerOf(auto.runtime).gapSeconds === 120, "the marker records systemd and the gap");
  assert(readFileSync(shim.cron, "utf-8").trim() === "", "the systemd path leaves no cron line");

  const offRun = runLane(auto.home, ["--db-maintenance"], {
    TAWASSUL_DB_MAINTENANCE: "off",
    TAWASSUL_REGISTER_TRIGGERS: "auto",
  });
  assert(offRun.code === 0, "install.sh accepts the maintenance opt-out");
  assert(!existsSync(service) && !existsSync(timer), "the opt-out removes the owned unit pair");
  assert(markerOf(auto.runtime).trigger === "off", "the opt-out marker records off");

  const cronRun = runLane(auto.home, ["--db-maintenance"], {
    TAWASSUL_REGISTER_TRIGGERS: "cron",
    TAWASSUL_DB_GAP_SECONDS: "300",
  });
  assert(cronRun.code === 0, "install.sh registers a cron maintenance schedule");
  assert(!existsSync(service) && !existsSync(timer), "the cron path removes the previous unit pair");
  const cronText = readFileSync(shim.cron, "utf-8");
  assert(cronText.includes("# tawassul-db-maintenance owner=install.sh-db-maintenance"), "the cron line carries the lane owner stamp");
  assert(cronText.includes(`'${join(auto.runtime, "db", "opencode-db-scheduled.sh")}' --run`), "the cron line quotes the scheduled script");
  assert(cronText.includes("TAWASSUL_DB_GAP_SECONDS='300'"), "the cron line exports the captured gap");
  assert(markerOf(auto.runtime).trigger === "cron", "the marker records cron");

  const foreignCron = lane("foreign-cron");
  writeFileSync(
    shim.cron,
    "17 4 * * * /usr/bin/env bash '/tmp/other/opencode-db-scheduled.sh' --run # tawassul-db-maintenance owner=install-global\n",
  );
  const foreignAuto = runLane(foreignCron.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "auto" });
  assert(foreignAuto.code === 0 && markerOf(foreignCron.runtime).trigger === "manual", "a foreign cron line ends the auto attempt in manual");
  assert(
    foreignAuto.out.includes("run the lane manually with: bash") &&
      foreignAuto.out.includes(join(foreignCron.runtime, "db", "opencode-db-scheduled.sh")),
    "the manual outcome prints the command to run",
  );
  assert(readFileSync(shim.cron, "utf-8").includes("owner=install-global"), "the auto attempt leaves the foreign cron line");
  assert(!existsSync(systemdPath(foreignCron.config, serviceName)), "the auto attempt writes no unit");

  const forcedFail = lane("forced-fail");
  writeFileSync(shim.cron, "");
  assert(
    runLane(forcedFail.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "cron" }).code === 0,
    "the lane installs a cron schedule before the foreign failure",
  );
  const markerBefore = readFileSync(join(forcedFail.runtime, "db", "MAINTENANCE"), "utf-8");
  const foreignUnit = systemdPath(forcedFail.config, serviceName);
  mkdirSync(dirname(foreignUnit), { recursive: true });
  writeFileSync(
    foreignUnit,
    `# tawassul-owner: install-global\n[Unit]\nDescription=Tawassul v2 DB maintenance lane\n[Service]\nExecStart=/usr/bin/env bash "${join(forcedFail.runtime, "db", "opencode-db-scheduled.sh")}" --run\n`,
  );
  writeFileSync(
    systemdPath(forcedFail.config, timerName),
    "# tawassul-owner: install-global\n[Unit]\nDescription=Tawassul v2 DB maintenance schedule\n[Timer]\nOnCalendar=daily\n",
  );
  const forcedFailure = runLane(forcedFail.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "systemd" });
  assert(
    forcedFailure.code !== 0 && forcedFailure.out.includes("refusing to register systemd"),
    "the forced systemd mode fails on a foreign unit",
  );
  assert(
    readFileSync(foreignUnit, "utf-8").startsWith("# tawassul-owner: install-global\n"),
    "the failed registration leaves the foreign unit untouched",
  );
  assert(
    readFileSync(join(forcedFail.runtime, "db", "MAINTENANCE"), "utf-8") === markerBefore,
    "the failed registration restores the previous marker",
  );
  assert(readFileSync(shim.cron, "utf-8").includes("owner=install.sh-db-maintenance"), "the failed registration restores the cron line");
  assert(existsSync(join(forcedFail.runtime, "db", "opencode-db-scheduled.sh")), "the failed registration keeps the scripts");

  const takenOver = runLane(forcedFail.home, ["--db-maintenance", "--force"], { TAWASSUL_REGISTER_TRIGGERS: "auto" });
  assert(takenOver.code === 0, "--force takes over the foreign schedule");
  assert(
    readFileSync(foreignUnit, "utf-8").startsWith("# tawassul-owner: install.sh-db-maintenance\n"),
    "--force rewrites the foreign unit with its own stamp",
  );
  assert(readFileSync(shim.cron, "utf-8").trim() === "", "--force removes the foreign cron line");
  assert(markerOf(forcedFail.runtime).trigger === "systemd", "the taken-over marker records systemd");

  writeFileSync(
    shim.cron,
    "17 4 * * * /usr/bin/env bash '/tmp/other/opencode-db-scheduled.sh' --run # tawassul-db-maintenance owner=install-global\n",
  );
  const uninstalled = runLane(forcedFail.home, ["--db-maintenance", "--uninstall"]);
  assert(uninstalled.code === 0, "the maintenance lane uninstalls beside a foreign cron line");
  assert(
    uninstalled.out.includes("the maintenance schedule is owned by install-global") &&
      uninstalled.out.includes(systemdPath(forcedFail.config, serviceName)) &&
      uninstalled.out.includes(systemdPath(forcedFail.config, timerName)),
    "uninstall names the foreign owner and both unit paths",
  );
  assert(
    uninstalled.out.includes("crontab -l | grep -vF '# tawassul-db-maintenance owner=install-global' | crontab -"),
    "uninstall prints the exact foreign cron stamp",
  );
  assert(readFileSync(shim.cron, "utf-8").includes("owner=install-global"), "the foreign cron line survives uninstall");
  assert(!existsSync(join(forcedFail.runtime, "db")), "uninstall removes the maintenance scripts");

  const legacy = lane("legacy");
  writeFileSync(shim.cron, "");
  assert(
    runLane(legacy.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "cron" }).code === 0,
    "the lane installs before the legacy adoption",
  );
  writeFileSync(
    shim.cron,
    `17 4 * * * /usr/bin/env bash '${join(legacy.runtime, "db", "opencode-db-scheduled.sh")}' --run # tawassul-db-maintenance\n`,
  );
  const adopted = runLane(legacy.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "cron" });
  assert(adopted.code === 0, "an unstamped legacy cron line is adopted by the proven lane");
  assert(
    readFileSync(shim.cron, "utf-8").includes("owner=install.sh-db-maintenance"),
    "the adopted cron line is re-stamped",
  );
  assert(runLane(legacy.home, ["--db-maintenance", "--uninstall"]).code === 0, "the adopted lane uninstalls");
  assert(readFileSync(shim.cron, "utf-8").trim() === "", "uninstall removes the re-stamped cron line");

  const legacyUnits = lane("legacy-units");
  writeFileSync(shim.cron, "");
  assert(
    runLane(legacyUnits.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "systemd" }).code === 0,
    "the lane installs a unit pair before the legacy unit adoption",
  );
  const legacyService = systemdPath(legacyUnits.config, serviceName);
  const legacyTimer = systemdPath(legacyUnits.config, timerName);
  for (const file of [legacyService, legacyTimer]) {
    writeFileSync(
      file,
      readFileSync(file, "utf-8")
        .split("\n")
        .filter((line) => !line.startsWith("# tawassul-owner: "))
        .join("\n"),
    );
  }
  const adoptedUnits = runLane(legacyUnits.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "systemd" });
  assert(adoptedUnits.code === 0, "an unstamped legacy unit pair is adopted by the proven lane");
  assert(
    readFileSync(legacyService, "utf-8").startsWith("# tawassul-owner: install.sh-db-maintenance\n"),
    "the adopted service unit is re-stamped",
  );
  assert(
    readFileSync(legacyTimer, "utf-8").startsWith("# tawassul-owner: install.sh-db-maintenance\n"),
    "the adopted timer unit is re-stamped",
  );
  assert(runLane(legacyUnits.home, ["--db-maintenance", "--uninstall"]).code === 0, "the adopted unit pair uninstalls");
  assert(
    !existsSync(legacyService) && !existsSync(legacyTimer),
    "uninstall removes the re-stamped unit pair",
  );

  const spaced = lane("space home");
  writeFileSync(shim.cron, "");
  const spacedData = join(spaced.home, ".local", "share");
  const spacedRun = runLane(spaced.home, ["--db-maintenance"], {
    TAWASSUL_REGISTER_TRIGGERS: "auto",
    XDG_DATA_HOME: spacedData,
  });
  assert(spacedRun.code === 0, "a home path with a space registers systemd");
  const spacedService = readFileSync(systemdPath(spaced.config, serviceName), "utf-8");
  assert(
    spacedService.includes(`ExecStart=/usr/bin/env bash "${join(spaced.runtime, "db", "opencode-db-scheduled.sh")}" --run`),
    "the unit quotes a script path that contains a space",
  );
  assert(
    spacedService.includes(`Environment="OPENCODE_DB=${spaced.db}"`),
    "the unit quotes a database path that contains a space",
  );
  assert(
    spacedService.includes(`Environment="XDG_DATA_HOME=${spacedData}"`),
    "the unit quotes an XDG data path that contains a space",
  );
  const analyzed = spawnSync(
    "systemd-analyze",
    ["verify", systemdPath(spaced.config, serviceName), systemdPath(spaced.config, timerName)],
    { encoding: "utf-8", env: proofEnv() },
  );
  assert(
    analyzed.status === 0,
    `systemd-analyze accepts the spaced-home unit pair: ${analyzed.stderr ?? ""}`,
  );
  const spacedCron = runLane(spaced.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "cron" });
  assert(spacedCron.code === 0, "a home path with a space registers cron");
  assert(
    readFileSync(shim.cron, "utf-8").includes(`'${join(spaced.runtime, "db", "opencode-db-scheduled.sh")}' --run`),
    "the cron line quotes a script path that contains a space",
  );

  const linkHome = lane("symlink");
  const linkPath = join(linkHome.home, ".local", "share", "opencode", "tawassul-v2", "linked.db");
  symlinkSync(linkHome.db, linkPath);
  const linked = runLane(linkHome.home, ["--db-maintenance", "--db", linkPath], { TAWASSUL_REGISTER_TRIGGERS: "manual" });
  assert(linked.code !== 0 && linked.out.includes("refusing a symlinked database path"), "the lane rejects a symlinked DB path");
  const outside = join(ROOT, "outside.db");
  writeFileSync(outside, "");
  const escaped = runLane(linkHome.home, ["--db-maintenance", "--db", outside], { TAWASSUL_REGISTER_TRIGGERS: "manual" });
  assert(
    escaped.code !== 0 && escaped.out.includes("expected a desktop-sidecar DB under"),
    "the lane rejects a DB outside the sidecar root",
  );

  const freshHome = join(ROOT, "lane", "fresh");
  const fresh = runLane(freshHome, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "manual" });
  assert(
    fresh.code !== 0 && fresh.out.includes("start the host once before installing the lane"),
    "a fresh home asks for the host's first launch",
  );

  const scratchHome = join(ROOT, "lane", "scratch-home");
  const scratchPrefix = join(ROOT, "lane", "scratch-prefix");
  const scratchDb = join(scratchPrefix, ".local", "share", "opencode", "tawassul-v2", "opencode.db");
  mkdirSync(dirname(scratchDb), { recursive: true });
  writeFileSync(scratchDb, "");
  const scratchConfig = join(scratchPrefix, ".config");
  const scratchForced = runLane(scratchHome, ["--db-maintenance", "--prefix", scratchPrefix], {
    TAWASSUL_REGISTER_TRIGGERS: "systemd",
  });
  assert(
    scratchForced.code !== 0 && scratchForced.out.includes("a scratch --prefix cannot register systemd"),
    "a forced systemd mode under a foreign prefix fails loudly",
  );
  assert(
    scratchForced.out.includes(
      `bash "${join(scratchPrefix, ".config", "opencode", "tawassul-runtime", "db", "opencode-db-scheduled.sh")}" --run`,
    ),
    "the forced refusal prints the manual run command",
  );
  const scratchManual = runLane(scratchHome, ["--db-maintenance", "--prefix", scratchPrefix], {
    TAWASSUL_REGISTER_TRIGGERS: "auto",
  });
  assert(
    scratchManual.code === 0 && !existsSync(systemdPath(scratchConfig, serviceName)),
    "a foreign prefix keeps the auto mode manual",
  );
  assert(
    scratchManual.out.includes("run the lane manually with: bash"),
    "a foreign prefix prints the manual run command",
  );
  assert(
    JSON.parse(readFileSync(join(scratchPrefix, ".config", "opencode", "tawassul-runtime", "db", "MAINTENANCE"), "utf-8"))
      .trigger === "manual",
    "the foreign prefix marker records manual",
  );

  const prefixHome = lane("prefix-home");
  writeFileSync(shim.cron, "");
  const foreignConfig = join(ROOT, "lane", "prefix-home-xdg");
  mkdirSync(foreignConfig, { recursive: true });
  const prefixHomeRun = runLane(prefixHome.home, ["--db-maintenance", "--prefix", prefixHome.home], {
    TAWASSUL_REGISTER_TRIGGERS: "auto",
    XDG_CONFIG_HOME: foreignConfig,
  });
  assert(
    prefixHomeRun.code === 0 && markerOf(prefixHome.runtime).trigger === "manual",
    "PREFIX=$HOME under a foreign XDG_CONFIG_HOME stays manual",
  );
  assert(
    !existsSync(systemdPath(prefixHome.config, serviceName)) && !existsSync(systemdPath(foreignConfig, serviceName)),
    "the foreign XDG guard writes no unit pair",
  );

  const prefixDefault = lane("prefix-default");
  writeFileSync(shim.cron, "");
  const prefixDefaultRun = runLane(prefixDefault.home, ["--db-maintenance", "--prefix", prefixDefault.home], {
    TAWASSUL_REGISTER_TRIGGERS: "auto",
  });
  assert(
    prefixDefaultRun.code === 0 && markerOf(prefixDefault.runtime).trigger === "systemd",
    "PREFIX=$HOME without a foreign XDG_CONFIG_HOME registers systemd",
  );
  assert(
    existsSync(systemdPath(prefixDefault.config, serviceName)) && existsSync(systemdPath(prefixDefault.config, timerName)),
    "the matching prefix writes the unit pair under HOME/.config",
  );

  const realHost = lane("real-host");
  writeFileSync(shim.cron, "");
  assert(
    runLane(realHost.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "cron" }).code === 0,
    "the real host lane registers a cron line before the scratch runs",
  );
  const realHostCron = readFileSync(shim.cron, "utf-8");
  const scratchOptHome = join(ROOT, "lane", "scratch-opt-home");
  const scratchOptPrefix = join(ROOT, "lane", "scratch-opt-prefix");
  const scratchOptDb = join(scratchOptPrefix, ".local", "share", "opencode", "tawassul-v2", "opencode.db");
  mkdirSync(dirname(scratchOptDb), { recursive: true });
  writeFileSync(scratchOptDb, "");
  const scratchOpt = runLane(scratchOptHome, ["--db-maintenance", "--prefix", scratchOptPrefix], {
    TAWASSUL_REGISTER_TRIGGERS: "auto",
    TAWASSUL_DB_MAINTENANCE: "off",
  });
  assert(scratchOpt.code === 0, "a scratch-prefix opt-out completes");
  assert(
    readFileSync(shim.cron, "utf-8") === realHostCron,
    "a scratch-prefix opt-out leaves the real host cron line",
  );
  assert(
    JSON.parse(readFileSync(join(scratchOptPrefix, ".config", "opencode", "tawassul-runtime", "db", "MAINTENANCE"), "utf-8"))
      .trigger === "off",
    "the scratch-prefix opt-out marker records off",
  );
  assert(
    runLane(scratchOptHome, ["--db-maintenance", "--prefix", scratchOptPrefix, "--uninstall"]).code === 0,
    "the scratch-prefix lane uninstalls",
  );
  assert(
    readFileSync(shim.cron, "utf-8") === realHostCron,
    "a scratch-prefix uninstall leaves the real host cron line",
  );
  assert(
    runLane(realHost.home, ["--db-maintenance", "--uninstall"]).code === 0,
    "the real host lane uninstalls after the scratch runs",
  );
  assert(readFileSync(shim.cron, "utf-8").trim() === "", "the real host uninstall removes its own cron line");

  const legacyCronSwitch = lane("legacy-cron-switch");
  writeFileSync(shim.cron, "");
  assert(
    runLane(legacyCronSwitch.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "cron" }).code === 0,
    "the legacy-cron switch case installs a cron line",
  );
  writeFileSync(
    shim.cron,
    `17 4 * * * /usr/bin/env bash '${join(legacyCronSwitch.runtime, "db", "opencode-db-scheduled.sh")}' --run # tawassul-db-maintenance\n`,
  );
  const switched = runLane(legacyCronSwitch.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "systemd" });
  assert(
    switched.code === 0 && markerOf(legacyCronSwitch.runtime).trigger === "systemd",
    "the proved lane switches from cron to systemd",
  );
  assert(readFileSync(shim.cron, "utf-8").trim() === "", "the systemd switch removes the adopted legacy cron line");

  const legacyCronOff = lane("legacy-cron-off");
  writeFileSync(shim.cron, "");
  assert(
    runLane(legacyCronOff.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "cron" }).code === 0,
    "the legacy-cron opt-out case installs a cron line",
  );
  writeFileSync(
    shim.cron,
    `17 4 * * * /usr/bin/env bash '${join(legacyCronOff.runtime, "db", "opencode-db-scheduled.sh")}' --run # tawassul-db-maintenance\n`,
  );
  const legacyCronOffRun = runLane(legacyCronOff.home, ["--db-maintenance"], {
    TAWASSUL_DB_MAINTENANCE: "off",
  });
  assert(
    legacyCronOffRun.code === 0 && markerOf(legacyCronOff.runtime).trigger === "off",
    "the opt-out accepts an adopted legacy cron line",
  );
  assert(readFileSync(shim.cron, "utf-8").trim() === "", "the opt-out removes the adopted legacy cron line");

  const legacyUnitOff = lane("legacy-unit-off");
  writeFileSync(shim.cron, "");
  assert(
    runLane(legacyUnitOff.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "systemd" }).code === 0,
    "the legacy-unit opt-out case installs a unit pair",
  );
  for (const file of [systemdPath(legacyUnitOff.config, serviceName), systemdPath(legacyUnitOff.config, timerName)]) {
    writeFileSync(
      file,
      readFileSync(file, "utf-8")
        .split("\n")
        .filter((line) => !line.startsWith("# tawassul-owner: "))
        .join("\n"),
    );
  }
  const legacyUnitOffRun = runLane(legacyUnitOff.home, ["--db-maintenance"], {
    TAWASSUL_DB_MAINTENANCE: "off",
  });
  assert(
    legacyUnitOffRun.code === 0 &&
      !existsSync(systemdPath(legacyUnitOff.config, serviceName)) &&
      !existsSync(systemdPath(legacyUnitOff.config, timerName)),
    "the opt-out removes an adopted legacy unit pair",
  );

  const foreignMarker = lane("foreign-marker");
  writeFileSync(shim.cron, "");
  assert(
    runLane(foreignMarker.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "manual" }).code === 0,
    "the foreign-marker case installs a manual lane",
  );
  const foreignMarkerPath = join(foreignMarker.runtime, "db", "MAINTENANCE");
  const foreignMarkerBody = JSON.parse(readFileSync(foreignMarkerPath, "utf-8")) as Record<string, unknown>;
  foreignMarkerBody.package = "other-package";
  writeFileSync(foreignMarkerPath, `${JSON.stringify(foreignMarkerBody, null, 2)}\n`);
  const foreignPackageUninstall = runLane(foreignMarker.home, ["--db-maintenance", "--uninstall"]);
  assert(
    foreignPackageUninstall.code !== 0 && foreignPackageUninstall.out.includes("no Tawassul maintenance marker"),
    "a marker with a foreign package is not owned",
  );
  foreignMarkerBody.package = "tawassul-v2";
  foreignMarkerBody.lane = "install-global";
  writeFileSync(foreignMarkerPath, `${JSON.stringify(foreignMarkerBody, null, 2)}\n`);
  const foreignLaneUninstall = runLane(foreignMarker.home, ["--db-maintenance", "--uninstall"]);
  assert(
    foreignLaneUninstall.code !== 0 && foreignLaneUninstall.out.includes("no Tawassul maintenance marker"),
    "a marker with a foreign lane is not owned",
  );
  assert(
    existsSync(foreignMarkerPath) && existsSync(join(foreignMarker.runtime, "db", "opencode-db-scheduled.sh")),
    "the foreign marker keeps the lane files",
  );
  assert(
    runLane(foreignMarker.home, ["--db-maintenance", "--uninstall", "--force"]).code === 0,
    "--force removes the lane under a foreign marker",
  );

  const controlPath = lane("control-path");
  const controlDb = join(controlPath.home, ".local", "share", "opencode", "tawassul-v2", "bad\nname.db");
  writeFileSync(controlDb, "");
  const controlRun = runLane(controlPath.home, ["--db-maintenance", "--db", controlDb], {
    TAWASSUL_REGISTER_TRIGGERS: "manual",
  });
  assert(
    controlRun.code !== 0 && controlRun.out.includes("unsupported control character"),
    "the lane rejects a newline in the database path",
  );
  assert(
    !existsSync(join(controlPath.runtime, "db", "MAINTENANCE")),
    "a control-character database path writes no marker",
  );

  const failingLane = lane("failing-cron");
  writeFileSync(shim.cron, "");
  assert(
    runLane(failingLane.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "cron" }).code === 0,
    "the failing-crontab case installs a cron line",
  );
  const failingShimDir = join(ROOT, "shim-failing-cron");
  mkdirSync(failingShimDir, { recursive: true });
  writeFileSync(
    join(failingShimDir, "crontab"),
    `#!/bin/sh\nif [ "$1" = "-l" ]; then cat "${shim.cron}" 2>/dev/null; exit 0; fi\nexit 1\n`,
  );
  chmodSync(join(failingShimDir, "crontab"), 0o755);
  writeFileSync(join(failingShimDir, "systemctl"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(failingShimDir, "systemctl"), 0o755);
  const failingEnv = { PATH: `${failingShimDir}:/usr/bin:/bin` };
  const failingOptOut = runLane(failingLane.home, ["--db-maintenance"], {
    ...failingEnv,
    TAWASSUL_DB_MAINTENANCE: "off",
  });
  assert(
    failingOptOut.code !== 0 && failingOptOut.out.includes("crontab could not remove the maintenance entry"),
    "the opt-out fails when crontab cannot write",
  );
  assert(
    existsSync(join(failingLane.runtime, "db", "MAINTENANCE")) &&
      existsSync(join(failingLane.runtime, "db", "opencode-db-scheduled.sh")),
    "the failed opt-out keeps the marker and scripts",
  );
  const failingUninstall = runLane(failingLane.home, ["--db-maintenance", "--uninstall"], failingEnv);
  assert(
    failingUninstall.code !== 0 && failingUninstall.out.includes("the lane was not removed"),
    "uninstall fails when crontab cannot write",
  );
  assert(
    existsSync(join(failingLane.runtime, "db", "MAINTENANCE")) &&
      existsSync(join(failingLane.runtime, "db", "opencode-db-scheduled.sh")),
    "the failed uninstall keeps the marker and scripts",
  );
  assert(
    runLane(failingLane.home, ["--db-maintenance", "--uninstall"]).code === 0,
    "the lane uninstalls once crontab recovers",
  );

  const systemdCleanup = lane("systemd-cleanup");
  writeFileSync(shim.cron, "");
  assert(
    runLane(systemdCleanup.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "cron" }).code === 0,
    "the systemd-cleanup case installs a cron line",
  );
  const systemdCleanupCron = readFileSync(shim.cron, "utf-8");
  const systemdCleanupRun = runLane(systemdCleanup.home, ["--db-maintenance"], {
    TAWASSUL_REGISTER_TRIGGERS: "systemd",
    PATH: `${failingShimDir}:/usr/bin:/bin`,
  });
  assert(
    systemdCleanupRun.code !== 0 &&
      systemdCleanupRun.out.includes("crontab could not remove the previous maintenance entry"),
    "the systemd switch fails when the old cron line cannot be removed",
  );
  assert(markerOf(systemdCleanup.runtime).trigger === "cron", "the failed switch restores the cron marker");
  assert(readFileSync(shim.cron, "utf-8") === systemdCleanupCron, "the failed switch keeps the previous cron line");
  assert(
    !existsSync(systemdPath(systemdCleanup.config, serviceName)) &&
      !existsSync(systemdPath(systemdCleanup.config, timerName)),
    "the failed switch removes its new unit pair",
  );

  const unreadableShimDir = join(ROOT, "shim-unreadable-cron");
  mkdirSync(unreadableShimDir, { recursive: true });
  writeFileSync(
    join(unreadableShimDir, "crontab"),
    `#!/bin/sh\nif [ "$1" = "-l" ]; then printf 'crontab: cannot read\\n' >&2; exit 1; fi\ncat > "${shim.cron}"\n`,
  );
  chmodSync(join(unreadableShimDir, "crontab"), 0o755);
  writeFileSync(join(unreadableShimDir, "systemctl"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(unreadableShimDir, "systemctl"), 0o755);
  const unreadableEnv = { PATH: `${unreadableShimDir}:/usr/bin:/bin` };

  const unreadableLane = lane("unreadable-cron");
  const unrelated = "0 1 * * * /usr/bin/true # unrelated\n";
  writeFileSync(shim.cron, unrelated);
  const unreadableInstall = runLane(unreadableLane.home, ["--db-maintenance"], {
    ...unreadableEnv,
    TAWASSUL_REGISTER_TRIGGERS: "cron",
  });
  assert(
    unreadableInstall.code !== 0 && unreadableInstall.out.includes("refusing to rewrite an unknown schedule"),
    "install refuses an unreadable crontab",
  );
  assert(readFileSync(shim.cron, "utf-8") === unrelated, "the refused install preserves an unrelated cron entry");
  assert(
    !existsSync(join(unreadableLane.runtime, "db", "MAINTENANCE")),
    "the refused install writes no marker",
  );
  assert(
    runLane(unreadableLane.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "cron" }).code === 0,
    "the unreadable-cron lane installs once crontab recovers",
  );
  const unreadableCron = readFileSync(shim.cron, "utf-8");
  const unreadableUninstall = runLane(unreadableLane.home, ["--db-maintenance", "--uninstall"], unreadableEnv);
  assert(
    unreadableUninstall.code !== 0 &&
      unreadableUninstall.out.includes("crontab could not be read; the maintenance lane was not removed"),
    "uninstall refuses an unreadable crontab",
  );
  assert(markerOf(unreadableLane.runtime).trigger === "cron", "the refused uninstall keeps the cron marker");
  assert(existsSync(join(unreadableLane.runtime, "db", "opencode-db-scheduled.sh")), "the refused uninstall keeps the scripts");
  assert(readFileSync(shim.cron, "utf-8") === unreadableCron, "the refused uninstall keeps the cron line");
  const unreadableOptOut = runLane(unreadableLane.home, ["--db-maintenance"], {
    ...unreadableEnv,
    TAWASSUL_DB_MAINTENANCE: "off",
  });
  assert(
    unreadableOptOut.code !== 0 && unreadableOptOut.out.includes("the maintenance lane was kept"),
    "the opt-out refuses an unreadable crontab",
  );
  assert(markerOf(unreadableLane.runtime).trigger === "cron", "the refused opt-out keeps the cron marker");
  assert(
    runLane(unreadableLane.home, ["--db-maintenance", "--uninstall"]).code === 0,
    "the unreadable-cron lane uninstalls once crontab recovers",
  );

  const unreadableSwitch = lane("unreadable-switch");
  writeFileSync(shim.cron, "");
  assert(
    runLane(unreadableSwitch.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "cron" }).code === 0,
    "the unreadable-switch case installs a cron line",
  );
  const unreadableSwitchCron = readFileSync(shim.cron, "utf-8");
  const unreadableSwitchRun = runLane(unreadableSwitch.home, ["--db-maintenance"], {
    ...unreadableEnv,
    TAWASSUL_REGISTER_TRIGGERS: "systemd",
  });
  assert(
    unreadableSwitchRun.code === 0 && markerOf(unreadableSwitch.runtime).trigger === "systemd",
    "the systemd switch tolerates an unreadable crontab",
  );
  assert(
    unreadableSwitchRun.out.includes("the previous cron entry was left in place"),
    "the tolerant switch reports the left cron entry",
  );
  assert(
    readFileSync(shim.cron, "utf-8") === unreadableSwitchCron,
    "the tolerant switch keeps the previous cron line",
  );
  assert(
    runLane(unreadableSwitch.home, ["--db-maintenance", "--uninstall"]).code === 0,
    "the tolerant switch lane uninstalls once crontab recovers",
  );
  assert(readFileSync(shim.cron, "utf-8").trim() === "", "the recovered uninstall removes the left cron line");

  const rollbackLane = lane("rollback-runtime");
  writeFileSync(shim.cron, "");
  const rollbackRun = runLane(rollbackLane.home, ["--db-maintenance"], {
    TAWASSUL_REGISTER_TRIGGERS: "cron",
    PATH: `${failingShimDir}:/usr/bin:/bin`,
  });
  assert(
    rollbackRun.code !== 0 && rollbackRun.out.includes("database maintenance registration failed"),
    "a failed maintenance install rolls the lane back",
  );
  assert(
    !existsSync(rollbackLane.runtime),
    "a failed maintenance install removes the runtime directory it created",
  );
  const globalAfterRollback = runLane(rollbackLane.home, ["--global"]);
  assert(
    globalAfterRollback.code === 0 && !globalAfterRollback.out.includes("exists without a Tawassul marker"),
    "a global install accepts the runtime root after a rolled-back maintenance install",
  );
  assert(
    existsSync(join(rollbackLane.config, "opencode", "plugins", "tawassul.js")),
    "the global install writes the bundle after the rollback",
  );
  assert(
    runLane(rollbackLane.home, ["--global", "--uninstall"]).code === 0,
    "the global install after a rollback uninstalls",
  );

  const reverseOrder = lane("reverse-order");
  writeFileSync(shim.cron, "");
  assert(
    runLane(reverseOrder.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "manual" }).code === 0,
    "the maintenance lane installs before the global bundle",
  );
  const reverseGlobal = runLane(reverseOrder.home, ["--global"]);
  assert(
    reverseGlobal.code === 0 && !reverseGlobal.out.includes("exists without a Tawassul marker"),
    "a global install accepts a maintenance-only runtime",
  );
  assert(
    existsSync(join(reverseOrder.runtime, "db", "MAINTENANCE")),
    "the global install keeps the maintenance marker",
  );
  const reverseUninstall = runLane(reverseOrder.home, ["--global", "--uninstall"]);
  assert(reverseUninstall.code === 0, "the global uninstall completes beside the maintenance lane");
  assert(
    existsSync(join(reverseOrder.runtime, "db", "MAINTENANCE")) &&
      existsSync(join(reverseOrder.runtime, "db", "opencode-db-scheduled.sh")),
    "the global uninstall keeps the maintenance marker and scripts",
  );
  assert(
    runLane(reverseOrder.home, ["--db-maintenance", "--uninstall"]).code === 0,
    "the maintenance lane uninstalls after the global uninstall",
  );
  assert(!existsSync(reverseOrder.runtime), "the maintenance uninstall removes the runtime root");

  const crossHome = join(ROOT, "lane", "global-beside-lane");
  const crossConfig = join(crossHome, ".config");
  const crossData = join(crossHome, ".local", "share");
  const crossDb = join(crossData, "opencode", "tawassul-v2", "opencode.db");
  mkdirSync(dirname(crossDb), { recursive: true });
  writeFileSync(crossDb, "");
  const crossLaneEnv = {
    TAWASSUL_REGISTER_TRIGGERS: "manual",
    XDG_CONFIG_HOME: crossConfig,
    XDG_DATA_HOME: crossData,
  };
  assert(
    runLane(crossHome, ["--db-maintenance"], crossLaneEnv).code === 0,
    "the cross case installs the maintenance lane first",
  );
  const crossBunEnv: NodeJS.ProcessEnv = {
    ...proofEnv(),
    HOME: crossHome,
    XDG_CONFIG_HOME: crossConfig,
    XDG_DATA_HOME: crossData,
    TAWASSUL_GLOBAL_DIR: join(crossConfig, "opencode"),
    PATH: `${shim.dir}:/usr/bin:/bin`,
    OPENCODE_DB: crossDb,
    TAWASSUL_REGISTER_TRIGGERS: "manual",
  };
  const crossGlobal = runWith([], crossBunEnv);
  assert(crossGlobal.code === 0, "install-global completes beside the maintenance lane");
  const crossRuntime = join(crossConfig, "opencode", "tawassul-runtime");
  assert(existsSync(join(crossRuntime, "db", "MAINTENANCE")), "the cross install keeps the maintenance marker");
  assert(
    !/"db"\s*:/.test(readFileSync(join(crossRuntime, "VERSION"), "utf-8")),
    "the cross install records no db payload beside the maintenance lane",
  );
  const crossAgain = runLane(crossHome, ["--db-maintenance"], crossLaneEnv);
  assert(
    crossAgain.code === 0 && !crossAgain.out.includes("records the repository database lane"),
    "a second --db-maintenance run replaces the files after install-global",
  );
  const crossRemove = runLane(crossHome, ["--db-maintenance", "--uninstall"], crossLaneEnv);
  assert(crossRemove.code === 0, "the lane uninstalls beside the install-global marker");
  assert(
    !existsSync(join(crossRuntime, "db", "MAINTENANCE")) &&
      !existsSync(join(crossRuntime, "db", "opencode-db-scheduled.sh")),
    "the lane uninstall removes the scripts when VERSION records no database lane",
  );
  assert(existsSync(join(crossRuntime, "VERSION")), "the lane uninstall keeps the install-global marker");
  assert(runWith(["--uninstall"], crossBunEnv).code === 0, "install-global uninstalls after the lane removal");

  const versionDb = lane("version-db-refusal");
  writeFileSync(shim.cron, "");
  assert(runLane(versionDb.home, ["--global"]).code === 0, "the refusal case seeds a global marker");
  const versionPath = join(versionDb.runtime, "VERSION");
  const versionBase = JSON.parse(readFileSync(versionPath, "utf-8")) as Record<string, unknown>;
  writeFileSync(
    versionPath,
    `${JSON.stringify(
      {
        ...versionBase,
        db: {
          "opencode-db-scheduled.sh": {
            path: join(versionDb.runtime, "db", "opencode-db-scheduled.sh"),
            sha256: "0".repeat(64),
            bytes: 1,
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  const versionRefusedInstall = runLane(versionDb.home, ["--global"]);
  assert(
    versionRefusedInstall.code !== 0 &&
      versionRefusedInstall.out.includes("records a database payload; pass --force to overwrite it"),
    "a global install refuses a foreign VERSION.db without --force",
  );
  const versionRefusedUninstall = runLane(versionDb.home, ["--global", "--uninstall"]);
  assert(
    versionRefusedUninstall.code !== 0 &&
      versionRefusedUninstall.out.includes("records a database payload; pass --force to remove it"),
    "a global uninstall refuses a foreign VERSION.db without --force",
  );
  assert(
    existsSync(join(versionDb.config, "opencode", "plugins", "tawassul.js")),
    "the refused global uninstall keeps the bundle",
  );

  const cleanupLane = lane("global-uninstall-cleanup");
  writeFileSync(shim.cron, "");
  assert(
    runLane(cleanupLane.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "cron" }).code === 0,
    "the cleanup case installs a cron-owned lane",
  );
  assert(
    readFileSync(shim.cron, "utf-8").includes("owner=install.sh-db-maintenance"),
    "the cleanup case owns the cron line",
  );
  assert(runLane(cleanupLane.home, ["--global"]).code === 0, "the global install completes beside the cron lane");
  const cleanupUninstall = runLane(cleanupLane.home, ["--global", "--uninstall"]);
  assert(cleanupUninstall.code === 0, "the global uninstall completes beside the cron lane");
  assert(
    cleanupUninstall.out.includes("the maintenance schedule is owned by install.sh-db-maintenance"),
    "the global uninstall names the lane owner",
  );
  assert(
    cleanupUninstall.out.includes(systemdPath(cleanupLane.config, serviceName)) &&
      cleanupUninstall.out.includes(systemdPath(cleanupLane.config, timerName)),
    "the global uninstall names the lane's unit paths",
  );
  assert(
    cleanupUninstall.out.includes("crontab -l | grep -vF '# tawassul-db-maintenance owner=install.sh-db-maintenance' | crontab -"),
    "the global uninstall prints the lane owner's cron cleanup command",
  );
  assert(
    readFileSync(shim.cron, "utf-8").includes("owner=install.sh-db-maintenance"),
    "the global uninstall leaves the lane's cron line",
  );
  assert(
    existsSync(join(cleanupLane.runtime, "db", "MAINTENANCE")),
    "the global uninstall keeps the lane marker",
  );

  const forcedLane = lane("force-lane-beside-version");
  writeFileSync(shim.cron, "");
  assert(runLane(forcedLane.home, ["--global"]).code === 0, "the lane force case seeds a global marker");
  const forcedVersionPath = join(forcedLane.runtime, "VERSION");
  const forcedVersionBefore = readFileSync(forcedVersionPath, "utf-8");
  writeForeignUnitPair(forcedLane.config, "install-global", join(forcedLane.runtime, "db", "opencode-db-scheduled.sh"));
  const forcedLaneRun = runLane(forcedLane.home, ["--db-maintenance", "--force"], {
    TAWASSUL_REGISTER_TRIGGERS: "systemd",
  });
  assert(forcedLaneRun.code === 0, "the lane force takes over a foreign unit beside a global marker");
  assert(
    readFileSync(systemdPath(forcedLane.config, serviceName), "utf-8").startsWith(
      "# tawassul-owner: install.sh-db-maintenance\n",
    ),
    "the lane force rewrites the unit with its own stamp",
  );
  assert(
    readFileSync(forcedVersionPath, "utf-8") === forcedVersionBefore,
    "the lane force leaves the global VERSION marker intact",
  );

  const forcedGlobal = lane("force-global-beside-maint");
  writeFileSync(shim.cron, "");
  assert(
    runLane(forcedGlobal.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "manual" }).code === 0,
    "the global force case installs the lane first",
  );
  const forcedMaintPath = join(forcedGlobal.runtime, "db", "MAINTENANCE");
  const forcedMaintBefore = readFileSync(forcedMaintPath, "utf-8");
  writeForeignUnitPair(forcedGlobal.config, "install.sh-db-maintenance", join(forcedGlobal.runtime, "db", "opencode-db-scheduled.sh"));
  const forcedGlobalEnv: NodeJS.ProcessEnv = {
    ...proofEnv(),
    HOME: forcedGlobal.home,
    XDG_CONFIG_HOME: forcedGlobal.config,
    XDG_DATA_HOME: join(forcedGlobal.home, ".local", "share"),
    TAWASSUL_GLOBAL_DIR: join(forcedGlobal.config, "opencode"),
    PATH: `${shim.dir}:/usr/bin:/bin`,
    OPENCODE_DB: forcedGlobal.db,
    TAWASSUL_REGISTER_TRIGGERS: "systemd",
  };
  const forcedGlobalRun = runWith(["--force"], forcedGlobalEnv);
  assert(forcedGlobalRun.code === 0, "install-global --force completes beside the maintenance lane");
  assert(
    readFileSync(systemdPath(forcedGlobal.config, serviceName), "utf-8").startsWith(
      "# tawassul-owner: install.sh-db-maintenance\n",
    ),
    "install-global --force leaves the lane's unit intact",
  );
  assert(
    readFileSync(forcedMaintPath, "utf-8") === forcedMaintBefore,
    "install-global --force leaves the lane marker intact",
  );

  const dryRunLane = lane("dry-run-plain");
  writeFileSync(shim.cron, "");
  assert(
    runLane(dryRunLane.home, ["--db-maintenance"], { TAWASSUL_REGISTER_TRIGGERS: "manual" }).code === 0,
    "the dry-run case installs a plain lane",
  );
  const plainDry = runLane(dryRunLane.home, ["--db-maintenance", "--uninstall", "--dry-run"]);
  assert(
    plainDry.code === 0 &&
      plainDry.out.includes("would remove the database scripts, marker and this lane's own schedule"),
    "the maintenance uninstall dry run reports the removal path without VERSION.db",
  );
  assert(
    existsSync(join(dryRunLane.runtime, "db", "opencode-db-scheduled.sh")),
    "the plain dry run keeps the five scripts",
  );
}

function globalTriggerEnv(label: string, extra: NodeJS.ProcessEnv = {}): {
  env: NodeJS.ProcessEnv;
  global: string;
  config: string;
  cron: string;
} {
  const shim = triggerShim(`global-${label}`);
  const base = join(ROOT, "global-trigger", label);
  const config = join(base, "config");
  const global = join(base, "opencode");
  const env: NodeJS.ProcessEnv = {
    ...proofEnv(),
    HOME: join(base, "home"),
    XDG_CONFIG_HOME: config,
    TAWASSUL_GLOBAL_DIR: global,
    PATH: `${shim.dir}:/usr/bin:/bin`,
    OPENCODE_DB: join(base, "missing.db"),
    TAWASSUL_REGISTER_TRIGGERS: "off",
    ...extra,
  };
  return { env, global, config, cron: shim.cron };
}

function writeForeignUnitPair(config: string, owner: string, script: string): { service: string; timer: string } {
  const dir = join(config, "systemd", "user");
  const service = join(dir, "tawassul-db-maintenance.service");
  const timer = join(dir, "tawassul-db-maintenance.timer");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    service,
    `# tawassul-owner: ${owner}\n[Unit]\nDescription=Tawassul v2 DB maintenance lane\n\n[Service]\nType=oneshot\nExecStart=/usr/bin/env bash "${script}" --run\n`,
  );
  writeFileSync(
    timer,
    `# tawassul-owner: ${owner}\n[Unit]\nDescription=Tawassul v2 DB maintenance schedule\n\n[Timer]\nOnCalendar=daily\n`,
  );
  return { service, timer };
}

function installGlobalLaneCases(): void {
  const maintenanceEnv = globalTriggerEnv("maintenance");
  const maintFile = join(maintenanceEnv.global, "tawassul-runtime", "db", "MAINTENANCE");
  mkdirSync(dirname(maintFile), { recursive: true });
  writeFileSync(
    maintFile,
    `${JSON.stringify(
      {
        package: "tawassul-v2",
        lane: "install.sh --db-maintenance",
        version: "0.0.0",
        db: join(maintenanceEnv.global, "sidecar.db"),
        trigger: "manual",
        gapSeconds: 3600,
        installedAt: "2026-11-17T00:00:00Z",
      },
      null,
      2,
    )}\n`,
  );
  const dry = runWith(["--dry-run"], maintenanceEnv.env);
  assert(
    dry.code === 0 && dry.out.includes("owns the database lane; no db scripts would be written"),
    "the install-global dry run reports the maintenance lane",
  );
  assert(
    !dry.out.includes("Windows lane stages no db scripts") && !dry.out.includes("would write 5 db scripts"),
    "the dry run does not claim database work it will not do",
  );
  const real = runWith([], { ...maintenanceEnv.env, TAWASSUL_REGISTER_TRIGGERS: "manual" });
  assert(real.code === 0 && !real.out.includes("smoke"), "a real install under MAINTENANCE runs no dbSmoke");
  const maintMarker = JSON.parse(readFileSync(join(maintenanceEnv.global, "tawassul-runtime", "VERSION"), "utf-8")) as Marker;
  assert(Object.keys(maintMarker.db ?? {}).length === 0, "the marker records no db payload under MAINTENANCE");
  assert(
    !/"db"\s*:/.test(readFileSync(join(maintenanceEnv.global, "tawassul-runtime", "VERSION"), "utf-8")),
    "the marker omits the db key entirely under MAINTENANCE",
  );
  assert(maintMarker.trigger === "manual", "the marker keeps the manual trigger under MAINTENANCE");
  assert(runWith(["--verify"], maintenanceEnv.env).code === 0, "verify accepts a MAINTENANCE lane without db records");

  const foreignCron = globalTriggerEnv("foreign-cron");
  writeFileSync(
    foreignCron.cron,
    "17 4 * * * /usr/bin/env bash '/tmp/other/opencode-db-scheduled.sh' --run # tawassul-db-maintenance owner=install.sh-db-maintenance\n",
  );
  const blocked = runWith([], { ...foreignCron.env, TAWASSUL_REGISTER_TRIGGERS: "auto" });
  assert(blocked.code === 0 && blocked.out.includes("leaving the trigger manual"), "a foreign cron line ends auto in manual");
  assert(blocked.out.includes("run the lane manually with: bash"), "the manual outcome prints the command to run");
  const blockedMarker = JSON.parse(readFileSync(join(foreignCron.global, "tawassul-runtime", "VERSION"), "utf-8")) as Marker;
  assert(blockedMarker.trigger === "manual", "the marker records manual under a foreign cron line");
  assert(
    !existsSync(join(foreignCron.config, "systemd", "user", "tawassul-db-maintenance.service")),
    "auto writes no systemd unit beside a foreign cron line",
  );
  assert(readFileSync(foreignCron.cron, "utf-8").includes("owner=install.sh-db-maintenance"), "the foreign cron line survives");

  const forced = globalTriggerEnv("forced-fail");
  const foreignScript = join(forced.global, "tawassul-runtime", "db", "opencode-db-scheduled.sh");
  const forcedUnits = writeForeignUnitPair(forced.config, "install.sh-db-maintenance", foreignScript);
  const staleWasmDir = join(forced.global, "tawassul-runtime", "wasm", "stale-tree");
  mkdirSync(staleWasmDir, { recursive: true });
  const staleWasm = join(staleWasmDir, "old.wasm");
  writeFileSync(staleWasm, "stale\n");
  const forcedFailure = runWith([], { ...forced.env, TAWASSUL_REGISTER_TRIGGERS: "systemd" });
  assert(
    forcedFailure.code !== 0 && forcedFailure.out.includes("refusing to register systemd"),
    "a forced systemd registration fails on a foreign unit",
  );
  assert(!existsSync(join(forced.global, "plugins", "tawassul.js")), "the failure writes no bundle");
  assert(!existsSync(join(forced.global, "tawassul-runtime", "VERSION")), "the failure writes no marker");
  assert(!existsSync(join(forced.global, "tawassul-runtime", "db")), "the failure stages no db scripts");
  assert(existsSync(staleWasm), "the failure leaves stale wasm pruning undone");
  assert(
    readFileSync(forcedUnits.service, "utf-8").startsWith("# tawassul-owner: install.sh-db-maintenance\n"),
    "the failure leaves the foreign unit intact",
  );

  const take = globalTriggerEnv("takeover");
  const takeScript = join(take.global, "tawassul-runtime", "db", "opencode-db-scheduled.sh");
  const takeUnits = writeForeignUnitPair(take.config, "install.sh-db-maintenance", takeScript);
  writeFileSync(
    take.cron,
    "17 4 * * * /usr/bin/env bash '/tmp/other/opencode-db-scheduled.sh' --run # tawassul-db-maintenance owner=install.sh-db-maintenance\n",
  );
  const taken = runWith(["--force"], { ...take.env, TAWASSUL_REGISTER_TRIGGERS: "auto" });
  assert(taken.code === 0, "--force takes over a foreign maintenance schedule");
  assert(
    readFileSync(takeUnits.service, "utf-8").startsWith("# tawassul-owner: install-global\n"),
    "--force rewrites the unit with the install-global stamp",
  );
  assert(readFileSync(take.cron, "utf-8").trim() === "", "--force removes the taken-over cron line");
  const takenMarker = JSON.parse(readFileSync(join(take.global, "tawassul-runtime", "VERSION"), "utf-8")) as Marker;
  assert(takenMarker.trigger === "systemd", "the taken-over marker records systemd");

  writeFileSync(
    takeUnits.service,
    "[Unit]\nDescription=Tawassul v2 DB maintenance lane\n\n[Service]\nType=oneshot\nExecStart=/usr/bin/env bash " +
      `"${takeScript}" --run\n`,
  );
  writeFileSync(
    takeUnits.timer,
    "[Unit]\nDescription=Tawassul v2 DB maintenance schedule\n\n[Timer]\nOnCalendar=daily\n",
  );
  const adopted = runWith([], { ...take.env, TAWASSUL_REGISTER_TRIGGERS: "systemd" });
  if (adopted.code !== 0) fail(`legacy unit adoption debug: ${adopted.out}`);
  assert(adopted.code === 0, "the proven lane adopts an unstamped legacy unit pair");
  assert(
    readFileSync(takeUnits.service, "utf-8").startsWith("# tawassul-owner: install-global\n"),
    "the adopted unit pair is re-stamped",
  );
  assert(runWith(["--uninstall"], take.env).code === 0, "the adopted lane uninstalls");
  assert(!existsSync(takeUnits.service) && !existsSync(takeUnits.timer), "uninstall removes the re-stamped unit pair");

  const opt = globalTriggerEnv("opt-out");
  assert(runWith([], { ...opt.env, TAWASSUL_REGISTER_TRIGGERS: "systemd" }).code === 0, "the lane registers systemd before the opt-out");
  const optUnits = {
    service: join(opt.config, "systemd", "user", "tawassul-db-maintenance.service"),
    timer: join(opt.config, "systemd", "user", "tawassul-db-maintenance.timer"),
  };
  assert(existsSync(optUnits.service) && existsSync(optUnits.timer), "the opt-out case starts with an owned unit pair");
  const optOut = runWith([], { ...opt.env, TAWASSUL_DB_MAINTENANCE: "off", TAWASSUL_REGISTER_TRIGGERS: "auto" });
  assert(optOut.code === 0, "TAWASSUL_DB_MAINTENANCE=off is accepted");
  assert(!existsSync(optUnits.service) && !existsSync(optUnits.timer), "the opt-out removes the owned unit pair");
  const optMarker = JSON.parse(readFileSync(join(opt.global, "tawassul-runtime", "VERSION"), "utf-8")) as Marker;
  assert(optMarker.trigger === "off", "the install-global opt-out marker records off");
  assert(readFileSync(opt.cron, "utf-8").trim() === "", "the opt-out writes no new schedule");

  const unreadableGlobalShim = join(ROOT, "shim-global-unreadable");
  mkdirSync(unreadableGlobalShim, { recursive: true });
  writeFileSync(
    join(unreadableGlobalShim, "crontab"),
    "#!/bin/sh\nif [ \"$1\" = \"-l\" ]; then printf 'crontab: cannot read\\n' >&2; exit 1; fi\ncat > /dev/null\n",
  );
  chmodSync(join(unreadableGlobalShim, "crontab"), 0o755);
  writeFileSync(join(unreadableGlobalShim, "systemctl"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(unreadableGlobalShim, "systemctl"), 0o755);
  const unreadableGlobalEnv = { PATH: `${unreadableGlobalShim}:/usr/bin:/bin` };

  const offUnreadable = globalTriggerEnv("off-unreadable");
  assert(
    runWith([], { ...offUnreadable.env, TAWASSUL_REGISTER_TRIGGERS: "cron" }).code === 0,
    "the off-unreadable case installs an owned cron line",
  );
  const offUnreadableCron = readFileSync(offUnreadable.cron, "utf-8");
  assert(offUnreadableCron.includes("owner=install-global"), "the off-unreadable case owns the cron line");
  const offUnreadableRun = runWith([], {
    ...offUnreadable.env,
    ...unreadableGlobalEnv,
    TAWASSUL_DB_MAINTENANCE: "off",
  });
  assert(
    offUnreadableRun.code === 0 &&
      offUnreadableRun.out.includes("crontab could not be read") &&
      offUnreadableRun.out.includes("could not be fully removed"),
    "the opt-out reports an unreadable crontab instead of claiming removal",
  );
  assert(
    readFileSync(offUnreadable.cron, "utf-8") === offUnreadableCron,
    "the opt-out keeps the owned cron line when the crontab is unreadable",
  );
  const offRecovered = runWith([], { ...offUnreadable.env, TAWASSUL_DB_MAINTENANCE: "off" });
  assert(
    offRecovered.code === 0 &&
      offRecovered.out.includes("the owned schedule was removed") &&
      readFileSync(offUnreadable.cron, "utf-8").trim() === "",
    "the opt-out removes the owned cron line once the crontab is readable",
  );

  const un = globalTriggerEnv("uninstall-foreign");
  assert(runWith([], { ...un.env, TAWASSUL_REGISTER_TRIGGERS: "systemd" }).code === 0, "the uninstall case installs systemd");
  const unUnits = {
    service: join(un.config, "systemd", "user", "tawassul-db-maintenance.service"),
    timer: join(un.config, "systemd", "user", "tawassul-db-maintenance.timer"),
  };
  for (const file of [unUnits.service, unUnits.timer]) {
    const text = readFileSync(file, "utf-8").replace("# tawassul-owner: install-global", "# tawassul-owner: install.sh-db-maintenance");
    writeFileSync(file, text);
  }
  writeFileSync(
    un.cron,
    `17 4 * * * /usr/bin/env bash '${join(un.global, "tawassul-runtime", "db", "opencode-db-scheduled.sh")}' --run # tawassul-db-maintenance owner=install.sh-db-maintenance\n`,
  );
  const uninstall = runWith(["--uninstall"], un.env);
  assert(uninstall.code === 0, "uninstall exits beside a maintenance-owned schedule");
  assert(
    uninstall.out.includes(unUnits.service) && uninstall.out.includes(unUnits.timer),
    "uninstall names both resolved unit paths",
  );
  assert(
    uninstall.out.includes("crontab -l | grep -vF '# tawassul-db-maintenance owner=install.sh-db-maintenance' | crontab -"),
    "uninstall prints the exact maintenance cron stamp",
  );
  assert(
    existsSync(unUnits.service) && existsSync(unUnits.timer),
    "uninstall leaves the maintenance-owned unit pair in place",
  );
  assert(readFileSync(un.cron, "utf-8").includes("owner=install.sh-db-maintenance"), "uninstall leaves the maintenance cron line");

  const unreadableUninstall = globalTriggerEnv("uninstall-unreadable");
  assert(
    runWith([], { ...unreadableUninstall.env, TAWASSUL_REGISTER_TRIGGERS: "cron" }).code === 0,
    "the uninstall-unreadable case installs an owned cron line",
  );
  const unreadableBundle = join(unreadableUninstall.global, "plugins", "tawassul.js");
  const unreadableCron = readFileSync(unreadableUninstall.cron, "utf-8");
  const refusedUninstall = runWith(["--uninstall"], { ...unreadableUninstall.env, ...unreadableGlobalEnv });
  assert(
    refusedUninstall.code !== 0 &&
      refusedUninstall.out.includes("crontab could not be read; the uninstall was not performed"),
    "the uninstall refuses an unreadable crontab",
  );
  assert(existsSync(unreadableBundle), "the refused uninstall keeps the bundle");
  assert(
    readFileSync(unreadableUninstall.cron, "utf-8") === unreadableCron,
    "the refused uninstall keeps the owned cron line",
  );
  assert(
    runWith(["--uninstall"], unreadableUninstall.env).code === 0,
    "the uninstall completes once the crontab is readable",
  );
  assert(
    !existsSync(unreadableBundle) && readFileSync(unreadableUninstall.cron, "utf-8").trim() === "",
    "the recovered uninstall removes the bundle and the cron line",
  );
}

function maintenanceMarkerUninstallCases(): void {
  const maint = join(DB_DIR, "MAINTENANCE");
  writeFileSync(
    maint,
    `${JSON.stringify(
      {
        package: "tawassul-v2",
        lane: "install.sh --db-maintenance",
        version: "0.0.0",
        db: SMOKE_DB,
        trigger: "manual",
        gapSeconds: 86400,
        installedAt: "2026-11-17T00:00:00Z",
      },
      null,
      2,
    )}\n`,
  );
  const sidecarDb = join(HOME, ".local", "share", "opencode", "tawassul-v2", "opencode.db");
  mkdirSync(dirname(sidecarDb), { recursive: true });
  writeFileSync(sidecarDb, "");
  const runSh = (args: string[]): { code: number; out: string } => {
    const result = spawnSync("sh", [join(REPO, "install.sh"), ...args, "--release", "0.0.0"], {
      env: { ...proofEnv(), OPENCODE_DB: sidecarDb },
      encoding: "utf-8",
    });
    return { code: result.status ?? -1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  };
  try {
    const dry = runSh(["--db-maintenance", "--uninstall", "--dry-run"]);
    assert(
      dry.code === 0 && dry.out.includes("would remove only") && dry.out.includes("VERSION records the repository database lane"),
      "the maintenance uninstall dry run reports the VERSION.db preserve path",
    );
    assert(existsSync(join(DB_DIR, "opencode-db-scheduled.sh")), "the dry run keeps the five scripts");
    const refused = runSh(["--db-maintenance"]);
    assert(
      refused.code !== 0 && refused.out.includes("records the repository database lane"),
      "the maintenance lane refuses a repository VERSION.db without --force",
    );
    const real = runSh(["--db-maintenance", "--uninstall"]);
    assert(real.code === 0 && !existsSync(maint), "uninstall removes only the maintenance marker under VERSION.db");
    assert(existsSync(join(DB_DIR, "opencode-db-scheduled.sh")), "the five scripts survive the VERSION.db uninstall");
    assert(existsSync(MARKER), "the repository VERSION survives the maintenance uninstall");
  } finally {
    rmSync(maint, { force: true });
  }
}

try {
  releaseInstallerCases();
  fiveFileSetCases();
  installShLaneCases();
  assert(installLane("win32") === "windows", "win32 resolves to the windows lane");
  assert(installLane("darwin") === "macos", "darwin resolves to the macos lane");
  assert(installLane("linux") === "linux", "linux resolves to the linux lane");
  assert(dependencyProbeCommand("win32") === "where", "Windows probes dependencies with where");
  assert(dependencyProbeCommand("linux") === "which", "POSIX probes dependencies with which");
  assert(!usesPosixDatabaseLane("windows"), "the windows lane stages no POSIX database payload");
  assert(usesPosixDatabaseLane("linux"), "the linux lane stages the database payload");
  const acl = windowsKeyAclArgv("C:\\Users\\tawassul\\.config\\tawassul", "*S-1-5-21-1");
  assert(acl[0] === "icacls", "the windows key ACL starts with icacls");
  assert(acl.includes("/inheritance:r"), "the windows key ACL removes inherited entries");
  assert(acl.includes("*S-1-5-21-1:(OI)(CI)F"), "the windows key ACL grants the current user");
  assert(acl.includes("*S-1-5-18:(OI)(CI)F"), "the windows key ACL keeps SYSTEM access");
  assert(acl.includes("*S-1-5-32-544:(OI)(CI)F"), "the windows key ACL keeps Administrators access");
  assert(
    windowsAclPath("C:\\Users\\tester\\.config\\tawassul") === "C:\\Users\\tester\\.config\\tawassul",
    "a short windows path reaches icacls unchanged",
  );
  const longKey = `C:\\Users\\tester\\${"segment\\\\".repeat(30)}tawassul`;
  assert(
    windowsAclPath(longKey).startsWith("\\\\?\\C:\\") && windowsAclPath(longKey).endsWith("\\tawassul"),
    "a long windows path is prefixed for icacls",
  );
  assert(
    windowsAclPath(`\\\\server\\share\\${"segment\\\\".repeat(30)}tawassul`).startsWith("\\\\?\\UNC\\server\\"),
    "a long UNC path uses the UNC long-path form",
  );
  assert(
    windowsAclPath("\\\\?\\C:\\already\\long") === "\\\\?\\C:\\already\\long",
    "an already-prefixed windows path is left alone",
  );
  const keyDefault = windowsKeyDirectory({}, "/home/tester");
  assert(
    keyDefault.dir === resolve("/home/tester", ".config", "tawassul"),
    "the default key directory mirrors the runtime ~/.config/tawassul path",
  );
  assert(keyDefault.managed === true, "the default key directory is installer-managed");
  const keyXdg = windowsKeyDirectory({ XDG_CONFIG_HOME: "/xdg" }, "/home/tester");
  assert(keyXdg.dir === resolve("/xdg", "tawassul"), "XDG_CONFIG_HOME moves the key directory");
  const keyGlobal = windowsKeyDirectory({ TAWASSUL_GLOBAL_DIR: "/opt/opencode" }, "/home/tester");
  assert(keyGlobal.dir === resolve("/opt", "tawassul"), "TAWASSUL_GLOBAL_DIR keeps the key beside the config root");
  const keyExplicit = windowsKeyDirectory({ TAWASSUL_HMAC_KEY_DIR: "/keys" }, "/home/tester");
  assert(
    keyExplicit.dir === resolve("/keys") && keyExplicit.managed === false,
    "an explicit key directory is operator-managed and left untouched",
  );
  assert(operatorKeyProblem({}, null) === undefined, "a managed key directory is never pre-checked");
  const missingKey = operatorKeyProblem({ TAWASSUL_HMAC_KEY_DIR: "/keys" }, null);
  assert(
    typeof missingKey === "string" && missingKey.includes(resolve("/keys", HMAC_KEY_FILE)),
    "an absent operator key is reported with the path the runtime will read",
  );
  assert(
    typeof operatorKeyProblem({ TAWASSUL_HMAC_KEY_DIR: "/keys" }, 31) === "string",
    "an operator key of the wrong length is rejected",
  );
  assert(
    operatorKeyProblem({ TAWASSUL_HMAC_KEY_DIR: "/keys" }, 32) === undefined,
    "a 32-byte operator key passes the pre-check",
  );
  const plainProbe = hostProbeCommand("/usr/bin/opencode", "linux");
  assert(
    plainProbe.command === "/usr/bin/opencode" && plainProbe.shell === false,
    "a POSIX host is probed directly",
  );
  const cmdProbe = hostProbeCommand("C:\\bin\\opencode.cmd", "win32", {});
  assert(cmdProbe.shell === true, "a Windows command shim is probed through the interpreter");
  const psProbe = hostProbeCommand("C:\\bin\\opencode.ps1", "win32", { SystemRoot: "D:\\Windows" });
  assert(
    psProbe.command === "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "a Windows PowerShell shim is probed with the system PowerShell",
  );
  assert(
    psProbe.args.includes("-File") && psProbe.args.includes("C:\\bin\\opencode.ps1"),
    "the PowerShell probe passes the script and the version flag",
  );
  const durableDir = join(ROOT, "durable");
  const durableFile = join(durableDir, "marker.json");
  mkdirSync(durableDir, { recursive: true });
  durableWriteFile(durableFile, "one\n", 0o600);
  assert(readFileSync(durableFile, "utf8") === "one\n", "the durable write lands the bytes");
  assert((statSync(durableFile).mode & 0o777) === 0o600, "the durable write keeps the requested mode");
  durableWriteFile(durableFile, "two\n", 0o640);
  assert(readFileSync(durableFile, "utf8") === "two\n", "the durable write replaces an existing file");
  assert((statSync(durableFile).mode & 0o777) === 0o640, "a replaced file takes the requested mode");
  const traceOpened: Array<string | number> = [];
  let traceFsync = 0;
  const traceFile = join(durableDir, "trace.json");
  durableWriteFile(
    traceFile,
    "trace\n",
    0o600,
    {
      ...realWriteOps,
      openSync: (path, flags, mode) => {
        traceOpened.push(flags);
        return realWriteOps.openSync(path, flags, mode);
      },
      fsyncSync: (descriptor) => {
        traceFsync += 1;
        return realWriteOps.fsyncSync(descriptor);
      },
    },
    "win32",
  );
  assert(readFileSync(traceFile, "utf8") === "trace\n", "the traced durable write lands the bytes");
  assert(
    traceOpened.length === 1 && traceOpened[0] === "wx" && traceFsync === 1,
    "the durable write fsyncs the writable descriptor it created",
  );
  const durableLink = join(durableDir, "link.json");
  symlinkSync(durableFile, durableLink);
  let refusedLink = false;
  try {
    durableWriteFile(durableLink, "three\n");
  } catch {
    refusedLink = true;
  }
  assert(refusedLink, "the durable write refuses a symlink target");
  assert(readFileSync(durableFile, "utf8") === "two\n", "a refused symlink leaves the target untouched");
  let win32DirSync = false;
  try {
    fsyncDirectory(join(durableDir, "absent"), realWriteOps, "win32");
  } catch {
    win32DirSync = true;
  }
  assert(!win32DirSync, "the windows lane skips the directory fsync");
  let posixDirSync = false;
  try {
    fsyncDirectory(join(durableDir, "absent"), realWriteOps, "linux");
  } catch {
    posixDirSync = true;
  }
  assert(posixDirSync, "the posix lane opens the directory it fsyncs");
  let fsyncAttempts = 0;
  fsyncFileDescriptor(1, {
    ...realWriteOps,
    fsyncSync: () => {
      fsyncAttempts += 1;
      if (fsyncAttempts < 2) {
        const error = new Error("interrupted") as NodeJS.ErrnoException;
        error.code = "EINTR";
        throw error;
      }
    },
  });
  assert(fsyncAttempts === 2, "an interrupted fsync is retried");
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
  assert(record.host === "2.3.0", "marker records the host override");
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
  doctorMaintenanceCases();
  maintenanceMarkerUninstallCases();
  installGlobalLaneCases();

  const rangeEnv = proofEnv();
  delete rangeEnv.TAWASSUL_OPENCODE_VERSION;
  assert(runWith(["--verify"], rangeEnv).code === 0, "verify accepts a marker inside the supported range");

  const badPin = proofEnv();
  badPin.TAWASSUL_OPENCODE_VERSION = "2.2.0";
  const refusedPin = runWith(["--verify"], badPin);
  assert(
    refusedPin.code !== 0 && refusedPin.out.includes("outside the supported range"),
    "verify refuses the old 2.2.0 floor",
  );

  const olderPin = proofEnv();
  olderPin.TAWASSUL_OPENCODE_VERSION = "2.1.4";
  const refusedOlder = runWith(["--verify"], olderPin);
  assert(
    refusedOlder.code !== 0 && refusedOlder.out.includes("outside the supported range"),
    "verify refuses an out-of-range pin",
  );

  const newer = marker();
  newer.host = "2.3.1";
  writeFileSync(MARKER, `${JSON.stringify(newer, null, 2)}\n`);
  assert(runWith(["--verify"], rangeEnv).code === 0, "verify accepts a newer 2.x marker");
  newer.host = "3.0.0";
  writeFileSync(MARKER, `${JSON.stringify(newer, null, 2)}\n`);
  assert(runWith(["--verify"], rangeEnv).code === 0, "verify accepts an untested major marker");
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
    detectInstallScope(pathToFileURL(join(REPO, ".opencode", "plugins", "tawassul.js")).href) ===
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

  mkdirSync(join(HOME, ".opencode", "plan"), { recursive: true });
  writeFileSync(
    join(HOME, ".opencode", "package.json"),
    `${JSON.stringify({ dependencies: { "@opencode-ai/plugin": "0.0.0" } })}\n`,
  );
  const archived = run([]);
  assert(archived.code === 0, "a retired v1 tree does not block the install");
  assert(existsSync(TARGET), "the install stays in place beside the archive");
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

  const bundleBytes = readFileSync(TARGET);
  const bundleText = bundleBytes.toString("utf-8");
  for (const id of ["tawassul-goal-review", "tawassul-handoff-triage", "tawassul-context-continue"]) {
    assert(bundleText.includes(id), `the installed bundle embeds the ${id} skill`);
  }
  assert(bundleText.includes("tawassul-goals"), "the installed bundle embeds the tawassul-goals command");

  const userSkill = join(GLOBAL, "skills", "user-notes", "SKILL.md");
  const userCommand = join(GLOBAL, "command", "user-review.md");
  mkdirSync(dirname(userSkill), { recursive: true });
  mkdirSync(dirname(userCommand), { recursive: true });
  writeFileSync(userSkill, "---\nname: user-notes\ndescription: user owned\n---\nkeep\n");
  writeFileSync(userCommand, "keep the user command\n");
  assert(run(["--verify"]).code === 0, "verify passes with user skills and commands beside the install");

  const tamperedTarget = `${TARGET}.bak`;
  renameSync(TARGET, tamperedTarget);
  writeFileSync(TARGET, Buffer.concat([bundleBytes, Buffer.from("tampered\n")]));
  const bundleTamper = run(["--verify"]);
  assert(
    bundleTamper.code !== 0 && bundleTamper.out.includes("bundle hash mismatch"),
    "verify fails on a tampered bundle",
  );
  renameSync(tamperedTarget, TARGET);
  assert(run(["--verify"]).code === 0, "verify passes after the bundle is restored");

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
  assert(existsSync(userSkill), "uninstall keeps a user skill it did not write");
  assert(existsSync(userCommand), "uninstall keeps a user command it did not write");
  assert(removed.out.includes("did not write"), "the uninstall report names the kept user files");
  assert(!existsSync(DB_DIR), "uninstall removes the staged db scripts with the runtime");
  assert(readFileSync(USER_CONFIG, "utf-8") === BODY, "uninstall leaves the user config byte-identical");
  assert(sha256(SMOKE_DB) === dbHashBefore, "uninstall leaves the database byte-identical (P3.7)");
  assert(
    existsSync(backupFile) && sha256(backupFile) === backupHashBefore,
    "uninstall leaves every backup byte-identical (P3.7)",
  );
  rmSync(userNote, { force: true });
  rmSync(join(GLOBAL, "skills"), { recursive: true, force: true });
  rmSync(join(GLOBAL, "command"), { recursive: true, force: true });
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
  const dataRoot = join(HOME, ".local", "share", "tawassul-v2");
  const dataProject = join(dataRoot, "projects", "abc", ".opencode");
  mkdirSync(stateRoot, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });
  mkdirSync(dataProject, { recursive: true });
  writeFileSync(join(stateRoot, "state.json"), "{}\n");
  writeFileSync(join(runtimeRoot, "metrics.json"), "{}\n");
  writeFileSync(join(dataProject, "tawassul-state.json"), "{}\n");
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
    existsSync(TARGET) &&
      existsSync(join(stateRoot, "state.json")) &&
      existsSync(join(dataProject, "tawassul-state.json")) &&
      existsSync(join(GLOBAL, "tawassul.jsonc")),
    "the purge refusal leaves the install, the state and the data intact",
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
  assert(!existsSync(dataRoot), "purge moves the data namespace off its name");
  const dataShare = join(HOME, ".local", "share");
  const dataArchives = readdirSync(dataShare).filter((name) => name.startsWith("tawassul-v2.purged-"));
  assert(dataArchives.length === 1, "purge leaves exactly one archived data directory");
  assert(
    existsSync(join(dataShare, dataArchives[0] as string, "projects", "abc", ".opencode", "tawassul-state.json")),
    "the archived data keeps the original payload",
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
