#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GoalStore } from "../src/services/goal-store.ts";

type Counts = { completed: number; verified: number; dropped: number };

type QuarantineManifest = {
  createdAt: string;
  stateDir: string;
  ledgerHash: string;
  metaHash: string | null;
  metaExisted: boolean;
};

export type GoalMigrationResult =
  | {
      ok: true;
      counts: Counts;
      ledgerHash: string;
      preHash: string;
      quarantine: string;
      diff: Array<{ id: string; before: string; after: string }>;
    }
  | {
      ok: false;
      reason: string;
      detail?: string;
      quarantine?: string;
      restored?: boolean;
    };

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function restoreQuarantine(quarantine: string, goalsDir: string, manifest: QuarantineManifest): boolean {
  const ledgerCopy = join(quarantine, "goals.jsonl");
  const metaCopy = join(quarantine, "goals-meta.json");
  const ledgerLive = join(goalsDir, "goals.jsonl");
  const metaLive = join(goalsDir, "goals-meta.json");
  try {
    if (!existsSync(ledgerCopy)) return false;
    copyFileSync(ledgerCopy, ledgerLive);
    if (manifest.metaExisted && existsSync(metaCopy)) {
      copyFileSync(metaCopy, metaLive);
    } else {
      rmSync(metaLive, { force: true });
    }
    if (sha256File(ledgerLive) !== manifest.ledgerHash) return false;
    if (manifest.metaExisted) {
      if (!existsSync(metaLive) || sha256File(metaLive) !== manifest.metaHash) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function migrateGoalLedger(opts: {
  stateDir: string;
  expectHash?: string;
  force?: boolean;
  now?: Date;
}): Promise<GoalMigrationResult> {
  const stateDir = resolve(opts.stateDir);
  const goalsDir = join(stateDir, "goals");
  const ledgerLive = join(goalsDir, "goals.jsonl");
  const metaLive = join(goalsDir, "goals-meta.json");
  if (!existsSync(ledgerLive)) return { ok: false, reason: "missing-ledger" };
  if (!opts.expectHash) return { ok: false, reason: "missing-expect-hash" };
  const preHash = sha256File(ledgerLive);
  if (preHash !== opts.expectHash) {
    return { ok: false, reason: "hash-mismatch", detail: `expected ${opts.expectHash}, found ${preHash}` };
  }
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  let quarantine = join(goalsDir, "quarantine", stamp);
  for (let n = 2; existsSync(quarantine); n += 1) {
    quarantine = join(goalsDir, "quarantine", `${stamp}-${n}`);
  }
  mkdirSync(quarantine, { recursive: true });
  copyFileSync(ledgerLive, join(quarantine, "goals.jsonl"));
  const metaExisted = existsSync(metaLive);
  if (metaExisted) copyFileSync(metaLive, join(quarantine, "goals-meta.json"));
  const manifest: QuarantineManifest = {
    createdAt: new Date().toISOString(),
    stateDir,
    ledgerHash: sha256File(join(quarantine, "goals.jsonl")),
    metaHash: metaExisted ? sha256File(join(quarantine, "goals-meta.json")) : null,
    metaExisted,
  };
  writeFileSync(join(quarantine, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  const store = new GoalStore(stateDir);
  try {
    const result = await store.rebuildMeta();
    if (!result.ok) return { ok: false, reason: result.reason, quarantine };
    writeFileSync(join(quarantine, "diff.json"), `${JSON.stringify(result.diff, null, 2)}\n`, "utf-8");
    return {
      ok: true,
      counts: result.counts,
      ledgerHash: result.ledgerHash,
      preHash,
      quarantine,
      diff: result.diff,
    };
  } catch (err) {
    const restored = restoreQuarantine(quarantine, goalsDir, manifest);
    return {
      ok: false,
      reason: "write-failed",
      detail: err instanceof Error ? err.message : String(err),
      quarantine,
      restored,
    };
  }
}

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const stateDir = arg("--state-dir");
  const expectHash = arg("--expect-hash");
  const force = process.argv.includes("--force");
  if (!stateDir) {
    console.log("Usage: bun scripts/goal-migrate.ts --state-dir <dir> --expect-hash <sha256> [--force]");
    process.exit(2);
  }
  if (force && !expectHash) {
    console.log("--force still requires --expect-hash");
    process.exit(2);
  }
  const result = await migrateGoalLedger({ stateDir, expectHash, force });
  if (!result.ok) {
    console.error(`goal migration refused: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`);
    if (result.quarantine) console.error(`quarantine: ${result.quarantine}`);
    if (result.restored !== undefined) console.error(`restored: ${result.restored}`);
    process.exit(1);
  }
  console.log("goal meta rebuilt");
  console.log(`  state dir    : ${resolve(stateDir)}`);
  console.log(`  pre hash     : ${result.preHash}`);
  console.log(`  ledger hash  : ${result.ledgerHash}`);
  console.log(`  completed    : ${result.counts.completed}`);
  console.log(`  verified     : ${result.counts.verified}`);
  console.log(`  dropped      : ${result.counts.dropped}`);
  console.log(`  quarantine   : ${result.quarantine}`);
  console.log(`  diff entries : ${result.diff.length}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("goal migration failed:", err);
    process.exit(1);
  });
}
