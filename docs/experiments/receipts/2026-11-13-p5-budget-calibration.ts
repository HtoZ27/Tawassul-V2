import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CAP, tokenBudget } from "../../../src/services/iteration-budget.ts";
import {
  computeBillable,
  type UsageLedgerRow,
} from "../../../src/services/usage-ledger.ts";

const source = join(homedir(), ".local", "share", "tawassul-v2", "usage-ledger.jsonl");
const work = mkdtempSync(join(tmpdir(), "tawassul-p5-budget-"));
const copy = join(work, "usage-ledger.jsonl");

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? null;
}

function distribution(values: number[]) {
  return {
    n: values.length,
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p99: percentile(values, 99),
    max: values.length > 0 ? Math.max(...values) : null,
  };
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
  const childrenOf = new Map<string, string[]>();
  for (const row of sessions) {
    if (!row.parentID) continue;
    const list = childrenOf.get(row.parentID) ?? [];
    list.push(row.sessionID);
    childrenOf.set(row.parentID, list);
  }
  const billableOf = new Map(sessions.map((row) => [row.sessionID, computeBillable(row.raw)]));
  const roots = sessions.filter((row) => !row.parentID);
  const treeOf = new Map<string, number>();
  const treeBillable: number[] = [];
  const treeCost: number[] = [];
  const treeSessions: number[] = [];
  for (const root of roots) {
    let total = 0;
    let cost = 0;
    const seen = new Set<string>();
    const stack = [root.sessionID];
    while (stack.length > 0) {
      const id = stack.pop();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      total += billableOf.get(id) ?? 0;
      cost += latest.get(id)?.raw.cost ?? 0;
      for (const child of childrenOf.get(id) ?? []) stack.push(child);
    }
    for (const id of seen) treeOf.set(id, total);
    treeBillable.push(total);
    treeCost.push(cost);
    treeSessions.push(seen.size);
  }

  const readings = sessions.map((row) => {
    const own = tokenBudget("", billableOf.get(row.sessionID) ?? 0, !row.parentID);
    if (!row.parentID) return own;
    const treeReading = tokenBudget("", treeOf.get(row.sessionID) ?? 0, true);
    return treeReading.ratio > own.ratio ? treeReading : own;
  });

  const count = (zone: string) => readings.filter((reading) => reading.zone === zone).length;
  const rootsOverRootBudget = roots.filter(
    (root) => (treeOf.get(root.sessionID) ?? 0) > DEFAULT_CAP.maxRootTokens,
  ).length;
  const childrenOverChildBudget = sessions
    .filter((row) => row.parentID)
    .filter((row) => (billableOf.get(row.sessionID) ?? 0) > DEFAULT_CAP.maxChildTokens).length;
  const pricedSessions = sessions.filter((row) => row.raw.cost > 0).length;
  const maxCost = sessions.reduce((max, row) => Math.max(max, row.raw.cost), 0);

  const report = {
    readingAt: new Date().toISOString(),
    budgetModel: "root_tree_and_child",
    sessions: sessions.length,
    roots: roots.length,
    children: sessions.length - roots.length,
    orphans: sessions.filter((row) => row.parentID && !latest.has(row.parentID)).length,
    maxRootTokens: DEFAULT_CAP.maxRootTokens,
    maxChildTokens: DEFAULT_CAP.maxChildTokens,
    sessionBillable: distribution([...billableOf.values()]),
    treeBillable: distribution(treeBillable),
    treeCost: distribution(treeCost),
    treeSessions: distribution(treeSessions),
    zones: { green: count("green"), yellow: count("yellow"), orange: count("orange"), red: count("red") },
    rootsOverRootBudget,
    childrenOverChildBudget,
    pricedSessions,
    maxSessionCost: maxCost,
    falsePositiveCheck: count("orange") === 0 && count("red") === 0,
  };
  console.log(JSON.stringify(report, null, 1));

  if (!report.falsePositiveCheck) {
    console.error(
      `PROOF FAIL: ${count("orange")} session(s) enter orange and ${count("red")} enter red on the observed distribution`,
    );
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
