import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TawassulContext } from "../src/context-class.ts";
import { logger } from "../src/utils/logger.ts";
import type { RecordEntry } from "../src/context/types.ts";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "tawassul-e21-"));

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

function addRecord(ctx: TawassulContext, title: string): void {
  ctx.recSeq++;
  ctx.records.push({
    id: `R-${String(ctx.recSeq).padStart(3, "0")}`,
    timestamp: new Date().toISOString(),
    agent: "dev",
    type: "note",
    title,
    detail: title,
    provenance: "tool_observed",
  } satisfies RecordEntry);
}

function onDisk(path: string): RecordEntry[] {
  const raw = readFileSync(path, "utf8");
  const start = raw.indexOf("{");
  if (start < 0) fail("the state file carries no JSON payload");
  const parsed = JSON.parse(raw.slice(start)) as { records?: RecordEntry[] };
  return parsed.records ?? [];
}

async function main(): Promise<void> {
  const errors: string[] = [];
  const originalError = logger.error;
  logger.error = ((message: string) => {
    errors.push(String(message));
  }) as typeof logger.error;

  try {
    const dir = makeProject("recoverable");
    const ctx = new TawassulContext(dir);
    ctx.ensureConfig();
    addRecord(ctx, "written after eight failures");
    const failures = ctx.lifecycleManager as unknown as { persistence: { saveFailureCount: number } };
    failures.persistence.saveFailureCount = 8;
    await ctx.lifecycleManager.flushSaves();
    assert(existsSync(ctx.statePath()), "flushSaves still writes after eight failed saves");
    assert(
      onDisk(ctx.statePath()).some((entry) => entry.title === "written after eight failures"),
      "the forced final write carries the newest record",
    );
    assert(
      errors.some((line) => line.includes("one final forced write")),
      "the exhausted flush announces the forced write",
    );
    assert(
      !errors.some((line) => line.includes("gave up after retries")),
      "a successful forced write reports no give-up",
    );

    const failingDir = makeProject("terminal");
    const failing = new TawassulContext(failingDir);
    failing.ensureConfig();
    addRecord(failing, "cannot reach the disk");
    const failingManager = failing.stateManager;
    failingManager.saveWithRevision = (async () => {
      throw new Error("simulated disk failure");
    }) as typeof failingManager.saveWithRevision;
    const failingFailures = failing.lifecycleManager as unknown as { persistence: { saveFailureCount: number } };
    failingFailures.persistence.saveFailureCount = 8;
    errors.length = 0;
    let threw = false;
    try {
      await failing.lifecycleManager.flushSaves();
    } catch {
      threw = true;
    }
    assert(threw, "a failed final write rejects instead of returning silently");
    assert(
      errors.some((line) => line.includes("the final write failed")),
      "the failed final write logs at error level",
    );
    assert(
      errors.some((line) => line.includes("not on disk")),
      "the error states that the session state is not persisted",
    );
    assert(
      failing.lifecycleManager.getSaveHealth().failureCount === 9,
      "the failure count grows past the eight-failure gate",
    );
    assert(!existsSync(failing.statePath()), "no state file is reported as written");
  } finally {
    logger.error = originalError;
  }
}

try {
  await main();
  console.log(`PROOF PASS: the shutdown flush is never a silent no-op (${passed} assertions)`);
} finally {
  for (const key of envKeys) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(work, { recursive: true, force: true });
}
