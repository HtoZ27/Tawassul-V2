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

const work = mkdtempSync(join(tmpdir(), "tawassul-read-cache-unrelated-"));

async function main(): Promise<void> {
  const project = join(work, "project");
  const watched = join(project, "watched");
  const other = join(project, "other");
  mkdirSync(watched, { recursive: true });
  mkdirSync(other, { recursive: true });
  const watchedFile = join(watched, "w.ts");
  const otherFile = join(other, "o.ts");
  writeFileSync(watchedFile, "export const w = 1;\n");
  writeFileSync(otherFile, "export const o = 1;\n");

  const cache = new ReadCacheService({ projectKey: "unrelated-key", enabled: true });
  const files: FileStamp[] = [fileStamp(watchedFile)];
  const dirs: DirStamp[] = [dirStamp(watched)];
  let computed = 0;

  const call = (): Promise<{ value: { output: string }; cached: boolean }> =>
    cache.getOrCompute<{ output: string }>({
      tool: "batchread",
      args: { paths: ["watched/w.ts"] },
      files,
      dirs,
      compute: () => {
        computed += 1;
        return { output: `revision-${computed}` };
      },
    });

  const first = await call();
  eq(first.cached, false, "the first call computes the entry");

  const second = await call();
  eq(second.cached, true, "an unchanged entry hits");

  writeFileSync(otherFile, "export const o = 2;\nexport const more = 3;\n");
  const when = new Date(Date.now() + 5000);
  utimesSync(other, when, when);
  utimesSync(otherFile, when, when);

  const afterUnrelatedEdit = await call();
  eq(afterUnrelatedEdit.cached, true, "an edit outside every stamp still hits");
  eq(computed, 1, "the unrelated edit runs no recomputation");
  eq(afterUnrelatedEdit.value.output, second.value.output, "the hit returns identical output");

  writeFileSync(watchedFile, "export const w = 2;\nexport const extra = 3;\n");
  const later = new Date(Date.now() + 10000);
  utimesSync(watchedFile, later, later);
  files[0] = fileStamp(watchedFile);

  const afterRelatedEdit = await call();
  eq(afterRelatedEdit.cached, false, "an edit inside a stamped path still misses");
  eq(computed, 2, "the related edit runs the compute function again");
  assert(
    afterRelatedEdit.value.output !== afterUnrelatedEdit.value.output,
    "the related edit returns a fresh value",
  );

  console.log(`PROOF PASS: an edit outside the stamped paths keeps the entry valid (${passed} assertions)`);
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
