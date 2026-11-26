import "./proof-log-isolate.ts";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getInitReady } from "../src/bootstrap/plugin-init.ts";
import { createV2Setup } from "../src/v2/setup.ts";

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

const BOOT_BUDGET_MS = 2000;

async function isolatedBoot(): Promise<number> {
  const work = mkdtempSync(join(tmpdir(), "tawassul-boot-budget-"));
  const keyDir = join(work, "hmac");
  mkdirSync(join(work, ".opencode", "agents"), { recursive: true });
  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  copyFileSync(
    join(process.cwd(), ".opencode", "agents", "dev.md"),
    join(work, ".opencode", "agents", "dev.md"),
  );
  writeFileSync(
    join(work, "opencode.json"),
    JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        agent: { dev: { model: "opencode/big-pickle", mode: "subagent", permission: { edit: "allow", bash: "allow" } } },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });

  process.env.TAWASSUL_SCOPE = "project";
  process.env.TAWASSUL_PROJECT_DIR = work;
  process.env.TAWASSUL_STATE_DIR = join(work, "context");
  process.env.TAWASSUL_V2_STATE_DIR = join(work, "state");
  process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
  process.env.TAWASSUL_ASK_CHANNEL = "1";
  process.env.TAWASSUL_ASK_TRANSCRIPT = "1";
  process.env.OPENCODE_DB = join(work, "opencode.db");
  process.env.HOME = join(work, "home");
  process.env.XDG_CONFIG_HOME = join(work, "xdg-config");
  process.env.XDG_DATA_HOME = join(work, "xdg-data");
  process.env.XDG_CACHE_HOME = join(work, "xdg-cache");
  process.env.XDG_STATE_HOME = join(work, "xdg-state");
  mkdirSync(join(work, "home"), { recursive: true });

  const { initPlugin } = await import("../src/bootstrap/plugin-init.ts");
  const { buildPluginInput } = await import("../src/v2/client-shim.ts");

  const ctx = {
    location: { directory: work },
    session: {
      hook: async () => ({ dispose: async () => undefined }),
      prompt: async () => undefined,
      synthetic: async () => undefined,
      interrupt: async () => undefined,
      get: async () => ({}),
      list: () => new Promise(() => {}),
    },
    tool: {
      transform: async (callback: (editor: { add: (entry: unknown) => void }) => void) => {
        callback({ add: () => undefined });
        return { dispose: async () => undefined };
      },
      reload: async () => undefined,
      list: async () => [],
      hook: async () => ({ dispose: async () => undefined }),
    },
    event: { subscribe: async function* () {} },
    permission: {
      assert: async () => undefined,
      hook: async () => ({ dispose: async () => undefined }),
    },
  } as never;

  const logs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" "));
  };
  try {
    const started = Date.now();
    const plugin = initPlugin(buildPluginInput(ctx));
    const probe = getInitReady(plugin as never);
    if (probe) await probe();
    const cleanup = await createV2Setup({ refresh: { attempts: 2, delayMs: 1, initialWaitMs: 5 } })(ctx);
    const { claimCoexistence } = await import("../src/core/install-scope.ts");
    const duplicate = claimCoexistence(
      process.env.TAWASSUL_SCOPE === "global" ? "global" : "project",
      "boot-budget-second-token",
      work,
    );
    assert(
      duplicate.shouldRegister === false,
      "a same-process claim with a different token yields to the measured boot",
    );
    const elapsed = Date.now() - started;
    const registered = logs.some((line) => line.includes("v2 registered"));
    const cleanupStartedAt = Date.now();
    await cleanup();
    const cleanupElapsed = Date.now() - cleanupStartedAt;
    originalError(
      `[boot-budget] registration log before cleanup: ${registered ? "present" : "missing"}; cleanup ${cleanupElapsed} ms`,
    );
    assert(registered, "the setup reaches tool registration while session.list is parked");
    assert(
      cleanupElapsed < 5000,
      `cleanup resolves while session.list is parked (measured ${cleanupElapsed} ms)`,
    );
    await plugin.dispose?.();
    return elapsed;
  } finally {
    console.error = originalError;
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    rmSync(work, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const elapsed = await isolatedBoot();
  console.log(`[boot-budget] measured boot: ${elapsed} ms (budget ${BOOT_BUDGET_MS} ms)`);
  assert(elapsed > 0, "the boot measurement is a positive duration");
  assert(
    elapsed < BOOT_BUDGET_MS,
    `boot from init to registered tools stays under ${BOOT_BUDGET_MS} ms (measured ${elapsed} ms)`,
  );
}

try {
  await main();
  console.log(`PROOF PASS: boot stays within the measured budget (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
