import { existsSync, unlinkSync } from "node:fs";
import { createSessionCompactedHook } from "../src/hooks/session.ts";
import type { RecordEntry } from "../src/context/types.ts";

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

function record(id: string, title: string, ageMs: number): RecordEntry {
  return {
    id,
    type: "decision",
    timestamp: new Date(Date.UTC(2026, 9, 31, 12, 0, 0) - ageMs).toISOString(),
    agent: "dev",
    title,
    detail: `detail for ${id}`,
  };
}

const records: RecordEntry[] = [];
for (let i = 1; i <= 105; i += 1) {
  const id = `R-${String(i).padStart(3, "0")}`;
  let title = `Decision ${i}`;
  if (i <= 12) title = "Repeated decision title";
  if (i >= 96) title = "Tail shared title";
  records.push(record(id, title, i * 1_000));
}
records.push(record("R-050", "Duplicate id row", 50 * 1_000));

const snapshot = JSON.stringify(records);
const soakPath = `/tmp/opencode/prove-record-digest-dedupe-${process.pid}.jsonl`;
process.env.TAWASSUL_SOAK_LOG = soakPath;

const hook = createSessionCompactedHook({
  records,
  handoffs: [],
  agentErrors: {},
  getMaxCompactItems: () => 10,
  sessionId: "s-digest",
});
const output: { context: string[] } = { context: [] };
await hook({ sessionID: "s-digest" }, output);
const digest = output.context.join("\n");

assert(digest.includes("### 📋 Session Records (10 detail)"), "the digest renders the detail cap");
assert(digest.includes("Repeated decision title ×12"), "a repeated title is annotated with its distinct-id count");
assert(digest.includes("Tail shared title ×10"), "the detail section annotates its repeated title");
assert(digest.includes("Decision 13"), "a unique title stays unannotated");
assert(!digest.includes("Decision 13 ×"), "a unique title never gains a counter");
assert(!digest.includes("Duplicate id row"), "a duplicate id entry is collapsed by id, not by title");
assert(digest.split("R-050").length - 1 === 1, "the duplicate id appears exactly once");

assert(digest.includes("Records: 105 · Handoffs: 0"), "the index counts distinct record ids");
assert(digest.includes("+95 more records"), "the detail tail counts distinct hidden ids");
assert(digest.includes("+5 older records (ids R-101…R-105)"), "the index tail counts distinct hidden ids");
for (let i = 1; i <= 100; i += 1) {
  const id = `R-${String(i).padStart(3, "0")}`;
  assert(digest.includes(id), `the index keeps distinct id ${id}`);
}
assert(digest.includes("R-101…R-105"), "the hidden tail keeps both distinct range endpoints");
assert(!/[0-9a-f]{16,}/i.test(digest), "no content hash replaces a record id");
assert(JSON.stringify(records) === snapshot, "the digest never mutates, deletes, or merges the store");
assert(records.length === 106, "the store still holds every entry it started with");

if (existsSync(soakPath)) unlinkSync(soakPath);
console.log(`PROOF PASS: repeated titles are annotated while distinct record ids survive (${passed} assertions)`);
