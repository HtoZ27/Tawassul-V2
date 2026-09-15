#!/usr/bin/env bun

import fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_RETENTION } from "../services/retention.ts";
import { DATA_DIR } from "../services/mission-board.ts";

const INDEX_FILE = "index.json";
const SCHEMA_VERSION = 1;

type Status = "backlog" | "ready" | "in_progress" | "review" | "done" | "blocked" | "failed";

interface Board {
  id: string;
  name: string;
  columns: Record<Status, Array<{ id: string }>>;
  createdAt: number;
}

function isCompleted(board: Board): boolean {
  const cols = Object.values(board.columns);
  const hasTasks = cols.some((col) => col.length > 0);
  if (!hasTasks) return false;
  const total = cols.reduce((s, col) => s + col.length, 0);
  const doneFailed = (board.columns.done?.length ?? 0) + (board.columns.failed?.length ?? 0);
  return doneFailed === total;
}

async function main(): Promise<void> {
  let entries: string[];
  try {
    entries = await fsp.readdir(DATA_DIR);
  } catch {
    console.error(`data dir not found: ${DATA_DIR}`);
    process.exit(1);
  }
  const boardFiles = entries.filter((f) => f.endsWith(".json") && f !== INDEX_FILE);
  const now = Date.now();
  let removed = 0;
  let corrupted = 0;
  const indexBoards: Array<{ id: string; file: string; createdAt: number; status: "active" | "done" }> = [];

  for (const file of boardFiles) {
    const full = path.join(DATA_DIR, file);
    let board: Board;
    try {
      board = JSON.parse(await fsp.readFile(full, "utf-8")) as Board;
    } catch {
      
      await fsp.rm(full, { force: true });
      corrupted++;
      continue;
    }
    if (!board.id || !Array.isArray(board.columns?.backlog)) {
      
      await fsp.rm(full, { force: true });
      corrupted++;
      continue;
    }
    const done = isCompleted(board);
    if (done && now - (board.createdAt ?? now) > DEFAULT_RETENTION.maxAgeMs) {
      await fsp.rm(full, { force: true });
      removed++;
      continue;
    }
    indexBoards.push({
      id: board.id,
      file: `${board.id}.json`,
      createdAt: board.createdAt ?? now,
      status: done ? "done" : "active",
    });
  }

  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(
    path.join(DATA_DIR, INDEX_FILE),
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, boards: indexBoards, updatedAt: now }, null, 2),
    "utf-8",
  );

  const remaining = (await fsp.readdir(DATA_DIR)).filter((f) => f.endsWith(".json") && f !== INDEX_FILE);
  
  
  console.log(`mission-board migration done`);
  console.log(`  files scanned : ${boardFiles.length}`);
  console.log(`  removed (old) : ${removed}`);
  console.log(`  removed (bad) : ${corrupted}`);
  console.log(`  files remaining: ${remaining.length}`);
  console.log(`  index written : ${path.join(DATA_DIR, INDEX_FILE)}`);
  /* eslint-enable no-console */
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
