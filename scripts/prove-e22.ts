import "./proof-log-isolate.ts";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TawassulContext } from "../src/context-class.ts";
import type { HandoffEntry } from "../src/context/types.ts";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "tawassul-e22-"));

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

const envKeys = [
  "TAWASSUL_SCOPE",
  "TAWASSUL_PROJECT_DIR",
  "TAWASSUL_STATE_DIR",
  "TAWASSUL_V2_STATE_DIR",
  "TAWASSUL_HMAC_KEY_DIR",
  "TAWASSUL_LOG_FILE",
  "TAWASSUL_QUIET",
  "OPENCODE_DB",
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
] as const;

const savedEnv = new Map<string, string | undefined>();
for (const key of envKeys) savedEnv.set(key, process.env[key]);

const fakeHome = join(work, "home");
process.env.HOME = fakeHome;
process.env.XDG_CONFIG_HOME = join(fakeHome, ".config");
process.env.XDG_DATA_HOME = join(fakeHome, ".local", "share");
process.env.XDG_STATE_HOME = join(fakeHome, ".local", "state");
process.env.XDG_CACHE_HOME = join(fakeHome, ".cache");
delete process.env.TAWASSUL_STATE_DIR;
delete process.env.TAWASSUL_V2_STATE_DIR;
delete process.env.TAWASSUL_PROJECT_DIR;

function makeProject(label: string): string {
  const dir = join(work, label);
  mkdirSync(join(dir, ".opencode", "agents"), { recursive: true });
  copyFileSync(join(repo, ".opencode", "agents", "dev.md"), join(dir, ".opencode", "agents", "dev.md"));
  return dir;
}

function diskRating(path: string, agent: string): number {
  const raw = readFileSync(path, "utf8");
  const start = raw.indexOf("{");
  if (start < 0) fail("the state file carries no JSON payload");
  const parsed = JSON.parse(raw.slice(start)) as {
    agentRatings?: Record<string, { handoffsDropped?: number }>;
  };
  return parsed.agentRatings?.[agent]?.handoffsDropped ?? 0;
}

async function main(): Promise<void> {
  const dir = makeProject("dropped");
  const ctx = new TawassulContext(dir);
  ctx.ensureConfig();
  const handoff: HandoffEntry = {
    id: "H-001",
    from: "analyst",
    to: "dev",
    task: "never completed",
    context: "still accepted when the session ends",
    files: [],
    timestamp: new Date().toISOString(),
    status: "accepted",
  };
  ctx.handoffs.set(handoff.id, handoff);
  ctx.hoffSeq = 1;
  assert((ctx.ratingManager.agentRatings["dev"]?.handoffsDropped ?? 0) === 0, "the agent starts with no dropped handoff");

  await ctx.lifecycleManager.destroy();

  assert(existsSync(ctx.statePath()), "destroy writes the state file");
  assert(diskRating(ctx.statePath(), "dev") === 1, "the dropped-handoff penalty reaches the disk");

  const reader = new TawassulContext(dir);
  await reader.lifecycleManager.loadStateAsync();
  assert(
    (reader.ratingManager.agentRatings["dev"]?.handoffsDropped ?? 0) === 1,
    "a restart reads the dropped-handoff penalty back",
  );

  const second = makeProject("completed");
  const cleanCtx = new TawassulContext(second);
  cleanCtx.ensureConfig();
  cleanCtx.handoffs.set("H-002", {
    id: "H-002",
    from: "analyst",
    to: "tester",
    task: "finished",
    context: "completed before shutdown",
    files: [],
    timestamp: new Date().toISOString(),
    status: "completed",
  });
  cleanCtx.hoffSeq = 1;
  await cleanCtx.lifecycleManager.destroy();
  assert(
    (diskRating(cleanCtx.statePath(), "tester") ?? 0) === 0,
    "a completed handoff is never counted as dropped",
  );
}

try {
  await main();
  console.log(`PROOF PASS: dropped-handoff penalties are persisted before persistence closes (${passed} assertions)`);
} finally {
  for (const key of envKeys) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(work, { recursive: true, force: true });
}
