import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getInitReady } from "../src/bootstrap/plugin-init.ts";
import { createHooks } from "../src/index.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

type Tool = {
  execute(args: Record<string, unknown>, context: never): Promise<unknown>;
};

const work = mkdtempSync(join(tmpdir(), "tawassul-no-git-"));
const emptyBin = join(work, "empty-bin");
const keyDir = join(work, "keys");
mkdirSync(emptyBin, { recursive: true });
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });

process.env.HOME = work;
process.env.USERPROFILE = work;
process.env.XDG_CONFIG_HOME = join(work, "config");
process.env.XDG_DATA_HOME = join(work, "data");
process.env.XDG_STATE_HOME = join(work, "state");
process.env.XDG_CACHE_HOME = join(work, "cache");
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
process.env.TAWASSUL_REGISTER_TRIGGERS = "off";
process.env.TAWASSUL_GIT_BIN = join(work, "missing-git");
process.env.PATH = emptyBin;

try {
  const hooks = await createHooks({ client: {}, directory: work, worktree: work } as never);
  const probe = getInitReady(hooks as never);
  assert(probe !== undefined, "the isolated boot exposes the init readiness probe");
  const status = await probe!();
  assert(status.ready, `the boot completes init without git (${status.error?.message ?? "ready"})`);

  const tools = (hooks.tool ?? {}) as Record<string, Tool>;
  assert(Object.keys(tools).length > 0, "the tool registry is not empty without git");
  assert("astquery" in tools, "astquery registers without git");
  assert("codestate" in tools, "codestate registers without git");

  const result = await tools.codestate!.execute({ action: "status" }, {} as never);
  const text = typeof result === "string" ? result : ((result as { output?: string }).output ?? "");
  assert(text.includes("git"), `codestate explains the missing git (${text})`);

  console.log(`PROOF PASS: init and the tool registry survive a missing git (${passed} assertions)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
