import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoalStore } from "../src/services/goal-store.ts";
import { TimelineStore } from "../src/services/timeline-store.ts";
import { MissionBoard } from "../src/services/mission-board.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

const dir = mkdtempSync(join(tmpdir(), "tawassul-priming-"));
try {
  const goals = new GoalStore(join(dir, "goals"));
  const p1 = goals.ensureLoaded();
  const p2 = goals.ensureLoaded();
  assert(p1 === p2, "goal concurrent readers share one load");
  await p1;
  assert(typeof goals.compactDigest() === "string", "goal digest after prime");

  const missing = new GoalStore(join(dir, "no-such-dir", "deep"));
  await missing.ensureLoaded();
  assert(missing.size === 0, "goal missing dir fail-open empty");

  const timeline = new TimelineStore(join(dir, "tl"));
  const q1 = timeline.ensureLoaded();
  const q2 = timeline.ensureLoaded();
  assert(q1 === q2, "timeline concurrent readers share one load");
  await q1;

  const board = new MissionBoard(undefined, join(dir, "boards"));
  await board.ready();
  assert(board.getActiveCount() === 0, "board ready joins load");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("PROOF PASS: store priming shared, fail-open, joined");
