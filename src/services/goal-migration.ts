
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "../utils/logger.ts";
import { normalizeName } from "../utils/name-utils.ts";
import type { GoalStore } from "./goal-store.ts";
import type { GoalItemState } from "../types/goal-types.ts";

type BoardStatus = "backlog" | "ready" | "in_progress" | "review" | "done" | "blocked" | "failed";

interface BoardTask {
  id: string;
  description: string;
  files?: string[];
  agent?: string;
  status?: BoardStatus;
}

interface BoardFile {
  id: string;
  name: string;
  columns: Partial<Record<BoardStatus, BoardTask[]>>;
}

export interface GoalMigrationResult {
  boardsScanned: number;
  goalsCreated: string[];
  itemsMigrated: number;
  skippedBoards: string[];
  corruptFiles: number;
}

const MIGRATABLE: Record<Exclude<BoardStatus, "done">, GoalItemState> = {
  backlog: "pending",
  ready: "pending",
  in_progress: "in_progress",
  review: "in_progress",
  blocked: "pending",
  failed: "failed",
};

function normalizeAgent(raw: string): string {
  return normalizeName(raw.trim());
}

export async function migrateBoardsToGoals(
  store: GoalStore,
  boardsDir: string,
  opts: { dryRun?: boolean } = {},
): Promise<GoalMigrationResult> {
  const result: GoalMigrationResult = {
    boardsScanned: 0,
    goalsCreated: [],
    itemsMigrated: 0,
    skippedBoards: [],
    corruptFiles: 0,
  };
  const alreadyLinked = new Set<string>();
  for (const g of store.list("all")) {
    for (const b of g.linkedBoards) alreadyLinked.add(b);
  }
  let entries: string[];
  try {
    entries = await readdir(boardsDir);
  } catch {
    return result; 
  }
  
  let files: string[] = entries.filter((f) => f.endsWith(".json") && f !== "index.json");
  try {
    const indexRaw = await readFile(join(boardsDir, "index.json"), "utf-8");
    const index = JSON.parse(indexRaw) as { boards?: Array<{ id: string; file: string }> };
    if (Array.isArray(index.boards) && index.boards.length > 0) {
      files = index.boards.map((b) => b.file).filter((f) => typeof f === "string");
    }
  } catch {

  }
  for (const file of files) {
    result.boardsScanned++;
    let board: BoardFile;
    try {
      board = JSON.parse(await readFile(join(boardsDir, file), "utf-8")) as BoardFile;
      if (!board || typeof board.id !== "string" || typeof board.columns !== "object") throw new Error("bad board");
    } catch {
      result.corruptFiles++;
      continue;
    }
    if (alreadyLinked.has(board.id)) {
      result.skippedBoards.push(board.id);
      continue;
    }
    const items: string[] = [];
    const itemStates: Array<{ title: string; state: GoalItemState }> = [];
    let boardOwner = "migration";
    for (const [column, tasks] of Object.entries(board.columns ?? {})) {
      if (column === "done" || !Array.isArray(tasks)) continue;
      const mapped = MIGRATABLE[column as Exclude<BoardStatus, "done">];
      if (!mapped) continue;
      for (const t of tasks) {
        if (!t || typeof t.description !== "string" || t.description.trim().length === 0) continue;
        
        
        if (!boardOwner || boardOwner === "migration") {
          const taskAgent = typeof t.agent === "string" && t.agent.trim() ? normalizeAgent(t.agent) : "";
          if (taskAgent) boardOwner = taskAgent;
        }
        const title = column === "blocked" ? `${t.description.trim()} [was: blocked]` : t.description.trim();
        items.push(title);
        itemStates.push({ title, state: mapped });
      }
    }
    if (items.length === 0) {
      result.skippedBoards.push(board.id);
      continue;
    }
    if (opts.dryRun) {
      result.goalsCreated.push(`(dry-run) board:${board.id}`);
      result.itemsMigrated += items.length;
      continue;
    }
    const created = await store.create({
      title: `Board: ${board.name || board.id}`,
      detail: `Migrated from mission-board ${board.id}. Add acceptance criteria via goal(update).`,
      owner: boardOwner,
      ownerKind: "solo",
      items,
      linkedBoards: [board.id],
    });
    if (!created.ok) {
      logger.warn(`[goal-migration] board ${board.id} not migrated: ${created.reason}`);
      result.skippedBoards.push(board.id);
      continue;
    }
    
    for (const [n, s] of itemStates.entries()) {
      if (s.state !== "pending") {
        await store.update(created.goal.id, {
          itemStates: [{ itemId: `${created.goal.id}-I${n + 1}`, state: s.state }],
        });
      }
    }
    result.goalsCreated.push(created.goal.id);
    result.itemsMigrated += items.length;
  }
  return result;
}
