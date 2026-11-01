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
import { TOOL_COUNT, TOOL_NAME_SET_HASH } from "../src/generated/tool-tripwire.ts";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const PROJECT_ENTRY = join(REPO, ".opencode", "plugin", "tawassul.js");
const MODEL = process.env.TAWASSUL_SMOKE_MODEL ?? "opencode/big-pickle";
const BOOT_TIMEOUT = Number(process.env.TAWASSUL_SMOKE_TIMEOUT ?? 90);
const PROVIDER_REFUSAL = /provider\.[a-z-]+|FreeUsageLimitError|"status": *429|Free usage limit/i;
const BOOT_MARKER_RE = new RegExp(`v2 registered ${TOOL_COUNT} tools name-set ${TOOL_NAME_SET_HASH}`);

let passed = 0;

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
      const candidate = join(cliRoot, versions[i] as string, "opencode-cli");
      if (existsSync(candidate)) return candidate;
    }
  }
  return spawnSync("which", ["opencode"], { encoding: "utf-8" }).stdout?.trim() ?? "";
}

function lineTime(line: string): number {
  const match = line.match(/^(?:timestamp=)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
  return match ? Date.parse(match[1] as string) : Number.NaN;
}

function linesSince(file: string, since: number): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter((line) => {
      const at = lineTime(line);
      return !Number.isNaN(at) && at >= since;
    });
}

function childEnv(env: Record<string, string>, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  delete merged.TAWASSUL_OPENCODE_VERSION;
  delete merged.OPENCODE_BIN;
  return { ...merged, ...env, ...extra };
}

try {
  const HOST_BIN = resolveHostBin();
  assert(HOST_BIN.length > 0 && existsSync(HOST_BIN), `host binary resolved (${HOST_BIN || "not found"})`);
  if (HOST_BIN.length === 0) fail("host binary missing");
  assert(existsSync(PROJECT_ENTRY), "the built project entry exists before the independence boot");

  const ROOT = mkdtempSync(join(tmpdir(), "tawassul-independence-boot-"));
  const HOME = join(ROOT, "home");
  const WORKSPACE = join(ROOT, "workspace");
  for (const dir of [".config", ".local/share", ".local/state", ".cache"]) {
    mkdirSync(join(HOME, dir), { recursive: true });
  }
  mkdirSync(join(WORKSPACE, ".opencode", "plugin"), { recursive: true });
  const entry = join(WORKSPACE, ".opencode", "plugin", "tawassul.js");
  copyFileSync(PROJECT_ENTRY, entry);
  symlinkSync(join(REPO, ".opencode", "node_modules"), join(WORKSPACE, ".opencode", "node_modules"), "dir");
  writeFileSync(join(WORKSPACE, "opencode.json"), `${JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2)}\n`);

  const env: Record<string, string> = {
    HOME,
    XDG_CONFIG_HOME: join(HOME, ".config"),
    XDG_DATA_HOME: join(HOME, ".local", "share"),
    XDG_STATE_HOME: join(HOME, ".local", "state"),
    XDG_CACHE_HOME: join(HOME, ".cache"),
    TAWASSUL_HMAC_KEY_DIR: join(ROOT, "hmac"),
    TAWASSUL_V2_STATE_DIR: join(ROOT, "state"),
    TAWASSUL_LOG_FILE: join(ROOT, "tawassul.log"),
    TAWASSUL_N2_LOG: join(ROOT, "n2.jsonl"),
    OPENCODE_DB: join(ROOT, "opencode.db"),
    TAWASSUL_REGISTER_TRIGGERS: "off",
    PWD: WORKSPACE,
    OLDPWD: WORKSPACE,
  };
  const hostLog = join(HOME, ".local", "share", "opencode", "log", "opencode.log");
  rmSync(hostLog, { force: true });
  const before = Date.now() - 1;

  const result = spawnSync(
    HOST_BIN,
    ["run", "--standalone", "--auto", "--format", "json", "--model", MODEL, "Reply with exactly: INDEPENDENT"],
    { cwd: WORKSPACE, encoding: "utf-8", timeout: BOOT_TIMEOUT * 1000, env: childEnv(env) },
  );
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const code = result.status ?? -1;
  const refusal = code !== 0 && PROVIDER_REFUSAL.test(out);
  assert(code === 0 || refusal, `the isolated boot runs without the v1 tree (rc=${code})`);

  const hostLines = linesSince(hostLog, before);
  const loads = hostLines
    .filter((line) => /msg="loading plugin"|message="loading plugin"|msg=loading plugin/.test(line))
    .map((line) => line.match(/\bid="?([^"\s]+)"?/)?.[1] ?? "")
    .filter((value) => value.length > 0);
  assert(loads.length > 0, `the host log records plugin loads (${loads.length})`);
  assert(
    loads.every((value) => value === entry),
    `every plugin load is the scratch v2 entry (found ${[...new Set(loads)].join(", ") || "none"})`,
  );
  assert(
    hostLines.every((line) => !/tawassyl|retired-v1|plugins\/tawassul/i.test(line)),
    "the boot log never mentions the v1 tree or a package-directory entry",
  );
  assert(
    hostLines.every((line) => !/failed to load plugin/i.test(line)),
    "the isolated boot has no plugin load failure",
  );

  const pluginLog = readFileSync(join(ROOT, "tawassul.log"), "utf-8");
  assert(BOOT_MARKER_RE.test(pluginLog), `the scratch bundle registers ${TOOL_COUNT} tools`);
  assert(/initPlugin=/.test(pluginLog), "the scratch bundle records initPlugin");

  for (const legacy of [".config/tawassul", ".local/share/tawassul", ".cache/tawassul", ".config/tawassyl"]) {
    assert(!existsSync(join(HOME, legacy)), `the isolated HOME has no v1 state at ~/${legacy}`);
  }
  assert(
    readdirSync(join(WORKSPACE, ".opencode", "plugin")).every((name) => name === "tawassul.js"),
    "the workspace exposes exactly one plugin entry",
  );
  const config = JSON.parse(readFileSync(join(WORKSPACE, "opencode.json"), "utf-8")) as Record<string, unknown>;
  assert(!("plugin" in config) && !("mcp" in config), "the scratch config carries no plugin or mcp entry");

  console.log(`PROOF PASS: the v2 bundle boots in a v1-free HOME and workspace (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
