import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadCacheService } from "../src/services/read-cache/index.ts";
import type { DirStamp, FileStamp } from "../src/services/project-index/types.ts";

let passed = 0;

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, name: string): void {
  if (!condition) fail(name);
  passed += 1;
  console.log(`ok ${name}`);
}

function eq(actual: unknown, expected: unknown, name: string): void {
  assert(Object.is(actual, expected), `${name} (${String(actual)}/${String(expected)})`);
}

function fileStamp(path: string): FileStamp {
  const info = statSync(path);
  return { path, mtimeMs: info.mtimeMs, size: info.size };
}

function dirStamp(path: string): DirStamp {
  return { path, mtimeMs: statSync(path).mtimeMs };
}

function bump(path: string, seconds: number): void {
  const when = new Date(Date.now() + seconds * 1000);
  utimesSync(path, when, when);
}

const work = mkdtempSync(join(tmpdir(), "tawassul-read-cache-stamp-"));

async function main(): Promise<void> {
  const project = join(work, "project");
  const src = join(project, "src");
  mkdirSync(src, { recursive: true });
  const aPath = join(src, "a.ts");
  writeFileSync(aPath, "export const a = 1;\n");

  const cache = new ReadCacheService({ projectKey: "stamp-key", enabled: true });
  let files: FileStamp[] = [fileStamp(aPath)];
  let dirs: DirStamp[] = [dirStamp(src)];
  let computed = 0;

  const call = (): Promise<{ value: { revision: number }; cached: boolean }> =>
    cache.getOrCompute<{ revision: number }>({
      tool: "depmap",
      args: { dir: project, depth: 3, useAst: false, file: null },
      files,
      dirs,
      compute: () => {
        computed += 1;
        return { revision: computed };
      },
    });

  const first = await call();
  eq(first.cached, false, "the first call computes");
  eq(computed, 1, "the first call runs the compute function once");

  const second = await call();
  eq(second.cached, true, "an unchanged call hits");
  eq(second.value.revision, 1, "the hit returns the stored value");

  writeFileSync(aPath, "export const a = 2;\nexport const extra = 3;\n");
  bump(aPath, 5);
  files = [fileStamp(aPath)];
  const edited = await call();
  eq(edited.cached, false, "editing a stamped file forces recomputation");
  eq(computed, 2, "the edited file runs the compute function again");
  eq(edited.value.revision, 2, "the edited file returns a fresh value");
  assert(edited.value.revision !== first.value.revision, "the stale value is never returned");

  const bPath = join(src, "b.ts");
  writeFileSync(bPath, "export const b = 1;\n");
  bump(src, 10);
  dirs = [dirStamp(src)];
  files = [fileStamp(aPath)];
  const added = await call();
  eq(added.cached, false, "adding a file to a walked directory forces recomputation");
  eq(computed, 3, "the directory stamp change runs the compute function again");
  eq(added.value.revision, 3, "the re-walked directory returns a fresh value");

  writeFileSync(bPath, "export const b = 2;\nexport const more = 4;\n");
  bump(bPath, 15);
  files = [fileStamp(aPath), fileStamp(bPath)];
  const secondFile = await call();
  eq(secondFile.cached, false, "editing a second stamped file forces recomputation");

  rmSync(aPath);
  files = [fileStamp(bPath)];
  bump(src, 20);
  dirs = [dirStamp(src)];
  const removed = await call();
  eq(removed.cached, false, "a missing stamped file forces recomputation");

  const again = await call();
  eq(again.cached, true, "the entry hits again once its stamps are stable");

  console.log(`PROOF PASS: a changed file or directory stamp forces a fresh computation (${passed} assertions)`);
}

try {
  await main();
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
