import "./proof-log-isolate.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const critical = ["src/services/persist-utils.ts", "src/utils/atomic.ts"];
const emptyCatch = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;

for (const rel of critical) {
  const source = readFileSync(join(repo, rel), "utf-8");
  const matches = source.match(emptyCatch) ?? [];
  assert(matches.length === 0, `${rel} has no empty catch block`);
}

const persist = readFileSync(join(repo, "src/services/persist-utils.ts"), "utf-8");
assert(
  persist.includes("rejected state could not be preserved"),
  "rejected-state preservation failure is loud",
);
assert(persist.includes("M-2: rejected state preserved"), "rejected-state preservation still quarantines");

const atomic = readFileSync(join(repo, "src/utils/atomic.ts"), "utf-8");
assert(atomic.includes("backup requested but not created"), "backup creation failure is loud");
assert(atomic.includes("backup prune skipped"), "backup prune failure is observable");
assert(atomic.includes("mode read skipped") && atomic.includes("mode restore skipped"), "mode failures are observable");

console.log("PROOF PASS: state-critical catches never swallow a data-loss path");
