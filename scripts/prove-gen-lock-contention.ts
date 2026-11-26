import "./proof-log-isolate.ts";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireOpencodeConfigLock, opencodeConfigLockName } from "../src/utils/opencode-config.ts";
import { acquireFSLock, lockDirFor, releaseFSLock } from "../src/infra/file-lock.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const GEN = resolve(REPO, "src", "scripts", "gen-opencode-config.ts");
const BASE_AGENTS = ["tawa", "dev", "analyst", "tester", "reviewer", "architect", "designer", "doc"];

function runCli(dir: string): number {
  try {
    execFileSync(process.execPath, [GEN, "--project", dir], { timeout: 120000, stdio: "pipe" });
    return 0;
  } catch (e) {
    const status = (e as { status?: unknown }).status;
    return typeof status === "number" ? status : 1;
  }
}

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-genlock-"));
  const alias = `${dir}-alias`;
  let aliasCreated = false;
  try {
    symlinkSync(dir, alias);
    aliasCreated = true;

    if (opencodeConfigLockName(dir) !== opencodeConfigLockName(alias)) {
      fail("a symlink alias produced a different config lock name");
    }
    console.log("symlink-lock-name ok");

    const missingLeaf = join(dir, "missing", "nested");
    const missingAliasLeaf = join(alias, "missing", "nested");
    if (opencodeConfigLockName(missingLeaf) !== opencodeConfigLockName(missingAliasLeaf)) {
      fail("a missing parent did not canonicalize through the real directory");
    }
    console.log("missing-parent ok");

    mkdirSync(join(dir, ".opencode", "agents"), { recursive: true });
    for (const n of BASE_AGENTS) {
      copyFileSync(join(REPO, ".opencode", "agents", `${n}.md`), join(dir, ".opencode", "agents", `${n}.md`));
    }
    const cfg = join(dir, "opencode.json");
    const seed = JSON.stringify({ $schema: "https://opencode.ai/config.json", agent: {} }, null, 2);
    writeFileSync(cfg, seed, "utf-8");

    const held = await acquireOpencodeConfigLock(alias);
    if (!held.acquired) fail("could not hold the alias anchor lock for the proof");
    try {
      const refused = runCli(dir);
      if (refused === 0) fail("CLI exited 0 while the alias anchor was held");
      if (readFileSync(cfg, "utf-8") !== seed) fail("config was written while the alias anchor was held");
      console.log("refuse-while-alias-held ok");
    } finally {
      await releaseFSLock(held.lockName, held.owner).catch(() => undefined);
    }

    const code = runCli(dir);
    if (code !== 0) fail("CLI failed after lock release");
    const agents = (JSON.parse(readFileSync(cfg, "utf-8")) as { agent?: Record<string, unknown> }).agent;
    const count = agents ? Object.keys(agents).length : 0;
    if (count !== 16) fail(`first run wrote ${count} agents, expected 16`);
    console.log(`run-after-release ok (${count} agents)`);

    const shadow = mkdtempSync(join(tmpdir(), "tawassul-shadow-"));
    try {
      writeFileSync(join(shadow, "opencode.jsonc"), '{\n  "agent": {}\n}\n', "utf-8");
      const shadowCode = runCli(shadow);
      if (shadowCode === 0) fail("CLI accepted an opencode.jsonc shadow");
      if (existsSync(join(shadow, "opencode.json"))) fail("CLI created opencode.json beside opencode.jsonc");
      console.log("jsonc-shadow ok");
    } finally {
      rmSync(shadow, { recursive: true, force: true });
    }

    const proofOwner = `proof::pid-${process.pid}`;
    const reclaimedOwner = `proof-new::pid-${process.pid}`;
    const staleName = `proof-stale-${process.pid}-${Date.now()}`;
    const staleDir = lockDirFor(staleName);
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, "lock"), "legacy", "utf-8");
    writeFileSync(join(staleDir, "owner"), "legacy-session", "utf-8");
    const liveName = `proof-live-${process.pid}-${Date.now()}`;
    const liveDir = lockDirFor(liveName);
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(join(liveDir, "lock"), "live", "utf-8");
    writeFileSync(join(liveDir, "owner"), proofOwner, "utf-8");
    try {
      if (await acquireFSLock(staleName, reclaimedOwner, 5000)) {
        fail("a no-pid lock was reclaimed before the grace");
      }
      if (await acquireFSLock(liveName, reclaimedOwner, 5000)) {
        fail("a lock whose owner pid is alive was reclaimed");
      }
      console.log("no-early-reclaim ok");
      await new Promise((done) => setTimeout(done, 3200));
      if (!(await acquireFSLock(staleName, reclaimedOwner, 5000))) {
        fail("a stale no-pid lock was not reclaimed after the grace");
      }
      await releaseFSLock(staleName, reclaimedOwner);
      if (await acquireFSLock(liveName, reclaimedOwner, 5000)) {
        fail("a lock whose owner pid is alive was reclaimed after the grace");
      }
      console.log("owner-aware-reclaim ok");
    } finally {
      rmSync(liveDir, { recursive: true, force: true });
      rmSync(staleDir, { recursive: true, force: true });
    }

    console.log("PROOF PASS: regen respects the FS config lock and owner-aware reclaim");
  } finally {
    if (aliasCreated) rmSync(alias, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

await main();
