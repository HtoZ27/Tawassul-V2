import "./proof-log-isolate.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { safeHomedir } from "../src/utils/path-resolver.ts";
import {
  QUARANTINE_SUBDIR,
  STATE_DIR_ALIAS_ENV,
  STATE_DIR_ENV,
  STATE_DIR_NAME,
  STATE_SUBDIR,
  projectRootFallback,
  projectStatePath,
  quarantinePath,
  stateDir,
  stateDirWritable,
  statePath,
  v2DataRoot,
  v2NamespaceRoot,
} from "../src/utils/state-paths.ts";
import { n2AutoLogPath } from "../src/hooks/n2-auto.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed += 1;
  console.log(`ok ${name}`);
}

const root = mkdtempSync(join(tmpdir(), "tawassul-state-paths-"));
const homeDir = join(root, "home");
const configHome = join(root, "config");
const profileHome = join(configHome, STATE_DIR_NAME);
const dataHome = join(root, "data");
const overrideDir = join(root, "override-state");
const projectRoot = join(root, "project");
const saved = {
  state: process.env[STATE_DIR_ENV],
  global: process.env.TAWASSUL_GLOBAL_DIR,
  config: process.env.XDG_CONFIG_HOME,
  data: process.env.XDG_DATA_HOME,
  n2: process.env.TAWASSUL_N2_LOG,
  home: process.env.HOME,
};

try {
  delete process.env[STATE_DIR_ENV];
  delete process.env.TAWASSUL_GLOBAL_DIR;
  delete process.env.TAWASSUL_N2_LOG;
  mkdirSync(configHome, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  process.env.HOME = homeDir;

  process.env.XDG_CONFIG_HOME = configHome;
  assert(
    stateDir() === resolve(configHome, STATE_DIR_NAME, STATE_SUBDIR),
    "the default state dir is the namespaced XDG state directory",
  );

  process.env.XDG_CONFIG_HOME = profileHome;
  assert(
    stateDir() === resolve(profileHome, STATE_SUBDIR),
    "a v2 profile home does not double-nest the state dir",
  );
  process.env.XDG_CONFIG_HOME = configHome;

  process.env.TAWASSUL_GLOBAL_DIR = join(root, "plugins", "tawassul");
  assert(
    stateDir() === resolve(root, "plugins", STATE_DIR_NAME, STATE_SUBDIR),
    "TAWASSUL_GLOBAL_DIR places the state beside the plugin directory",
  );
  delete process.env.TAWASSUL_GLOBAL_DIR;

  assert(
    v2NamespaceRoot(join(root, "cache")) === join(root, "cache", STATE_DIR_NAME),
    "the namespace root appends the namespace once",
  );
  assert(v2NamespaceRoot(profileHome) === profileHome, "the namespace root keeps an existing v2 profile");
  assert(
    v2NamespaceRoot(join(root, "cache") + "/") === join(root, "cache", STATE_DIR_NAME),
    "a trailing slash does not add a second namespace",
  );

  process.env.XDG_DATA_HOME = join(dataHome, STATE_DIR_NAME);
  assert(
    v2DataRoot() === join(dataHome, STATE_DIR_NAME),
    "the data root keeps a v2 profile single-nested",
  );
  assert(
    n2AutoLogPath() === join(dataHome, STATE_DIR_NAME, "n2-auto.jsonl"),
    "the N2 log does not double-nest under the profile",
  );

  process.env.XDG_DATA_HOME = dataHome;
  assert(v2DataRoot() === join(dataHome, STATE_DIR_NAME), "the data root namespaces a plain data home");
  assert(
    n2AutoLogPath() === join(dataHome, STATE_DIR_NAME, "n2-auto.jsonl"),
    "the N2 log namespaces a plain data home",
  );

  process.env.TAWASSUL_N2_LOG = join(root, "custom-n2.jsonl");
  assert(n2AutoLogPath() === join(root, "custom-n2.jsonl"), "the N2 log override wins");
  delete process.env.TAWASSUL_N2_LOG;

  process.env.XDG_DATA_HOME = "relative-data";
  assert(
    v2DataRoot() === join(homeDir, ".local", "share", STATE_DIR_NAME),
    "a relative XDG data home falls back to the home directory",
  );
  delete process.env.XDG_DATA_HOME;

  const osHome = safeHomedir();
  delete process.env.HOME;
  assert(
    v2DataRoot() === join(osHome, ".local", "share", STATE_DIR_NAME),
    "the data root falls back to the OS home when HOME is unset",
  );
  assert(
    n2AutoLogPath() === join(osHome, ".local", "share", STATE_DIR_NAME, "n2-auto.jsonl"),
    "the N2 log follows the OS home fallback",
  );
  process.env.HOME = "/";
  assert(
    v2DataRoot() === join(osHome, ".local", "share", STATE_DIR_NAME),
    "a root-only HOME falls back to the OS home",
  );
  process.env.HOME = homeDir;

  process.env[STATE_DIR_ENV] = overrideDir;
  assert(stateDir() === resolve(overrideDir), "TAWASSUL_V2_STATE_DIR overrides the state dir");
  assert(statePath("x.json") === resolve(overrideDir, "x.json"), "the override applies to every state file");
  assert(
    quarantinePath("x.json") === resolve(overrideDir, QUARANTINE_SUBDIR, "x.json"),
    "the quarantine lives under the overridden state dir",
  );
  process.env[STATE_DIR_ALIAS_ENV] = resolve(overrideDir, "alias");
  assert(
    stateDir() === resolve(overrideDir),
    "the state override wins over the compatibility alias",
  );
  delete process.env[STATE_DIR_ENV];
  assert(
    stateDir() === resolve(overrideDir, "alias"),
    "the compatibility alias applies when the primary is unset",
  );
  assert(
    quarantinePath("x.json") === resolve(overrideDir, "alias", QUARANTINE_SUBDIR, "x.json"),
    "the quarantine follows the compatibility alias",
  );
  delete process.env[STATE_DIR_ALIAS_ENV];

  assert(stateDirWritable(join(root, "writable-state")) === true, "a creatable state directory is writable");
  writeFileSync(join(root, "not-a-dir"), "x", "utf-8");
  assert(
    stateDirWritable(join(root, "not-a-dir", "state")) === false,
    "a state directory under a regular file is not writable",
  );

  assert(
    projectStatePath(projectRoot, "predictive-router.json") ===
      join(projectRoot, ".opencode", "predictive-router.json"),
    "the router lives inside the project for every install scope",
  );

  mkdirSync(join(projectRoot, ".opencode"), { recursive: true });
  writeFileSync(join(projectRoot, "state.json"), "root-copy", "utf-8");
  assert(
    projectRootFallback(join(projectRoot, ".opencode", "state.json")) === join(projectRoot, "state.json"),
    "a project-root copy is the fallback for a namespaced state file",
  );
  assert(
    projectRootFallback(join(projectRoot, ".opencode", "missing.json")) === undefined,
    "a missing project-root copy yields no fallback",
  );
  assert(
    projectRootFallback(join(projectRoot, "state.json")) === undefined,
    "a file outside .opencode has no project-root fallback",
  );

  console.log(`PROOF PASS: v2 state paths stay namespaced and single-nested (${passed} assertions)`);
} finally {
  if (saved.state === undefined) delete process.env[STATE_DIR_ENV];
  else process.env[STATE_DIR_ENV] = saved.state;
  if (saved.global === undefined) delete process.env.TAWASSUL_GLOBAL_DIR;
  else process.env.TAWASSUL_GLOBAL_DIR = saved.global;
  if (saved.config === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = saved.config;
  if (saved.data === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = saved.data;
  if (saved.n2 === undefined) delete process.env.TAWASSUL_N2_LOG;
  else process.env.TAWASSUL_N2_LOG = saved.n2;
  if (saved.home === undefined) delete process.env.HOME;
  else process.env.HOME = saved.home;
  rmSync(root, { recursive: true, force: true });
}
