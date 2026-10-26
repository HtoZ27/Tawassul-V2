import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TawassulContext } from "../src/context-class.ts";
import { buildRecordTool } from "../src/tools/record.ts";
import { logger } from "../src/utils/logger.ts";
import type { RecordEntry } from "../src/context/types.ts";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "tawassul-e13-"));

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

function toolContext(dir: string): {
  sessionID: string;
  messageID: string;
  agent: string;
  directory: string;
  worktree: string;
  abort: AbortSignal;
  metadata(): void;
} {
  return {
    sessionID: "ses_e13",
    messageID: "msg_e13",
    agent: "dev",
    directory: dir,
    worktree: dir,
    abort: new AbortController().signal,
    metadata() {},
  };
}

function recordsOnDisk(path: string, reader: TawassulContext): RecordEntry[] {
  const raw = readFileSync(path, "utf8");
  const start = raw.indexOf("{");
  if (start < 0) fail("the state file carries no JSON payload");
  const parsed = JSON.parse(raw.slice(start)) as { records?: RecordEntry[] };
  return parsed.records ?? reader.records;
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
  });
}

async function main(): Promise<void> {
  const dir = makeProject("rejected");
  const writer = new TawassulContext(dir);
  writer.ensureConfig();
  const tool = buildRecordTool(writer);
  await tool.execute(
    { type: "decision", title: "old good", detail: "the newest readable generation" },
    toolContext(dir),
  );
  const statePath = writer.statePath();
  const goodBytes = readFileSync(statePath);
  const backupPath = `${statePath}.bak.0`;
  writeFileSync(backupPath, goodBytes);
  const goodBackupDigest = readFileSync(backupPath);

  const tampered = readFileSync(statePath, "utf8").replace('"old good"', '"tampered"');
  assert(tampered.includes('"tampered"'), "the primary payload is altered after signing");
  writeFileSync(statePath, tampered);

  const errors: string[] = [];
  const originalError = logger.error;
  logger.error = ((message: string) => {
    errors.push(String(message));
  }) as typeof logger.error;
  const reader = new TawassulContext(dir);
  try {
    await reader.lifecycleManager.loadStateAsync();
  } finally {
    logger.error = originalError;
  }

  assert(reader.records.length === 1, "the recovered state carries exactly the backup generation");
  assert(reader.records[0]?.title === "old good", "the readable backup wins over the rejected primary");
  assert(
    reader.records.every((entry) => entry.title !== "tampered"),
    "the rejected payload is never adopted",
  );
  assert(errors.some((line) => line.includes("rejected")), "the startup error names the rejected file");
  assert(errors.some((line) => line.includes(".bak.0")), "the startup error explains the backup fallback");

  const stateDir = dirname(statePath);
  const quarantined = readdirSync(stateDir).filter((name) => name.includes(".quarantine-"));
  assert(quarantined.length === 1, "the rejected file is preserved as one quarantine copy");
  const quarantineText = readFileSync(join(stateDir, quarantined[0] as string), "utf8");
  assert(quarantineText.includes('"tampered"'), "the quarantine copy holds the rejected bytes");

  const rejected = reader.stateManager.getRejectedStateFiles();
  assert(rejected.length === 1 && rejected[0]?.path === statePath, "the manager reports the rejected path");
  assert(rejected[0]?.reason === "hmac", "the rejection reason is the failed signature");

  const known = reader.stateManager.getKnownRevision();
  const diskRevision = await reader.stateManager.getDiskRevision();
  assert(known > 0, "the recovered generation carries a revision");
  assert(diskRevision === known, "a rejected primary reports the recovered revision, not zero");

  const warnings: string[] = [];
  const originalWarn = logger.warn;
  logger.warn = ((message: string) => {
    warnings.push(String(message));
  }) as typeof logger.warn;
  addRecord(reader, "blocked while rejected");
  try {
    await reader.saveState();
  } finally {
    logger.warn = originalWarn;
  }
  assert(
    readFileSync(statePath, "utf8").includes('"tampered"'),
    "a tampered primary stays untouched while the session is read-only",
  );
  assert(
    readFileSync(backupPath).equals(goodBackupDigest),
    "the rejected file never rotated over the newest good backup",
  );
  assert(
    warnings.some((line) => line.includes("memory-only")),
    "a skipped save warns instead of reporting success",
  );
  assert(reader.stateManager.getRejectedStateFiles().length === 1, "the rejected mark survives a skipped save");

  const warningsBeforeGuard = warnings.length;
  logger.warn = ((message: string) => {
    warnings.push(String(message));
  }) as typeof logger.warn;
  try {
    await (reader.stateManager as unknown as { rotateBackups(path: string): Promise<void> }).rotateBackups(statePath);
  } finally {
    logger.warn = originalWarn;
  }
  assert(
    warnings.slice(warningsBeforeGuard).some((line) => line.includes("rotation skipped")),
    "the rotation guard refuses a rejected primary even when called directly",
  );
  assert(
    readFileSync(backupPath).equals(goodBackupDigest),
    "a direct rotation attempt leaves the good backup intact",
  );

  copyFileSync(backupPath, statePath);
  const counters = reader.stateManager as unknown as { incrementalCounter: number };
  counters.incrementalCounter = 4;
  addRecord(reader, "after recovery");
  await reader.saveState();
  assert(reader.stateManager.getRejectedStateFiles().length === 0, "a successful write clears the rejected mark");
  const afterRecovery = new TawassulContext(dir);
  await afterRecovery.lifecycleManager.loadStateAsync();
  assert(afterRecovery.records.length === 3, "the healed file carries every in-memory generation");
  assert(afterRecovery.records[2]?.title === "after recovery", "the new record reaches the canonical file");
  assert(
    afterRecovery.records[1]?.title === "blocked while rejected",
    "the memory-only record is written once the file is readable again",
  );

  counters.incrementalCounter = 4;
  addRecord(reader, "rotation resumed");
  await reader.saveState();
  const rotatedBackup = recordsOnDisk(backupPath, afterRecovery);
  assert(
    !readFileSync(backupPath).equals(goodBackupDigest),
    "rotation resumes once the canonical file is readable again",
  );
  assert(
    rotatedBackup.some((entry) => entry.title === "after recovery"),
    "the rotated backup holds the previous good generation",
  );
  assert(
    rotatedBackup.every((entry) => entry.title !== "rotation resumed"),
    "the rotated backup predates the newest write",
  );
  const finalReader = new TawassulContext(dir);
  await finalReader.lifecycleManager.loadStateAsync();
  assert(finalReader.records.length === 4, "the canonical file keeps every generation");
  assert(existsSync(statePath), "the canonical state file exists");
}

try {
  await main();
  console.log(`PROOF PASS: a rejected state file is quarantined and never rotated over a backup (${passed} assertions)`);
} finally {
  for (const key of envKeys) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(work, { recursive: true, force: true });
}
