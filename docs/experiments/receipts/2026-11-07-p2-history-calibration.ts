import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DEFAULT_PRICING_MODELS } from "../../../src/services/cost-transparency/types.ts";

const SOURCE = process.env.TAWASSUL_CALIB_DB?.trim()
  || join(homedir(), ".local", "share", "opencode", "tawassul-v2", "opencode.db");
const PROJECT = process.env.TAWASSUL_CALIB_PROJECT?.trim() || "Tawassul V2";

if (!existsSync(SOURCE)) {
  console.error(`CALIB ABORT: no database at ${SOURCE}`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "tawassul-calib-"));
const copy = join(work, "opencode.db");

type Row = {
  id: string;
  parent_id: string | null;
  directory: string;
  model: string | null;
  cost: number | null;
  ti: number;
  to_: number;
  tr: number;
  cr: number;
  cw: number;
};

function billable(row: Row): number {
  return row.ti + row.to_ + row.cr * 0.1 + row.cw * 1.25;
}

function context(row: Row): number {
  return row.ti + row.cr;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? null;
}

function line(label: string, rows: Row[]): string {
  const b = rows.map(billable);
  const c = rows.map(context);
  const parts = [
    `${label}: n=${rows.length}`,
    `billable p50=${percentile(b, 50)}`,
    `p90=${percentile(b, 90)}`,
    `p99=${percentile(b, 99)}`,
    `budget(p99x1.5)=${(percentile(b, 99) ?? 0) * 1.5}`,
    `context p50=${percentile(c, 50)}`,
    `p99=${percentile(c, 99)}`,
  ];
  return parts.join(" ");
}

try {
  for (const suffix of ["", "-wal", "-shm"]) {
    const from = `${SOURCE}${suffix}`;
    if (existsSync(from)) copyFileSync(from, `${copy}${suffix}`);
  }
  const db = new Database(copy);
  const rows = db
    .query(
      `SELECT id, parent_id, directory, model, cost, tokens_input AS ti, tokens_output AS to_,
              tokens_reasoning AS tr, tokens_cache_read AS cr, tokens_cache_write AS cw
       FROM session_v2 WHERE time_archived IS NULL`,
    )
    .all() as Row[];
  db.close();

  const nonzero = rows.filter((row) => row.ti + row.to_ + row.cr + row.cw > 0);
  const project = nonzero.filter((row) => row.directory && row.directory.includes(PROJECT));
  const roots = (group: Row[]): Row[] => group.filter((row) => !row.parent_id);
  const children = (group: Row[]): Row[] => group.filter((row) => row.parent_id);

  console.log(`source: ${SOURCE}`);
  console.log(`copied: ${work}`);
  console.log(`all projects: total=${rows.length} nonzero=${nonzero.length} zero=${rows.length - nonzero.length}`);
  console.log(`project "${PROJECT}": total=${project.length} roots=${roots(project).length} children=${children(project).length}`);
  console.log(line(`all roots`, roots(nonzero)));
  console.log(line(`all children`, children(nonzero)));
  console.log(line(`project roots`, roots(project)));
  console.log(line(`project children`, children(project)));

  const priced = nonzero.filter((row) => (row.cost ?? 0) > 0);
  const catalog = new Set(DEFAULT_PRICING_MODELS.map((model) => model.model));
  const modelOf = (row: Row): string => {
    if (!row.model) return "unknown";
    try {
      const parsed = JSON.parse(row.model) as { id?: string; providerID?: string };
      return `${parsed.providerID ?? "?"}/${parsed.id ?? "?"}`;
    } catch {
      return "unparseable";
    }
  };
  console.log(`priced sessions: ${priced.length}`);
  for (const row of priced) {
    const id = modelOf(row).split("/").pop() ?? "";
    console.log(
      `  project=${basename(row.directory.replace(/\/+$/, ""))} model=${modelOf(row)} cost=${row.cost} catalogued=${catalog.has(id)}`,
    );
  }
  const rootP99 = percentile(roots(project).map(billable), 99);
  console.log(`project p99(root) below 300k: ${(rootP99 ?? 0) < 300000}`);
  console.log(`project priced sessions: ${project.filter((row) => (row.cost ?? 0) > 0).length}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
