import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLockManager } from "../src/infra/file-lock.ts";
import { GoalStore } from "../src/services/goal-store.ts";

let passed = 0;

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

const work = mkdtempSync(join(tmpdir(), "tawassul-e23-"));
const dir = join(work, "state");

function makeStore(): GoalStore {
  return new GoalStore(dir, undefined, { minEvidenceIntervalMs: 0 });
}

function isLocked(result: { ok: boolean; reason?: string }): boolean {
  return result.ok === false && result.reason === "locked";
}

async function main(): Promise<void> {
  const store = makeStore();
  await store.ensureLoaded();

  const created = await Promise.all([
    store.create({ title: "alpha", owner: "main" }),
    store.create({ title: "beta", owner: "main" }),
    store.create({ title: "gamma", owner: "main" }),
  ]);
  assert(
    created.every((r) => r.ok),
    "three concurrent creates all succeed",
  );
  assert(
    created.every((r) => !isLocked(r)),
    "no concurrent create reports a lock it could have waited for",
  );
  const ids = created.map((r) => (r.ok ? r.goal.id : ""));
  assert(new Set(ids).size === 3, "every concurrent create gets its own id");
  assert(store.list("all").length === 3, "all three goals live in the store");

  const reloaded = makeStore();
  await reloaded.ensureLoaded();
  const reloadedTitles = reloaded
    .list("all")
    .map((g) => g.title)
    .sort();
  assert(
    reloadedTitles.join(",") === "alpha,beta,gamma",
    "a fresh store loads all three goals from disk",
  );

  const alpha = reloaded.list("all").find((g) => g.title === "alpha");
  const beta = reloaded.list("all").find((g) => g.title === "beta");
  assert(alpha !== undefined && beta !== undefined, "the reloaded goals are addressable");

  const updates = await Promise.all([
    reloaded.update(alpha!.id, { title: "alpha-2" }),
    reloaded.update(beta!.id, { title: "beta-2" }),
  ]);
  assert(
    updates.every((r) => r.ok),
    "two concurrent updates to different goals both succeed",
  );
  const afterUpdate = makeStore();
  await afterUpdate.ensureLoaded();
  const updateTitles = afterUpdate
    .list("all")
    .map((g) => g.title)
    .sort();
  assert(
    updateTitles.join(",") === "alpha-2,beta-2,gamma",
    "neither concurrent update is lost on disk",
  );

  const gamma = afterUpdate.list("all").find((g) => g.title === "gamma");
  const evidence = await Promise.all([
    afterUpdate.appendEvidence(gamma!.id, "evidence one works"),
    afterUpdate.appendEvidence(gamma!.id, "evidence two works"),
  ]);
  assert(
    evidence.every((r) => r.ok),
    "two concurrent evidence appends to one goal both succeed",
  );
  const afterEvidence = makeStore();
  await afterEvidence.ensureLoaded();
  const gammaReloaded = afterEvidence.list("all").find((g) => g.title === "gamma");
  assert(
    (gammaReloaded?.evidence ?? []).length === 2,
    "both evidence entries survive the concurrent append",
  );

  const blocker = new FileLockManager(true);
  const held = await blocker.acquireLock(afterEvidence.paths.meta, "proof-blocker", "e23");
  assert(held.acquired, "the proof holds the cross-process file lock");
  const timer = setTimeout(() => {
    void blocker.releaseLock(afterEvidence.paths.meta, "proof-blocker");
  }, 120);
  const waited = await afterEvidence.create({ title: "delta", owner: "main" });
  clearTimeout(timer);
  assert(waited.ok, "a mutation waits for a held file lock instead of failing at once");
  assert(
    afterEvidence.list("all").some((g) => g.title === "delta"),
    "the mutation that waited is committed",
  );

  await blocker.releaseLock(afterEvidence.paths.meta, "proof-blocker").catch(() => undefined);
}

try {
  await main();
  console.log(`PROOF PASS: goal mutations wait for the lock and never drop a concurrent write (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
