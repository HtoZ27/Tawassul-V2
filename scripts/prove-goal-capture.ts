import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoalStore } from "../src/services/goal-store.ts";
import { runTodoReconcile } from "../src/services/goal-auto.ts";
import { logger } from "../src/utils/logger.ts";
import type { Goal } from "../src/types/goal-types.ts";

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
  const dir = mkdtempSync(join(tmpdir(), `tawassul-goal-capture-${tag}-`));
  dirs.push(dir);
  return dir;
}

function makeStore(dir: string, maxGoals?: number): GoalStore {
  const options: { lockManager: null; minEvidenceIntervalMs: number; maxGoals?: number } = {
    lockManager: null,
    minEvidenceIntervalMs: 0,
  };
  if (maxGoals !== undefined) options.maxGoals = maxGoals;
  return new GoalStore(dir, options);
}

function countsLine(store: GoalStore): string {
  return store.buildDigest({ terminalCounts: true }).text.split("\n")[0] ?? "";
}

function tombstoneCount(dir: string): number {
  const raw = readFileSync(join(dir, "goals", "goals.jsonl"), "utf-8");
  let n = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line) as { status?: string };
    if (parsed.status === "dropped") n += 1;
  }
  return n;
}

function metaLiveCount(dir: string): number {
  const raw = readFileSync(join(dir, "goals", "goals-meta.json"), "utf-8");
  const parsed = JSON.parse(raw.slice(raw.indexOf("{"))) as { count?: number };
  return parsed.count ?? -1;
}

async function createCloseable(store: GoalStore, title: string): Promise<string> {
  const created = await store.create({ title, owner: "@dev", acceptance: ["done"] });
  if (!created.ok) fail(`seed goal "${title}" failed: ${created.reason}`);
  const id = created.goal.id;
  const covered = await store.update(id, {
    acceptanceEvidence: [{ criterion: "done", text: "acceptance covered by proof" }],
    acceptanceStates: [{ criterion: "done", status: "met" }],
  });
  if (!covered.ok) fail(`seed goal "${title}" could not cover acceptance: ${covered.reason}`);
  return id;
}

try {
  const dirClose = tempDir("close");
  const closeStore = makeStore(dirClose);
  const closeId = await createCloseable(closeStore, "close path");
  const closed = await closeStore.close(closeId, false, "@dev");
  assert(closed.ok, "close() completes a ready goal");
  assert(closeStore.size === 0, "close() removes the goal from the live map");
  assert(closeStore.get(closeId) === undefined, "close() keeps the live lookup empty");
  const closeTomb = closeStore.getAny(closeId);
  assert(closeTomb?.status === "dropped", "close() keeps the tombstone readable by id");
  assert(closeTomb?.closedAs === "completed", "close() records the terminal status on the tombstone");
  assert(!closeStore.list("dropped").some((g) => g.id === closeId), "list(dropped) hides a completed tombstone");
  assert(closeStore.list("completed").some((g) => g.id === closeId), "list(completed) shows a completed tombstone");
  assert(closeStore.list("all").some((g) => g.id === closeId), "list(all) shows the tombstone");
  assert(metaLiveCount(dirClose) === 0, "close() persists a zero live count");
  const closeLine = countsLine(closeStore);
  assert(closeLine.includes("1 completed"), "close() counts one completed goal");
  assert(closeLine.includes("0 verified"), "close() leaves verified empty");
  assert(closeLine.includes("0 dropped"), "close() tombstone is not counted as dropped");
  const defaultCloseLine = closeStore.buildDigest().text.split("\n")[0] ?? "";
  assert(defaultCloseLine === "🎯 0 open", "default digest line carries the open count only");
  assert(tombstoneCount(dirClose) === 1, "close() writes exactly one tombstone");
  const closedAgain = await closeStore.close(closeId, false, "@dev");
  assert(!closedAgain.ok && closedAgain.reason === "not-found", "repeated close cannot double count");
  assert(tombstoneCount(dirClose) === 1, "repeated close writes no extra tombstone");

  const dirUpdate = tempDir("update");
  const updateStore = makeStore(dirUpdate);
  const updateId = await createCloseable(updateStore, "update path");
  const updated = await updateStore.update(updateId, { status: "completed" });
  assert(updated.ok, "update(status completed) completes a ready goal");
  assert(updateStore.size === 0, "terminal update removes the goal from the live map");
  assert(countsLine(updateStore) === closeLine, "close and update produce identical lifecycle counts");
  assert(tombstoneCount(dirUpdate) === 1, "terminal update writes exactly one tombstone");
  const updatedAgain = await updateStore.update(updateId, { status: "completed" });
  assert(!updatedAgain.ok && updatedAgain.reason === "not-found", "repeated terminal update cannot double count");

  const dirVerifyUntilClose = tempDir("verify-close");
  const verifyCloseStore = makeStore(dirVerifyUntilClose);
  const verifyCloseId = await createCloseable(verifyCloseStore, "verify close");
  assert((await verifyCloseStore.appendEvidence(verifyCloseId, "goal level evidence for verify")).ok, "verify seed evidence accepted");
  assert((await verifyCloseStore.close(verifyCloseId, true, "@dev")).ok, "close(verify) completes a ready goal");
  const verifyLine = countsLine(verifyCloseStore);
  assert(verifyLine.includes("1 verified"), "close(verify) counts one verified goal");
  assert(verifyLine.includes("0 completed"), "close(verify) leaves completed empty");
  assert(verifyCloseStore.getAny(verifyCloseId)?.closedAs === "verified", "close(verify) records the verified terminal status");
  assert(verifyCloseStore.list("verified").some((g) => g.id === verifyCloseId), "list(verified) shows a verified tombstone");

  const dirVerifyUpdate = tempDir("verify-update");
  const verifyUpdateStore = makeStore(dirVerifyUpdate);
  const verifyUpdateId = await createCloseable(verifyUpdateStore, "verify update");
  assert((await verifyUpdateStore.appendEvidence(verifyUpdateId, "goal level evidence for verify")).ok, "verify update seed evidence accepted");
  assert((await verifyUpdateStore.update(verifyUpdateId, { status: "verified" })).ok, "update(status verified) completes a ready goal");
  assert(countsLine(verifyUpdateStore) === verifyLine, "verify close and terminal update produce identical counts");

  unlinkSync(join(dirClose, "goals", "goals-meta.json"));
  const healedClose = makeStore(dirClose);
  await healedClose.ensureLoaded();
  assert(countsLine(healedClose) === closeLine, "missing meta replays the completed count");
  assert(healedClose.getAny(closeId)?.status === "dropped", "missing meta keeps the tombstone readable");
  assert(healedClose.getAny(closeId)?.closedAs === "completed", "missing meta keeps the terminal status");
  assert(!healedClose.list("dropped").some((g) => g.id === closeId), "missing meta hides a completed tombstone from dropped");
  assert(healedClose.list("completed").some((g) => g.id === closeId), "missing meta keeps list(completed) populated");
  assert(existsSync(join(dirClose, "goals", "goals-meta.json")), "replay rewrites the meta file");

  unlinkSync(join(dirVerifyUntilClose, "goals", "goals-meta.json"));
  const healedVerify = makeStore(dirVerifyUntilClose);
  await healedVerify.ensureLoaded();
  assert(countsLine(healedVerify) === verifyLine, "missing meta replays the verified count");

  const dirLegacy = tempDir("legacy-completed");
  const legacyStore = makeStore(dirLegacy);
  const legacyCreated = await legacyStore.create({ title: "legacy completed goal", owner: "@dev" });
  if (!legacyCreated.ok) fail(`legacy seed goal failed: ${legacyCreated.reason}`);
  console.log("ok legacy seed goal created");
  const legacyGoal: Goal = {
    ...legacyCreated.goal,
    status: "completed",
    progressPct: 100,
    updatedAt: new Date(Date.now() + 1000).toISOString(),
  };
  appendFileSync(join(dirLegacy, "goals", "goals.jsonl"), `${JSON.stringify(legacyGoal)}\n`);
  const legacyReloaded = makeStore(dirLegacy);
  await legacyReloaded.ensureLoaded();
  assert(legacyReloaded.list("completed").length === 1, "legacy live completed goal stays visible after load");
  assert(countsLine(legacyReloaded).includes("1 completed"), "live completed goal is visible in the digest");
  assert((await legacyReloaded.deleteGoal(legacyGoal.id)).ok, "deleteGoal drops a legacy live completed goal");
  assert(legacyReloaded.getAny(legacyGoal.id)?.closedAs === "dropped", "deleteGoal marks the terminal status dropped");
  const legacyLine = countsLine(legacyReloaded);
  assert(legacyLine.includes("0 completed"), "deleteGoal clears the completed count of a live completed goal");
  assert(legacyLine.includes("1 dropped"), "deleteGoal counts the live completed goal as dropped");
  assert(!legacyLine.includes("2 completed"), "deleteGoal never double counts the completed goal");
  assert(!legacyLine.includes("1 completed"), "deleteGoal never keeps the prior terminal count");
  unlinkSync(join(dirLegacy, "goals", "goals-meta.json"));
  const legacyHealed = makeStore(dirLegacy);
  await legacyHealed.ensureLoaded();
  assert(countsLine(legacyHealed) === legacyLine, "replay agrees with deleteGoal on the completed count");

  const dirDrop = tempDir("drop");
  const dropStore = makeStore(dirDrop);
  const dropCreated = await dropStore.create({ title: "dropped goal", owner: "@dev" });
  if (!dropCreated.ok) fail(`drop seed goal failed: ${dropCreated.reason}`);
  console.log("ok drop seed goal created");
  assert((await dropStore.update(dropCreated.goal.id, { status: "dropped" })).ok, "update(status dropped) drops an active goal");
  const dropLine = countsLine(dropStore);
  assert(dropLine.includes("1 dropped"), "dropping an active goal counts one dropped goal");
  assert(dropLine.includes("0 completed"), "dropping an active goal adds no completed count");
  assert(dropStore.list("dropped").some((g) => g.id === dropCreated.goal.id), "list(dropped) shows a dropped goal");
  unlinkSync(join(dirDrop, "goals", "goals-meta.json"));
  const dropHealed = makeStore(dirDrop);
  await dropHealed.ensureLoaded();
  assert(countsLine(dropHealed) === dropLine, "replay agrees with the dropped count");

  const dirCap = tempDir("cap");
  const capStore = makeStore(dirCap, 2);
  const capFirst = await createCloseable(capStore, "cap one");
  await createCloseable(capStore, "cap two");
  const pastCap = await capStore.create({ title: "cap three", owner: "@dev" });
  assert(!pastCap.ok && pastCap.reason === "max", "create refuses a goal past the active cap");
  assert(capStore.buildDigest().text.includes("active goal cap reached (2/2)"), "digest announces cap exhaustion");

  const loggerAny = logger as unknown as { warn: (...args: unknown[]) => void };
  const realWarn = loggerAny.warn;
  const warnings: string[] = [];
  loggerAny.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(" "));
  };
  let captureAtCap: { ok: boolean };
  try {
    captureAtCap = await runTodoReconcile({
      store: capStore,
      sessionId: "ses_cap_proof",
      owner: "@dev",
      todos: [{ title: "capture at cap", status: "in_progress" }],
    });
  } finally {
    loggerAny.warn = realWarn;
  }
  assert(captureAtCap.ok === false, "todo capture refuses to create a goal at the cap");
  assert(
    warnings.some((w) => w.includes("active goal cap reached")),
    "todo capture logs the cap warning",
  );

  assert((await capStore.close(capFirst, false, "@dev")).ok, "a ready goal still closes at the cap");
  assert(!capStore.buildDigest().text.includes("active goal cap reached"), "digest drops the cap line once a slot frees");
  const afterClose = await capStore.create({ title: "cap three", owner: "@dev" });
  assert(afterClose.ok, "closing a goal frees an active slot");
  assert(
    capStore.buildDigest().text.includes("active goal cap reached (2/2)"),
    "the relaxed cap returns as soon as the slot is used",
  );

  const dirDefault = tempDir("default-cap");
  mkdirSync(join(dirDefault, "goals"), { recursive: true });
  const stamp = new Date().toISOString();
  const seedLines: string[] = [];
  for (let i = 1; i <= 5000; i += 1) {
    const seeded: Goal = {
      id: `G-${String(i).padStart(3, "0")}`,
      seq: i,
      title: `seeded goal ${i}`,
      detail: "",
      status: "open",
      progressPct: 0,
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
    };
    seedLines.push(JSON.stringify(seeded));
  }
  writeFileSync(join(dirDefault, "goals", "goals.jsonl"), `${seedLines.join("\n")}\n`);
  const defaultStore = makeStore(dirDefault);
  await defaultStore.ensureLoaded();
  assert(defaultStore.size === 5000, "seed ledger loads 5000 active goals");
  const overflow = await defaultStore.create({ title: "goal 5001", owner: "@dev" });
  assert(!overflow.ok && overflow.reason === "max", "5001st active goal is refused with reason max");
  assert(
    defaultStore.buildDigest().text.includes("active goal cap reached (5000/5000)"),
    "digest reports the default cap boundary",
  );

  console.log("PROOF PASS: goal capture closes once, replays counts, and enforces the active cap");
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
