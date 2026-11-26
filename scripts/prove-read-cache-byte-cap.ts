import "./proof-log-isolate.ts";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadCacheService } from "../src/services/read-cache/index.ts";
import { MAX_ENTRY_BYTES } from "../src/services/read-cache/policy.ts";
import type { FileStamp } from "../src/services/project-index/types.ts";

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

const CAP_BYTES = 900;
const PAYLOAD = 400;
const work = mkdtempSync(join(tmpdir(), "tawassul-read-cache-cap-"));

async function main(): Promise<void> {
  const project = join(work, "project");
  mkdirSync(project, { recursive: true });
  for (const tag of ["a", "b", "c", "d"]) {
    writeFileSync(join(project, `${tag}.ts`), `export const ${tag} = 1;\n`);
  }

  const cache = new ReadCacheService({ projectKey: "cap-key", enabled: true, maxBytes: CAP_BYTES });
  let computed = 0;

  const call = (tag: string): Promise<{ value: { output: string }; cached: boolean }> =>
    cache.getOrCompute<{ output: string }>({
      tool: "batchread",
      args: { paths: [`${tag}.ts`] },
      files: [fileStamp(join(project, `${tag}.ts`))],
      dirs: [],
      compute: () => {
        computed += 1;
        return { output: `${tag}:${"x".repeat(PAYLOAD)}` };
      },
    });

  const a1 = await call("a");
  eq(a1.cached, false, "the first entry is computed");
  const b1 = await call("b");
  eq(b1.cached, false, "the second entry is computed");
  let stats = cache.stats();
  eq(stats.entries, 2, "two entries fit under the cap");
  eq(stats.evictions, 0, "no eviction is needed under the cap");
  assert(stats.bytes <= CAP_BYTES, "the byte total stays under the cap");

  const a2 = await call("a");
  eq(a2.cached, true, "the first entry is reused and becomes the most recent");
  eq(computed, 2, "the reused entry runs no computation");

  const c1 = await call("c");
  eq(c1.cached, false, "a third distinct entry is computed");
  eq(computed, 3, "the third entry runs the compute function once");
  stats = cache.stats();
  eq(stats.entries, 2, "the third entry evicts back down to two");
  eq(stats.evictions, 1, "exceeding the cap evicts exactly one entry");
  assert(stats.bytes <= CAP_BYTES, "the total stays under the cap after eviction");

  const b2 = await call("b");
  eq(b2.cached, false, "the least-recently-used entry was evicted");
  assert(cache.bytes <= CAP_BYTES, "the total stays under the cap after the refill");
  assert(cache.stats().entries <= 2, "the entry count never exceeds the cap");

  const d1 = await call("d");
  assert(d1.cached === false, "a fresh key under the cap computes");
  assert(cache.bytes <= CAP_BYTES, "the invariant holds across every insert");

  const bigPath = join(project, "big.ts");
  writeFileSync(bigPath, "export const big = 1;\n");
  let bigComputed = 0;
  const big = (): Promise<{ value: { output: string }; cached: boolean }> =>
    cache.getOrCompute<{ output: string }>({
      tool: "batchread",
      args: { paths: ["big.ts"] },
      files: [fileStamp(bigPath)],
      dirs: [],
      compute: () => {
        bigComputed += 1;
        return { output: "y".repeat(MAX_ENTRY_BYTES + 1024) };
      },
    });
  const entriesBeforeBig = cache.stats().entries;
  const firstBig = await big();
  eq(firstBig.cached, false, "an oversized entry is computed");
  const afterBig = cache.stats();
  eq(afterBig.entries, entriesBeforeBig, "an oversized entry is not stored");
  assert(afterBig.bytes <= CAP_BYTES, "an oversized entry never enters the byte total");
  const secondBig = await big();
  eq(secondBig.cached, false, "an oversized entry is recomputed instead of cached");
  eq(bigComputed, 2, "an oversized entry runs the compute function on every call");

  console.log(`PROOF PASS: the byte cap evicts under LRU and the total stays bounded (${passed} assertions)`);
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
