import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TawassulContext } from "../src/context.ts";
import type { Checkpoint, RecordEntry } from "../src/context/types.ts";
import type { ToolContext } from "../src/tool.ts";
import { StateManager } from "../src/context/managers/StateManager.ts";
import { buildRecordTool } from "../src/tools/record.ts";
import { CHECKPOINT_UNVERIFIED_MAX, asCheckpoint, buildHandoffTool } from "../src/tools/handoff.ts";
import { CheckpointSchema } from "../src/validation.ts";
import { resetContinuity } from "../src/services/continuity/detect.ts";
import { configureContinuity } from "../src/services/continuity/owner.ts";
import { t } from "../src/translations.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

function show(value: unknown): string {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function eq<T>(actual: T, expected: T, name: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${name} (${show(actual)} === ${show(expected)})`);
}

type SearchResult = {
  output: string;
  metadata?: { search: string; scanned: number; matched: number; limit: number; hits: string[] };
};

const work = mkdtempSync(join(tmpdir(), "tawassul-record-search-"));
const agent = { agent: "@dev", sessionID: "ses_search" } as unknown as ToolContext;

function record(
  id: string,
  severity: RecordEntry["severity"],
  timestamp: string,
  title: string,
  detail: string,
): RecordEntry {
  return {
    id,
    type: severity === "critical" || severity === "severe" ? "incident" : "note",
    timestamp,
    agent: "@tester",
    title,
    detail,
    ...(severity ? { severity } : {}),
  };
}

async function search(
  tool: ReturnType<typeof buildRecordTool>,
  args: Record<string, unknown>,
): Promise<SearchResult> {
  return (await tool.execute(args, agent)) as SearchResult;
}

async function main(): Promise<void> {
  try {
    process.env.TAWASSUL_CONTINUITY = "1";
    resetContinuity();
    configureContinuity({ baseDir: join(work, "state") });

    const handoffBytes = Buffer.byteLength(buildHandoffTool({} as TawassulContext).description ?? "");
    const recordBytes = Buffer.byteLength(buildRecordTool({} as TawassulContext).description ?? "");
    eq(handoffBytes, 1126, "the handoff description measures 1,126 bytes");
    eq(recordBytes, 541, "the record description measures 541 bytes");
    eq(handoffBytes + recordBytes, 1667, "the pair measures 1,667 bytes, 16 above the previous surface");

    const ranked: RecordEntry[] = [
      record("R-001", "minor", "2026-01-05T00:00:00.000Z", "needle in the title", "plain detail"),
      record("R-002", "critical", "2026-01-01T00:00:00.000Z", "oldest critical", "the needle is in the detail"),
      record("R-003", "severe", "2026-01-03T00:00:00.000Z", "a needle appears here", "plain detail"),
      record("R-004", undefined, "2026-01-06T00:00:00.000Z", "newest unranked needle", "plain detail"),
      record("R-005", "critical", "2026-01-04T00:00:00.000Z", "newer needle", "plain detail"),
    ];
    const bulk: RecordEntry[] = [];
    for (let i = 1; i <= 25; i++) {
      const id = `R-${String(100 + i).padStart(3, "0")}`;
      bulk.push(record(id, i % 2 === 0 ? "minor" : undefined, `2026-02-${String(i).padStart(2, "0")}T00:00:00.000Z`, `bulk item ${i}`, "bulk detail"));
    }
    const other: RecordEntry[] = [
      record("R-201", "minor", "2026-03-01T00:00:00.000Z", "unrelated", "nothing here"),
      record("R-202", "minor", "2026-03-02T00:00:00.000Z", "also unrelated", "still nothing"),
    ];
    const records: RecordEntry[] = [...ranked, ...bulk, ...other];
    const ctx = {
      records,
      recSeq: records.length,
      getMaxRecords: () => 5000,
      saveState: async () => undefined,
      recordRecordCreated: () => undefined,
    } as unknown as TawassulContext;
    const tool = buildRecordTool(ctx);
    const snapshot = JSON.stringify(records);

    const rankedHits = await search(tool, { search: "needle" });
    eq(rankedHits.metadata?.hits, ["R-005", "R-002", "R-003", "R-001", "R-004"], "hits rank by severity then recency");
    eq(rankedHits.metadata?.matched, 5, "the ranking query matches five records");
    eq(rankedHits.metadata?.scanned, records.length, "the search scans every record exactly once");

    const folded = await search(tool, { search: "NEEDLE" });
    eq(folded.metadata?.hits, rankedHits.metadata?.hits, "the search is case-folded");

    const detailHit = await search(tool, { search: "in the detail" });
    eq(detailHit.metadata?.hits, ["R-002"], "the search reads the detail, not only the title");

    const capped = await search(tool, { search: "bulk" });
    eq(capped.metadata?.matched, 25, "twenty-five records match the bulk query");
    eq(capped.metadata?.hits.length, 20, "the default search cap is twenty");
    eq(capped.metadata?.limit, 20, "the default limit is twenty");

    const three = await search(tool, { search: "bulk", limit: 3 });
    eq(three.metadata?.hits.length, 3, "an explicit limit returns exactly that many hits");
    eq(three.metadata?.limit, 3, "an explicit limit is reported unchanged");

    const clamped = await search(tool, { search: "bulk", limit: 50 });
    eq(clamped.metadata?.hits.length, 20, "a limit above twenty is clamped at the writer");
    eq(clamped.metadata?.limit, 20, "the clamp is reported as twenty");

    const missing = await search(tool, { search: "absent-token" });
    assert(missing.output.includes(t("recordSearchEmpty", { query: "absent-token", limit: "20" })), "an empty result names the query and the limit");
    eq(missing.metadata?.hits, [], "an empty result reports no hits");

    const blank = await search(tool, { search: "   " });
    eq(blank.output, t("recordSearchRequired"), "a blank query refuses without scanning");

    eq(JSON.stringify(records), snapshot, "no search mutates the record list");

    const listed = (await tool.execute({ list: true }, agent)) as { output: string };
    assert(listed.output.includes("R-202"), "an unlimited list keeps the last record");
    const limited = (await tool.execute({ list: true, limit: 2 }, agent)) as { output: string };
    assert(limited.output.includes(t("recordListLimited", { shown: "2", total: String(records.length) })), "a limited list names the shown and total counts");

    process.env.TAWASSUL_CONTINUITY = "0";
    const refused = await search(tool, { search: "needle" });
    eq(refused.output, t("continuityDisabled"), "a disabled continuity gate refuses the search");
    eq(refused.metadata, undefined, "a refused search writes no metadata");
    eq(JSON.stringify(records), snapshot, "a refused search does not touch the record list");
    process.env.TAWASSUL_CONTINUITY = "1";

    eq(CHECKPOINT_UNVERIFIED_MAX, 5, "the checkpoint unverified cap is five");
    const checkpoint: Checkpoint = {
      completed: ["one"],
      remaining: ["two"],
      filesChanged: ["src/a.ts"],
      decisions: [{ title: "choose", detail: "the smaller path" }],
      unverified: ["a", "b", "c", "d", "e", "f", "g"],
    };
    const parsed = CheckpointSchema.parse(checkpoint);
    eq(parsed?.unverified?.length, 7, "the schema declares no maximum on unverified");
    const clipped = asCheckpoint(checkpoint);
    eq(clipped?.unverified, ["a", "b", "c", "d", "e"], "the writer clips unverified to five entries");
    eq(clipped?.completed, ["one"], "the clip keeps the completed list");
    const mixed = asCheckpoint({ ...checkpoint, unverified: ["a", 3, "b"] });
    eq(mixed?.unverified, ["a", "b"], "the writer drops non-string unverified entries");
    const absent = asCheckpoint({ ...checkpoint, unverified: "not-an-array" });
    eq(absent?.unverified, undefined, "the writer drops a non-array unverified value");

    const schemaDir = join(work, "state-schema");
    mkdirSync(schemaDir, { recursive: true });
    const schemaPath = join(schemaDir, "state.json");
    const manager = new StateManager(schemaDir, () => schemaPath);
    const seed = {
      id: "H-900",
      from: "@tawa",
      to: "dev",
      task: "checkpoint round trip",
      context: "a handoff carrying the clipped checkpoint",
      files: [],
      timestamp: new Date().toISOString(),
      status: "pending",
      checkpoint: clipped,
    };
    const validation = manager.validateStateData({ version: 1, records: [], handoffs: [seed] });
    assert(validation.valid, "a handoff with a clipped checkpoint passes validateStateData");
    if (validation.valid) {
      const sanitized = validation.sanitized.handoffs as Array<{ checkpoint?: Checkpoint }>;
      eq(sanitized[0]?.checkpoint?.unverified, ["a", "b", "c", "d", "e"], "validation keeps exactly five unverified entries");
    }

    console.log(`PROOF PASS: record search ranks, caps, and never mutates (${passed} assertions)`);
  } finally {
    resetContinuity();
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
