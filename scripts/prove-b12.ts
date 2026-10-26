import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPanicTool } from "../src/tools/system-controls.ts";
import type { ToolContext } from "../src/tool.ts";

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

const work = mkdtempSync(join(tmpdir(), "tawassul-b12-"));
const ctx = { agent: "@analyst", sessionID: "sess-b12" } as unknown as ToolContext;

function backupFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith("tawassul-state.panic-backup-"))
      .sort();
  } catch {
    return [];
  }
}

async function runPanic(dir: string, cleared: string[]): Promise<string> {
  const panic = buildPanicTool(() => {
    cleared.push("cleared");
    return "summary";
  }, dir);
  const result = await panic.execute({ confirm: true }, ctx);
  return String((result as { output?: string }).output ?? "");
}

async function main(): Promise<void> {
  const live = join(work, "live");
  mkdirSync(live, { recursive: true });
  writeFileSync(join(live, "tawassul-state.json"), JSON.stringify({ live: true }), "utf8");
  const cleared: string[] = [];
  const output = await runPanic(live, cleared);
  const backups = backupFiles(live);
  assert(backups.length === 1, "a confirmed panic takes a backup before clearing");
  assert(cleared.length === 1, "the state is cleared only after the backup lands");

  const six = join(work, "six");
  mkdirSync(six, { recursive: true });
  writeFileSync(join(six, "tawassul-state.json"), JSON.stringify({ live: true }), "utf8");
  for (let i = 0; i < 5; i++) {
    writeFileSync(join(six, `tawassul-state.panic-backup-2026-01-0${i + 1}T00-00-00-000Z-old.json`), "old", "utf8");
  }
  const clearedSix: string[] = [];
  await runPanic(six, clearedSix);
  const capped = backupFiles(six);
  assert(capped.length === 3, "panic backups are capped at three");
  assert(
    capped.some((f) => f.includes(`2026-01-0${5}`)) && !capped.some((f) => f.includes("2026-01-01")),
    "the oldest panic backups are pruned first",
  );
  assert(output.includes(backups[0]!), "the report names the backup file");

  const empty = join(work, "empty");
  mkdirSync(empty, { recursive: true });
  const clearedEmpty: string[] = [];
  const emptyOutput = await runPanic(empty, clearedEmpty);
  assert(clearedEmpty.length === 1, "a panic with no state file still clears");
  assert(backupFiles(empty).length === 0, "no backup file is invented when there is no state");
  assert(emptyOutput.includes("No state file existed"), "the report says no backup was needed");

  const blocked = join(work, "blocked");
  mkdirSync(blocked, { recursive: true });
  writeFileSync(join(blocked, "tawassul-state.json"), JSON.stringify({ live: true }), "utf8");
  chmodSync(join(blocked, "tawassul-state.json"), 0o000);
  const clearedBlocked: string[] = [];
  const blockedOutput = await runPanic(blocked, clearedBlocked);
  chmodSync(join(blocked, "tawassul-state.json"), 0o600);
  assert(clearedBlocked.length === 0, "a failed backup refuses to clear the state");
  assert(blockedOutput.includes("Panic aborted"), "a failed backup reports the abort");
  assert(backupFiles(blocked).length === 0, "a failed backup leaves no partial copy");
}

try {
  await main();
  console.log(`PROOF PASS: panic backs up first, caps its backups, and refuses to clear on failure (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
