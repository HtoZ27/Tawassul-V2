import "./proof-log-isolate.ts";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "tawassul-snapshot-"));
const gitHome = join(work, "git-repo");
const cacheRoot = join(work, "cache");
const runner = join(work, "runner.ts");

function git(args: string[], cwd: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) fail(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function writeRunner(): void {
  writeFileSync(
    runner,
    [
      `import { maybeAutoCapture } from ${JSON.stringify(join(repo, "src", "services", "code-state-auto.ts"))};`,
      "const tool = process.argv[2] ?? \"edit\";",
      "const ok = process.argv[3] === \"success\";",
      "const mode = process.argv[4] ?? \"single\";",
      "await maybeAutoCapture(tool, ok);",
      "if (mode === \"double\") {",
      "  await new Promise((resolve) => setTimeout(resolve, 100));",
      "  await maybeAutoCapture(\"write\", true);",
      "}",
      "await new Promise((resolve) => setTimeout(resolve, 900));",
      "",
    ].join("\n"),
  );
}

function logPathFor(root: string, cache: string): string {
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join(cache, "tawassul-v2", "code-state", hash, "log.json");
}

function snapshots(cache: string, root: string): Array<{ label: string }> {
  const path = logPathFor(root, cache);
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as { snapshots?: Array<{ label: string }> };
    return data.snapshots ?? [];
  } catch {
    return [];
  }
}

function runCase(name: string, env: Record<string, string>, tool: string, success: boolean, mode = "single"): Array<{ label: string }> {
  const cache = join(cacheRoot, name);
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(gitHome, "a.txt"), `${name}\n`);
  const result = spawnSync("bun", [runner, tool, success ? "success" : "failure", mode], {
    cwd: gitHome,
    encoding: "utf-8",
    env: { ...process.env, TAWASSUL_CACHE_DIR: cache, ...env },
  });
  if (result.status !== 0) fail(`${name} runner exited ${result.status}: ${result.stderr}`);
  return snapshots(cache, realpathSync(gitHome));
}

try {
  mkdirSync(gitHome, { recursive: true });
  git(["init", "-q"], gitHome);
  git(["config", "user.email", "proof@example.test"], gitHome);
  git(["config", "user.name", "proof"], gitHome);
  writeFileSync(join(gitHome, "a.txt"), "base\n");
  git(["add", "a.txt"], gitHome);
  git(["commit", "-q", "-m", "base"], gitHome);
  writeRunner();

  const unset = runCase("unset", {}, "edit", true);
  assert(unset.length === 0, "auto capture is off when the switch is unset");
  const zero = runCase("zero", { TAWASSUL_CODE_STATE_AUTO: "0" }, "edit", true);
  assert(zero.length === 0, "only the literal 1 enables auto capture");
  const readOnly = runCase("read", { TAWASSUL_CODE_STATE_AUTO: "1" }, "read", true);
  assert(readOnly.length === 0, "a non-mutating tool captures nothing");
  const failed = runCase("failed", { TAWASSUL_CODE_STATE_AUTO: "1" }, "edit", false);
  assert(failed.length === 0, "a failed run captures nothing");
  const single = runCase("single", { TAWASSUL_CODE_STATE_AUTO: "1" }, "edit", true);
  assert(single.length === 1, "an enabled successful mutation captures once");
  assert(single[0]?.label === "auto:edit", "the capture is labelled with the mutating tool");
  const double = runCase("double", { TAWASSUL_CODE_STATE_AUTO: "1" }, "edit", true, "double");
  assert(double.length === 1, "two mutations inside the debounce window collapse to one capture");
  assert(double[0]?.label === "auto:write", "the collapsed capture carries the last tool");

  console.log(`PROOF PASS: auto capture stays behind one opt-in and never double-captures (${passed} assertions)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
