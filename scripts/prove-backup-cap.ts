import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteFile } from "../src/utils/atomic.ts";
import { ensureAgentModels } from "../src/utils/opencode-config.ts";
import { StateManager } from "../src/context/managers/StateManager.ts";

let failures = 0;

function check(name: string, cond: boolean): void {
  if (cond) {
    console.log(`ok ${name}`);
    return;
  }
  failures += 1;
  console.error(`PROOF FAIL: ${name}`);
}

const root = mkdtempSync(join(tmpdir(), "tawassul-backup-cap-"));
const target = join(root, "state.json");
const atomicPattern = /^state\.json\.bak\.(\d+)\.[0-9a-f]{12}$/;

try {
  delete process.env.TAWASSUL_ISOLATED;
  writeFileSync(target, "v0", "utf8");

  const numbered = [`${target}.bak.0`, `${target}.bak.1`];
  for (const path of numbered) writeFileSync(path, "numbered", "utf8");
  writeFileSync(`${target}.bak.orphan-1000`, "orphan", "utf8");

  for (const at of [100, 200]) {
    writeFileSync(`${target}.bak.${at}.aaaaaaaaaaaa`, `old-${at}`, "utf8");
  }

  await atomicWriteFile(target, "v1");
  await atomicWriteFile(target, "v2");

  check("numbered backup 0 survives the atomic prune", existsSync(`${target}.bak.0`));
  check("numbered backup 1 survives the atomic prune", existsSync(`${target}.bak.1`));
  check("the orphan backup survives the atomic prune", existsSync(`${target}.bak.orphan-1000`));

  const entries = readdirSync(root);
  const own = entries.filter((entry) => atomicPattern.test(entry)).sort();
  check("atomic keeps exactly two of its own backups", own.length === 2);
  check("the two oldest atomic backups were pruned", !own.includes("state.json.bak.100.aaaaaaaaaaaa") && !own.includes("state.json.bak.200.aaaaaaaaaaaa"));

  const newest = own
    .map((entry) => ({ entry, at: Number(atomicPattern.exec(entry)?.[1] ?? 0) }))
    .sort((a, b) => b.at - a.at)[0];
  check("the newest atomic backup holds the previous version", newest !== undefined && readFileSync(join(root, newest.entry), "utf8") === "v1");

  writeFileSync(`${target}.bak.orphan-2000`, "orphan-2", "utf8");
  writeFileSync(`${target}.bak.orphan-3000`, "orphan-3", "utf8");
  writeFileSync(`${target}.tmp`, "partial", "utf8");
  writeFileSync(`${target}.delta`, "partial", "utf8");

  const manager = new StateManager(root, () => target);
  await manager.cleanOrphanedTmp(target);

  check("orphans are capped at one", !existsSync(`${target}.bak.orphan-1000`) && !existsSync(`${target}.bak.orphan-2000`) && existsSync(`${target}.bak.orphan-3000`));
  check("tmp files are cleaned", !existsSync(`${target}.tmp`));
  check("delta files are cleaned", !existsSync(`${target}.delta`));
  check("the numbered chain is untouched by cleanup", existsSync(`${target}.bak.0`) && existsSync(`${target}.bak.1`));

  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  const config = join(project, "opencode.json");
  const dynamicConfig = `{\n  "agent": {\n    "dev": {\n      "model": "dynamic"\n    }\n  }\n}\n`;
  let lastBackup: string | null = null;
  for (let run = 0; run < 3; run++) {
    writeFileSync(config, dynamicConfig, "utf8");
    const result = await ensureAgentModels(project);
    if (result.changed) lastBackup = result.backupPath;
  }
  const configBackups = readdirSync(project).filter((entry) => /^opencode\.json\.bak\.\d+\.[0-9a-f]{12}$/.test(entry));
  check("config repair uses the atomic backup scheme", lastBackup !== null && /\.bak\.\d+\.[0-9a-f]{12}$/.test(lastBackup));
  check("config repair keeps exactly two backups", configBackups.length === 2);
  check("config repair writes no uncapped timestamped backup", !readdirSync(project).some((entry) => /^opencode\.json\.bak\.\d{4}-/.test(entry)));

  const large = join(root, "large-state.json");
  const largeBytes = StateManager.BACKUP_SIZE_WARN_BYTES + 1024;
  writeFileSync(large, "x".repeat(largeBytes), "utf8");
  const largeManager = new StateManager(root, () => large);
  const rotate = (largeManager as unknown as { rotateBackups: (fp: string) => Promise<void> }).rotateBackups.bind(largeManager);
  await rotate(large);
  check("a state file above the warning size still gets a backup", existsSync(`${large}.bak.0`));
  check("the large backup keeps the full content", existsSync(`${large}.bak.0`) && statSync(`${large}.bak.0`).size === largeBytes);
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`PROOF FAIL: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("PROOF PASS: backup schemes are namespaced and capped without evicting the recovery chain");
