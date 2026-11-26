import "./proof-log-isolate.ts";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TawassulContext } from "../src/context.ts";
import type { ToolContext } from "../src/tool.ts";
import { ReadCacheService } from "../src/services/read-cache/index.ts";
import { buildDependencyMapTool } from "../src/tools/dependency-map.ts";

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

function toolContext(directory: string): ToolContext {
  return {
    sessionID: "ses_read_cache_hit",
    messageID: "msg_read_cache_hit",
    agent: "dev",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {},
  };
}

function outputOf(result: unknown): string {
  return typeof result === "object" && result !== null && "output" in result
    ? String((result as { output: unknown }).output)
    : "";
}

const work = mkdtempSync(join(tmpdir(), "tawassul-read-cache-hit-"));

async function main(): Promise<void> {
  const project = join(work, "project");
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "src", "a.ts"), 'import { b } from "./b";\nexport const a = b;\n');
  writeFileSync(join(project, "src", "b.ts"), "export const b = 1;\n");
  writeFileSync(join(project, "src", "c.ts"), 'import { a } from "./a";\nexport const c = a;\n');

  const cache = new ReadCacheService({ projectKey: "hit-key", enabled: true });
  const ctx = { readCache: cache } as unknown as TawassulContext;
  const cctx = toolContext(project);
  const depmap = buildDependencyMapTool(ctx);

  const first = outputOf(await depmap.execute({ depth: 3 } as never, cctx));
  assert(first.includes("b.ts"), "the first depmap run renders the walked tree");
  const afterFirst = cache.stats();
  eq(afterFirst.misses, 1, "the first depmap run is a miss");
  eq(afterFirst.hits, 0, "the first depmap run records no hit");
  eq(afterFirst.entries, 1, "the first depmap run stores exactly one entry");
  assert(afterFirst.bytes > 0, "the stored entry carries a positive byte count");

  const second = outputOf(await depmap.execute({ depth: 3 } as never, cctx));
  eq(second, first, "the second depmap run returns byte-identical output");
  const afterSecond = cache.stats();
  eq(afterSecond.hits, 1, "the second depmap run is a cache hit");
  eq(afterSecond.misses, 1, "the second depmap run performs no recomputation");
  eq(afterSecond.entries, 1, "the hit keeps the single entry in place");

  const otherDepth = outputOf(await depmap.execute({ depth: 2 } as never, cctx));
  assert(otherDepth.length > 0, "a different depth still renders a report");
  const afterOther = cache.stats();
  eq(afterOther.misses, 2, "a different depth is a different key");
  eq(afterOther.entries, 2, "the second key stores its own entry");

  let computed = 0;
  const service = new ReadCacheService({ projectKey: "counter-key", enabled: true });
  const target = join(project, "src", "b.ts");
  const info = statSync(target);
  const files = [{ path: target, mtimeMs: info.mtimeMs, size: info.size }];
  const compute = (): { output: string } => {
    computed += 1;
    return { output: "counted" };
  };
  const once = await service.getOrCompute({ tool: "batchread", args: { paths: ["src/b.ts"] }, files, dirs: [], compute });
  const twice = await service.getOrCompute({ tool: "batchread", args: { paths: ["src/b.ts"] }, files, dirs: [], compute });
  eq(computed, 1, "two identical lookups run the compute function once");
  eq(once.cached, false, "the first lookup computes");
  eq(twice.cached, true, "the second lookup hits");
  eq(twice.value.output, "counted", "the hit returns the cached value");

  console.log(`PROOF PASS: identical reads run once, return identical output and record a hit (${passed} assertions)`);
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
