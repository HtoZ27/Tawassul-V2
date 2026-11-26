import "./proof-log-isolate.ts";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TOOL_RANKING_SOURCE,
  rankToolRuns,
  type ToolRunEntry,
} from "../src/services/tool-run-log.ts";

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

function assertThrows(fn: () => unknown, pattern: RegExp, name: string): void {
  try {
    fn();
  } catch (e) {
    assert(pattern.test(e instanceof Error ? e.message : String(e)), name);
    return;
  }
  fail(name);
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

function entry(
  tool: string,
  sessionId: string,
  status: "success" | "error",
  turn: number,
  timestamp: number,
): ToolRunEntry {
  return {
    id: `tr-${tool}-${sessionId}-${turn}`,
    tool,
    agent: "dev",
    sessionId,
    argsHash: `${tool}-${turn}`,
    status,
    timestamp,
    turn,
  };
}

const fixture: ToolRunEntry[] = [
  entry("read", "s1", "success", 1, 1),
  entry("read", "s1", "error", 2, 2),
  entry("read", "s1", "success", 3, 3),
  entry("write", "s1", "error", 4, 4),
  entry("write", "s1", "error", 5, 5),
  entry("write", "s1", "success", 6, 6),
  entry("grep", "s2", "success", 1, 7),
  entry("bash", "s1", "error", 7, 8),
  entry("read", "s2", "error", 2, 9),
];
const snapshot = JSON.stringify(fixture);

assert(TOOL_RANKING_SOURCE === "tool-run-log", "the ranking source is tool-run-log");
assert(rankToolRuns([]).length === 0, "an empty log ranks no tools");

const rows = rankToolRuns(fixture);
assert(rows.length === 4, "the ranking keeps one row per tool");
assert(
  JSON.stringify(rows.map((row) => row.tool)) === JSON.stringify(["read", "write", "bash", "grep"]),
  "the hot table sorts by calls, then errors, then name",
);
const read = rows[0]!;
assert(read.calls === 4, "read counts every invocation");
assert(read.errors === 2, "read counts failed invocations");
assert(read.retries === 1, "read counts only a later same-session retry");
assert(read.lastTurn === 3, "read records the highest turn");
const write = rows[1]!;
assert(write.calls === 3, "write counts every invocation");
assert(write.errors === 2, "write counts failed invocations");
assert(write.retries === 2, "write counts each retry after a failure");
assert(write.lastTurn === 6, "write records the highest turn");
const bash = rows[2]!;
assert(bash.errors === 1 && bash.retries === 0, "a failure without a later run is not a retry");
const grep = rows[3]!;
assert(grep.calls === 1 && grep.errors === 0, "a clean single call ranks cold");
assert(rows.at(-1)?.tool === "grep", "the cold end is the last ranked tool");
assert(
  rankToolRuns(fixture).map((row) => row.tool).join(",") === rows.map((row) => row.tool).join(","),
  "the ranking is deterministic",
);
assert(JSON.stringify(fixture) === snapshot, "ranking never mutates the log entries");

assertThrows(
  () => rankToolRuns(fixture, "activity-metrics"),
  /unsupported tool ranking source: activity-metrics/,
  "activity-metrics is refused as a ranking source",
);
assertThrows(
  () => rankToolRuns(fixture, "tool-run-log-v2"),
  /unsupported tool ranking source: tool-run-log-v2/,
  "a third measurement source is refused",
);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((dirent) => {
    const path = join(dir, dirent.name);
    return dirent.isDirectory() ? walk(path) : dirent.name.endsWith(".ts") ? [path] : [];
  });
}

const sources = walk(join(repo, "src"));
const owners = sources.filter((file) => readFileSync(file, "utf8").includes("rankToolRuns"));
assert(
  JSON.stringify(owners.map((file) => relative(repo, file))) ===
    JSON.stringify(["src/services/tool-run-log.ts"]),
  "rankToolRuns is defined only in the tool-run log",
);
const activityOwners = sources.filter((file) =>
  readFileSync(file, "utf8").includes("getActivityMetrics"),
);
assert(
  JSON.stringify(activityOwners.map((file) => relative(repo, file))) ===
    JSON.stringify(["src/services/background-notifier.ts"]),
  "activity-metrics stays lifecycle telemetry and is never read for ranking",
);
const notifier = readFileSync(join(repo, "src", "services", "background-notifier.ts"), "utf8");
assert(!notifier.includes("rankToolRuns"), "the lifecycle notifier does not rank tools");
assert(notifier.includes("activity-metrics.json"), "the lifecycle notifier keeps its telemetry store");

console.log(`PROOF PASS: hot and cold tool ranking reads only the tool-run log (${passed} assertions)`);
