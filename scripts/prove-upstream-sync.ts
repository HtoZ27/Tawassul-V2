import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareVersions,
  diffReleases,
  parseChangelog,
  validateRegistry,
  verdictCounts,
  type UpstreamRegistry,
} from "../src/upstream/changelog.ts";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(
  readFileSync(join(repo, "src", "upstream", "registry.json"), "utf8"),
) as UpstreamRegistry;

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

type MutableRelease = {
  version: unknown;
  date: unknown;
  auditedAt: unknown;
  hostContract: unknown;
  status: unknown;
  items: Array<Record<string, unknown>>;
};

type MutableRegistry = {
  source: unknown;
  auditedThrough: unknown;
  releases: MutableRelease[];
};

function mutable(): MutableRegistry {
  return structuredClone(registry) as unknown as MutableRegistry;
}

function expectProblem(document: unknown, needle: string, name: string): void {
  const problems = validateRegistry(document);
  assert(problems.some((problem) => problem.includes(needle)), name);
}

function fixture(): string {
  return [
    '<header><h2><a href="#v2-3-0">v2.3.0</a></h2><time datetime="2026-11-01">November 1, 2026</time></header>',
    '<header><h2><a href="#v2-2-0">v2.2.0</a></h2><time datetime="2026-10-27">October 27, 2026</time></header>',
    '<header><h2><a href="#v2-1-4">v2.1.4</a></h2><time datetime="2026-10-23">October 23, 2026</time></header>',
    '<header><h2><a href="#notes">Notes</a></h2><time datetime="2026-10-01">October 1, 2026</time></header>',
  ].join("\n");
}

const parsed = parseChangelog(fixture());
assert(parsed.length === 3, "parser returns only release headings");
assert(parsed[0]?.version === "2.3.0", "parser sorts the newest release first");
assert(parsed[2]?.version === "2.1.4", "parser keeps the oldest release last");
assert(parsed[0]?.date === "2026-11-01", "parser carries the release date");
assert(parseChangelog("").length === 0, "parser returns nothing for empty input");
assert(compareVersions("2.10.0", "2.9.9") > 0, "version comparison is numeric");
assert(compareVersions("2.2.0", "2.2.0") === 0, "equal versions compare at zero");

assert(validateRegistry(registry).length === 0, "the checked-in registry is valid");
assert(registry.source === "https://opencode.ai/changelog", "registry points at the changelog");
assert(registry.auditedThrough === registry.releases[0]?.version, "auditedThrough is the newest release");
assert(registry.releases[0]?.hostContract === "2.1.4", "the audited release records the built host contract");
assert(
  (registry.releases[0]?.items.length ?? 0) >= 20,
  "the audited release tracks at least 20 changes",
);
const counts = verdictCounts(registry);
const total = registry.releases.reduce((sum, release) => sum + release.items.length, 0);
assert(
  Object.values(counts).reduce((sum, value) => sum + value, 0) === total,
  "every item carries a counted verdict",
);
assert(counts.guarded >= 1, "the registry records at least one guarded change");
assert(counts.tracked >= 1, "the registry records at least one tracked change");
assert(counts.adopted >= 1, "the registry records at least one adopted change");

const newer = parseChangelog(fixture());
const drift = diffReleases(registry, newer);
assert(drift.unaudited.length === 1, "a newer release is reported as unaudited");
assert(drift.unaudited[0]?.version === "2.3.0", "the unaudited release is the new one");
assert(drift.unlisted.length === 0, "a full page lists every audited release");

const equal = diffReleases(registry, parseChangelog(fixture()).slice(1));
assert(equal.unaudited.length === 0, "an audited page has no unaudited release");
assert(equal.latest?.version === "2.2.0", "the drift report exposes the live latest release");

const older = diffReleases(registry, [
  { version: "2.2.0", date: "2026-10-27" },
  { version: "2.1.9", date: "2026-10-25" },
]);
assert(older.unaudited.length === 0, "releases below auditedThrough are not flagged");

const patchAbove = diffReleases(registry, [
  { version: "2.2.1", date: "2026-10-28" },
  { version: "2.2.0", date: "2026-10-27" },
]);
assert(patchAbove.unaudited[0]?.version === "2.2.1", "a patch release above the ceiling is flagged");

const pruned = diffReleases(registry, [{ version: "2.1.4", date: "2026-10-23" }]);
assert(pruned.unlisted.length === 1, "a pruned audited release is reported");
assert(pruned.latest?.version === "2.1.4", "a pruned page reports its own latest release");

const duplicateVersion = mutable();
const duplicated = duplicateVersion.releases[0]?.version;
if (duplicated) duplicateVersion.releases.push({ ...duplicateVersion.releases[0]!, version: duplicated });
expectProblem(duplicateVersion, "repeats", "a duplicate release version fails validation");

const outOfOrder = mutable();
const template = outOfOrder.releases[0];
if (template) {
  outOfOrder.releases = [
    { ...template, version: "2.1.0" },
    { ...template, version: "2.2.0" },
  ];
}
expectProblem(outOfOrder, "must sort below", "an ascending release list fails validation");

const badDay = mutable();
if (badDay.releases[0]) badDay.releases[0].date = "2026-02-31";
expectProblem(badDay, "valid day", "an impossible calendar day fails validation");

const auditBeforeRelease = mutable();
if (auditBeforeRelease.releases[0]) auditBeforeRelease.releases[0].auditedAt = "2026-10-01";
expectProblem(auditBeforeRelease, "precedes the release date", "an audit before the release fails validation");

const unknownVerdict = mutable();
const verdictItem = unknownVerdict.releases[0]?.items[0];
if (verdictItem) verdictItem.verdict = "banana";
expectProblem(unknownVerdict, "known verdict", "an unknown verdict fails validation");

const missingIssue = mutable();
const guardedItem = missingIssue.releases[0]?.items.find((item) => item.verdict === "guarded");
if (guardedItem) delete guardedItem.issue;
expectProblem(missingIssue, "required for verdict", "a guarded change needs an issue id");

const badIssue = mutable();
const adoptedItem = badIssue.releases[0]?.items.find((item) => item.verdict === "adopted");
if (adoptedItem) adoptedItem.issue = "issue-1";
expectProblem(badIssue, "not an issue id", "a malformed issue id fails validation");

const badTopic = mutable();
const topicItem = badTopic.releases[0]?.items[0];
if (topicItem) topicItem.topic = "Not A Slug";
expectProblem(badTopic, "lowercase slug", "a malformed topic fails validation");

const duplicateTopic = mutable();
const topicSource = duplicateTopic.releases[0]?.items[0]?.topic;
const topicTarget = duplicateTopic.releases[0]?.items[1];
if (topicSource && topicTarget) topicTarget.topic = topicSource;
expectProblem(duplicateTopic, "repeats", "a duplicate topic fails validation");

const duplicatePr = mutable();
const prSource = duplicatePr.releases[0]?.items[0]?.pr;
const prTarget = duplicatePr.releases[0]?.items[1];
if (typeof prSource === "number" && prTarget) prTarget.pr = prSource;
expectProblem(duplicatePr, "repeats", "a duplicate pull request fails validation");

const shortNote = mutable();
const noteItem = shortNote.releases[0]?.items[0];
if (noteItem) noteItem.note = "short";
expectProblem(shortNote, "shorter than 8", "a short note fails validation");

const emptyItems = mutable();
if (emptyItems.releases[0]) emptyItems.releases[0].items = [];
expectProblem(emptyItems, "non-empty array", "a release with no items fails validation");

const staleCeiling = mutable();
staleCeiling.auditedThrough = "2.1.4";
expectProblem(staleCeiling, "not the newest release", "a stale auditedThrough fails validation");

const wrongSource = mutable();
wrongSource.source = "https://example.com/changelog";
expectProblem(wrongSource, "source must be", "a foreign source fails validation");

const notAnObject = validateRegistry(["2.2.0"]);
assert(notAnObject.length === 1, "a non-object registry fails validation");

console.log(`PROOF PASS: the upstream registry validates and detects drift (${passed} assertions)`);
