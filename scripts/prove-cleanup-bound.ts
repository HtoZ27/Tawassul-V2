import { z } from "zod";
import { INIT_READY } from "../src/plugin-types.ts";
import type { TawassulHooks } from "../src/plugin-types.ts";
import { tool } from "../src/tool.ts";
import { collectToolSchemas } from "../src/v2/adapters.ts";
import { createV2Setup } from "../src/v2/setup.ts";
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakePlugin(
  ready: () => Promise<{ ready: boolean; error?: { message?: string } }>,
): TawassulHooks {
  const echo = tool({
    description: "echo",
    args: { text: z.string() },
    execute: async (args) => ({ output: (args as { text: string }).text }),
  });
  return { tool: { echo }, [INIT_READY]: ready } as unknown as TawassulHooks;
}

type ContextOptions = {
  reload: () => Promise<void>;
  onToolDispose: () => void;
};

function fakeContext(options: ContextOptions): V2Context {
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
        return { dispose: async () => options.onToolDispose() };
      },
      reload: options.reload,
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

async function parkedProbe(): Promise<void> {
  let refreshes = 0;
  let reloads = 0;
  let probes = 0;
  const started = deferred();
  const cleanup = await createV2Setup({
    init: () =>
      fakePlugin(async () => {
        probes += 1;
        started.resolve();
        return new Promise<{ ready: boolean }>(() => undefined);
      }),
    collectSchemas: async (toolMap) => {
      refreshes += 1;
      return collectToolSchemas(toolMap);
    },
    refresh: { attempts: 3, delayMs: 10, initialWaitMs: 10 },
  })(
    fakeContext({
      reload: async () => {
        reloads += 1;
      },
      onToolDispose: () => undefined,
    }),
  );
  await started.promise;
  await delay(30);
  assert(probes >= 2, "the refresh loop parks on the probe");
  const began = performance.now();
  const outcome = await Promise.race([
    cleanup().then(() => "settled" as const),
    delay(150).then(() => "timeout" as const),
  ]);
  const elapsed = performance.now() - began;
  assert(outcome === "settled", "a parked probe is released instead of waiting for the teardown bound");
  assert(elapsed < 150, "the parked probe releases in less than 150 ms");
  assert(refreshes === 0, "a parked probe never runs a refresh");
  assert(reloads === 0, "a parked probe never runs a reload");
}

async function inFlightReload(): Promise<void> {
  const order: string[] = [];
  const reloadStarted = deferred();
  const reloadGate = deferred();
  let reloads = 0;
  let probes = 0;
  const cleanup = await createV2Setup({
    init: () =>
      fakePlugin(async () => {
        probes += 1;
        return probes === 1 ? { ready: false } : { ready: true };
      }),
    refresh: { attempts: 2, delayMs: 1, initialWaitMs: 5 },
  })(
    fakeContext({
      reload: async () => {
        reloads += 1;
        order.push("reload-start");
        reloadStarted.resolve();
        await reloadGate.promise;
        order.push("reload-end");
      },
      onToolDispose: () => {
        order.push("tool-dispose");
      },
    }),
  );
  await reloadStarted.promise;
  let disposed = false;
  const disposing = cleanup().then(() => {
    disposed = true;
  });
  await delay(300);
  assert(!disposed, "cleanup waits for an in-flight reload");
  assert(!order.includes("tool-dispose"), "the tool domain is not disposed before the reload ends");
  reloadGate.resolve();
  await disposing;
  assert(disposed, "cleanup finishes once the in-flight reload ends");
  assert(
    order.indexOf("reload-end") < order.indexOf("tool-dispose"),
    "the tool domain is disposed after the reload ends",
  );
  assert(reloads === 1, "the in-flight reload runs exactly once");
}

async function backoffSleep(): Promise<void> {
  let refreshes = 0;
  let reloads = 0;
  const cleanup = await createV2Setup({
    init: () =>
      fakePlugin(async () => ({ ready: false, error: { message: "pending" } })),
    collectSchemas: async (toolMap) => {
      refreshes += 1;
      return collectToolSchemas(toolMap);
    },
    refresh: { attempts: 6, delayMs: 300, initialWaitMs: 5 },
  })(
    fakeContext({
      reload: async () => {
        reloads += 1;
      },
      onToolDispose: () => undefined,
    }),
  );
  await delay(50);
  const began = performance.now();
  await cleanup();
  const elapsed = performance.now() - began;
  assert(elapsed <= 400, "a release during a backoff sleep settles within delayMs plus 100 ms");
  assert(refreshes === 0, "a release during the sleep never refreshes");
  assert(reloads === 0, "a release during the sleep never reloads");
}

try {
  await parkedProbe();
  await inFlightReload();
  await backoffSleep();
  console.log(`PROOF PASS: a parked probe is released without breaking the reload contract (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(e);
    process.exitCode = 1;
  }
}
