import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoalStore } from "../src/services/goal-store.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function gateFirstAcquisition(store: GoalStore): () => void {
  const lm = (store as unknown as { lockManager: { acquireLock: (...a: never[]) => Promise<unknown> } }).lockManager;
  const real = lm.acquireLock.bind(lm);
  let release: (() => void) | null = null;
  let parked = false;
  lm.acquireLock = (async (...args: never[]) => {
    if (!parked) {
      parked = true;
      await new Promise<void>((r) => {
        release = r;
      });
    }
    return real(...args);
  }) as typeof lm.acquireLock;
  return () => release?.();
}

async function seed(store: GoalStore): Promise<string> {
  const created = await store.create({ title: "victim goal", owner: "@dev" });
  if (!created.ok || !("goal" in created) || !created.goal) fail("seed failed");
  return (created.goal as { id: string }).id;
}

async function expectNoGhost(kind: string, run: (store: GoalStore, id: string) => Promise<{ ok: boolean; reason?: string }>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-resurrect-"));
  try {
    const store = new GoalStore(dir);
    const id = await seed(store);
    const release = gateFirstAcquisition(store);
    const pending = run(store, id);
    await new Promise((r) => setTimeout(r, 25));
    const del = await store.deleteGoal(id);
    if (!del.ok) fail(`${kind}: delete did not win the race`);
    release();
    const res = await pending;
    if (res.ok) fail(`${kind}: ghost write resurrected the goal`);
    if (!["not-found", "locked"].includes(res.reason ?? "")) fail(`${kind}: unexpected loser reason ${res.reason}`);
    if (store.get(id) !== undefined) fail(`${kind}: goal physically present after delete`);
    console.log(`ok ${kind} loser=${res.reason}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await expectNoGhost("appendEvidence-vs-delete", (s, id) => s.appendEvidence(id, "concurrent evidence text long enough"));
await expectNoGhost("close-vs-delete", (s, id) => s.close(id, false, "@dev"));
console.log("PROOF PASS: goal resurrection accepts both losers, never writes ghosts");
