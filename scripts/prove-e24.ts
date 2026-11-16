import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SagaCoordinator } from "../src/services/saga-coordinator.ts";

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

const work = mkdtempSync(join(tmpdir(), "tawassul-e24-"));
const stateDir = join(work, "state");
const journalDir = join(stateDir, "sagas");

async function main(): Promise<void> {
  const first = new SagaCoordinator<string>(stateDir);
  const a = first.createSaga("first-run", [], "handoff-a");
  await first.flushJournal();
  assert(a.transactionId === "SAGA-001", "a fresh journal starts at SAGA-001");
  const before = await first.readJournalRecord("SAGA-001");
  assert(before !== null && before.sagaName === "first-run", "the first journal record is on disk");

  const second = new SagaCoordinator<string>(stateDir);
  const b = second.createSaga("second-run", [], "handoff-b");
  await second.flushJournal();
  assert(b.transactionId === "SAGA-002", "a new process continues the journal sequence");
  const survivor = await second.readJournalRecord("SAGA-001");
  assert(
    survivor !== null && survivor.sagaName === "first-run",
    "the earlier journal record is not overwritten",
  );
  const fresh = await second.readJournalRecord("SAGA-002");
  assert(fresh !== null && fresh.sagaName === "second-run", "the new record is written alongside it");
  assert(
    journalDirHas(journalDir, "SAGA-001.json") && journalDirHas(journalDir, "SAGA-002.json"),
    "both journal files coexist",
  );

  writeFileSync(
    join(journalDir, "SAGA-009.json"),
    JSON.stringify({ transactionId: "SAGA-009", sagaName: "seeded", state: "FAILED", completedSteps: [], error: null, startedAt: 1, updatedAt: 1 }),
    "utf8",
  );
  const third = new SagaCoordinator<string>(stateDir);
  const c = third.createSaga("third-run", [], "handoff-c");
  await third.flushJournal();
  assert(c.transactionId === "SAGA-010", "the sequence seeds from the highest journal id");

  writeFileSync(
    join(journalDir, "SAGA-012-resumed.json"),
    JSON.stringify({ transactionId: "SAGA-012-resumed", sagaName: "resumed", state: "EXECUTING", completedSteps: [], error: null, startedAt: 1, updatedAt: 1 }),
    "utf8",
  );
  const fourth = new SagaCoordinator<string>(stateDir);
  const d = fourth.createSaga("fourth-run", [], "handoff-d");
  await fourth.flushJournal();
  assert(d.transactionId === "SAGA-011", "a resumed-id file does not inflate the sequence");

  const files = readdirSync(journalDir).sort();
  assert(!files.some((f) => f.endsWith(".tmp")), "the journal is written atomically with no temp leftovers");
  assert(!files.some((f) => f.includes(".bak.")), "the journal write creates no backup family");
  const ids = files.filter((f) => /^SAGA-\d+\.json$/.test(f)).map((f) => f.replace(/\.json$/, ""));
  assert(
    new Set(ids).size === ids.length,
    "every journal id is unique on disk",
  );
}

function journalDirHas(dir: string, file: string): boolean {
  try {
    return readdirSync(dir).includes(file);
  } catch {
    return false;
  }
}

try {
  await main();
  console.log(`PROOF PASS: saga ids continue across restarts and never overwrite a journal (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
