import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MissionBoard } from "../src/services/mission-board.ts";
import type { SubTask } from "../src/types/plan.types.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed += 1;
  console.log(`ok ${name}`);
}

function taskItem(id: string): SubTask {
  return {
    id,
    description: `task ${id}`,
    files: [],
    agent: "dev",
    dependencies: [],
    successCriteria: [],
    status: "pending",
  };
}

type IndexShape = { boards: Array<{ id: string; status: string }> };

async function waitForIndex(dir: string, boardId: string, status: string): Promise<IndexShape> {
  const indexPath = join(dir, "index.json");
  const deadline = Date.now() + 3000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const raw = readFileSync(indexPath, "utf8");
      last = raw;
      const parsed = JSON.parse(raw) as IndexShape;
      if (parsed.boards.some((entry) => entry.id === boardId && entry.status === status)) return parsed;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`index.json never reached ${status} for ${boardId}: ${last}`);
}

function persistedTask(
  dir: string,
  boardId: string,
  taskId: string,
): { sessionId?: string; status?: string } | null {
  const raw = JSON.parse(readFileSync(join(dir, `${boardId}.json`), "utf8")) as {
    columns: Record<string, Array<{ id: string; sessionId?: string; status?: string }>>;
  };
  for (const column of Object.values(raw.columns)) {
    const found = column.find((item) => item.id === taskId);
    if (found) return found;
  }
  return null;
}

const dir = mkdtempSync(join(tmpdir(), "tawassul-board-"));

try {
  const board = new MissionBoard(undefined, dir);
  await board.ready();
  const created = await board.createBoard("Invariant board");
  await waitForIndex(dir, created.id, "active");
  assert(created.columns.backlog.length === 0 && created.columns.done.length === 0, "a fresh board starts with empty columns");
  assert(board.getActiveCount() === 1, "the created board is tracked");

  board.addTask(created.id, taskItem("task-1"));
  board.updateStatus(created.id, "task-1", "in_progress", undefined, "sess-42");
  await board.flush();
  const running = board.getBoard(created.id)!;
  assert(running.columns.in_progress.length === 1, "a queued task moves to in_progress");
  assert(running.columns.backlog.length === 0, "the source column loses the task");
  assert(running.columns.in_progress[0]!.sessionId === "sess-42", "the status change records the session id");
  assert((await waitForIndex(dir, created.id, "active")).boards.length === 1, "a running board stays active in the index");
  assert(persistedTask(dir, created.id, "task-1")?.sessionId === "sess-42", "the persisted board carries the session id");

  board.updateStatus(created.id, "task-1", "done", undefined, "sess-43");
  await board.flush();
  await waitForIndex(dir, created.id, "done");
  assert(board.getBoard(created.id)!.columns.done.length === 1, "the completed task sits in the done column");
  assert(persistedTask(dir, created.id, "task-1")?.sessionId === "sess-43", "the completion updates the session id");

  board.updateStatus(created.id, "task-1", "in_progress", "reopen", "sess-44");
  await board.flush();
  const closed = board.getBoard(created.id)!;
  assert(closed.columns.done.length === 1, "a done task stays in the done column");
  assert(closed.columns.in_progress.length === 0, "a done task cannot be reopened");
  assert(closed.columns.done[0]!.sessionId === "sess-43", "the refused reopen keeps the completion provenance");

  board.updateStatus(created.id, "task-1", "failed", "reopen", "sess-45");
  await board.flush();
  const stillClosed = board.getBoard(created.id)!;
  assert(stillClosed.columns.failed.length === 0, "a done task cannot move to failed");
  assert(stillClosed.columns.done[0]!.sessionId === "sess-43", "a refused failed move keeps provenance");

  board.addTask(created.id, taskItem("task-2"));
  await board.flush();
  await waitForIndex(dir, created.id, "active");
  assert(board.getBoard(created.id)!.columns.backlog.length === 1, "a new task reopens the active index state");
  board.updateStatus(created.id, "task-2", "failed");
  await board.flush();
  await waitForIndex(dir, created.id, "done");
  const failedBoard = board.getBoard(created.id)!;
  assert(
    failedBoard.columns.done.length === 1 && failedBoard.columns.failed.length === 1,
    "done and failed both count as closed",
  );

  board.updateStatus(created.id, "no-such-task", "done");
  board.updateStatus("no-such-board", "task-1", "done");
  await board.flush();
  assert(board.getBoard(created.id)!.columns.done.length === 1, "unknown targets are no-ops");

  const reopened = new MissionBoard(undefined, dir);
  await reopened.ready();
  const loaded = reopened.getBoard(created.id)!;
  assert(loaded.columns.done[0]!.sessionId === "sess-43", "a reload keeps the completion provenance");
  assert(loaded.columns.failed[0]!.sessionId === undefined, "a missing session id is not invented on reload");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`PROOF PASS: board index sync, session provenance, and close-only invariants (${passed} assertions)`);
