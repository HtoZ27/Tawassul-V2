import "./proof-log-isolate.ts";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceDigest } from "./source-digest.ts";

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

function readContentSha(text: string): string | undefined {
  return text.match(/TAWASSUL_CONTENT_SHA=([0-9a-f]{64})/)?.[1];
}

async function main(): Promise<void> {
  const build = spawnSync("npm", ["run", "build"], { cwd: REPO, encoding: "utf-8", timeout: 300_000 });
  if (build.status !== 0) {
    fail(`npm run build failed: ${build.stderr?.slice(-500) ?? ""}`);
  }
  assert(build.status === 0, "the bundle builds successfully");

  const digest = sourceDigest();
  assert(/^[0-9a-f]{64}$/.test(digest), "the source digest is a 64-character content hash");
  assert(sourceDigest() === digest, "the source digest is deterministic across calls");

  const globalPath = join(REPO, "dist", "global.js");
  const indexPath = join(REPO, "dist", "index.js");
  assert(existsSync(globalPath), "dist/global.js exists after the build");
  const globalDigest = readContentSha(readFileSync(globalPath, "utf8"));
  assert(globalDigest === digest, "dist/global.js carries the current content digest");
  assert(existsSync(indexPath), "dist/index.js exists after the build");
  const indexDigest = readContentSha(readFileSync(indexPath, "utf8"));
  assert(indexDigest === digest, "dist/index.js carries the current content digest");

  const target = join(REPO, ".opencode", "plugins", "tawassul.js");
  assert(existsSync(target), "the project bundle is written");
  const projectDigest = readContentSha(readFileSync(target, "utf8"));
  assert(projectDigest === digest, "the project bundle carries the current content digest");

  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf-8", timeout: 10_000 });
  const headSha = head.status === 0 ? (head.stdout ?? "").trim() : "";
  assert(headSha.length > 0, "a git HEAD is available for the independence check");
  assert(
    globalDigest !== headSha,
    "the content digest is not the commit id, so a commit cannot make a current bundle look stale",
  );
}

try {
  await main();
  console.log(`PROOF PASS: the bundle carries the current content digest (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
