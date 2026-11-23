import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
};

async function settledRetire(): Promise<void> {
  const directory = project("settled");
  const first = initPlugin(pluginInput(directory));
  const firstProbe = getInitReady(first as never);
  assert(firstProbe !== undefined, "the first instance exposes readiness");
  const firstStatus = await firstProbe!();
  assert(firstStatus.ready, "the first instance becomes ready");

  const logs = capture();
  const second = initPlugin(pluginInput(directory));
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
  const first = initPlugin(pluginInput(directory)) as unknown as RetiringInstance;
  const firstProbe = getInitReady(first as never);
  const firstStatus = await firstProbe!();
  assert(firstStatus.ready, "the retired instance becomes ready before the ceiling case");
  const manager = first.tawaCtx.lifecycleManager;
  const original = manager.destroy.bind(manager);
  manager.destroy = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    return original();
  };

  const logs = capture();
  const superseding = initPlugin(pluginInput(directory), { retireCeilingMs: 60 });
  const probe = getInitReady(superseding as never);
  const status = await probe!();
  logs.restore();
  assert(status.ready, "the superseding instance becomes ready past the ceiling");

  const ceilingLines = logs.lines.filter(
    (line) => line.includes("v2 retire ") && line.includes("ceiling=1"),
  );
  assert(ceilingLines.length === 1, "the ceiling logs one retire line");
  assert(ceilingLines[0]?.includes("hits=1") === true, "the ceiling line reports the first hit");
  assert(retireCeilingHits() === 1, "the ceiling counter records the hit");
  assert(RETIRE_CEILING_MS === 8000, "the production ceiling stays at 8 s");
}

try {
  await settledRetire();
  await ceilingRetire();
  console.log(`PROOF PASS: every supersede logs its retire wait and the 8 s ceiling is counted (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(e);
    process.exitCode = 1;
  }
} finally {
  await new Promise<void>((resolve) => setTimeout(resolve, 500));
  rmSync(work, { recursive: true, force: true });
}
