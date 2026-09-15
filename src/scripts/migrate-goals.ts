#!/usr/bin/env bun

import { GoalStore } from "../services/goal-store.ts";
import { migrateBoardsToGoals } from "../services/goal-migration.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}


async function main(): Promise<void> {
  const boardsDir = arg("--boards-dir");
  const stateDir = arg("--state-dir");
  const dryRun = process.argv.includes("--dry-run");
  if (!boardsDir || !stateDir) {
    console.log("Usage: bun scripts/migrate-goals.ts --boards-dir <dir> --state-dir <dir> [--dry-run]");
    process.exit(2);
  }
  const store = new GoalStore(stateDir);
  await store.load();
  const res = await migrateBoardsToGoals(store, boardsDir, { dryRun });
  console.log("goal migration done");
  console.log(`  boards scanned : ${res.boardsScanned}`);
  console.log(`  goals created  : ${res.goalsCreated.length} ${res.goalsCreated.join(", ")}`);
  console.log(`  items migrated : ${res.itemsMigrated}`);
  console.log(`  skipped boards : ${res.skippedBoards.join(", ") || "—"}`);
  console.log(`  corrupt files  : ${res.corruptFiles}`);
}


if (import.meta.main) {
  main().catch((err) => {
    console.error("goal migration failed:", err);
    process.exit(1);
  });
}
