import "./proof-log-isolate.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ProjectIndexService } from "../src/services/project-index/index.ts";
import { snapshotPath } from "../src/services/project-index/store.ts";

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

const work = mkdtempSync(join(tmpdir(), "tawassul-index-corrupt-"));

async function main(): Promise<void> {
  const project = join(work, "project");
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "src", "a.ts"), "export function alpha() {\n  return 1;\n}\n");

  process.env.TAWASSUL_PROJECT_INDEX = "1";
  const file = snapshotPath(project);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "{ this is not json");

  const service = new ProjectIndexService({ baseDir: project, projectKey: "corrupt-key", enabled: true });
  eq(service.snapshot().stats.files, 0, "a corrupt snapshot loads as an empty index");
  eq(service.snapshot().stats.symbols, 0, "the empty index has no symbols");
  const record = await service.recordFile(join(project, "src", "a.ts"));
  assert(record !== null, "the tool path still records a file after corruption");
  const replaced = JSON.parse(readFileSync(file, "utf8")) as { projectKey?: string; files?: Record<string, unknown> };
  eq(replaced.projectKey, "corrupt-key", "the next write replaces the corrupt snapshot");
  assert(Object.keys(replaced.files ?? {}).includes("src/a.ts"), "the replacement carries the new record");

  writeFileSync(
    file,
    JSON.stringify({ schemaVersion: 1, projectKey: "another-project", files: { "x.ts": {} }, dirs: {}, reverse: {} }),
  );
  const foreign = new ProjectIndexService({ baseDir: project, projectKey: "corrupt-key", enabled: true });
  eq(foreign.snapshot().stats.files, 0, "a snapshot from another project key loads as empty");
  await foreign.recordFile(join(project, "src", "a.ts"));
  const rewritten = JSON.parse(readFileSync(file, "utf8")) as { projectKey?: string };
  eq(rewritten.projectKey, "corrupt-key", "the foreign snapshot is replaced with the current key");

  writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 1,
      projectKey: "corrupt-key",
      files: { "src/a.ts": "bogus", "src/z.ts": { stamp: { path: "src/z.ts" } } },
      dirs: { "src": "bogus" },
      reverse: { "src/a.ts": "bogus" },
    }),
  );
  const partial = new ProjectIndexService({ baseDir: project, projectKey: "corrupt-key", enabled: true });
  eq(partial.snapshot().stats.files, 0, "malformed records are dropped instead of failing the load");
  const recovered = await partial.recordFile(join(project, "src", "a.ts"));
  assert(recovered !== null, "a partially corrupt snapshot still records files");
  eq(partial.snapshot().stats.files, 1, "the recovered index holds exactly the valid record");

  writeFileSync(file, "");
  const empty = new ProjectIndexService({ baseDir: project, projectKey: "corrupt-key", enabled: true });
  eq(empty.snapshot().stats.files, 0, "an empty snapshot file loads as an empty index");
  const treeChanged = await empty.recordTree(
    [{ path: join(project, "src", "a.ts"), mtimeMs: 1, size: 10 }],
    [{ path: join(project, "src"), mtimeMs: 2 }],
  );
  eq(treeChanged, true, "recordTree works after an empty snapshot");
  assert(existsSync(file), "the snapshot exists again after the recovery write");

  console.log(`PROOF PASS: a corrupt or foreign snapshot degrades to empty and is replaced on the next write (${passed} assertions)`);
}

try {
  await main();
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  delete process.env.TAWASSUL_PROJECT_INDEX;
  rmSync(work, { recursive: true, force: true });
}
