import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RELEASES_URL,
  compareVersions,
  diffReleases,
  mergeEntries,
  parseChangelog,
  parseFeed,
  parseReleaseFeed,
  releaseNotesUrl,
  validateRegistry,
  verdictCounts,
  type UpstreamRegistry,
} from "../src/upstream/changelog.ts";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(
  readFileSync(join(repo, "src", "upstream", "registry.json"), "utf8"),
) as UpstreamRegistry;
const installed = JSON.parse(
  readFileSync(join(repo, "node_modules", "@opencode", "plugin", "package.json"), "utf8"),
) as { version?: string };

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
  notesUrl?: unknown;
  status: unknown;
  items: Array<Record<string, unknown>>;
};

type MutableRegistry = {
  source: unknown;
  releasesUrl?: unknown;
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
  const entries = [
    { version: "2.3.1", date: "2026-11-14" },
    ...registry.releases.map(({ version, date }) => ({ version, date })),
    { version: "2.1.4", date: "2026-10-23" },
  ];
  return [
    ...entries.map(({ version, date }) => {
      const id = version.replace(/\./g, "-");
      return `<header><h2><a href="#v${id}">v${version}</a></h2><time datetime="${date}">${date}</time></header>`;
    }),
    '<header><h2><a href="#notes">Notes</a></h2><time datetime="2026-10-01">October 1, 2026</time></header>',
  ].join("\n");
}

function feed(): string {
  return [
    '<feed><title>Release notes from opencode</title><updated>2026-10-29T04:27:12Z</updated>',
    '<entry><title>v2.2.1</title><updated>2026-10-29T05:16:55Z</updated><link href="https://github.com/anomalyco/opencode/releases/tag/v2.2.1"/></entry>',
    '<entry><title>v2.2.0</title><updated>2026-10-27T10:00:00Z</updated><link href="https://github.com/anomalyco/opencode/releases/tag/v2.2.0"/></entry>',
    '<entry><title>v2.3.0-beta.1</title><updated>2026-11-02T10:00:00Z</updated></entry>',
    '</feed>',
  ].join("\n");
}

const parsed = parseChangelog(fixture());
assert(parsed.length === registry.releases.length + 2, "parser returns only release headings");
assert(parsed[0]?.version === "2.3.1", "parser sorts the newest release first");
assert(parsed.at(-1)?.version === "2.1.4", "parser keeps the oldest release last");
assert(parsed[0]?.date === "2026-11-14", "parser carries the release date");
assert(parseChangelog("").length === 0, "parser returns nothing for empty input");
assert(compareVersions("2.10.0", "2.9.9") > 0, "version comparison is numeric");
assert(compareVersions("2.2.0", "2.2.0") === 0, "equal versions compare at zero");

const atom = parseReleaseFeed(feed());
assert(atom.length === 2, "the release feed skips a prerelease title");
assert(atom[0]?.version === "2.2.1", "the release feed sorts the newest tag first");
assert(atom[0]?.date === "2026-10-29", "the release feed reads the entry update day");
assert(parseFeed(feed())[0]?.version === "2.2.1", "the feed parser auto-detects atom");
assert(parseFeed(fixture())[0]?.version === "2.3.1", "the feed parser falls back to the changelog page");
const merged = mergeEntries([
  [{ version: "2.2.1", date: "2026-10-29" }],
  [
    { version: "2.2.1", date: "2026-10-28" },
    { version: "2.3.0", date: "2026-11-01" },
  ],
]);
assert(merged.length === 2, "merged feeds drop a duplicate version");
assert(merged[0]?.version === "2.3.0", "merged feeds sort newest first");
assert(merged[1]?.date === "2026-10-28", "merged feeds keep the earliest day for a version");

assert(validateRegistry(registry).length === 0, "the checked-in registry is valid");
assert(registry.source === "https://opencode.ai/changelog", "registry points at the changelog");
assert(registry.releasesUrl === RELEASES_URL, "registry points at the GitHub releases");
assert(
  registry.releases.every((release) => release.notesUrl === releaseNotesUrl(release.version)),
  "every release carries its own notes link",
);
assert(registry.auditedThrough === registry.releases[0]?.version, "auditedThrough is the newest release");
assert(
  registry.releases[0]?.hostContract === installed.version,
  `the audited release records the built host contract (${installed.version ?? "unknown"})`,
);
assert(
  registry.releases[0]?.hostContract === registry.auditedThrough,
  "the newest host contract matches auditedThrough",
);
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
assert(drift.unaudited[0]?.version === "2.3.1", "the unaudited release is the new one");
assert(drift.unlisted.length === 0, "a full page lists every audited release");

const equal = diffReleases(registry, parseChangelog(fixture()).slice(1));
assert(equal.unaudited.length === 0, "an audited page has no unaudited release");
assert(equal.latest?.version === "2.3.0", "the drift report exposes the live latest release");

const older = diffReleases(registry, [
  { version: "2.2.0", date: "2026-10-27" },
  { version: "2.1.9", date: "2026-10-25" },
]);
assert(older.unaudited.length === 0, "releases below auditedThrough are not flagged");

const patchAbove = diffReleases(registry, [
  { version: "2.3.1", date: "2026-11-14" },
  { version: "2.3.0", date: "2026-11-13" },
]);
assert(patchAbove.unaudited[0]?.version === "2.3.1", "a patch release above the ceiling is flagged");

const feedDrift = diffReleases(registry, parseReleaseFeed(feed()));
assert(feedDrift.unaudited.length === 0, "the audited ceiling is not flagged from the release feed");
assert(feedDrift.latest?.version === "2.2.1", "the release feed exposes the live latest tag");

const pruned = diffReleases(registry, [{ version: "2.1.4", date: "2026-10-23" }]);
assert(pruned.unlisted.length === registry.releases.length, "a pruned audited release is reported");
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
const guardedItem = missingIssue.releases
  .flatMap((release) => release.items)
  .find((item) => item.verdict === "guarded");
if (guardedItem) delete guardedItem.issue;
expectProblem(missingIssue, "required for verdict", "a guarded change needs an issue id");

const badIssue = mutable();
const adoptedItem = badIssue.releases
  .flatMap((release) => release.items)
  .find((item) => item.verdict === "adopted");
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

const foreignReleases = mutable();
foreignReleases.releasesUrl = "https://example.com/releases";
expectProblem(foreignReleases, "releasesUrl must be", "a foreign releases url fails validation");

const missingReleases = mutable();
delete missingReleases.releasesUrl;
expectProblem(missingReleases, "releasesUrl must be", "a missing releases url fails validation");

const foreignNotes = mutable();
const notesRelease = foreignNotes.releases[0];
if (notesRelease) notesRelease.notesUrl = releaseNotesUrl("2.2.0");
expectProblem(foreignNotes, "notesUrl must be", "a mismatched notes link fails validation");

const missingNotes = mutable();
if (missingNotes.releases[0]) delete missingNotes.releases[0].notesUrl;
expectProblem(missingNotes, "not a release tag url", "a missing notes link fails validation");

assert(parseReleaseFeed("<feed><title>Release notes</title></feed>").length === 0, "an empty feed yields no releases");

const notAnObject = validateRegistry(["2.2.0"]);
assert(notAnObject.length === 1, "a non-object registry fails validation");

console.log(`PROOF PASS: the upstream registry validates and detects drift (${passed} assertions)`);
