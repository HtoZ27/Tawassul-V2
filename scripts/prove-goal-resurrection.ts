import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoalStore } from "../src/services/goal-store.ts";
import type { Goal } from "../src/types/goal-types.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function seed(store: GoalStore): Promise<string> {
  const created = await store.create({ title: "victim goal", owner: "@dev" });
  if (!created.ok || !("goal" in created) || !created.goal) fail("seed failed");
  return (created.goal as { id: string }).id;
}

async function expectNoGhost(
  kind: string,
  run: (store: GoalStore, id: string) => Promise<{ ok: boolean; reason?: string }>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-resurrect-"));
  try {
    const store = new GoalStore(dir);
    const id = await seed(store);
    const pending = run(store, id);
    await new Promise((r) => setTimeout(r, 25));
    const del = await store.deleteGoal(id);
    const res = await pending;
    if (!del.ok && del.reason !== "not-found") fail(`${kind}: unexpected delete reason ${del.reason}`);
    if (!del.ok && !res.ok) fail(`${kind}: neither the delete nor the pending mutation won`);
    if (store.get(id) !== undefined) fail(`${kind}: goal physically present after delete`);
    const reloaded = new GoalStore(dir);
    await reloaded.ensureLoaded();
    if (reloaded.get(id) !== undefined) fail(`${kind}: deleted goal resurrected on reload`);
    const after = await run(reloaded, id);
    if (after.ok) fail(`${kind}: a mutation after the delete resurrected the goal`);
    if (after.reason !== "not-found") fail(`${kind}: unexpected loser reason ${after.reason}`);
    console.log(`ok ${kind} pending=${res.ok ? "committed" : res.reason} delete=${del.ok ? "won" : del.reason}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await expectNoGhost("appendEvidence-vs-delete", (s, id) =>
  s.appendEvidence(id, "concurrent evidence text long enough"),
);
await expectNoGhost("update-vs-delete", (s, id) => s.update(id, { title: "updated during delete" }));

const legacyDir = mkdtempSync(join(tmpdir(), "tawassul-resurrect-legacy-"));
try {
  mkdirSync(join(legacyDir, "goals"), { recursive: true });
  const stamp = new Date().toISOString();
  const record = (seq: number, status: Goal["status"]): Goal => ({
    id: "G-001",
    seq,
    title: "legacy terminal goal",
    detail: "",
    status,
    progressPct: status === "verified" ? 100 : 0,
    owner: "@dev",
    ownerKind: "solo",
    parentId: null,
    items: [],
    completedItems: [],
    acceptance: [],
    linkedRecords: [],
    linkedHandoffs: [],
    linkedBoards: [],
    evidence: [],
    evidenceHashes: [],
    pinned: false,
    createdAt: stamp,
    updatedAt: stamp,
    verifiedBy: null,
    lastEvidenceAt: null,
  });
  writeFileSync(
    join(legacyDir, "goals", "goals.jsonl"),
    `${JSON.stringify(record(1, "verified"))}\n${JSON.stringify(record(2, "dropped"))}\n`,
  );
  const legacy = new GoalStore(legacyDir, { lockManager: null });
  await legacy.ensureLoaded();
  const tomb = legacy.getAny("G-001");
  if (!tomb || tomb.status !== "dropped") fail("legacy: dropped record is not readable as a tombstone");
  if (tomb.closedAs !== "dropped") fail(`legacy: closedAs backfill is ${String(tomb.closedAs)}, expected dropped`);
  if (!legacy.list("dropped").some((g) => g.id === "G-001")) fail("legacy: dropped filter hides the record");
  const counts = legacy.lifecycleSnapshot();
  if (counts.dropped !== 1) fail(`legacy: dropped count is ${counts.dropped}, expected 1`);
  if (counts.verified !== 0) fail(`legacy: verified count is ${counts.verified}, expected 0`);
  console.log("ok legacy record without closedAs counts as dropped");
} finally {
  rmSync(legacyDir, { recursive: true, force: true });
}

console.log("PROOF PASS: goal resurrection accepts both losers, never writes ghosts");
