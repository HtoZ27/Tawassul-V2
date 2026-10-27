import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

function gitHead(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf-8", timeout: 10_000 });
  if (result.status !== 0) fail(`git rev-parse failed: ${result.stderr ?? ""}`);
  return (result.stdout ?? "").trim();
}

function readSourceSha(text: string): string | undefined {
  return text.match(/TAWASSUL_SOURCE_SHA=([0-9a-f]{7,40})/)?.[1];
}

async function main(): Promise<void> {
  const build = spawnSync("npm", ["run", "build"], { cwd: REPO, encoding: "utf-8", timeout: 300_000 });
  if (build.status !== 0) {
    fail(`npm run build failed: ${build.stderr?.slice(-500) ?? ""}`);
  }
  assert(build.status === 0, "the bundle builds successfully");

  const head = gitHead();
  const globalPath = join(REPO, "dist", "global.js");
  const indexPath = join(REPO, "dist", "index.js");
  assert(existsSync(globalPath), "dist/global.js exists after the build");
  const globalSha = readSourceSha(readFileSync(globalPath, "utf8"));
  assert(globalSha === head, "dist/global.js carries the current source SHA");
  assert(existsSync(indexPath), "dist/index.js exists after the build");
  const indexSha = readSourceSha(readFileSync(indexPath, "utf8"));
  assert(indexSha === head, "dist/index.js carries the current source SHA");

  const target = join(REPO, ".opencode", "plugin", "tawassul.js");
  assert(existsSync(target), "the project bundle is written");
  const projectSha = readSourceSha(readFileSync(target, "utf8"));
  assert(projectSha === head, "the project bundle carries the current source SHA");
}

try {
  await main();
  console.log(`PROOF PASS: the bundle carries the current source SHA (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
