import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TawassulContext } from "../src/context.ts";
import type { ToolContext } from "../src/tool.ts";
import { buildProjectMapTool } from "../src/tools/project-map.ts";
import { buildAstQueryTool } from "../src/tools/ast-tools.ts";
import { ProjectIndexService } from "../src/services/project-index/index.ts";
import { projectRootFor, resolveProjectIdentity } from "../src/utils/project-identity.ts";

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
    sessionID: "ses_index_proof",
    messageID: "msg_index_proof",
    agent: "dev",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {},
  };
}

const work = mkdtempSync(join(tmpdir(), "tawassul-index-byproduct-"));

async function main(): Promise<void> {
  const project = join(work, "project");
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(
    join(project, "src", "a.ts"),
    "export function alpha() {\n  return 1;\n}\n\nexport class Beta {\n  value = 2;\n}\n",
  );
  writeFileSync(join(project, "src", "b.ts"), 'import { alpha } from "./a";\n\nexport const gamma = alpha();\n');

  process.env.TAWASSUL_PROJECT_INDEX = "1";
  const service = new ProjectIndexService({ baseDir: project, projectKey: "proof-key", enabled: true });
  const ctx = { projectIndex: service } as unknown as TawassulContext;
  const cctx = toolContext(project);

  eq(service.snapshot().stats.files, 0, "a fresh project starts with an empty index");
  const map = await buildProjectMapTool(ctx).execute({ depth: 5 } as never, cctx);
  assert(typeof map === "object" && "output" in map && map.output.includes("src"), "projectmap still renders the tree");
  const afterMap = service.snapshot();
  assert(Object.keys(afterMap.files).includes("src/a.ts"), "projectmap records the walked file");
  assert(Object.keys(afterMap.files).includes("src/b.ts"), "projectmap records every walked file");
  assert(Object.keys(afterMap.dirs).includes("."), "projectmap records the walk root");
  assert(Object.keys(afterMap.dirs).includes("src"), "projectmap records the walked directory");
  eq(afterMap.files["src/a.ts"]?.symbols.length, 0, "projectmap records stamps without parsing");
  eq(service.stats().parses, 0, "projectmap performs no parse");

  const query = await buildAstQueryTool(ctx).execute({ file: "src/a.ts" } as never, cctx);
  assert(typeof query === "object" && "output" in query && query.output.includes("alpha"), "astquery still renders symbols");
  const afterQuery = service.snapshot();
  const aRecord = afterQuery.files["src/a.ts"];
  assert(aRecord !== undefined, "astquery records the parsed file");
  eq(aRecord?.lang, "ts", "the record carries the language");
  assert((aRecord?.lines ?? 0) > 0, "the record carries the line count");
  assert((aRecord?.hash.length ?? 0) === 64, "the record carries the sha256 content hash");
  assert(aRecord?.symbols.some((symbol) => symbol.name === "alpha" && symbol.kind === "function") === true, "the record carries the function symbol");
  assert(aRecord?.symbols.some((symbol) => symbol.name === "Beta" && symbol.kind === "class") === true, "the record carries the class symbol");
  eq(service.stats().parses, 1, "the first astquery parses the file once");

  await buildAstQueryTool(ctx).execute({ file: "src/a.ts" } as never, cctx);
  eq(service.stats().parses, 1, "a second astquery does not re-parse an unchanged file");

  assert(existsSync(join(project, ".opencode", "project-index", "snapshot.json")), "the snapshot is written under .opencode/project-index");
  const persisted = JSON.parse(readFileSync(join(project, ".opencode", "project-index", "snapshot.json"), "utf8")) as {
    schemaVersion?: number;
    projectKey?: string;
    files?: Record<string, unknown>;
  };
  eq(persisted.schemaVersion, 1, "the persisted snapshot carries schema version 1");
  eq(persisted.projectKey, "proof-key", "the persisted snapshot carries the project key");
  assert(Object.keys(persisted.files ?? {}).includes("src/a.ts"), "the persisted snapshot carries the file record");

  const dirA = join(work, "worktree-a");
  const dirB = join(work, "worktree-b");
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });
  writeFileSync(join(dirA, "shared.ts"), "export const shared = 1;\n");
  process.env.XDG_DATA_HOME = join(work, "xdg");
  const identityA = resolveProjectIdentity({ directory: dirA, project: { id: "shared-project", directory: dirA } }, dirA);
  const identityB = resolveProjectIdentity({ directory: dirB, project: { id: "shared-project", directory: dirB } }, dirB);
  eq(identityA.key, identityB.key, "two working directories resolve the same host project key");
  const rootA = projectRootFor(identityA);
  const rootB = projectRootFor(identityB);
  assert(typeof rootA === "string" && rootA === rootB, "two working directories resolve the same project root");
  const sharedServiceA = new ProjectIndexService({ baseDir: rootA!, projectKey: identityA.key, enabled: true });
  await sharedServiceA.recordFile(join(dirA, "shared.ts"));
  const sharedServiceB = new ProjectIndexService({ baseDir: rootB!, projectKey: identityB.key, enabled: true });
  assert(sharedServiceB.snapshot().stats.files > 0, "the second working directory reads the same snapshot");
  eq(sharedServiceB.snapshot().revision, sharedServiceA.snapshot().revision, "both working directories share one revision");

  const offProject = join(work, "off");
  mkdirSync(offProject, { recursive: true });
  writeFileSync(join(offProject, "a.ts"), "export const off = 1;\n");
  const offService = new ProjectIndexService({ baseDir: offProject, projectKey: "off-key", enabled: false });
  const recorded = await offService.recordFile(join(offProject, "a.ts"));
  eq(recorded, null, "a disabled index records nothing");
  eq(offService.stats().parses, 0, "a disabled index performs no parse");
  assert(!existsSync(join(offProject, ".opencode", "project-index", "snapshot.json")), "a disabled index writes no snapshot");

  console.log(`PROOF PASS: projectmap and astquery feed one shared incremental project index (${passed} assertions)`);
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
  delete process.env.XDG_DATA_HOME;
  rmSync(work, { recursive: true, force: true });
}
