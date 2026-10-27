export type UpstreamVerdict =
  | "adopted"
  | "aligned"
  | "candidate"
  | "guarded"
  | "tracked"
  | "ignored";

export type UpstreamStatus = "aligned" | "partial" | "blocked";

export type UpstreamItem = {
  pr: number;
  topic: string;
  verdict: UpstreamVerdict;
  issue?: string;
  note: string;
};

export type UpstreamRelease = {
  version: string;
  date: string;
  auditedAt: string;
  hostContract: string;
  status: UpstreamStatus;
  items: UpstreamItem[];
};

export type UpstreamRegistry = {
  source: string;
  auditedThrough: string;
  releases: UpstreamRelease[];
};

export type ChangelogEntry = { version: string; date: string };

export type UpstreamDrift = {
  auditedThrough: string;
  latest: ChangelogEntry | undefined;
  unaudited: ChangelogEntry[];
  unlisted: ChangelogEntry[];
};

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TOPIC = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISSUE = /^[A-Z]-\d{2}$/;
const SOURCE = /^https:\/\/opencode\.ai\/changelog$/;
const ISSUE_VERDICTS: readonly UpstreamVerdict[] = ["adopted", "guarded", "tracked"];
const VERDICTS: readonly UpstreamVerdict[] = [
  "adopted",
  "aligned",
  "candidate",
  "guarded",
  "tracked",
  "ignored",
];
const STATUSES: readonly UpstreamStatus[] = ["aligned", "partial", "blocked"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVersion(value: unknown): value is string {
  return typeof value === "string" && SEMVER.test(value);
}

function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === value;
}

function isVerdict(value: unknown): value is UpstreamVerdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is UpstreamStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number.parseInt(part, 10));
  const b = right.split(".").map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function parseChangelog(html: string): ChangelogEntry[] {
  const pattern =
    /<h2[^>]*>\s*<a[^>]*>\s*v(\d+\.\d+\.\d+)\s*<\/a>\s*<\/h2>\s*<time[^>]*datetime="(\d{4}-\d{2}-\d{2})"/g;
  const seen = new Set<string>();
  const entries: ChangelogEntry[] = [];
  for (const match of html.matchAll(pattern)) {
    const version = match[1] ?? "";
    const date = match[2] ?? "";
    if (!isVersion(version) || !isDay(date) || seen.has(version)) continue;
    seen.add(version);
    entries.push({ version, date });
  }
  entries.sort((left, right) => compareVersions(right.version, left.version));
  return entries;
}

export function validateRegistry(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ["registry is not an object"];
  if (typeof value.source !== "string" || !SOURCE.test(value.source)) {
    problems.push("source must be https://opencode.ai/changelog");
  }
  if (!isVersion(value.auditedThrough)) {
    problems.push("auditedThrough is not a semantic version");
  }
  const releases = value.releases;
  if (!Array.isArray(releases) || releases.length === 0) {
    problems.push("releases must be a non-empty array");
    return problems;
  }
  const versions = new Set<string>();
  let previous: string | null = null;
  for (let index = 0; index < releases.length; index++) {
    const release = releases[index];
    const at = `releases[${index}]`;
    if (!isRecord(release)) {
      problems.push(`${at} is not an object`);
      continue;
    }
    const version = release.version;
    if (!isVersion(version)) {
      problems.push(`${at}.version is not a semantic version`);
    } else {
      if (versions.has(version)) problems.push(`${at}.version repeats ${version}`);
      versions.add(version);
      if (previous && compareVersions(previous, version) <= 0) {
        problems.push(`${at}.version must sort below ${previous}`);
      }
      previous = version;
    }
    if (!isDay(release.date)) problems.push(`${at}.date is not a valid day`);
    if (!isDay(release.auditedAt)) problems.push(`${at}.auditedAt is not a valid day`);
    if (isDay(release.date) && isDay(release.auditedAt) && release.auditedAt < release.date) {
      problems.push(`${at}.auditedAt precedes the release date`);
    }
    if (!isVersion(release.hostContract)) {
      problems.push(`${at}.hostContract is not a semantic version`);
    }
    if (!isStatus(release.status)) problems.push(`${at}.status is not a known status`);
    const items = release.items;
    if (!Array.isArray(items) || items.length === 0) {
      problems.push(`${at}.items must be a non-empty array`);
      continue;
    }
    const pullRequests = new Set<number>();
    const topics = new Set<string>();
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      const itemAt = `${at}.items[${itemIndex}]`;
      if (!isRecord(item)) {
        problems.push(`${itemAt} is not an object`);
        continue;
      }
      if (typeof item.pr !== "number" || !Number.isInteger(item.pr) || item.pr <= 0) {
        problems.push(`${itemAt}.pr is not a positive integer`);
      } else {
        if (pullRequests.has(item.pr)) problems.push(`${itemAt}.pr repeats ${item.pr}`);
        pullRequests.add(item.pr);
      }
      if (typeof item.topic !== "string" || !TOPIC.test(item.topic)) {
        problems.push(`${itemAt}.topic is not a lowercase slug`);
      } else {
        if (topics.has(item.topic)) problems.push(`${itemAt}.topic repeats ${item.topic}`);
        topics.add(item.topic);
      }
      if (!isVerdict(item.verdict)) {
        problems.push(`${itemAt}.verdict is not a known verdict`);
      } else if (ISSUE_VERDICTS.includes(item.verdict)) {
        if (typeof item.issue !== "string" || !ISSUE.test(item.issue)) {
          problems.push(`${itemAt}.issue is required for verdict ${item.verdict}`);
        }
      }
      if (item.issue !== undefined && (typeof item.issue !== "string" || !ISSUE.test(item.issue))) {
        problems.push(`${itemAt}.issue is not an issue id`);
      }
      if (typeof item.note !== "string" || item.note.trim().length < 8) {
        problems.push(`${itemAt}.note is shorter than 8 characters`);
      }
    }
  }
  if (isVersion(value.auditedThrough) && versions.size > 0) {
    const ordered = Array.from(versions).sort((left, right) => compareVersions(right, left));
    const newest = ordered[0];
    if (newest && newest !== value.auditedThrough) {
      problems.push(`auditedThrough ${value.auditedThrough} is not the newest release ${newest}`);
    }
  }
  return problems;
}

export function diffReleases(registry: UpstreamRegistry, remote: ChangelogEntry[]): UpstreamDrift {
  const known = new Set(registry.releases.map((release) => release.version));
  const remoteVersions = new Set(remote.map((entry) => entry.version));
  const unaudited = remote.filter(
    (entry) =>
      compareVersions(entry.version, registry.auditedThrough) > 0 && !known.has(entry.version),
  );
  const unlisted = registry.releases
    .filter((release) => !remoteVersions.has(release.version))
    .map((release) => ({ version: release.version, date: release.date }));
  return {
    auditedThrough: registry.auditedThrough,
    latest: remote[0],
    unaudited,
    unlisted,
  };
}

export function verdictCounts(registry: UpstreamRegistry): Record<UpstreamVerdict, number> {
  const counts: Record<UpstreamVerdict, number> = {
    adopted: 0,
    aligned: 0,
    candidate: 0,
    guarded: 0,
    tracked: 0,
    ignored: 0,
  };
  for (const release of registry.releases) {
    for (const item of release.items) counts[item.verdict] += 1;
  }
  return counts;
}

export function renderSummary(registry: UpstreamRegistry): string {
  const items = registry.releases.reduce((total, release) => total + release.items.length, 0);
  const counts = verdictCounts(registry);
  const verdictLine = VERDICTS.map((verdict) => `${verdict} ${counts[verdict]}`).join(", ");
  const releases = registry.releases.length === 1 ? "release" : "releases";
  return [
    `[upstream] audited through v${registry.auditedThrough} (${registry.releases.length} ${releases}, ${items} tracked changes)`,
    `[upstream] verdicts: ${verdictLine}`,
  ].join("\n");
}
