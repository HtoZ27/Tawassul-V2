import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLockManager } from "../src/infra/file-lock.ts";
import { GoalStore, checkCloseInvariant, isEmptyGoal } from "../src/services/goal-store.ts";
import type { GoalStoreOptions } from "../src/services/goal-store.ts";
import { buildGoalTool } from "../src/tools/goal.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

let passed = 0;
const dirs: string[] = [];

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `tawassul-goal-stale-${tag}-`));
  dirs.push(dir);
  return dir;
}

function makeStore(dir: string, options: GoalStoreOptions = {}): GoalStore {
  return new GoalStore(dir, { lockManager: null, minEvidenceIntervalMs: 0, ...options });
}

function toolContext(dir: string): {
  sessionID: string;
  messageID: string;
  agent: string;
  directory: string;
  worktree: string;
  abort: AbortSignal;
  metadata: () => void;
} {
  return {
    sessionID: "ses_goal_stale_proof",
    messageID: "msg_goal_stale_proof",
    agent: "tawa",
    directory: dir,
    worktree: dir,
    abort: new AbortController().signal,
    metadata: () => undefined,
  };
}

async function completeGoal(store: GoalStore, title: string): Promise<string> {
  const created = await store.create({ title, owner: "@dev", acceptance: ["done"] });
  if (!created.ok) fail(`seed "${title}" failed: ${created.reason}`);
  const covered = await store.update(created.goal.id, {
    acceptanceEvidence: [{ criterion: "done", text: "acceptance covered by the sweep proof" }],
    acceptanceStates: [{ criterion: "done", status: "met" }],
  });
  if (!covered.ok) fail(`seed "${title}" could not cover acceptance: ${covered.reason}`);
  return created.goal.id;
}

async function incompleteGoal(store: GoalStore, title: string, detail?: string): Promise<string> {
  const created = await store.create({ title, owner: "@dev", detail, acceptance: ["done"] });
  if (!created.ok) fail(`seed "${title}" failed: ${created.reason}`);
  return created.goal.id;
}

try {
  delete process.env.TAWASSUL_GOAL_AUTOCLOSE;

  const offDir = tempDir("off");
  const offStore = makeStore(offDir, { maxGoals: 3 });
  const offCompleteA = await completeGoal(offStore, "flag-off complete A");
  const offCompleteB = await completeGoal(offStore, "flag-off complete B");
  const offIncomplete = await incompleteGoal(offStore, "flag-off incomplete");
  const offSwept = await offStore.markStale(0, Date.now() + 60_000);
  assert(
    offSwept.length === 2 && offSwept.includes(offCompleteA) && offSwept.includes(offCompleteB),
    "flag-off markStale still stales the fully complete goals",
  );
  assert(!offSwept.includes(offIncomplete), "flag-off markStale still skips the incomplete goal");
  assert(offStore.get(offIncomplete)?.status === "open", "flag-off incomplete goal keeps its status");
  assert(offStore.list("stale").length === 2, "flag-off stale filter returns both staled goals");
  assert(
    offStore.list("active").some((g) => g.id === offCompleteA),
    "flag-off stale goal stays in the active roster",
  );
  const offDigest = offStore.buildDigest().text;
  assert(offDigest.split("\n")[0] === "🎯 3 open", "flag-off stale goals are counted open");
  assert(offStore.staleSection() === "", "flag-off board carries no Stale section");
  const offBoard = await buildGoalTool(offStore).execute({ board: true }, toolContext(offDir));
  assert(
    !String((offBoard as { output?: string }).output ?? "").includes("STALE"),
    "flag-off board output carries no Stale section",
  );
  const offCapture = await offStore.reconcileCapture({
    owner: "@dev",
    sessionId: "ses_flag_off_capture",
    todos: [{ title: "fresh work", status: "pending" }],
  });
  assert(
    !offCapture.ok && offCapture.reason === "max",
    "flag-off stale goals still consume the active goal cap",
  );

  const staleCloseDir = tempDir("stale-close");
  const staleCloseStore = makeStore(staleCloseDir);
  const staleCloseId = await completeGoal(staleCloseStore, "stale close");
  const staleCloseSwept = await staleCloseStore.markStale(0, Date.now() + 60_000);
  assert(
    staleCloseSwept.length === 1 && staleCloseSwept[0] === staleCloseId,
    "the complete stale-close seed is swept",
  );
  const staleClose = await staleCloseStore.close(staleCloseId, false, "@dev");
  assert(staleClose.ok, "a complete stale goal closes as completed");
  assert(
    staleCloseStore.getAny(staleCloseId)?.closedAs === "completed",
    "the stale close records the completed terminal status",
  );

  const staleVerifyDir = tempDir("stale-verify");
  const staleVerifyStore = makeStore(staleVerifyDir);
  const staleVerifyId = await completeGoal(staleVerifyStore, "stale verify");
  const staleVerifyEvidence = await staleVerifyStore.appendEvidence(
    staleVerifyId,
    "goal evidence for the stale verify path",
  );
  assert(staleVerifyEvidence.ok, "the stale verify seed accepts goal evidence");
  await staleVerifyStore.markStale(0, Date.now() + 60_000);
  const staleVerify = await staleVerifyStore.close(staleVerifyId, true, "@dev");
  assert(staleVerify.ok, "a complete stale goal verifies through the close path");
  assert(
    staleVerifyStore.getAny(staleVerifyId)?.closedAs === "verified",
    "the stale verify records the verified terminal status",
  );

  process.env.TAWASSUL_GOAL_AUTOCLOSE = "1";

  const closeDir = tempDir("close");
  const closeStore = makeStore(closeDir);
  const closeId = await completeGoal(closeStore, "flag-on complete goal");
  const closedSeed = closeStore.get(closeId);
  if (!closedSeed) fail("flag-on complete goal is missing before the sweep");
  assert(checkCloseInvariant(closedSeed).ok, "the closeable seed passes the close invariant");
  const closeSwept = await closeStore.markStale(0, Date.now() + 60_000);
  assert(closeSwept.length === 1 && closeSwept[0] === closeId, "flag-on sweep reports the auto-closed goal");
  const closed = closeStore.getAny(closeId);
  if (!closed) fail("the auto-closed goal is missing from the ledger");
  assert(closed.status === "dropped" && closed.closedAs === "completed", "flag-on sweep closes the goal as completed");
  assert(closeStore.list("active").length === 0, "the auto-closed goal leaves the active roster");
  assert(closeStore.list("completed").some((g) => g.id === closeId), "the auto-closed goal is visible as completed");
  assert(closeStore.lifecycleSnapshot().completed === 1, "the auto-close bumps the completed lifecycle count");
  assert(closeStore.staleSection() === "", "an auto-closed goal adds no Stale section");
  const closeDigestLine = closeStore.buildDigest({ terminalCounts: true }).text.split("\n")[0] ?? "";
  assert(
    closeDigestLine === "🎯 0 open · ✅ 1 completed · ✔ 0 verified · 🗑 0 dropped",
    "the auto-closed goal appears once in the board counts",
  );

  const dodDir = tempDir("dod");
  const dodStore = makeStore(dodDir);
  const dodCreated = await dodStore.create({
    title: "unmet DoD goal",
    owner: "@dev",
    items: ["unfinished work"],
    acceptance: ["done"],
  });
  if (!dodCreated.ok) fail("unmet DoD seed failed");
  const itemId = dodCreated.goal.items[0]?.id;
  if (!itemId) fail("unmet DoD seed has no item");
  const itemDone = await dodStore.update(dodCreated.goal.id, {
    itemEvidence: [{ itemId, text: "item evidence for the sweep proof" }],
    itemStates: [{ itemId, state: "done" }],
  });
  if (!itemDone.ok) fail(`the item could not be completed: ${itemDone.reason}`);
  const dodSwept = await dodStore.markStale(0, Date.now() + 60_000);
  assert(dodSwept.length === 1 && dodSwept[0] === dodCreated.goal.id, "an unmet DoD goal is not auto-closed");
  assert(dodStore.get(dodCreated.goal.id)?.status === "stale", "an unmet DoD goal becomes stale when old");
  assert(dodStore.lifecycleSnapshot().completed === 0, "the unmet DoD goal adds no completed count");
  const dodCovered = await dodStore.update(dodCreated.goal.id, {
    acceptanceEvidence: [{ criterion: "done", text: "acceptance covered after the stale sweep" }],
    acceptanceStates: [{ criterion: "done", status: "met" }],
  });
  if (!dodCovered.ok) fail(`the stale goal could not cover its DoD: ${dodCovered.reason}`);
  const dodClosed = await dodStore.markStale(0, Date.now() + 60_000);
  assert(dodClosed.length === 1 && dodClosed[0] === dodCreated.goal.id, "a completed stale goal is auto-closed");
  assert(dodStore.getAny(dodCreated.goal.id)?.closedAs === "completed", "the completed stale goal closes as completed");
  assert(dodStore.lifecycleSnapshot().completed === 1, "the completed stale goal bumps the completed count");

  const soloDir = tempDir("solo");
  const soloStore = makeStore(soloDir, { maxGoals: 1 });
  const soloId = await incompleteGoal(soloStore, "single stale goal");
  const soloSwept = await soloStore.markStale(0, Date.now() + 60_000);
  assert(soloSwept.length === 1 && soloSwept[0] === soloId, "a single old incomplete goal becomes stale");
  assert(soloStore.list("active").length === 0, "a stale goal leaves the active roster");
  assert(soloStore.list("stale").some((g) => g.id === soloId), "the stale filter returns the stale goal");
  assert(soloStore.list("all").some((g) => g.id === soloId), "the all filter returns the stale goal");
  const soloDigest = soloStore.buildDigest({ terminalCounts: true });
  assert(soloDigest.open === 0 && soloDigest.attention === 1, "the stale goal surfaces through the attention scan");
  assert(
    soloDigest.text.includes(`⏳ **${soloId}** stale`),
    "the attention line names the stale goal",
  );
  const soloCompact = soloStore.compactDigest();
  assert(soloCompact.startsWith("### 🎯 Goals (0 open)"), "compactDigest keeps the zero-open header");
  assert(soloCompact.includes(soloId), "compactDigest surfaces the single stale goal");
  const soloSection = soloStore.staleSection();
  assert(soloSection.startsWith("\n\n⏳ STALE (1):"), "the Stale section starts with a bounded heading");
  assert(soloSection.includes(soloId), "the Stale section lists the stale goal");
  const soloBoard = await buildGoalTool(soloStore).execute({ board: true }, toolContext(soloDir));
  const soloOutput = String((soloBoard as { output?: string }).output ?? "");
  assert(soloOutput.includes(soloSection), "goal(board: true) appends the Stale section");
  const soloCapture = await soloStore.reconcileCapture({
    owner: "@dev",
    sessionId: "ses_after_stale",
    todos: [{ title: "replacement work", status: "pending" }],
  });
  assert(soloCapture.ok, "a stale goal frees the active goal cap");
  if (soloCapture.ok) {
    assert(soloCapture.goal.id !== soloId, "the freed cap creates a distinct active goal");
  }

  const emptyDir = tempDir("empty");
  const emptyStore = makeStore(emptyDir, { maxGoals: 1 });
  const emptyCreated = await emptyStore.create({
    title: "empty ledger goal",
    owner: "@dev",
    detail: "ses_empty_goal",
  });
  if (!emptyCreated.ok) fail("empty goal seed failed");
  const emptyId = emptyCreated.goal.id;
  assert(isEmptyGoal(emptyCreated.goal), "the empty goal has no items and no DoD");
  assert(!checkCloseInvariant(emptyCreated.goal).ok, "the empty goal fails the close invariant");
  const emptySwept = await emptyStore.markStale(0, Date.now() + 60_000);
  assert(emptySwept.length === 0, "the sweep never auto-closes an empty goal");
  assert(emptyStore.get(emptyId)?.status === "open", "the empty goal keeps its open status");
  assert(emptyStore.list("active").length === 0, "the empty goal is not counted active");
  const emptyDigest = emptyStore.buildDigest({ terminalCounts: true });
  assert(emptyDigest.text.includes(`▫️ **${emptyId}** empty`), "the empty goal enters the attention bucket");
  assert(emptyStore.compactDigest().includes(emptyId), "compactDigest surfaces the empty goal");
  const emptyCapture = await emptyStore.reconcileCapture({
    owner: "@dev",
    sessionId: "ses_empty_goal",
    todos: [{ title: "captured work", status: "pending" }],
  });
  assert(emptyCapture.ok, "capture is not blocked by the empty goal");
  if (emptyCapture.ok) {
    assert(emptyCapture.goal.id !== emptyId, "pickCaptureGoal never returns the empty goal");
    assert(emptyStore.list("active").some((g) => g.id === emptyCapture.goal.id), "capture creates an active goal");
  }

  const pinDir = tempDir("pinned");
  const pinStore = makeStore(pinDir);
  const pinOpen = await incompleteGoal(pinStore, "pinned open goal");
  const pinDone = await completeGoal(pinStore, "pinned complete goal");
  if (!(await pinStore.update(pinOpen, { pinned: true })).ok) fail("could not pin the open goal");
  if (!(await pinStore.update(pinDone, { pinned: true })).ok) fail("could not pin the complete goal");
  const pinSwept = await pinStore.markStale(0, Date.now() + 60_000);
  assert(pinSwept.length === 0, "the sweep skips every pinned goal");
  assert(pinStore.get(pinOpen)?.status === "open", "the pinned incomplete goal is not staled");
  assert(pinStore.get(pinDone)?.status === "open", "the pinned complete goal is not auto-closed");

  const lockDir = tempDir("lock");
  const lockManager = new FileLockManager(false);
  const lockStore = makeStore(lockDir, { lockManager });
  const lockId = await incompleteGoal(lockStore, "locked sweep goal");
  const held = await lockManager.acquireLock(lockStore.paths.meta, "proof-holder", "sweep");
  assert(held.acquired, "the proof holds the store lock");
  const lockedSwept = await lockStore.markStale(0, Date.now() + 60_000);
  assert(lockedSwept.length === 0, "a held lock skips the sweep");
  assert(lockStore.get(lockId)?.status === "open", "the skipped sweep leaves the goal untouched");
  await lockManager.releaseLock(lockStore.paths.meta, "proof-holder");
  const retried = await lockStore.markStale(0, Date.now() + 60_000);
  assert(retried.length === 1 && retried[0] === lockId, "the next sweep retries after the lock is free");
  assert(lockStore.get(lockId)?.status === "stale", "the retried sweep reaches the stale state");

  console.log(`PROOF PASS: the stale lifecycle keeps the flag-off path and runs the flag-on close, stale, empty and pinned rules (${passed} assertions)`);
} finally {
  delete process.env.TAWASSUL_GOAL_AUTOCLOSE;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
