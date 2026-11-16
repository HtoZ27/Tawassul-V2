import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectIndexService } from "../src/services/project-index/index.ts";
import { TaskContextService } from "../src/services/task-context/index.ts";

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

const work = mkdtempSync(join(tmpdir(), "tawassul-task-context-distinct-"));

async function main(): Promise<void> {
  const project = join(work, "project");
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "src", "a.ts"), "export function alpha() {\n  return 1;\n}\n");
  writeFileSync(join(project, "src", "b.ts"), 'import { alpha } from "./a";\nexport const beta = alpha();\n');
  writeFileSync(join(project, "src", "c.ts"), "export function gamma() {\n  return 3;\n}\n");

  const index = new ProjectIndexService({ baseDir: project, projectKey: "distinct-key", projectRoot: project, enabled: true });
  for (const file of ["a.ts", "b.ts", "c.ts"]) {
    await index.recordFile(join(project, "src", file));
  }
  const taskContext = new TaskContextService({ projectIndex: index, projectRoot: project });

  const bundleA = taskContext.build({
    taskId: "task-alpha",
    task: "Update alpha in src/a.ts",
    declaredFiles: ["src/a.ts"],
  });
  const bundleB = taskContext.build({
    taskId: "task-gamma",
    task: "Update gamma in src/c.ts",
    declaredFiles: ["src/c.ts"],
  });
  assert(bundleA !== null && bundleB !== null, "both tasks produce a bundle");
  if (!bundleA || !bundleB) return;

  eq(bundleA.taskId, "task-alpha", "the first bundle carries its task id");
  eq(bundleB.taskId, "task-gamma", "the second bundle carries its task id");
  assert(bundleA.taskId !== bundleB.taskId, "the two bundles carry different task ids");
  assert(bundleA.task !== bundleB.task, "the two bundles carry different task text");
  assert(bundleA.items !== bundleB.items, "the two bundles never share the items array");
  eq(
    bundleA.items.every((item) => !bundleB.items.includes(item)),
    true,
    "the two bundles never share an item object",
  );

  const pathsA = bundleA.items.filter((item) => item.kind === "file").map((item) => item.path);
  const pathsB = bundleB.items.filter((item) => item.kind === "file").map((item) => item.path);
  eq(pathsA[0], "src/a.ts", "the first bundle ranks the alpha file first");
  eq(pathsB[0], "src/c.ts", "the second bundle ranks the gamma file first");
  assert(JSON.stringify(pathsA) !== JSON.stringify(pathsB), "the two bundles rank their files differently");
  assert(
    JSON.stringify(bundleA.items.map((item) => item.kind)) !== JSON.stringify(bundleB.items.map((item) => item.kind)) ||
      JSON.stringify(pathsA) !== JSON.stringify(pathsB),
    "the two bundles carry different item sets",
  );
  eq(
    bundleA.items.every((item) => item.reason.trim().length > 0) &&
      bundleB.items.every((item) => item.reason.trim().length > 0),
    true,
    "every item in both bundles carries a reason",
  );

  const textA = taskContext.render(bundleA);
  const textB = taskContext.render(bundleB);
  assert(textA !== textB, "the two tasks produce different bundle text");
  assert(!textB.includes(bundleA.taskId) && !textA.includes(bundleB.taskId), "no bundle leaks into the other task");

  const repeatA = taskContext.build({
    taskId: "task-alpha",
    task: "Update alpha in src/a.ts",
    declaredFiles: ["src/a.ts"],
  });
  assert(repeatA !== null, "the first task rebuilds");
  if (!repeatA) return;
  assert(repeatA.items !== bundleA.items, "a rebuild allocates its own items array");
  eq(taskContext.render(repeatA), textA, "the same task rebuilds the same bundle text");

  unlinkSync(join(project, "src", "a.ts"));
  const afterDelete = taskContext.build({
    taskId: "task-alpha",
    task: "Update alpha in src/a.ts",
    declaredFiles: ["src/a.ts"],
  });
  assert(afterDelete !== null, "the bundle still builds after the file is deleted");
  if (!afterDelete) return;
  const deletedPaths = afterDelete.items.filter((item) => item.kind === "file").map((item) => item.path);
  assert(!deletedPaths.includes("src/a.ts"), "the deleted file leaves the items");
  assert(afterDelete.missing.includes("src/a.ts"), "the deleted file moves to missing");
  eq(bundleA.missing.includes("src/a.ts"), false, "the file was present in the first bundle");
  assert(!taskContext.render(afterDelete).includes("- file src/a.ts"), "the rendered bundle no longer lists the deleted file");
  assert(taskContext.render(afterDelete).includes("missing: src/a.ts"), "the rendered bundle lists the deleted file as missing");

  console.log(`PROOF PASS: different tasks keep different bundles and a deleted file moves to missing (${passed} assertions)`);
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
