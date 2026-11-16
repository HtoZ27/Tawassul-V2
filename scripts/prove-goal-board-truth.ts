import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoalStore } from "../src/services/goal-store.ts";
import { runTodoReconcile } from "../src/services/goal-auto.ts";
import { hostGoalSuffix } from "../src/services/host-goal.ts";
import type { HostGoalState } from "../src/services/host-goal.ts";

delete process.env.TAWASSUL_GOAL_AUTOCLOSE;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

const dirs: string[] = [];

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `tawassul-goal-board-${tag}-`));
  dirs.push(dir);
  return dir;
}

function makeStore(dir: string): GoalStore {
  return new GoalStore(dir, { lockManager: null, minEvidenceIntervalMs: 0 });
}

async function closeable(store: GoalStore, title: string): Promise<string> {
  const created = await store.create({ title, owner: "@dev", acceptance: ["done"] });
  if (!created.ok) fail(`seed "${title}" failed: ${created.reason}`);
  const covered = await store.update(created.goal.id, {
    acceptanceEvidence: [{ criterion: "done", text: "acceptance covered by proof" }],
    acceptanceStates: [{ criterion: "done", status: "met" }],
  });
  if (!covered.ok) fail(`seed "${title}" could not cover acceptance: ${covered.reason}`);
  return created.goal.id;
}

function hostGoal(status: HostGoalState["status"]): HostGoalState {
  return {
    id: "host-1",
    objective: "ship the goal ledger repair",
    status,
    rounds: 3,
    maxRounds: 10,
    boot: "boot-1",
    updatedAt: 1,
  };
}

try {
  const dir = tempDir("counts");
  const store = makeStore(dir);
  await store.create({ title: "active goal", owner: "@dev" });
  const completedId = await closeable(store, "completed goal");
  assert((await store.close(completedId, false, "@dev")).ok, "seed closes one completed goal");
  const verifiedId = await closeable(store, "verified goal");
  assert((await store.appendEvidence(verifiedId, "goal level evidence for verify")).ok, "seed adds verify evidence");
  assert((await store.close(verifiedId, true, "@dev")).ok, "seed closes one verified goal");
  const dropped = await store.create({ title: "dropped goal", owner: "@dev" });
  if (!dropped.ok) fail("seed dropped goal failed");
  assert((await store.deleteGoal(dropped.goal.id)).ok, "seed drops one goal");

  const defaultLine = store.buildDigest().text.split("\n")[0] ?? "";
  assert(defaultLine === "🎯 1 open", "default digest line carries the open count only");
  assert(!defaultLine.includes("completed"), "default digest line omits completed");
  assert(!defaultLine.includes("dropped"), "default digest line omits dropped");

  const counts = store.buildDigest({ terminalCounts: true }).text.split("\n")[0] ?? "";
  assert(
    counts === "🎯 1 open · ✅ 1 completed · ✔ 1 verified · 🗑 1 dropped",
    "terminalCounts renders the full counts line",
  );
  assert(counts.includes("1 completed"), "terminalCounts keeps the completed segment");
  assert(counts.includes("1 verified"), "terminalCounts keeps the verified segment");
  assert(counts.includes("1 dropped"), "terminalCounts keeps the dropped segment");

  const compact = store.compactDigest();
  assert(compact.startsWith("### 🎯 Goals (1 open)"), "compactDigest keeps its open header");
  const compactBody = compact.split("\n").slice(1).join("\n");
  assert(!compactBody.includes("completed"), "compactDigest carries no completed count");
  assert(!compactBody.includes("dropped"), "compactDigest carries no dropped count");

  const auto = await runTodoReconcile({
    store,
    sessionId: "ses_board_proof",
    owner: "@dev",
    todos: [{ title: "active goal", status: "in_progress" }],
  });
  assert(auto.ok, "todo reconcile attaches a digest");
  if (auto.ok) {
    const autoDigest = auto.digest ?? "";
    assert(autoDigest.length > 0, "todo reconcile returns a digest body");
    const autoLine = autoDigest.split("\n")[0] ?? "";
    assert(autoLine === "🎯 1 open", "goal-auto digest carries the open count only");
  }

  assert(hostGoalSuffix(hostGoal("complete")) === "", "a complete host goal is not appended");
  const activeSuffix = hostGoalSuffix(hostGoal("active"));
  assert(activeSuffix.includes("Host /goal · active · 3/10"), "an active host goal is appended");
  const pausedSuffix = hostGoalSuffix(hostGoal("paused"));
  assert(pausedSuffix.includes("Host /goal · paused · 3/10"), "a paused host goal is appended");
  assert(hostGoalSuffix(null) === "", "a missing host goal appends nothing");

  const staleDir = tempDir("stale");
  const staleStore = makeStore(staleDir);
  const staleCreated = await staleStore.create({ title: "stale candidate", owner: "@dev", acceptance: ["done"] });
  if (!staleCreated.ok) fail("stale seed failed");
  const staleCovered = await staleStore.update(staleCreated.goal.id, {
    acceptanceEvidence: [{ criterion: "done", text: "acceptance covered by proof" }],
    acceptanceStates: [{ criterion: "done", status: "met" }],
  });
  if (!staleCovered.ok) fail("stale seed could not cover acceptance");
  const staled = await staleStore.markStale(0);
  assert(staled.length === 1 && staled[0] === staleCreated.goal.id, "flag-off markStale stales a complete goal as today");
  assert(staleStore.list("stale").some((g) => g.id === staleCreated.goal.id), "filter stale returns the stale goal");
  assert(staleStore.list("active").some((g) => g.id === staleCreated.goal.id), "flag-off stale stays in the active roster");
  assert(staleStore.staleSection() === "", "flag-off board carries no Stale section");

  process.env.TAWASSUL_GOAL_AUTOCLOSE = "1";
  const boundedDir = tempDir("bounded");
  const boundedStore = makeStore(boundedDir);
  for (let n = 1; n <= 12; n++) {
    const seeded = await boundedStore.create({
      title: `bounded stale goal ${n}`,
      owner: "@dev",
      acceptance: ["done"],
    });
    if (!seeded.ok) fail(`bounded stale seed ${n} failed: ${seeded.reason}`);
  }
  const boundedSwept = await boundedStore.markStale(0, Date.now() + 60_000);
  assert(boundedSwept.length === 12, "flag-on sweep marks every incomplete old goal stale");
  assert(boundedStore.list("stale").length === 12, "flag-on filter stale returns every stale goal");
  const boundedSection = boundedStore.staleSection();
  assert(boundedSection.startsWith("\n\n⏳ STALE (12):"), "flag-on Stale section reports the full count");
  const boundedLines = boundedSection.split("\n").filter((line) => line.startsWith("⏳ G-"));
  assert(boundedLines.length === 10, "the Stale section is bounded to ten goals");
  assert(boundedSection.includes("+ 2 more"), "the bounded Stale section points at the remaining goals");
  assert(boundedSection.includes('filter: "stale"'), "the overflow hint names the stale filter");
  delete process.env.TAWASSUL_GOAL_AUTOCLOSE;

  console.log("PROOF PASS: board keeps terminal counts, digests omit them, stale stays filterable");
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
