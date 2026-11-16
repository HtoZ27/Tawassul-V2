import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_COUNT, TOOL_NAME_SET_HASH } from "../src/generated/tool-tripwire.ts";
import { TOOL_COUNT_FLOOR, toolNameSetHash } from "../src/services/tool-tripwire.ts";
import { TAWASSUL_TOOL_NAMES } from "../src/tool-names.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const names = [...TAWASSUL_TOOL_NAMES];
const hash = toolNameSetHash(names);

assert(new Set(names).size === names.length, "tool names are unique");
assert(
  names.length === TOOL_COUNT,
  `the generated count matches the tool name list (${names.length}/${TOOL_COUNT})`,
);
assert(
  hash === TOOL_NAME_SET_HASH,
  `the generated hash matches the tool name list (${hash.slice(0, 12)}/${TOOL_NAME_SET_HASH.slice(0, 12)})`,
);

const json = JSON.parse(
  readFileSync(join(repo, "scripts", "tool-tripwire.json"), "utf8"),
) as { count?: number; hash?: string; floor?: number };
assert(json.count === TOOL_COUNT, "the tripwire JSON count matches the generated count");
assert(json.hash === TOOL_NAME_SET_HASH, "the tripwire JSON hash matches the generated hash");
assert(json.floor === TOOL_COUNT_FLOOR, "the tripwire JSON floor matches the shared floor");
assert(
  names.length >= TOOL_COUNT_FLOOR,
  `the tool surface is above the coarse floor (${names.length}/${TOOL_COUNT_FLOOR})`,
);
assert(names.length <= 200, `the tool surface is below the coarse ceiling (${names.length}/200)`);

const check = spawnSync(process.execPath, ["scripts/generate-tool-tripwire.ts", "--check"], {
  cwd: repo,
  encoding: "utf8",
});
assert(
  check.status === 0,
  `the generated tripwire files are current (${(check.stderr || check.stdout).trim()})`,
);

console.log(`PROOF PASS: the tool name-set tripwire is generated and current (${passed} assertions)`);
