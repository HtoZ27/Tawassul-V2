import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoalStore, checkCloseInvariant } from "../src/services/goal-store.ts";
import { runTodoReconcile } from "../src/services/goal-auto.ts";

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

const dir = mkdtempSync(join(tmpdir(), "tawassul-goal-item-update-"));

try {
  const store = new GoalStore(dir, { lockManager: null, minEvidenceIntervalMs: 0 });
  const created = await store.create({
    title: "owner can rewrite or drop items",
    owner: "@dev",
    items: ["draft item", "second item"],
    acceptance: ["owner decision is recorded"],
  });
  if (!created.ok) fail(`seed goal failed: ${created.reason}`);
  const goalId = created.goal.id;
  const firstId = created.goal.items[0]?.id ?? "";
  const secondId = created.goal.items[1]?.id ?? "";

  const renamed = await store.update(goalId, {
    itemTitles: [{ itemId: firstId, title: "renamed item" }],
  });
  const renamedGoal = renamed.ok ? renamed.goal : fail("itemTitles updates an active item title");
  assert(renamed.ok, "itemTitles updates an active item title");
  assert(renamedGoal.items.find((i) => i.id === firstId)?.title === "renamed item", "the stored title is the new wording");

  const blank = await store.update(goalId, { itemTitles: [{ itemId: firstId, title: "   " }] });
  assert(!blank.ok && blank.reason === "required", "a blank item title is refused");

  const unknown = await store.update(goalId, { itemTitles: [{ itemId: "G-999-I9", title: "x" }] });
  assert(!unknown.ok && unknown.reason === "unknown-item", "an unknown item title target is refused");

  const dropWithoutEvidence = await store.update(goalId, {
    itemStates: [{ itemId: secondId, state: "dropped" }],
  });
  assert(
    !dropWithoutEvidence.ok && dropWithoutEvidence.reason === "item-evidence",
    "a dropped item needs a recorded owner reason",
  );

  const evidence = await store.update(goalId, {
    itemEvidence: [{ itemId: secondId, text: "owner decided the second item is not needed" }],
    itemStates: [{ itemId: secondId, state: "dropped" }],
  });
  const evidenceGoal = evidence.ok ? evidence.goal : fail("evidence and the dropped state land in one update");
  assert(evidence.ok, "evidence and the dropped state land in one update");
  assert(evidenceGoal.items.find((i) => i.id === secondId)?.state === "dropped", "the item is dropped, not silently removed");
  assert(evidenceGoal.progressPct === 50, "a dropped item counts as resolved in progress");

  const done = await store.update(goalId, {
    itemEvidence: [{ itemId: firstId, text: "the renamed item is implemented" }],
    itemStates: [{ itemId: firstId, state: "done" }],
  });
  const doneGoal = done.ok ? done.goal : fail("the remaining item can be completed");
  assert(done.ok, "the remaining item can be completed");
  assert(doneGoal.completedItems.some((i) => i.id === firstId), "a done item archives as completed");

  const invariant = checkCloseInvariant({
    items: [{ id: "G-1-I1", title: "x", state: "pending", evidence: [], verifiedBy: null, updatedAt: "" }],
    completedItems: [],
    acceptance: [],
  });
  assert(!invariant.ok, "a pending item still blocks close");
  const droppedInvariant = checkCloseInvariant({
    items: [{ id: "G-1-I1", title: "x", state: "dropped", evidence: ["owner: not needed"], verifiedBy: null, updatedAt: "" }],
    completedItems: [],
    acceptance: [],
  });
  assert(droppedInvariant.ok, "a dropped item no longer blocks close");

  const covered = await store.update(goalId, {
    acceptanceEvidence: [{ criterion: "owner decision is recorded", text: "the dropped item carries the owner reason" }],
    acceptanceStates: [{ criterion: "owner decision is recorded", status: "met" }],
  });
  assert(covered.ok, "the owner decision satisfies the acceptance criterion");

  const closed = await store.close(goalId, false, "@dev");
  const closedGoal = closed.ok ? closed.goal : fail("a goal with a dropped item and a done item closes");
  assert(closed.ok, "a goal with a dropped item and a done item closes");
  assert(closedGoal.progressPct === 100, "the closed goal reports 100% resolved");
  assert(closedGoal.items.some((i) => i.state === "dropped"), "the dropped item stays visible in the closed record");

  const reconcileDir = mkdtempSync(join(tmpdir(), "tawassul-goal-item-reconcile-"));
  try {
    const reconcileStore = new GoalStore(reconcileDir, { lockManager: null, minEvidenceIntervalMs: 0 });
    const seeded = await reconcileStore.create({
      title: "owner drop survives todo reconcile",
      owner: "@dev",
      detail: "ses_owner_drop",
      items: ["keep me dropped"],
    });
    if (!seeded.ok) fail(`reconcile seed failed: ${seeded.reason}`);
    const itemId = seeded.goal.items[0]?.id ?? "";
    const dropped = await reconcileStore.update(seeded.goal.id, {
      itemEvidence: [{ itemId, text: "owner says this item is not needed" }],
      itemStates: [{ itemId, state: "dropped" }],
    });
    assert(dropped.ok, "the reconcile seed item is dropped");
    const reconciled = await runTodoReconcile({
      store: reconcileStore,
      sessionId: "ses_owner_drop",
      owner: "@dev",
      todos: [{ title: "keep me dropped", status: "in_progress" }],
    });
    assert(reconciled.ok, "todo reconcile runs against the same goal");
    const after = reconcileStore.get(seeded.goal.id);
    assert(
      after?.items.find((i) => i.id === itemId)?.state === "dropped",
      "todo reconcile never resurrects an owner-dropped item",
    );
  } finally {
    rmSync(reconcileDir, { recursive: true, force: true });
  }

  console.log(`PROOF PASS: goal items accept owner wording and owner drops without resurrection (${passed} assertions)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
