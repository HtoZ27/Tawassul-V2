import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectIndexService } from "../src/services/project-index/index.ts";
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

type Stamps = { files: FileStamp[]; dirs: DirStamp[] };

function walk(dir: string, stamps: Stamps): void {
  const root = statSync(dir);
  stamps.dirs.push({ path: dir, mtimeMs: root.mtimeMs });
  for (const name of readdirSync(dir)) {
    if (name === ".opencode" || name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    const entry = statSync(full);
    if (entry.isDirectory()) walk(full, stamps);
    else stamps.files.push({ path: full, mtimeMs: entry.mtimeMs, size: entry.size });
  }
}

const work = mkdtempSync(join(tmpdir(), "tawassul-index-incremental-"));

async function main(): Promise<void> {
  const project = join(work, "project");
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "src", "a.ts"), "export function alpha() {\n  return 1;\n}\n");
  writeFileSync(join(project, "src", "b.ts"), 'import { alpha } from "./a";\n\nexport const beta = alpha();\n');

  process.env.TAWASSUL_PROJECT_INDEX = "1";
  const service = new ProjectIndexService({ baseDir: project, projectKey: "incremental-key", enabled: true });

  await service.recordFile(join(project, "src", "a.ts"));
  await service.recordFile(join(project, "src", "b.ts"));
  eq(service.stats().parses, 2, "the first pass parses both files");
  const bStamp = service.snapshot().files["src/b.ts"]?.stamp;
  assert(bStamp !== undefined, "the b record carries a stamp");
  assert(service.dependents("src/a.ts").includes("src/b.ts"), "b is recorded as a dependent of a");
  eq(service.snapshot().files["src/b.ts"]?.imports[0]?.to, "src/a.ts", "the import edge resolves to the relative target");

  await service.recordFile(join(project, "src", "a.ts"));
  eq(service.stats().parses, 2, "re-recording an unchanged file parses nothing");
  eq(service.snapshot().files["src/b.ts"]?.stamp.mtimeMs, bStamp?.mtimeMs, "the b mtime is unchanged");
  eq(service.snapshot().files["src/b.ts"]?.stamp.size, bStamp?.size, "the b size is unchanged");

  writeFileSync(join(project, "src", "a.ts"), "export function alphaTwo() {\n  return 2;\n}\n");
  const future = new Date(Date.now() + 5000);
  utimesSync(join(project, "src", "a.ts"), future, future);
  await service.recordFile(join(project, "src", "a.ts"));
  eq(service.stats().parses, 3, "changing one file parses only that file");
  assert(
    service.snapshot().files["src/a.ts"]?.symbols.some((symbol) => symbol.name === "alphaTwo") === true,
    "the changed file gets its new symbol",
  );
  eq(service.snapshot().files["src/b.ts"]?.stamp.mtimeMs, bStamp?.mtimeMs, "an unrelated record keeps its mtime");
  eq(service.snapshot().files["src/b.ts"]?.stamp.size, bStamp?.size, "an unrelated record keeps its size");

  writeFileSync(join(project, "src", "c.ts"), "export const gamma = 3;\n");
  const stamps: Stamps = { files: [], dirs: [] };
  walk(project, stamps);
  const treeChanged = await service.recordTree(stamps.files, stamps.dirs);
  assert(treeChanged, "a re-walk records the new file");
  assert(Object.keys(service.snapshot().files).includes("src/c.ts"), "the new file appears after its parent directory is re-walked");
  eq(service.snapshot().files["src/b.ts"]?.stamp.mtimeMs, bStamp?.mtimeMs, "the re-walk keeps the unchanged b record");

  const unchanged = await service.recordTree(stamps.files, stamps.dirs);
  eq(unchanged, false, "a second identical walk writes nothing");

  writeFileSync(join(project, "d.ts"), 'import { alphaTwo } from "./src/a";\n');
  const importChanged = service.recordImports(join(project, "d.ts"), [
    { from: join(project, "d.ts"), specifier: "./src/a", to: join(project, "src", "a.ts") },
  ]);
  assert(importChanged, "recordImports updates the reverse index");
  assert(service.dependents("src/a.ts").includes("d.ts"), "the direct import is a dependent");
  assert(service.dependentsClosure("src/a.ts").includes("src/b.ts"), "the closure includes the transitive dependent");
  eq(service.snapshot().reverse["src/a.ts"]?.length, 2, "the reverse index has both importers");
  assert(service.filesByLang("ts").includes("d.ts"), "filesByLang returns the recorded TypeScript files");

  console.log(`PROOF PASS: the index is incremental, stamp-stable and reverse-linked (${passed} assertions)`);
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
