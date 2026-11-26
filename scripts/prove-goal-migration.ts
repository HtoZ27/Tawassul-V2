import "./proof-log-isolate.ts";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoalStore } from "../src/services/goal-store.ts";
import { FileLockManager } from "../src/infra/file-lock.ts";
import { migrateGoalLedger } from "./goal-migrate.ts";
import type { Goal, GoalStatus } from "../src/types/goal-types.ts";

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

function tempState(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `tawassul-goal-migration-${tag}-`));
  dirs.push(dir);
  mkdirSync(join(dir, "goals"), { recursive: true });
  return dir;
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function record(id: string, seq: number, status: GoalStatus, closedAs?: GoalStatus): Goal {
  const stamp = new Date().toISOString();
  const value: Goal = {
    id,
    seq,
    title: `seeded ${id}`,
    detail: "",
    status,
    progressPct: status === "completed" || status === "verified" ? 100 : 0,
    owner: "@dev",
    ownerKind: "solo",
    parentId: null,
    items: [],
    completedItems: [],
    acceptance: [],
    retiredAcceptance: [],
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
  if (closedAs) value.closedAs = closedAs;
  return value;
}

function seedLedger(dir: string): void {
  const lines: Goal[] = [record("G-001", 1, "open")];
  let seq = 2;
  for (const id of ["G-002", "G-003", "G-004", "G-005", "G-006"]) {
    lines.push(record(id, seq, "completed"));
    seq += 1;
    lines.push(record(id, seq, "dropped"));
    seq += 1;
  }
  lines.push(record("G-007", seq, "dropped", "verified"));
  writeFileSync(
    join(dir, "goals", "goals.jsonl"),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf-8",
  );
}

function countsLine(store: GoalStore): string {
  return store.buildDigest({ terminalCounts: true }).text.split("\n")[0] ?? "";
}

try {
  const hashDir = tempState("hash");
  seedLedger(hashDir);
  const hashBefore = sha256File(join(hashDir, "goals", "goals.jsonl"));
  const hashRun = await migrateGoalLedger({ stateDir: hashDir, expectHash: "0".repeat(64) });
  assert(!hashRun.ok && hashRun.reason === "hash-mismatch", "expect-hash mismatch refuses the migration");
  assert(sha256File(join(hashDir, "goals", "goals.jsonl")) === hashBefore, "hash refusal leaves the ledger untouched");
  assert(!existsSync(join(hashDir, "goals", "quarantine")), "hash refusal writes no quarantine copy");

  const osDir = tempState("os");
  seedLedger(osDir);
  const osBefore = sha256File(join(osDir, "goals", "goals.jsonl"));
  const osRun = await migrateGoalLedger({ stateDir: osDir });
  assert(!osRun.ok && osRun.reason === "missing-expect-hash", "the migration requires an explicit expect-hash");
  assert(sha256File(join(osDir, "goals", "goals.jsonl")) === osBefore, "missing hash leaves the ledger untouched");

  const okDir = tempState("ok");
  seedLedger(okDir);
  const okHash = sha256File(join(okDir, "goals", "goals.jsonl"));
  const beforeStore = new GoalStore(okDir, { lockManager: null });
  await beforeStore.ensureLoaded();
  const beforeLine = countsLine(beforeStore);
  assert(beforeLine.includes("5 dropped"), "legacy replay reports the five dropped records");
  assert(beforeLine.includes("0 completed"), "legacy replay drops the prior completed count");
  assert(beforeLine.includes("1 verified"), "legacy replay keeps the explicit verified tombstone");

  const run = await migrateGoalLedger({ stateDir: okDir, expectHash: okHash });
  if (!run.ok) fail(`migration failed: ${run.reason} ${run.detail ?? ""}`);
  assert(run.counts.completed === 0, "migration recomputes zero completed");
  assert(run.counts.verified === 1, "migration recomputes one verified");
  assert(run.counts.dropped === 5, "migration recomputes five dropped");
  assert(sha256File(join(okDir, "goals", "goals.jsonl")) === okHash, "migration never rewrites the ledger");
  assert(existsSync(join(run.quarantine, "goals.jsonl")), "migration writes a quarantine copy");
  assert(existsSync(join(run.quarantine, "manifest.json")), "migration writes a quarantine manifest");
  const manifest = JSON.parse(readFileSync(join(run.quarantine, "manifest.json"), "utf-8")) as {
    ledgerHash: string;
    metaHash: string | null;
  };
  assert(manifest.ledgerHash === sha256File(join(run.quarantine, "goals.jsonl")), "quarantine manifest matches its copy");
  assert(existsSync(join(run.quarantine, "diff.json")), "migration persists the diff report");
  const diff = JSON.parse(readFileSync(join(run.quarantine, "diff.json"), "utf-8")) as Array<{
    id: string;
    before: string;
    after: string;
  }>;
  assert(diff.some((e) => e.id === "G-002" && e.before === "completed" && e.after === "dropped"), "diff records the prior status per goal");
  assert(diff.some((e) => e.id === "G-007" && e.before === "verified" && e.after === "verified"), "diff keeps an explicit terminal status");

  const afterStore = new GoalStore(okDir, { lockManager: null });
  await afterStore.ensureLoaded();
  const afterLine = countsLine(afterStore);
  assert(afterLine === "🎯 1 open · ✅ 0 completed · ✔ 1 verified · 🗑 5 dropped", "post-repair counts match the expected line");

  const metaBefore = readFileSync(join(okDir, "goals", "goals-meta.json"));
  const metaMtime = statSync(join(okDir, "goals", "goals-meta.json")).mtimeMs;
  const replayStore = new GoalStore(okDir, { lockManager: null });
  await replayStore.load({ replay: true, persist: false });
  assert(JSON.stringify(replayStore.lifecycleSnapshot()) === JSON.stringify(run.counts), "no-persist replay reproduces the counts");
  assert(replayStore.size === 1, "no-persist replay keeps one live goal");
  const metaAfter = readFileSync(join(okDir, "goals", "goals-meta.json"));
  assert(metaAfter.equals(metaBefore), "no-persist replay writes no meta bytes");
  assert(statSync(join(okDir, "goals", "goals-meta.json")).mtimeMs === metaMtime, "no-persist replay leaves the meta mtime alone");

  const second = await migrateGoalLedger({ stateDir: okDir, expectHash: okHash });
  if (!second.ok) fail(`second migration failed: ${second.reason}`);
  assert(JSON.stringify(second.counts) === JSON.stringify(run.counts), "second migration is count-idempotent");
  assert(second.ledgerHash === run.ledgerHash, "second migration keeps the same ledger hash");
  assert(second.quarantine !== run.quarantine, "second migration writes its own quarantine copy");

  const lockDir = tempState("locked");
  seedLedger(lockDir);
  const lockHash = sha256File(join(lockDir, "goals", "goals.jsonl"));
  const blocker = new FileLockManager(true);
  const metaPath = join(lockDir, "goals", "goals-meta.json");
  const held = await blocker.acquireLock(metaPath, "proof-holder", "migrate");
  assert(held.acquired, "proof acquires the store lock");
  const locked = await migrateGoalLedger({ stateDir: lockDir, expectHash: lockHash });
  assert(!locked.ok && locked.reason === "locked", "a held lock makes the migration refuse");
  assert(sha256File(join(lockDir, "goals", "goals.jsonl")) === lockHash, "lock refusal leaves the ledger untouched");
  assert(!existsSync(metaPath), "lock refusal writes no meta");
  await blocker.releaseLock(metaPath, "proof-holder");

  const isolatedDir = tempState("isolated");
  seedLedger(isolatedDir);
  const isolatedHash = sha256File(join(isolatedDir, "goals", "goals.jsonl"));
  process.env.TAWASSUL_ISOLATED = "1";
  let isolatedRun: Awaited<ReturnType<typeof migrateGoalLedger>>;
  try {
    isolatedRun = await migrateGoalLedger({ stateDir: isolatedDir, expectHash: isolatedHash });
  } finally {
    delete process.env.TAWASSUL_ISOLATED;
  }
  if (isolatedRun.ok) fail("a blocked meta write must fail the migration");
  assert(isolatedRun.reason === "write-failed", "a blocked meta write fails the migration");
  assert(isolatedRun.restored === true, "a blocked meta write restores from quarantine");
  assert(sha256File(join(isolatedDir, "goals", "goals.jsonl")) === isolatedHash, "restore keeps the ledger byte-identical");
  assert(!existsSync(join(isolatedDir, "goals", "goals-meta.json")), "restore removes a meta that did not exist before");
  const isolatedStore = new GoalStore(isolatedDir, { lockManager: null });
  await isolatedStore.ensureLoaded();
  assert(countsLine(isolatedStore).includes("5 dropped"), "restored ledger still replays the five dropped records");

  const crashDir = tempState("crash");
  const crashStore = new GoalStore(crashDir, { lockManager: null, minEvidenceIntervalMs: 0 });
  const created = await crashStore.create({ title: "crash window goal", owner: "@dev", acceptance: ["done"] });
  if (!created.ok) fail(`crash seed failed: ${created.reason}`);
  const crashId = created.goal.id;
  if (!(await crashStore.update(crashId, {
    acceptanceEvidence: [{ criterion: "done", text: "acceptance covered by proof" }],
    acceptanceStates: [{ criterion: "done", status: "met" }],
  })).ok) fail("crash seed could not cover acceptance");
  const live = structuredClone(crashStore.get(crashId) as Goal);
  live.status = "completed";
  live.progressPct = 100;
  live.updatedAt = new Date(Date.now() + 1000).toISOString();
  appendFileSync(join(crashDir, "goals", "goals.jsonl"), `${JSON.stringify(live)}\n`, "utf-8");
  const crashed = new GoalStore(crashDir, { lockManager: null });
  await crashed.ensureLoaded();
  assert(countsLine(crashed).includes("1 completed"), "crash window counts the live completed goal once");
  assert((await crashed.deleteGoal(crashId)).ok, "crash window goal can be dropped");
  const crashLine = countsLine(crashed);
  assert(crashLine.includes("0 completed"), "dropping the crash window goal clears completed");
  assert(crashLine.includes("1 dropped"), "dropping the crash window goal counts dropped");
  const crashReplay = new GoalStore(crashDir, { lockManager: null });
  await crashReplay.load({ replay: true, persist: false });
  assert(countsLine(crashReplay) === crashLine, "replay from closedAs agrees with the crash-window writer");

  console.log("PROOF PASS: goal migration is hash-gated, quarantined, restorable and idempotent");
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
