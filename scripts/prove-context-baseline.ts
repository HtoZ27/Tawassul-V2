import "./proof-log-isolate.ts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_COUNT, TOOL_NAME_SET_HASH } from "../src/generated/tool-tripwire.ts";
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

type Line = { name: string; bytes: number; estimatedTokens: number };

type Baseline = {
  date: string;
  commit: string;
  method: string;
  toolCount: number;
  toolNameSetHash: string;
  schemaPayload: { bytes: number; estimatedTokens: number };
  descriptionText: { bytes: number; estimatedTokens: number; lines: Line[] };
  concordance: { bytes: number; lines: number; estimatedTokens: number };
  sessionDigest: { composition: string[]; emptyStateBytes: number; note: string };
  i18n: { file: string; bytes: number; contextWeightBytes: number; note: string };
  registeredSkills: {
    count: number;
    lines: Line[];
    totalBytes: number;
    estimatedTokens: number;
    note: string;
  };
};

function tokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

function sumBytes(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + line.bytes, 0);
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(repo, "docs", "experiments", "baselines");
const readmePath = join(dir, "README.md");

assert(existsSync(dir), "the baselines directory exists");
assert(existsSync(readmePath), "the baselines directory documents its convention");
const readme = readFileSync(readmePath, "utf8");
assert(readme.includes("YYYY-MM-DD-context-baseline.json"), "the convention names the dated artifact pattern");
assert(/read-only/i.test(readme), "the convention records the read-only rule");
assert(readme.includes("--force"), "the convention names the draft-only overwrite switch");

const pattern = /^(\d{4}-\d{2}-\d{2})-context-baseline\.json$/;
const artifacts = readdirSync(dir)
  .filter((file) => pattern.test(file))
  .sort();
assert(artifacts.length >= 1, `at least one dated artifact exists (${artifacts.length})`);
assert(
  new Set(artifacts.map((file) => file.slice(0, 10))).size === artifacts.length,
  "each measurement date has exactly one artifact",
);

const latest = artifacts.at(-1) as string;
const fileDate = latest.slice(0, 10);
const baseline = JSON.parse(readFileSync(join(dir, latest), "utf8")) as Baseline;

assert(baseline.date === fileDate, `the artifact date matches its filename (${baseline.date})`);
assert(
  new Date(`${baseline.date}T00:00:00Z`).toISOString().slice(0, 10) === baseline.date,
  "the artifact date is a real calendar date",
);
assert(/^[0-9a-f]{40}$/.test(baseline.commit), "the artifact records the measured commit");
assert(typeof baseline.method === "string" && baseline.method.length > 0, "the artifact records its method");
assert(
  baseline.toolCount === TOOL_COUNT,
  `the artifact measures the generated tool count (${baseline.toolCount}/${TOOL_COUNT})`,
);
assert(
  baseline.toolNameSetHash === TOOL_NAME_SET_HASH,
  `the artifact measures the generated name set (${baseline.toolNameSetHash.slice(0, 12)}/${TOOL_NAME_SET_HASH.slice(0, 12)})`,
);

assert(baseline.schemaPayload.bytes > 0, `the schema payload is measured in bytes (${baseline.schemaPayload.bytes})`);
assert(
  baseline.schemaPayload.bytes > 5000,
  `the schema payload is above the placeholder-era floor (${baseline.schemaPayload.bytes})`,
);
assert(
  baseline.schemaPayload.estimatedTokens === tokens(baseline.schemaPayload.bytes),
  "the schema payload token estimate follows the recorded bytes",
);

const description = baseline.descriptionText;
assert(description.bytes > 0, `the description text is measured in bytes (${description.bytes})`);
assert(
  description.bytes > 10000,
  `the description text is above the placeholder-era floor (${description.bytes})`,
);
assert(
  description.lines.length === baseline.toolCount,
  `the description text carries one line per tool (${description.lines.length}/${baseline.toolCount})`,
);
assert(
  new Set(description.lines.map((line) => line.name)).size === description.lines.length,
  "every description line names a distinct tool",
);
assert(
  JSON.stringify(description.lines.map((line) => line.name)) ===
    JSON.stringify([...TAWASSUL_TOOL_NAMES].sort()),
  "the description lines cover the advertised tool names",
);
assert(
  description.bytes === sumBytes(description.lines),
  `the description total matches its lines (${description.bytes}/${sumBytes(description.lines)})`,
);
assert(
  description.estimatedTokens === tokens(description.bytes),
  "the description token estimate follows the recorded bytes",
);
assert(
  description.lines.every((line) => line.estimatedTokens === tokens(line.bytes)),
  "every description line carries its own token estimate",
);

assert(baseline.concordance.bytes > 0, `the concordance is measured in bytes (${baseline.concordance.bytes})`);
assert(baseline.concordance.lines > 0, "the concordance records its line count");
assert(
  baseline.concordance.estimatedTokens === tokens(baseline.concordance.bytes),
  "the concordance token estimate follows the recorded bytes",
);

assert(
  Array.isArray(baseline.sessionDigest.composition) && baseline.sessionDigest.composition.length > 0,
  "the artifact records the session digest composition",
);
assert(
  Number.isFinite(baseline.sessionDigest.emptyStateBytes) && baseline.sessionDigest.emptyStateBytes >= 0,
  "the artifact records the empty-state digest floor",
);

assert(baseline.i18n.file === "src/i18n/en.json", "the artifact names the i18n file");
assert(baseline.i18n.bytes > 0, `the artifact records the i18n bundle weight (${baseline.i18n.bytes} bytes)`);
assert(baseline.i18n.contextWeightBytes === 0, "i18n carries no context weight");
const liveI18nBytes = readFileSync(join(repo, "src", "i18n", "en.json")).byteLength;
if (liveI18nBytes !== baseline.i18n.bytes) {
  console.log(
    `INFO  i18n bundle drifted ${liveI18nBytes - baseline.i18n.bytes} bytes since ${latest}; the artifact stays a dated measurement, not a live pin`,
  );
}

const skills = baseline.registeredSkills;
assert(skills.count === skills.lines.length, "the skill count matches the per-skill lines");
assert(skills.totalBytes === sumBytes(skills.lines), "the skill total matches its lines");
assert(skills.estimatedTokens === tokens(skills.totalBytes), "the skill token estimate follows the recorded bytes");
assert(
  skills.lines.every((line) => line.estimatedTokens === tokens(line.bytes)),
  "every skill line carries its own token estimate",
);
assert(typeof skills.note === "string" && skills.note.length > 0, "the skill measurement records its scope");

const writer = readFileSync(join(repo, "scripts", "measure-context-baseline.ts"), "utf8");
assert(writer.includes("baselines are immutable"), "the writer refuses to overwrite a dated artifact");
assert(writer.includes('process.argv.includes("--force")'), "the writer gates overwrites behind --force");
assert(writer.includes("chmodSync(outPath, 0o444)"), "the writer marks the artifact read-only");

console.log(`PROOF PASS: the newest context baseline (${latest}) matches the generated tool surface and its method (${passed} assertions)`);
