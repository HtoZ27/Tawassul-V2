import { z } from "zod";
import { INIT_READY } from "../src/plugin-types.ts";
import type { TawassulHooks } from "../src/plugin-types.ts";
import { tool } from "../src/tool.ts";
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

type Handle = { done: Promise<void>; stop: () => Promise<void> };

type Options = {
  probe: () => Promise<{ ready: boolean; error?: { message?: string } }>;
  refresh: () => Promise<boolean | void>;
  reload: () => Promise<void>;
  describe: () => string;
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  logInfo?: (message: string) => void;
  logWarn?: (message: string, error?: unknown) => void;
};

let startSchemaRefresh: (options: Options) => Handle = () => {
  throw new Error("schema refresh lifecycle missing");
};

async function loadRefreshLifecycle(): Promise<void> {
  const module = await import("../src/v2/schema-refresh.ts").catch(() => null);
  assert(module !== null, "the schema refresh lifecycle is a separate module");
  if (!module) {
    fail("the schema refresh lifecycle is not extracted");
    return;
  }
  assert(typeof module.startSchemaRefresh === "function", "the refresh lifecycle exposes a start handle");
  startSchemaRefresh = module.startSchemaRefresh as (options: Options) => Handle;
}

function fakePlugin(ready: () => Promise<{ ready: boolean; error?: { message?: string } }>): TawassulHooks {
  const echo = tool({
    description: "echo",
    args: { text: z.string() },
    execute: async (args) => ({ output: (args as { text: string }).text }),
  });
  return {
    tool: { echo },
    [INIT_READY]: ready,
  } as unknown as TawassulHooks;
}

type ToolEntry = { name?: string; input?: Record<string, unknown> };

function fakeContext(
  order: string[],
  reload: () => Promise<void>,
  onEntry?: (entry: ToolEntry) => void,
): V2Context {
  return {
    location: { directory: process.cwd() },
    session: {
      hook: async () => ({ dispose: async () => order.push("session-dispose") }),
      prompt: async () => undefined,
      synthetic: async () => undefined,
      interrupt: async () => undefined,
    },
    tool: {
      transform: async (callback: (editor: { add: (entry: unknown) => void }) => void) => {
        callback({ add: (entry) => onEntry?.(entry as ToolEntry) });
        return { dispose: async () => order.push("tool-dispose") };
      },
      reload,
      list: async () => [],
      hook: async () => ({ dispose: async () => order.push("tool-hook-dispose") }),
    },
    event: {
      subscribe: async function* () {
        yield* [];
      },
    },
  } as unknown as V2Context;
}

async function helperCases(): Promise<void> {
  {
    const refreshGate = deferred();
    const refreshStarted = deferred();
    let reloads = 0;
    const handle = startSchemaRefresh({
      probe: async () => ({ ready: true }),
      refresh: async () => {
        refreshStarted.resolve();
        await refreshGate.promise;
      },
      reload: async () => {
        reloads++;
      },
      describe: () => "1 schema",
      attempts: 1,
      logInfo: () => undefined,
    });
    await refreshStarted.promise;
    let stopped = false;
    const stopping = handle.stop().then(() => {
      stopped = true;
    });
    await delay(20);
    assert(!stopped, "stop waits for an in-flight refresh");
    refreshGate.resolve();
    await stopping;
    assert(stopped, "stop resolves once the in-flight refresh finishes");
    assert(reloads === 0, "a stopped refresh never reloads the tool domain");
  }

  {
    let reloads = 0;
    const handle = startSchemaRefresh({
      probe: async () => ({ ready: true }),
      refresh: async () => undefined,
      reload: async () => {
        reloads++;
      },
      describe: () => "1 schema",
      attempts: 1,
      logInfo: () => undefined,
    });
    await handle.done;
    assert(reloads === 1, "a refresh that is not stopped reloads the tool domain once");
  }

  {
    let reloads = 0;
    const handle = startSchemaRefresh({
      probe: async () => ({ ready: false, error: { message: "pending" } }),
      refresh: async () => undefined,
      reload: async () => {
        reloads++;
      },
      describe: () => "0 schemas",
      attempts: 5,
      delayMs: 1,
      logWarn: () => undefined,
    });
    await handle.stop();
    assert(reloads === 0, "a refresh stopped before init readiness never reloads");
    await handle.stop();
    assert(true, "stopping an already stopped refresh is safe");
  }

  {
    const warnings: string[] = [];
    const handle = startSchemaRefresh({
      probe: async () => ({ ready: true }),
      refresh: async () => undefined,
      reload: async () => {
        throw new Error("reload exploded");
      },
      describe: () => "1 schema",
      attempts: 1,
      logInfo: () => undefined,
      logWarn: (message) => warnings.push(message),
    });
    await handle.done;
    assert(
      warnings.some((message) => message.includes("reload failed")),
      "a failed reload is reported instead of escaping",
    );
  }

  {
    const warnings: string[] = [];
    const handle = startSchemaRefresh({
      probe: async () => {
        throw new Error("probe exploded");
      },
      refresh: async () => undefined,
      reload: async () => undefined,
      describe: () => "0 schemas",
      attempts: 1,
      logInfo: () => undefined,
      logWarn: (message) => warnings.push(message),
    });
    await handle.done;
    assert(
      warnings.some((message) => message.includes("refresh failed")),
      "a failed probe is reported instead of rejecting the task",
    );
  }
}

async function setupCases(): Promise<void> {
  {
    const order: string[] = [];
    const reloadStarted = deferred();
    const reloadGate = deferred();
    const entries: ToolEntry[] = [];
    let reloads = 0;
    let probes = 0;
    const ready = async (): Promise<{ ready: boolean }> => {
      probes += 1;
      return probes === 1 ? { ready: false } : { ready: true };
    };
    const cleanup = await createV2Setup({
      init: () => fakePlugin(ready),
      refresh: { attempts: 2, delayMs: 1, initialWaitMs: 5 },
    })(
      fakeContext(
        order,
        async () => {
          reloads++;
          order.push("reload-start");
          reloadStarted.resolve();
          await reloadGate.promise;
          order.push("reload-end");
        },
        (entry) => entries.push(entry),
      ),
    );
    assert(
      entries.length === 1 && Object.keys(entries[0]?.input?.properties ?? {}).length === 0,
      "a registration before readiness advertises the placeholder schema",
    );
    const started = await Promise.race([
      reloadStarted.promise.then(() => true),
      delay(3000).then(() => false),
    ]);
    assert(started, "the setup refreshes the schemas once init is ready");
    let disposed = false;
    const disposing = cleanup().then(() => {
      disposed = true;
    });
    await delay(50);
    assert(!disposed, "dispose waits for the in-flight reload instead of returning early");
    reloadGate.resolve();
    await disposing;
    assert(disposed, "dispose finishes once the in-flight reload finishes");
    assert(order.indexOf("reload-end") < order.indexOf("tool-dispose"), "the tool domain is disposed only after the reload");
    assert(reloads === 1, "the setup reloads exactly once");
  }

  {
    const order: string[] = [];
    const entries: ToolEntry[] = [];
    let reloads = 0;
    const ready = async (): Promise<{ ready: boolean }> => ({ ready: true });
    const cleanup = await createV2Setup({
      init: () => fakePlugin(ready),
      refresh: { attempts: 2, delayMs: 1 },
    })(
      fakeContext(
        order,
        async () => {
          reloads++;
        },
        (entry) => entries.push(entry),
      ),
    );
    await cleanup();
    assert(
      entries.length === 1 && Object.keys(entries[0]?.input?.properties ?? {}).length > 0,
      "a registration after readiness advertises the real schema",
    );
    assert(reloads === 0, "the setup skips the reload when the registered schemas are already current");
  }

  {
    const order: string[] = [];
    let reloads = 0;
    const ready = async (): Promise<{ ready: boolean; error: { message: string } }> => ({
      ready: false,
      error: { message: "pending" },
    });
    const cleanup = await createV2Setup({
      init: () => fakePlugin(ready),
      refresh: { attempts: 3, delayMs: 1 },
    })(
      fakeContext(order, async () => {
        reloads++;
      }),
    );
    await cleanup();
    assert(reloads === 0, "a setup disposed before readiness never reloads the tool domain");
  }
}

try {
  await loadRefreshLifecycle();
  await helperCases();
  await setupCases();
  console.log(`PROOF PASS: schema refresh stops and is awaited before the tool domain is disposed (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
