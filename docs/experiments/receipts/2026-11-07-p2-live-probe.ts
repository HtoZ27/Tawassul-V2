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

const REPO = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const PROJECT_ENTRY = join(REPO, ".opencode", "plugins", "tawassul.js");
const MODEL = process.env.TAWASSUL_SMOKE_MODEL ?? "opencode/big-pickle";

function resolveHostBin(): string {
  const explicit = process.env.TAWASSUL_OPENCODE_BIN?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  const userBin = process.env.OPENCODE?.trim();
  if (userBin && existsSync(userBin)) return userBin;
  const cliRoot = join(process.env.HOME ?? "", ".config", "ai.opencode.desktop", "cli");
  if (existsSync(cliRoot)) {
    for (const version of readdirSync(cliRoot).sort().reverse()) {
      const candidate = join(cliRoot, version, "opencode-cli");
      if (existsSync(candidate)) return candidate;
    }
  }
  return spawnSync("which", ["opencode"], { encoding: "utf-8" }).stdout?.trim() ?? "";
}

const HOST = resolveHostBin();
if (!HOST || !existsSync(HOST) || !existsSync(PROJECT_ENTRY)) {
  console.error(`PROBE ABORT: host=${HOST} entry=${existsSync(PROJECT_ENTRY)}`);
  process.exit(1);
}

const ROOT = mkdtempSync(join(tmpdir(), "tawassul-p2-live-"));
const HOME = join(ROOT, "home");
const WORKSPACE = join(ROOT, "workspace");
const LEDGER = join(ROOT, "usage-ledger.jsonl");
const HOST_LOG = join(HOME, ".local", "share", "opencode", "log", "opencode.log");
const TAWASSUL_LOG = join(ROOT, "tawassul.log");

try {
  for (const dir of [".config", ".local/share", ".local/state", ".cache"]) {
    mkdirSync(join(HOME, dir), { recursive: true });
  }
  mkdirSync(join(WORKSPACE, ".opencode", "plugins"), { recursive: true });
  copyFileSync(PROJECT_ENTRY, join(WORKSPACE, ".opencode", "plugins", "tawassul.js"));
  symlinkSync(join(REPO, ".opencode", "node_modules"), join(WORKSPACE, ".opencode", "node_modules"), "dir");
  writeFileSync(join(WORKSPACE, "opencode.json"), `${JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2)}\n`);

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.TAWASSUL_OPENCODE_VERSION;
  delete env.OPENCODE_BIN;
  Object.assign(env, {
    HOME,
    XDG_CONFIG_HOME: join(HOME, ".config"),
    XDG_DATA_HOME: join(HOME, ".local", "share"),
    XDG_STATE_HOME: join(HOME, ".local", "state"),
    XDG_CACHE_HOME: join(HOME, ".cache"),
    TAWASSUL_HMAC_KEY_DIR: join(ROOT, "hmac"),
    TAWASSUL_V2_STATE_DIR: join(ROOT, "state"),
    TAWASSUL_LOG_FILE: TAWASSUL_LOG,
    TAWASSUL_N2_LOG: join(ROOT, "n2.jsonl"),
    TAWASSUL_USAGE_LEDGER: LEDGER,
    TAWASSUL_REGISTER_TRIGGERS: "off",
    TAWASSUL_WATCHER: "off",
    OPENCODE_DB: join(ROOT, "opencode.db"),
    PWD: WORKSPACE,
    OLDPWD: WORKSPACE,
  });

  const prompt = [
    "Use the shell tool five separate times.",
    "Each call must run exactly: printf p2-live",
    "Do not loop, do not combine them, and make one tool call per step.",
    "After the fifth call, reply exactly: LIVE-DONE",
  ].join(" ");

  const result = spawnSync(
    HOST,
    ["run", "--standalone", "--auto", "--format", "json", "--model", MODEL, prompt],
    { cwd: WORKSPACE, encoding: "utf-8", timeout: 240_000, env },
  );

  const tail = (file: string, count: number): string => {
    if (!existsSync(file)) return `<missing ${file}>`;
    return readFileSync(file, "utf-8").split("\n").slice(-count).join("\n");
  };

  console.log(`probe rc=${result.status} signal=${result.signal ?? "none"}`);
  console.log(`stdout tail:\n${(result.stdout ?? "").split("\n").slice(-25).join("\n")}`);
  if (result.status !== 0) console.log(`stderr tail:\n${(result.stderr ?? "").split("\n").slice(-20).join("\n")}`);

  if (!existsSync(LEDGER)) {
    console.error("PROBE FAIL: the ledger file was not created");
    console.error(`host log tail:\n${tail(HOST_LOG, 30)}`);
    console.error(`plugin log tail:\n${tail(TAWASSUL_LOG, 30)}`);
    process.exit(1);
  }

  const rows = readFileSync(LEDGER, "utf-8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  const usage = rows.filter((row) => row.kind === "usage");
  const shadow = rows.filter((row) => row.kind === "shadow");
  const noagent = rows.filter((row) => row.kind === "noagent");
  const repeats = shadow.filter((row) => row.detector === "repeat");

  console.log(`ledger rows: ${rows.length} (usage ${usage.length}, shadow ${shadow.length}, noagent ${noagent.length})`);
  for (const row of rows.slice(0, 12)) {
    console.log(JSON.stringify(row));
  }

  let failures = 0;
  const check = (cond: unknown, name: string): void => {
    if (cond) console.log(`ok ${name}`);
    else {
      failures += 1;
      console.error(`FAIL ${name}`);
    }
  };

  check(usage.length >= 1, "the live host wrote at least one usage row");
  check(usage.every((row) => typeof row.sessionID === "string" && row.sessionID.length > 0), "every usage row names a session");
  check(usage.every((row) => row.billableUnit === "weighted_tokens"), "every usage row uses weighted tokens");
  check(usage.every((row) => row.costUnpriced === true), "the free model rows are cost_unpriced");
  check(usage.every((row) => row.weights?.source === "default"), "the rows record the default weight source");
  check(usage.every((row) => typeof row.contextSize === "number" && row.contextSize === row.raw.input + row.raw.cacheRead), "context size is input plus cache read");
  check(repeats.length >= 1, "the shadow repeat detector fired on the five identical shell calls");
  check(repeats.some((row) => row.count >= 5 && row.tripped === true), "a repeat row reached the trip threshold");
  check(shadow.every((row) => typeof row.sessionID === "string"), "every shadow row names a session");

  console.log(failures === 0 ? "LIVE PROBE PASS" : `LIVE PROBE FAIL (${failures})`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
