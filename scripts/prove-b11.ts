import "./proof-log-isolate.ts";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PredictiveRouter } from "../src/features/predictive-router.ts";
import { writeIfChanged } from "../src/services/persist-utils.ts";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backupCount(dir: string): number {
  try {
    return readdirSync(dir).filter((f) => f.includes(".bak.")).length;
  } catch {
    return 0;
  }
}

const work = mkdtempSync(join(tmpdir(), "tawassul-b11-"));
const file = join(work, "predictive-router.json");

async function main(): Promise<void> {
  const router = new PredictiveRouter();
  const first = router.exportData();
  await sleep(10);
  const second = router.exportData();
  assert(first === second, "two exports of unchanged state are byte-identical");

  assert(await writeIfChanged(file, first, { backup: true }), "the first save writes the file");
  const mtime = statSync(file).mtimeMs;

  const results: boolean[] = [];
  for (let i = 0; i < 5; i++) {
    await sleep(10);
    results.push(await writeIfChanged(file, router.exportData(), { backup: true }));
  }
  assert(
    results.every((r) => r === false),
    "repeated saves of unchanged state skip the write",
  );
  assert(statSync(file).mtimeMs === mtime, "the file is not rewritten on an unchanged export");
  assert(backupCount(work) === 0, "unchanged exports grow no backup family");

  router.importData(JSON.stringify({ totalRoutings: 7 }));
  assert(await writeIfChanged(file, router.exportData(), { backup: true }), "a real change still writes");
  assert(backupCount(work) === 1, "a real change keeps exactly one backup");
  for (let i = 0; i < 3; i++) {
    router.importData(JSON.stringify({ totalRoutings: 8 + i }));
    await writeIfChanged(file, router.exportData(), { backup: true });
  }
  assert(backupCount(work) <= 2, "the backup cap holds after repeated real changes");
}

try {
  await main();
  console.log(`PROOF PASS: the router saves only when its state actually changes (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
