import "./proof-log-isolate.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoalStore } from "../src/services/goal-store.ts";

delete process.env.TAWASSUL_GOAL_AUTOCLOSE;

let passed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`ok ${msg}`);
    return;
  }
  console.error(`PROOF FAIL: ${msg}`);
  process.exit(1);
}

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exit(1);
}

async function seed(store: GoalStore, title: string, items: string[]): Promise<string> {
  const created = await store.create({ title, owner: "@dev", items });
  if (!created.ok || !("goal" in created) || !created.goal) fail(`seed failed for ${title}`);
  return created.goal.id;
}

const dir = mkdtempSync(join(tmpdir(), "tawassul-goal-ids-"));
try {
  const store = new GoalStore(dir);
  const id = await seed(store, "id reuse", ["first deliverable"]);
  const first = `${id}-I1`;

  const done1 = await store.update(id, {
    itemEvidence: [{ itemId: first, text: "first deliverable verified by an isolated run" }],
    itemStates: [{ itemId: first, state: "done" }],
  });
  assert(done1.ok, "first item completes");
  const afterFirst = store.get(id);
  if (!afterFirst) fail("goal vanished after the first completion");
  assert(!afterFirst.items.some((i) => i.id === first), "completed item leaves the live list");
  assert(afterFirst.completedItems.some((c) => c.id === first), "completed item is archived with its evidence");
  assert(afterFirst.progressPct === 100, "progress reaches 100 after the only item completes");

  const added = await store.update(id, { itemsAdd: ["second deliverable"] });
  assert(added.ok, "itemsAdd succeeds after an item was archived");
  const afterAdd = store.get(id);
  if (!afterAdd) fail("goal vanished after itemsAdd");
  const fresh = afterAdd.items[0];
  if (!fresh) fail("the added item is missing");
  assert(fresh.id !== first, "a new item never reuses an archived id");
  assert(fresh.id === `${id}-I2`, "the new item takes the next free index");

  const done2 = await store.update(id, {
    itemEvidence: [{ itemId: fresh.id, text: "second deliverable verified by an isolated run" }],
    itemStates: [{ itemId: fresh.id, state: "done" }],
  });
  assert(done2.ok, "the new item completes");
  const afterSecond = store.get(id);
  if (!afterSecond) fail("goal vanished after the second completion");
  assert(afterSecond.items.length === 0, "no live item remains");
  assert(afterSecond.completedItems.length === 2, "both deliverables are archived");
  assert(afterSecond.progressPct === 100, "progress stays at 100 with both items archived");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const legacyDir = mkdtempSync(join(tmpdir(), "tawassul-goal-legacy-"));
try {
  const writer = new GoalStore(legacyDir);
  const id = await seed(writer, "legacy collision", ["legacy live deliverable"]);
  const itemId = `${id}-I1`;
  const lines = readFileSync(writer.paths.events, "utf8").trim().split("\n");
  const goal = JSON.parse(lines[lines.length - 1] as string) as {
    items: Array<Record<string, unknown>>;
    completedItems: Array<Record<string, unknown>>;
    progressPct: number;
  };
  goal.items = [
    {
      id: itemId,
      title: "legacy live deliverable",
      state: "in_progress",
      evidence: [],
      verifiedBy: null,
      updatedAt: new Date().toISOString(),
    },
  ];
  goal.completedItems = [
    {
      id: itemId,
      title: "legacy archive from an earlier round",
      completedAt: new Date(Date.now() - 86_400_000).toISOString(),
      evidence: ["earlier round evidence"],
    },
  ];
  goal.progressPct = 50;
  writeFileSync(writer.paths.events, [...lines.slice(0, -1), JSON.stringify(goal)].join("\n") + "\n");

  const store = new GoalStore(legacyDir);
  await store.ensureLoaded();
  const done = await store.update(id, {
    itemEvidence: [{ itemId, text: "legacy live deliverable re-verified on the current build" }],
    itemStates: [{ itemId, state: "done" }],
  });
  assert(done.ok, "done succeeds when an archived duplicate holds the same id");
  const after = store.get(id);
  if (!after) fail("legacy goal vanished");
  assert(!after.items.some((i) => i.id === itemId), "the live item is archived instead of silently skipped");
  assert(
    after.completedItems.filter((c) => c.id === itemId).length === 2,
    "history keeps the old archive and records the new completion",
  );
  assert(after.progressPct === 100, "progress reflects the repair");

  const repeat = await store.update(id, { itemStates: [{ itemId, state: "done" }] });
  assert(repeat.ok, "re-completing an archived item stays idempotent");
  const afterRepeat = store.get(id);
  if (!afterRepeat) fail("legacy goal vanished after the repeat");
  assert(
    afterRepeat.completedItems.filter((c) => c.id === itemId).length === 2,
    "re-completing does not duplicate the archived entry",
  );

  const restored = await store.update(id, { itemStates: [{ itemId, state: "in_progress" }] });
  assert(restored.ok, "an archived duplicate can be restored");
  const afterRestore = store.get(id);
  if (!afterRestore) fail("legacy goal vanished after the restore");
  const live = afterRestore.items.find((i) => i.id === itemId);
  if (!live) fail("the restored item is missing");
  assert(live.title === "legacy live deliverable", "restore prefers the newest archive, not the stale one");
} finally {
  rmSync(legacyDir, { recursive: true, force: true });
}

console.log(`PROOF PASS: goal item ids never collide and done transitions are never skipped (${passed} assertions)`);
