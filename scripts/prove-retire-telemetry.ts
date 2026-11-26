import "./proof-log-isolate.ts";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getInitReady, initPlugin, RETIRE_CEILING_MS } from "../src/bootstrap/plugin-init.ts";
import { retireCeilingHits } from "../src/utils/boot-telemetry.ts";

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

const work = mkdtempSync(join(tmpdir(), "tawassul-retire-"));
const home = join(work, "home");
const keyDir = join(work, "keys");
mkdirSync(join(home, ".config"), { recursive: true });
mkdirSync(join(home, ".local", "share"), { recursive: true });
mkdirSync(join(home, ".local", "state"), { recursive: true });
mkdirSync(join(home, ".cache"), { recursive: true });
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = join(home, ".config");
process.env.XDG_DATA_HOME = join(home, ".local", "share");
process.env.XDG_STATE_HOME = join(home, ".local", "state");
process.env.XDG_CACHE_HOME = join(home, ".cache");
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
process.env.OPENCODE_DB = join(work, "opencode.db");
delete process.env.TAWASSUL_ISOLATED;

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(" "));
    original(...args);
  };
  return {
    lines,
    restore: () => {
      console.error = original;
    },
  };
}

function project(name: string): string {
  const directory = join(work, name);
  mkdirSync(join(directory, ".opencode"), { recursive: true });
  return directory;
}

function pluginInput(directory: string): never {
  return { client: {}, directory, worktree: directory } as never;
}

type RetiringInstance = {
  tawaCtx: { lifecycleManager: { destroy: () => Promise<void> } };
  dispose: () => Promise<void>;
};

const instances: RetiringInstance[] = [];

function remember(instance: unknown): RetiringInstance {
  const typed = instance as RetiringInstance;
  instances.push(typed);
  return typed;
}

function isolationChildEnv(logFile: string | undefined): NodeJS.ProcessEnv {
  const isoHome = join(work, "isolation", "home");
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.TAWASSUL_LOG_FILE;
  if (logFile !== undefined) env.TAWASSUL_LOG_FILE = logFile;
  env.HOME = isoHome;
  env.XDG_CONFIG_HOME = join(work, "isolation", "config");
  env.XDG_DATA_HOME = join(work, "isolation", "share");
  env.XDG_STATE_HOME = join(work, "isolation", "state");
  env.XDG_CACHE_HOME = join(work, "isolation", "cache");
  delete env.TAWASSUL_ISOLATED;
  mkdirSync(env.HOME, { recursive: true });
  mkdirSync(env.XDG_CONFIG_HOME, { recursive: true });
  mkdirSync(env.XDG_DATA_HOME, { recursive: true });
  mkdirSync(env.XDG_STATE_HOME, { recursive: true });
  mkdirSync(env.XDG_CACHE_HOME, { recursive: true });
  return env;
}

function runIsolationChild(script: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(process.execPath, [script], { env, encoding: "utf8", timeout: 15_000 });
  if (result.status !== 0) {
    fail(
      `isolation child failed: ${result.error?.message ?? result.stderr ?? result.stdout ?? `exit ${result.status}`}`,
    );
  }
}

function proofLogIsolation(): void {
  const iso = join(work, "isolation");
  mkdirSync(iso, { recursive: true });
  const loggerUrl = pathToFileURL(join(repoRoot, "src", "utils", "logger.ts")).href;
  const isolateUrl = pathToFileURL(join(repoRoot, "scripts", "proof-log-isolate.ts")).href;
  const defaultChild = join(iso, "child-default.ts");
  const redirectChild = join(iso, "child-redirect.ts");
  writeFileSync(
    defaultChild,
    [
      `import { logger } from ${JSON.stringify(loggerUrl)};`,
      `logger.info("PROBE_DEFAULT");`,
      `await new Promise((resolve) => setTimeout(resolve, 200));`,
      "",
    ].join("\n"),
  );
  writeFileSync(
    redirectChild,
    [
      `import ${JSON.stringify(isolateUrl)};`,
      `import { logger } from ${JSON.stringify(loggerUrl)};`,
      `logger.info("PROBE_REDIRECT");`,
      `await new Promise((resolve) => setTimeout(resolve, 200));`,
      "",
    ].join("\n"),
  );

  const defaultLog = join(work, "isolation", "share", "tawassul-v2", "tawassul", "tawassul.log");
  const redirectLog = join(iso, "redirect.log");
  runIsolationChild(defaultChild, isolationChildEnv(undefined));
  assert(existsSync(defaultLog), "the default sink writes without a redirect");
  const defaultBefore = statSync(defaultLog).size;
  assert(readFileSync(defaultLog, "utf8").includes("PROBE_DEFAULT"), "the default sink receives the default line");

  runIsolationChild(redirectChild, isolationChildEnv(redirectLog));
  assert(statSync(defaultLog).size === defaultBefore, "a redirected proof leaves the production sink byte-identical");
  assert(
    !readFileSync(defaultLog, "utf8").includes("PROBE_REDIRECT"),
    "the redirected line never reaches the production sink",
  );
  assert(existsSync(redirectLog), "the redirected sink is created");
  assert(readFileSync(redirectLog, "utf8").includes("PROBE_REDIRECT"), "the redirected line reaches the proof sink");
}

async function settledRetire(): Promise<void> {
  const directory = project("settled");
  const first = remember(initPlugin(pluginInput(directory)));
  const firstProbe = getInitReady(first as never);
  assert(firstProbe !== undefined, "the first instance exposes readiness");
  const firstStatus = await firstProbe!();
  assert(firstStatus.ready, "the first instance becomes ready");

  const logs = capture();
  const second = remember(initPlugin(pluginInput(directory)));
  const secondProbe = getInitReady(second as never);
  assert(secondProbe !== undefined, "the second instance exposes readiness");
  const secondStatus = await secondProbe!();
  logs.restore();
  assert(secondStatus.ready, "the superseding instance becomes ready");

  const retireLines = logs.lines.filter((line) =>
    /v2 retire gen=\d+ pid=\d+ ms=[\d.]+/.test(line),
  );
  assert(retireLines.length === 1, "one retire line per supersede");
  assert(retireLines[0]?.includes("gen=2") === true, "the retire line names the superseding generation");
  assert(!(retireLines[0] ?? "").includes("ceiling=1"), "a settled retire does not mark the ceiling");
  assert(retireCeilingHits() === 0, "a settled retire leaves the ceiling counter at zero");
}

async function ceilingRetire(): Promise<void> {
  const directory = project("ceiling");
  const first = remember(initPlugin(pluginInput(directory)));
  const firstProbe = getInitReady(first as never);
  const firstStatus = await firstProbe!();
  assert(firstStatus.ready, "the retired instance becomes ready before the ceiling case");
  const manager = first.tawaCtx.lifecycleManager;
  const original = manager.destroy.bind(manager);
  let resolveDestroyed: () => void = () => undefined;
  const destroyed = new Promise<void>((resolve) => {
    resolveDestroyed = resolve;
  });
  manager.destroy = async () => {
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      return await original();
    } finally {
      resolveDestroyed();
    }
  };

  const logs = capture();
  const superseding = remember(initPlugin(pluginInput(directory), { retireCeilingMs: 60 }));
  const probe = getInitReady(superseding as never);
  const status = await probe!();
  logs.restore();
  assert(status.ready, "the superseding instance becomes ready past the ceiling");
  await destroyed;

  const ceilingLines = logs.lines.filter(
    (line) => line.includes("v2 retire ") && line.includes("ceiling=1"),
  );
  assert(ceilingLines.length === 1, "the ceiling logs one retire line");
  assert(ceilingLines[0]?.includes("hits=1") === true, "the ceiling line reports the first hit");
  assert(retireCeilingHits() === 1, "the ceiling counter records the hit");
  assert(RETIRE_CEILING_MS === 8000, "the production ceiling stays at 8 s");
}

async function disposeInstances(): Promise<void> {
  for (const instance of instances) {
    try {
      await instance.dispose();
    } catch (e) {
      console.error(e);
    }
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
}

function assertNoFeatureIndexEnoent(): void {
  const proofLog = process.env.TAWASSUL_LOG_FILE;
  if (proofLog === undefined || !existsSync(proofLog)) return;
  const lines = readFileSync(proofLog, "utf8").split("\n");
  const enoent = lines.filter(
    (line) => line.includes("FeatureIndex save failed") && line.includes("ENOENT"),
  );
  assert(enoent.length === 0, "the retire proof leaves no ENOENT feature-index line");
}

try {
  proofLogIsolation();
  await settledRetire();
  await ceilingRetire();
  console.log(`PROOF PASS: every supersede logs its retire wait, the 8 s ceiling is counted, and proof logs stay isolated (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(e);
    process.exitCode = 1;
  }
} finally {
  await disposeInstances();
  if (process.exitCode !== 1) assertNoFeatureIndexEnoent();
  rmSync(work, { recursive: true, force: true });
}
