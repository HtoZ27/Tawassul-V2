import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = join(repo, "scripts", "prove-pilot-eval.ts");

const started = Date.now();
const result = spawnSync("bun", [fixture], { cwd: repo, encoding: "utf-8" });
const elapsed = Date.now() - started;
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

if (result.status !== 0) {
  process.stderr.write(output);
  console.error(`EVAL FAIL: the pilot fixture exited ${result.status ?? result.signal ?? "unknown"}`);
  process.exit(1);
}

const marker = output.match(/PROOF PASS: the pilot procedures replay and their load rate is recorded \((\d+) assertions\)/);
if (!marker) {
  process.stderr.write(output);
  console.error("EVAL FAIL: the pilot fixture did not report its assertion count");
  process.exit(1);
}

const assertions = Number.parseInt(marker[1] ?? "0", 10);
if (!Number.isFinite(assertions) || assertions < 60) {
  console.error(`EVAL FAIL: the pilot fixture reported ${assertions} assertions, expected at least 60`);
  process.exit(1);
}

console.log(`EVAL PASS: pilot fixture, ${assertions} assertions, ${elapsed}ms`);
