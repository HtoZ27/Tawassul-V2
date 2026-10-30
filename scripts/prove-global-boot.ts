import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const PROJECT_ENTRY = join(REPO, ".opencode", "plugin", "tawassul.js");
const INSTALLER = join(REPO, "scripts", "install-global.ts");
const MODEL = process.env.TAWASSUL_SMOKE_MODEL ?? "opencode/big-pickle";
const BOOT_TIMEOUT = Number(process.env.TAWASSUL_SMOKE_TIMEOUT ?? 90);
const PROVIDER_REFUSAL = /provider\.[a-z-]+|FreeUsageLimitError|"status": *429|Free usage limit/i;

let passed = 0;
let HOST_BIN = "";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

function resolveHostBin(): string {
  const explicit = process.env.TAWASSUL_OPENCODE_BIN?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  const userBin = process.env.OPENCODE?.trim();
  if (userBin && existsSync(userBin)) return userBin;
  const local = join(process.env.HOME ?? "", ".opencode", "bin", "opencode");
  if (existsSync(local)) return local;
  const cliRoot = join(process.env.HOME ?? "", ".config", "ai.opencode.desktop", "cli");
  if (existsSync(cliRoot)) {
    const versions = readdirSync(cliRoot).sort();
    for (let i = versions.length - 1; i >= 0; i -= 1) {
      const entry = versions[i] as string;
      const candidate = join(cliRoot, entry, "opencode-cli");
      if (existsSync(candidate)) return candidate;
    }
  }
  const onPath = spawnSync("which", ["opencode"], { encoding: "utf-8" }).stdout?.trim();
  return onPath ?? "";
}

function resolveBun(): string {
  const explicit = process.env.TAWASSUL_BUN_BIN?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  const onPath = spawnSync("which", ["bun"], { encoding: "utf-8" }).stdout?.trim();
  return onPath ?? "bun";
}

function hostVersion(bin: string): string {
  const result = spawnSync(bin, ["--version"], { encoding: "utf-8" });
  const match = `${result.stdout ?? ""}${result.stderr ?? ""}`.match(/\d+\.\d+\.\d+/);
  return match ? match[0] : "";
}

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = actual.split(".").map((part) => Number(part));
  const right = minimum.split(".").map((part) => Number(part));
  for (let i = 0; i < right.length; i += 1) {
    if ((left[i] ?? 0) < (right[i] ?? 0)) return false;
    if ((left[i] ?? 0) > (right[i] ?? 0)) return true;
  }
  return true;
}

type EnvMap = Record<string, string>;

function isolate(work: string, db: string, log: string): EnvMap {
  const home = join(work, "home");
  mkdirSync(join(home, ".config"), { recursive: true });
  mkdirSync(join(home, ".local", "share"), { recursive: true });
  mkdirSync(join(home, ".local", "state"), { recursive: true });
  mkdirSync(join(home, ".cache"), { recursive: true });
  return {
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    TAWASSUL_HMAC_KEY_DIR: join(work, "hmac"),
    TAWASSUL_V2_STATE_DIR: join(work, "state"),
    TAWASSUL_LOG_FILE: log,
    TAWASSUL_N2_LOG: join(work, "n2.jsonl"),
    OPENCODE_DB: db,
    TAWASSUL_REGISTER_TRIGGERS: "off",
  };
}

function childEnv(env: EnvMap, extra: EnvMap = {}): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  delete merged.TAWASSUL_OPENCODE_VERSION;
  delete merged.OPENCODE_BIN;
  return { ...merged, ...env, ...extra };
}

function run(
  env: EnvMap,
  command: string,
  args: string[],
  cwd: string,
  extra: EnvMap = {},
): { code: number; out: string } {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    timeout: 300_000,
    env: childEnv(env, extra),
  });
  return {
    code: result.status ?? -1,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function boot(env: EnvMap, workspace: string, prompt: string): { code: number; out: string } {
  const result = spawnSync(
    HOST_BIN,
    ["run", "--standalone", "--auto", "--format", "json", "--model", MODEL, prompt],
    {
      cwd: workspace,
      encoding: "utf-8",
      timeout: BOOT_TIMEOUT * 1000,
      env: childEnv(env, { PWD: workspace, OLDPWD: workspace }),
    },
  );
  return {
    code: result.status ?? -1,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function lineTime(line: string): number {
  const match = line.match(/^(?:timestamp=)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
  return match ? Date.parse(match[1] as string) : Number.NaN;
}

function firstSince(file: string, pattern: RegExp, since: number): string {
  if (!existsSync(file)) return "";
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const at = lineTime(line);
    if (Number.isNaN(at) || at < since) continue;
    if (pattern.test(line)) return line;
  }
  return "";
}

function countSince(file: string, pattern: RegExp, since: number): number {
  if (!existsSync(file)) return 0;
  let count = 0;
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const at = lineTime(line);
    if (Number.isNaN(at) || at < since) continue;
    if (pattern.test(line)) count += 1;
  }
  return count;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function refusal(booted: { code: number; out: string }): boolean {
  return booted.code !== 0 && PROVIDER_REFUSAL.test(booted.out);
}

try {
  HOST_BIN = resolveHostBin();
  assert(HOST_BIN.length > 0 && existsSync(HOST_BIN), `host binary resolved (${HOST_BIN || "not found"})`);
  if (HOST_BIN.length === 0) fail("host binary missing");
  const BUN = resolveBun();
  const bunCheck = run({ HOME: process.env.HOME ?? "" }, BUN, ["--version"], REPO);
  assert(bunCheck.code === 0, `bun is available for the direct tool probe (${bunCheck.out.trim()})`);
  const actual = hostVersion(HOST_BIN);
  assert(actual.length > 0, `host version readable (${actual || "unknown"})`);
  assert(
    versionAtLeast(actual, "2.2.0"),
    `host ${actual} is inside the supported range (>=2.2.0; audited 2.2.1)`,
  );

  const ROOT = mkdtempSync(join(tmpdir(), "tawassul-global-boot-"));
  const globalEnv = isolate(join(ROOT, "global"), join(ROOT, "global", "opencode.db"), join(ROOT, "global", "tawassul.log"));
  const globalConfig = join(ROOT, "global", "home", ".config", "opencode");
  const globalTarget = join(globalConfig, "plugins", "tawassul.js");
  const globalWasm = join(globalConfig, "tawassul-runtime", "wasm");

  const installed = run(globalEnv, BUN, [INSTALLER], REPO, { OPENCODE_BIN: HOST_BIN });
  assert(installed.code === 0, `the flat global file installs into the isolated HOME (${installed.out.slice(0, 400)})`);
  assert(existsSync(globalTarget), "the installed global bundle exists at the flat path");
  assert(existsSync(join(globalConfig, "tawassul-runtime", "VERSION")), "the installed marker records the runtime");
  for (const wasm of [
    "web-tree-sitter/web-tree-sitter.wasm",
    "tree-sitter-javascript/tree-sitter-javascript.wasm",
    "tree-sitter-typescript/tree-sitter-typescript.wasm",
    "tree-sitter-typescript/tree-sitter-tsx.wasm",
  ]) {
    assert(existsSync(join(globalWasm, wasm)), `the wasm asset ${wasm.split("/").at(-1)} is staged`);
  }

  const globalWorkspace = join(ROOT, "global", "ws-empty");
  mkdirSync(globalWorkspace, { recursive: true });
  const hostLog = join(globalEnv.XDG_DATA_HOME as string, "opencode", "log", "opencode.log");
  rmSync(hostLog, { force: true });
  const beforeGlobal = Date.now() - 1;
  const globalBoot = boot(globalEnv, globalWorkspace, "Reply with exactly: GLOBAL");
  assert(globalBoot.code === 0 || refusal(globalBoot), `the global bundle boots the host (rc=${globalBoot.code})`);
  const loadLine = firstSince(hostLog, new RegExp(`loading plugin.*${escapeRegExp(globalTarget)}`), beforeGlobal);
  assert(loadLine.length > 0, "the host log records loading the global plugin file");
  const registered = firstSince(globalEnv.TAWASSUL_LOG_FILE as string, /v2 registered 42 tools/, beforeGlobal);
  assert(registered.length > 0, "the global bundle registers 42 tools");
  const initLine = firstSince(globalEnv.TAWASSUL_LOG_FILE as string, /initPlugin=/, beforeGlobal);
  const initMs = initLine.match(/initPlugin=([\d.]+)ms/);
  assert(initMs !== null, `the global boot records initPlugin (${initMs?.[1] ?? "?"} ms)`);
  const globalSpan = lineTime(registered) - lineTime(loadLine);
  console.log(`INFO  global bundle boot: load->registered ${Math.max(globalSpan, 0)} ms, initPlugin=${initMs?.[1] ?? "?"} ms`);
  assert(globalSpan >= 0, "the global load-to-registered span is measurable");

  const tools = run(globalEnv, BUN, ["-e", directToolProbe()], ROOT, {
    SMOKE_ENTRY: globalTarget,
    SMOKE_DIR: globalWorkspace,
  });
  assert(
    tools.code === 0 && tools.out.includes("tools-ok"),
    `the installed global bundle executes direct tools (${tools.out.slice(0, 400)})`,
  );

  const coexistWorkspace = join(ROOT, "global", "ws-both");
  mkdirSync(join(coexistWorkspace, ".opencode", "plugin"), { recursive: true });
  const coexistEntry = join(coexistWorkspace, ".opencode", "plugin", "tawassul.js");
  copyFileSync(PROJECT_ENTRY, coexistEntry);
  symlinkSync(join(REPO, ".opencode", "node_modules"), join(coexistWorkspace, ".opencode", "node_modules"), "dir");
  writeFileSync(join(coexistWorkspace, "keep.txt"), "coexist workspace\n");
  const beforeCoexist = Date.now() - 1;
  const coexistBoot = boot(globalEnv, coexistWorkspace, "Reply with exactly: BOTH");
  assert(coexistBoot.code === 0 || refusal(coexistBoot), `the coexistence boot runs (rc=${coexistBoot.code})`);
  assert(
    firstSince(hostLog, new RegExp(`loading plugin.*${escapeRegExp(coexistEntry)}`), beforeCoexist).length > 0,
    "the host log records loading the project plugin file",
  );
  assert(
    firstSince(hostLog, new RegExp(`loading plugin.*${escapeRegExp(globalTarget)}`), beforeCoexist).length > 0,
    "the host log records loading the global plugin file",
  );
  const delegate = firstSince(
    globalEnv.TAWASSUL_LOG_FILE as string,
    /global copy delegates to the project copy at /,
    beforeCoexist,
  );
  assert(delegate.length > 0, "the global copy delegates to the project copy in the coexistence boot");
  assert(delegate.includes(coexistEntry), "the delegation names the project entry path");
  assert(
    countSince(globalEnv.TAWASSUL_LOG_FILE as string, /v2 registered 42 tools/, beforeCoexist) > 0,
    "the coexistence boot registers 42 tools after delegation",
  );
  assert(
    countSince(hostLog, /failed to load plugin/i, beforeCoexist) === 0,
    "the coexistence boot has no plugin load failure",
  );

  const projectEnv = isolate(join(ROOT, "project"), join(ROOT, "project", "opencode.db"), join(ROOT, "project", "tawassul.log"));
  const projectWorkspace = join(ROOT, "project", "ws-only");
  mkdirSync(join(projectWorkspace, ".opencode", "plugin"), { recursive: true });
  const projectEntry = join(projectWorkspace, ".opencode", "plugin", "tawassul.js");
  copyFileSync(PROJECT_ENTRY, projectEntry);
  symlinkSync(join(REPO, ".opencode", "node_modules"), join(projectWorkspace, ".opencode", "node_modules"), "dir");
  const projectHostLog = join(projectEnv.XDG_DATA_HOME as string, "opencode", "log", "opencode.log");
  rmSync(projectHostLog, { force: true });
  const beforeProject = Date.now() - 1;
  const projectBoot = boot(projectEnv, projectWorkspace, "Reply with exactly: PROJECT");
  assert(projectBoot.code === 0 || refusal(projectBoot), `the project bundle boots the host (rc=${projectBoot.code})`);
  assert(
    firstSince(projectHostLog, new RegExp(`loading plugin.*${escapeRegExp(globalTarget)}`), beforeProject).length === 0,
    "the project-only HOME has no global install to load",
  );
  const projectLoad = firstSince(projectHostLog, new RegExp(`loading plugin.*${escapeRegExp(projectEntry)}`), beforeProject);
  assert(projectLoad.length > 0, "the project-only boot loads the project plugin file");
  const projectRegistered = firstSince(projectEnv.TAWASSUL_LOG_FILE as string, /v2 registered 42 tools/, beforeProject);
  assert(projectRegistered.length > 0, "the project bundle registers 42 tools");
  const projectSpan = lineTime(projectRegistered) - lineTime(projectLoad);
  console.log(`INFO  project bundle boot: load->registered ${Math.max(projectSpan, 0)} ms`);
  assert(projectSpan >= 0, "the project load-to-registered span is measurable");

  console.log(
    `PROOF PASS: isolated global install, one effective plugin in coexistence, and direct tools (${passed} assertions)`,
  );
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}

function directToolProbe(): string {
  return [
    "const mod = await import(process.env.SMOKE_ENTRY);",
    "const hooks = await mod.tawassul.server({ client: {}, directory: process.env.SMOKE_DIR, worktree: process.env.SMOKE_DIR });",
    "const names = Object.keys(hooks.tool ?? {});",
    'if (names.length !== 42) { console.error("tools=" + names.length); process.exit(4); }',
    "const health = await hooks.tool.health.execute({}, {});",
    'const healthOut = String(health && typeof health === "object" && "output" in health ? health.output : health);',
    'if (!healthOut.includes("Event-loop lag") || !healthOut.includes("RSS")) process.exit(4);',
    "const help = await hooks.tool.help.execute({}, {});",
    'const helpOut = String(help && typeof help === "object" && "output" in help ? help.output : help);',
    'if (!helpOut.includes("Available tools")) process.exit(4);',
    'console.log("tools-ok");',
  ].join("\n");
}
