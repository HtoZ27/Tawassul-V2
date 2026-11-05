import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TawassulContext } from "../src/context.ts";
import type { ToolContext } from "../src/tool.ts";
import { ReadCacheService } from "../src/services/read-cache/index.ts";
import { NEVER_CACHED, evaluatePolicy, isCacheableTool } from "../src/services/read-cache/policy.ts";
import type { FileStamp } from "../src/services/project-index/types.ts";
import { buildBatchReadTool, buildSmartGrepTool } from "../src/tools/search-and-diff.ts";

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
    sessionID: "ses_read_cache_bypass",
    messageID: "msg_read_cache_bypass",
    agent: "dev",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {},
  };
}

function stampAt(index: number): FileStamp {
  return { path: `/tmp/never-cached-${index}.ts`, mtimeMs: index, size: index };
}

const work = mkdtempSync(join(tmpdir(), "tawassul-read-cache-bypass-"));

async function main(): Promise<void> {
  const project = join(work, "project");
  mkdirSync(join(project, "sub"), { recursive: true });
  writeFileSync(join(project, "a.ts"), "export const a = 1;\n");
  writeFileSync(join(project, "sub", "b.ts"), "export const b = 2;\n");

  const cache = new ReadCacheService({ projectKey: "bypass-key", enabled: true });
  const ctx = { readCache: cache } as unknown as TawassulContext;
  const cctx = toolContext(project);

  const batch = buildBatchReadTool(ctx);
  const small = await batch.execute({ paths: ["a.ts", "sub/b.ts"] } as never, cctx);
  assert(typeof small === "object" && "output" in small, "a two-path batchread still returns output");
  const afterSmall = cache.stats();
  eq(afterSmall.entries, 1, "a two-path batchread stores one entry");
  assert(afterSmall.bytes > 0, "the stored batchread entry carries bytes");

  const many = Array.from({ length: 51 }, (_, i) => `f${i}.ts`);
  await batch.execute({ paths: many } as never, cctx);
  const afterMany = cache.stats();
  eq(afterMany.entries, afterSmall.entries, "a 51-path batchread stores nothing");
  eq(afterMany.bytes, afterSmall.bytes, "a 51-path batchread adds no bytes");
  eq(afterMany.bypasses, afterSmall.bypasses, "the refused call never reaches the cache service");

  const grep = buildSmartGrepTool(ctx);
  await grep.execute({ pattern: "export", path: "." } as never, cctx);
  const afterGrep = cache.stats();
  eq(afterGrep.entries, afterSmall.entries, "smartgrep stores no entry");
  eq(afterGrep.bytes, afterSmall.bytes, "smartgrep adds no bytes");
  eq(afterGrep.hits, afterSmall.hits, "smartgrep records no hit");
  eq(afterGrep.misses, afterSmall.misses, "smartgrep records no miss");

  assert(isCacheableTool("depmap"), "depmap is a cacheable tool");
  assert(isCacheableTool("batchread"), "batchread is a cacheable tool");
  assert(!isCacheableTool("smartgrep"), "smartgrep is not a cacheable tool");
  assert(!isCacheableTool("projectmap"), "projectmap is not a cacheable tool");
  assert(NEVER_CACHED.has("smartgrep") && NEVER_CACHED.has("read") && NEVER_CACHED.has("bash"), "the never-cached list keeps its members");

  const wide51 = evaluatePolicy({
    tool: "batchread",
    args: {},
    projectKey: "k",
    files: Array.from({ length: 51 }, (_, i) => stampAt(i)),
    dirs: [],
    enabled: true,
  });
  eq(wide51.cacheable, false, "a 51-stamp batchread key bypasses the cache");

  const wide257 = evaluatePolicy({
    tool: "depmap",
    args: {},
    projectKey: "k",
    files: Array.from({ length: 257 }, (_, i) => stampAt(i)),
    dirs: [],
    enabled: true,
  });
  eq(wide257.cacheable, false, "a key above the stamped-path cap bypasses the cache");

  const disabled = evaluatePolicy({
    tool: "depmap",
    args: {},
    projectKey: "k",
    files: [stampAt(0)],
    dirs: [],
    enabled: false,
  });
  eq(disabled.cacheable, false, "a disabled cache bypasses every key");

  const allowed = evaluatePolicy({
    tool: "depmap",
    args: { dir: project, depth: 3 },
    projectKey: "k",
    files: [stampAt(0)],
    dirs: [],
    enabled: true,
  });
  eq(allowed.cacheable, true, "a small depmap key stays cacheable");

  console.log(`PROOF PASS: refused and never-cached reads write nothing to the cache (${passed} assertions)`);
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
