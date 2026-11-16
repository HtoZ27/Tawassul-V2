import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { UsageLedger, type UsageLedgerRow } from "../../../src/services/usage-ledger.ts";

const source = join(homedir(), ".local", "share", "tawassul-v2", "usage-ledger.jsonl");
const work = mkdtempSync(join(tmpdir(), "tawassul-gate-"));
const copy = join(work, "usage-ledger.jsonl");

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? null;
}

try {
  copyFileSync(source, copy);
  const rotations = existsSync(`${source}.1`) ? [`${copy}.1`, copy] : [copy];
  if (existsSync(`${source}.1`)) copyFileSync(`${source}.1`, `${copy}.1`);

  const latest = new Map<string, UsageLedgerRow>();
  for (const file of rotations) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { kind?: string };
      if (row.kind !== "usage") continue;
      const usage = row as UsageLedgerRow;
      latest.set(usage.sessionID, usage);
    }
  }

  const ledger = new UsageLedger({ path: copy, now: () => 1_760_000_000_000 });
  await ledger.start();
  const summary = ledger.summary();
  await ledger.dispose();

  const sessions = [...latest.values()];
  const cachedShare = sessions
    .map((row) => {
      const context = row.raw.input + row.raw.cacheRead;
      return context > 0 ? row.raw.cacheRead / context : null;
    })
    .filter((value): value is number => value !== null);
  const sharesAtLeast90 = cachedShare.filter((share) => share >= 0.9).length;
  const totalContext = sessions.reduce((sum, row) => sum + row.raw.input + row.raw.cacheRead, 0);
  const totalCacheRead = sessions.reduce((sum, row) => sum + row.raw.cacheRead, 0);

  const usageRows = summary.usageRows;
  const unobservedRows = summary.unobservedRows;
  const orphanRate = summary.sessions > 0
    ? (summary.orphanChildren + summary.lineageUnknown) / summary.sessions
    : null;

  console.log(JSON.stringify({
    readingAt: new Date().toISOString(),
    rows: summary.rows,
    usageRows,
    sessions: summary.sessions,
    roots: summary.roots,
    children: summary.children,
    lineageUnknown: summary.lineageUnknown,
    orphanChildren: summary.orphanChildren,
    orphanRate,
    rootP99: summary.root.p99,
    p99Below300k: (summary.root.p99 ?? 0) < 300_000,
    cachedShare: {
      sessions: cachedShare.length,
      p50: percentile(cachedShare, 50),
      p90: percentile(cachedShare, 90),
      weighted: totalContext > 0 ? totalCacheRead / totalContext : null,
      atLeast90: sharesAtLeast90,
    },
    unobservedRows,
    lossShareOfRows: usageRows > 0 ? unobservedRows / usageRows : null,
    resyncRows: sessions.filter((row) => row.resync).length,
    repeatSessions: summary.repeatSessions,
    echoSessions: summary.echoSessions,
    fanoutSessions: summary.fanoutSessions,
    shadowRows: summary.shadowRows,
    lastEventAt: summary.lastEventAt,
  }, null, 1));
} finally {
  rmSync(work, { recursive: true, force: true });
}
