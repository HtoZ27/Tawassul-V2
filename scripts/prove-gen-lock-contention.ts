import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireOpencodeConfigLock } from "../src/utils/opencode-config.ts";
import { releaseFSLock } from "../src/infra/file-lock.ts";

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
  try {
    mkdirSync(join(dir, ".opencode", "agents"), { recursive: true });
    for (const n of BASE_AGENTS) {
      copyFileSync(join(REPO, ".opencode", "agents", `${n}.md`), join(dir, ".opencode", "agents", `${n}.md`));
    }
    const cfg = join(dir, "opencode.json");
    const seed = JSON.stringify({ $schema: "https://opencode.ai/config.json", agent: {} }, null, 2);
    writeFileSync(cfg, seed, "utf-8");

    const held = await acquireOpencodeConfigLock(dir);
    if (!held.acquired) fail("could not hold the anchor lock for the proof");
    try {
      const refused = runCli(dir);
      if (refused === 0) fail("CLI exited 0 while the anchor was held");
      if (readFileSync(cfg, "utf-8") !== seed) fail("config was written while the anchor was held");
      console.log("refuse-while-held ok");
    } finally {
      await releaseFSLock(held.lockName, held.owner).catch(() => undefined);
    }

    const code = runCli(dir);
    if (code !== 0) fail("CLI failed after lock release");
    const agents = (JSON.parse(readFileSync(cfg, "utf-8")) as { agent?: Record<string, unknown> }).agent;
    const count = agents ? Object.keys(agents).length : 0;
    if (count === 0) fail("no agents written after lock release");
    console.log(`run-after-release ok (${count} agents)`);
    console.log("PROOF PASS: regen respects the FS config lock");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await main();
