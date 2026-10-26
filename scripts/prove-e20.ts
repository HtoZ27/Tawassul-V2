import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TawassulContext } from "../src/context-class.ts";
import { HandoffLedger } from "../src/services/handoff-ledger.ts";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "tawassul-e20-"));

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

const dir = join(work, "project");
mkdirSync(join(dir, ".opencode", "agents"), { recursive: true });
copyFileSync(join(repo, ".opencode", "agents", "dev.md"), join(dir, ".opencode", "agents", "dev.md"));

async function main(): Promise<void> {
  const ctx = new TawassulContext(dir);
  ctx.ensureConfig();
  const order: string[] = [];
  const marker = join(work, "marker.txt");
  const ledger = new HandoffLedger(join(dir, ".opencode"));

  ctx.lifecycleManager.addCleanupCallback(async () => {
    order.push("slow-start");
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    order.push("slow-end");
  });
  ctx.lifecycleManager.addCleanupCallback(async () => {
    order.push("writer");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(marker, "written", "utf8");
  });
  ctx.lifecycleManager.addCleanupCallback(() => {
    throw new Error("intentional cleanup failure");
  });
  ctx.lifecycleManager.addCleanupCallback(async () => {
    order.push("after-failure");
  });
  ctx.lifecycleManager.addCleanupCallback(() => ledger.dispose());

  ledger.append({
    type: "handoff_created",
    handoffId: "H-001",
    from: "analyst",
    to: "dev",
    task: "tail must survive shutdown",
  });

  await ctx.lifecycleManager.destroy();

  assert(order.includes("slow-end"), "destroy awaits an async cleanup callback");
  assert(order.indexOf("slow-start") < order.indexOf("slow-end"), "the async callback completes in order");
  assert(order.includes("writer"), "a later callback still runs after the awaited one");
  assert(existsSync(marker), "an async callback's write is on disk when destroy resolves");
  assert(order.includes("after-failure"), "a throwing callback does not stop the chain");
  const ledgerPath = join(dir, ".opencode", "handoff-ledger.jsonl");
  assert(existsSync(ledgerPath), "the handoff ledger tail is flushed by destroy");
  const lines = readFileSync(ledgerPath, "utf8").trim().split("\n").filter(Boolean);
  assert(lines.length === 1, "the buffered ledger entry is written exactly once");
  const entry = JSON.parse(lines[0] as string) as { handoffId?: string; task?: string };
  assert(entry.handoffId === "H-001", "the flushed ledger entry keeps its id");
  assert(entry.task === "tail must survive shutdown", "the flushed ledger entry keeps its task");
}

try {
  await main();
  console.log(`PROOF PASS: destroy awaits every async cleanup callback (${passed} assertions)`);
} finally {
  for (const key of envKeys) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(work, { recursive: true, force: true });
}
