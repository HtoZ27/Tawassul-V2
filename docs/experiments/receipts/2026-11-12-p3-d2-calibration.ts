import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CAP } from "../../../src/services/iteration-budget.ts";
import {
  computeBillable,
  type UsageLedgerRow,
} from "../../../src/services/usage-ledger.ts";

const source = join(homedir(), ".local", "share", "tawassul-v2", "usage-ledger.jsonl");
const work = mkdtempSync(join(tmpdir(), "tawassul-d2-calibration-"));
const copy = join(work, "usage-ledger.jsonl");

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? null;
}

try {
  copyFileSync(source, copy);
  const rotations = [copy];
  if (existsSync(`${source}.1`)) {
    copyFileSync(`${source}.1`, `${copy}.1`);
    rotations.unshift(`${copy}.1`);
  }

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

  const sessions = [...latest.values()];
  const billable = sessions.map((row) => computeBillable(row.raw));
  const roots = sessions.filter((row) => !row.parentID).map((row) => computeBillable(row.raw));
  const children = sessions.filter((row) => row.parentID).map((row) => computeBillable(row.raw));
  const overRoot = roots.filter((value) => value > DEFAULT_CAP.maxRootTokens);
  const overChild = children.filter((value) => value > DEFAULT_CAP.maxChildTokens);

  console.log(JSON.stringify({
    readingAt: new Date().toISOString(),
    budgetModel: "root_child",
    sessions: sessions.length,
    roots: roots.length,
    children: children.length,
    maxRootTokens: DEFAULT_CAP.maxRootTokens,
    maxChildTokens: DEFAULT_CAP.maxChildTokens,
    maxSubagents: DEFAULT_CAP.maxSubagents,
    all: {
      p50: percentile(billable, 50),
      p90: percentile(billable, 90),
      p99: percentile(billable, 99),
      max: billable.length > 0 ? Math.max(...billable) : null,
    },
    root: {
      p50: percentile(roots, 50),
      p90: percentile(roots, 90),
      p99: percentile(roots, 99),
      max: roots.length > 0 ? Math.max(...roots) : null,
    },
    child: {
      p50: percentile(children, 50),
      p90: percentile(children, 90),
      p99: percentile(children, 99),
      max: children.length > 0 ? Math.max(...children) : null,
    },
    sessionsOverRootCap: overRoot.length,
    sessionsOverChildCap: overChild.length,
    falsePositiveCheck: overRoot.length === 0 && overChild.length === 0,
  }, null, 1));

  if (overRoot.length > 0 || overChild.length > 0) {
    console.error(
      `PROOF FAIL: ${overRoot.length} root(s) and ${overChild.length} child(ren) exceed the calibrated budgets`,
    );
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
