import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareVersions,
  diffReleases,
  mergeEntries,
  parseFeed,
  renderSummary,
  validateRegistry,
  type ChangelogEntry,
  type UpstreamRegistry,
} from "../src/upstream/changelog.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = resolve(repo, "src", "upstream", "registry.json");
const FETCH_TIMEOUT_MS = 20_000;

type Options = {
  offline: boolean;
  json: boolean;
  source: string | undefined;
};

type SourceReport = {
  url: string;
  ok: boolean;
  entries: ChangelogEntry[];
  latest: ChangelogEntry | undefined;
  lagging: boolean;
  error?: string;
};

function usage(): string {
  return [
    "usage: bun scripts/check-upstream.ts [--offline] [--source <url|file>] [--json]",
    "",
    "  --offline       validate src/upstream/registry.json without network access",
    "  --source        read one feed from a URL or a local file instead of both live sources",
    "  --json          print one machine-readable object",
    "",
    "without --offline the check reads the GitHub releases feed and the changelog page,",
    "merges their versions, and reports when either source lags the audited ceiling.",
  ].join("\n");
}

function parseOptions(argv: string[]): Options {
  const options: Options = { offline: false, json: false, source: undefined };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (arg === "--offline") {
      options.offline = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--source") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--source requires a value");
      options.source = value;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

function loadRegistry(): UpstreamRegistry {
  const text = readFileSync(registryPath, "utf8");
  return JSON.parse(text) as UpstreamRegistry;
}

async function readRemote(source: string): Promise<ChangelogEntry[]> {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": "tawassul-upstream-check/1.0" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseFeed(await response.text());
  }
  return parseFeed(readFileSync(resolve(source), "utf8"));
}

async function readSource(url: string): Promise<SourceReport> {
  try {
    const entries = await readRemote(url);
    if (entries.length === 0) throw new Error("no releases parsed");
    return { url, ok: true, entries, latest: entries[0], lagging: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { url, ok: false, entries: [], latest: undefined, lagging: false, error: message };
  }
}

function sourceUrls(registry: UpstreamRegistry, override: string | undefined): string[] {
  if (override) return [override];
  return [`${registry.releasesUrl}.atom`, registry.source];
}

function reportJson(report: SourceReport): Record<string, unknown> {
  return {
    url: report.url,
    ok: report.ok,
    latest: report.latest ?? null,
    lagging: report.lagging,
    ...(report.error === undefined ? {} : { error: report.error }),
  };
}

async function main(): Promise<number> {
  let options: Options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[upstream] ${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(`${usage()}\n`);
    return 2;
  }

  let registry: UpstreamRegistry;
  try {
    registry = loadRegistry();
  } catch (error) {
    process.stderr.write(
      `[upstream] cannot read registry: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  const problems = validateRegistry(registry);
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`[upstream] invalid: ${problem}\n`);
    process.stderr.write(
      `[upstream] registry check FAILED (${problems.length} problem(s)) — fix src/upstream/registry.json\n`,
    );
    return 1;
  }

  if (options.offline) {
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            mode: "offline",
            releasesUrl: registry.releasesUrl,
            auditedThrough: registry.auditedThrough,
            releases: registry.releases.length,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      process.stdout.write(`${renderSummary(registry)}\n`);
      process.stdout.write("[upstream] registry OK (offline)\n");
    }
    return 0;
  }

  const urls = sourceUrls(registry, options.source);
  const reports = await Promise.all(urls.map(readSource));
  for (const report of reports) {
    if (!report.latest) continue;
    report.lagging = compareVersions(report.latest.version, registry.auditedThrough) < 0;
    if (options.json) continue;
    const suffix = report.lagging ? ` — lags the audited v${registry.auditedThrough}` : "";
    process.stdout.write(
      `[upstream] source ${report.url}: v${report.latest.version} (${report.latest.date})${suffix}\n`,
    );
  }

  const usable = reports.filter((report) => report.ok);
  if (usable.length === 0) {
    for (const report of reports) {
      process.stderr.write(`[upstream] cannot read ${report.url}: ${report.error ?? "unknown error"}\n`);
    }
    process.stderr.write("[upstream] network check unavailable; the offline gate still runs\n");
    return 2;
  }
  if (!options.json) {
    for (const report of reports) {
      if (report.ok) continue;
      process.stderr.write(
        `[upstream] warning: ${report.url} unavailable (${report.error ?? "unknown error"}); the other source still counts\n`,
      );
    }
  }

  const remote = mergeEntries(usable.map((report) => report.entries));
  const drift = diffReleases(registry, remote);
  const ok = drift.unaudited.length === 0;

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok,
          mode: "live",
          auditedThrough: drift.auditedThrough,
          latest: drift.latest ?? null,
          sources: reports.map(reportJson),
          unaudited: drift.unaudited,
          unlisted: drift.unlisted,
        },
        null,
        2,
      )}\n`,
    );
    return ok ? 0 : 1;
  }

  process.stdout.write(`${renderSummary(registry)}\n`);
  for (const version of drift.unlisted) {
    process.stdout.write(
      `[upstream] warning: audited v${version.version} is not on any live source anymore\n`,
    );
  }
  if (!ok) {
    for (const entry of drift.unaudited) {
      process.stderr.write(
        `[upstream] UNAUDITED v${entry.version} (${entry.date}) — add it to src/upstream/registry.json and update UPSTREAM.md\n`,
      );
    }
    process.stderr.write("[upstream] check FAILED: a newer host release needs an assessment\n");
    return 1;
  }
  process.stdout.write(`[upstream] aligned: no release newer than v${registry.auditedThrough}\n`);
  return 0;
}

const code = await main();
process.exitCode = code;
