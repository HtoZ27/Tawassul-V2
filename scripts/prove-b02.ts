import { z } from "zod";
import { INIT_READY } from "../src/plugin-types.ts";
import type { TawassulHooks } from "../src/plugin-types.ts";
import { tool } from "../src/tool.ts";
import { startSchemaRefresh, DEFAULT_ATTEMPTS, DEFAULT_DELAY_MS } from "../src/v2/schema-refresh.ts";
import {
  createV2Setup,
  SCHEMA_RETRY_ATTEMPTS,
  SCHEMA_RETRY_DELAY_MS,
  INITIAL_SCHEMA_WAIT_MS,
} from "../src/v2/setup.ts";
import type { V2Context } from "../src/v2/types.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

function fakePlugin(ready: () => Promise<{ ready: boolean; error?: { message?: string } }>): TawassulHooks {
  const echo = tool({
    description: "echo",
    args: { text: z.string() },
    execute: async (args) => ({ output: (args as { text: string }).text }),
  });
  return { tool: { echo }, [INIT_READY]: ready } as unknown as TawassulHooks;
}

function fakeContext(reloads: { count: number }): V2Context {
  return {
    location: { directory: process.cwd() },
    session: {
      hook: async () => ({ dispose: async () => undefined }),
      prompt: async () => undefined,
      synthetic: async () => undefined,
      interrupt: async () => undefined,
    },
    tool: {
      transform: async (callback: (editor: { add: (entry: unknown) => void }) => void) => {
        callback({ add: () => undefined });
        return { dispose: async () => undefined };
      },
      reload: async () => {
        reloads.count += 1;
      },
      list: async () => [],
      hook: async () => ({ dispose: async () => undefined }),
    },
    event: {
      subscribe: async function* () {
        yield* [];
      },
    },
  } as unknown as V2Context;
}

async function neverReadyGivesUpQuickly(): Promise<void> {
  const sleeps: number[] = [];
  const warnings: string[] = [];
  let reloads = 0;
  const handle = startSchemaRefresh({
    probe: async () => ({ ready: false, error: { message: "pending" } }),
    refresh: async () => undefined,
    reload: async () => {
      reloads += 1;
    },
    describe: () => "0 schemas",
    logWarn: (message) => warnings.push(message),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  await handle.done;
  assert(sleeps.length === 5, "a never-ready refresh retries only 5 times between 6 attempts");
  assert(warnings.length === 1, "a never-ready refresh emits exactly one warning line");
  assert(
    warnings[0]?.includes("gave up after 6 attempts") === true,
    "the single warning names the full 6-attempt budget",
  );
  assert(reloads === 0, "a never-ready refresh never reloads the tool domain");
  assert(handle.done instanceof Promise, "the refresh exposes a done promise");
}

async function readyAfterAFewAttemptsReloadsOnce(): Promise<void> {
  let probes = 0;
  let reloads = 0;
  const handle = startSchemaRefresh({
    probe: async () => {
      probes += 1;
      return probes >= 4 ? { ready: true } : { ready: false, error: { message: "pending" } };
    },
    refresh: async () => undefined,
    reload: async () => {
      reloads += 1;
    },
    describe: () => "1 schema",
    attempts: 6,
    delayMs: 1,
    logWarn: () => undefined,
  });
  await handle.done;
  assert(probes === 4, "the refresh stops polling as soon as init becomes ready");
  assert(reloads === 1, "a refresh that becomes ready reloads the tool domain once");
}

async function setupBudgetCase(): Promise<void> {
  const reloads = { count: 0 };
  let probes = 0;
  const ready = async (): Promise<{ ready: boolean; error?: { message: string } }> => {
    probes += 1;
    return { ready: false, error: { message: "pending" } };
  };
  const started = Date.now();
  const cleanup = await createV2Setup({
    init: () => fakePlugin(ready),
    refresh: { attempts: 6, delayMs: 1, initialWaitMs: 5 },
  })(fakeContext(reloads));
  const elapsed = Date.now() - started;
  await cleanup();
  assert(reloads.count === 0, "a setup that never becomes ready never reloads");
  assert(elapsed < 1000, "the 6-attempt budget finishes well under the old 10 second window");
}

async function constantCases(): Promise<void> {
  assert(SCHEMA_RETRY_ATTEMPTS === 6, "the setup retry budget is six attempts");
  assert(SCHEMA_RETRY_DELAY_MS === 500, "the setup retry delay stays at 500 ms");
  assert(INITIAL_SCHEMA_WAIT_MS === 750, "the initial readiness wait stays at 750 ms");
  assert(DEFAULT_ATTEMPTS === 6, "the refresh lifecycle default is six attempts");
  assert(DEFAULT_DELAY_MS === 500, "the refresh lifecycle default delay stays at 500 ms");
  const totalMs = INITIAL_SCHEMA_WAIT_MS + SCHEMA_RETRY_ATTEMPTS * SCHEMA_RETRY_DELAY_MS;
  assert(totalMs <= 4000, "the worst case budget is under four seconds instead of ten");
}

try {
  await neverReadyGivesUpQuickly();
  await readyAfterAFewAttemptsReloadsOnce();
  await setupBudgetCase();
  await constantCases();
  console.log(
    `PROOF PASS: the schema retry budget is six attempts with one warning line (${passed} assertions)`,
  );
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
