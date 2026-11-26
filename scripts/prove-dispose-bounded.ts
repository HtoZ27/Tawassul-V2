import "./proof-log-isolate.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { INIT_READY } from "../src/plugin-types.ts";
import type { TawassulHooks } from "../src/plugin-types.ts";
import { tool } from "../src/tool.ts";
import { createV2Setup, TEARDOWN_STEP_TIMEOUT_MS } from "../src/v2/setup.ts";
import { getSessionBridge } from "../src/v2/session-bridge.ts";
import { logger } from "../src/utils/logger.ts";
import type { V2Context } from "../src/v2/types.ts";

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

function deadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

type LogRecord = { level: string; message: string };

function captureLogger(): { records: LogRecord[]; restore: () => void } {
  const records: LogRecord[] = [];
  const original = {
    debug: logger.debug,
    info: logger.info,
    warn: logger.warn,
    error: logger.error,
  };
  const record = (level: string) => (message: string, data?: unknown) => {
    const suffix = data === undefined ? "" : ` ${String(data)}`;
    records.push({ level, message: message + suffix });
  };
  logger.debug = record("debug");
  logger.info = record("info");
  logger.warn = record("warn");
  logger.error = record("error");
  return {
    records,
    restore: () => {
      logger.debug = original.debug;
      logger.info = original.info;
      logger.warn = original.warn;
      logger.error = original.error;
    },
  };
}

function fakePlugin(options: {
  ready?: () => Promise<{ ready: boolean }>;
  event?: (input: { event: unknown }) => Promise<void>;
  dispose?: () => Promise<void>;
} = {}): TawassulHooks {
  const echo = tool({
    description: "echo",
    args: { text: z.string() },
    execute: async (args) => ({ output: (args as { text: string }).text }),
  });
  return {
    tool: { echo },
    event: options.event,
    dispose: options.dispose,
    [INIT_READY]: options.ready ?? (async () => ({ ready: true })),
  } as unknown as TawassulHooks;
}

type ContextOptions = {
  order?: string[];
  subscribe?: (options?: { signal?: AbortSignal }) => AsyncIterable<unknown>;
  contextDispose?: () => Promise<void>;
  toolDispose?: () => Promise<void>;
};

function fakeContext(options: ContextOptions = {}): V2Context {
  const order = options.order ?? [];
  const registration = (label: string) => ({
    dispose: async () => {
      order.push(label);
    },
  });
  return {
    app: { version: "2.3.0" },
    location: { directory: process.cwd() },
    session: {
      hook: async (name: string) => {
        if (name === "context" && options.contextDispose) {
          return { dispose: options.contextDispose };
        }
        return registration(`${name}-dispose`);
      },
      get: async () => ({}),
      list: async () => ({ data: [], cursor: { next: null } }),
      prompt: async () => undefined,
      synthetic: async () => undefined,
      interrupt: async () => undefined,
    },
    tool: {
      transform: async (callback: (editor: { add: (entry: unknown) => void }) => void) => {
        callback({ add: () => undefined });
        return {
          dispose: async () => {
            if (options.toolDispose) await options.toolDispose();
            order.push("tool-dispose");
          },
        };
      },
      reload: async () => undefined,
      list: async () => [],
      hook: async () => registration("tool-hook-dispose"),
    },
    event: options.subscribe ? { subscribe: options.subscribe } : { subscribe: async function* () {} },
  } as unknown as V2Context;
}

function idleStream(): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<unknown>>(() => {}),
      return: async () => ({ done: true, value: undefined }),
    }),
  };
}

const setupDeps = {
  optionalTimeoutMs: 20,
  teardownTimeoutMs: 25,
  registrationWatchdogMs: 50,
  refresh: { attempts: 1, delayMs: 1, initialWaitMs: 5 },
};

const work = mkdtempSync(join(tmpdir(), "tawassul-dispose-bounded-"));
process.env.TAWASSUL_SCOPE = "project";
process.env.TAWASSUL_USAGE_LEDGER = join(work, "usage-ledger.jsonl");

const captured = captureLogger();

try {
  assert(TEARDOWN_STEP_TIMEOUT_MS === 5000, "the teardown step bound defaults to 5 s");

  {
    let signalSeen: AbortSignal | undefined;
    let returnCalled = 0;
    let toolDisposed = 0;
    let pluginDisposed = 0;
    const plugin = fakePlugin({
      dispose: async () => {
        pluginDisposed += 1;
      },
    });
    const context = fakeContext({
      toolDispose: async () => {
        toolDisposed += 1;
      },
      subscribe: (subscribeOptions) => {
        signalSeen = subscribeOptions?.signal;
        return {
          [Symbol.asyncIterator]: () => ({
            next: () => new Promise<IteratorResult<unknown>>(() => {}),
            return: async () => {
              returnCalled += 1;
              return { done: true, value: undefined };
            },
          }),
        };
      },
    });
    const cleanup = await createV2Setup({
      ...setupDeps,
      init: () => plugin,
    })(context);
    const startedAt = Date.now();
    const first = cleanup();
    const second = cleanup();
    assert(first === second, "a second dispose returns the in-flight completion");
    await deadline(first, 2000, "idle cleanup");
    assert(Date.now() - startedAt < 1000, "an idle relay cleanup finishes within its bounds");
    assert(signalSeen?.aborted === true, "cleanup aborts the relay signal");
    assert(returnCalled === 1, "cleanup calls the iterator return exactly once");
    assert(
      captured.records.some(
        (record) => record.level === "warn" && record.message.includes("cleanup step event relay abandoned"),
      ),
      "the abandoned relay is logged",
    );
    assert(toolDisposed === 1, "the tool disposer runs once");
    assert(getSessionBridge() === null, "the bridge is cleared after the bounded relay");
    assert(pluginDisposed === 1, "plugin.dispose runs once");
  }

  {
    const delivery: { resolve: ((value: IteratorResult<unknown>) => void) | null } = { resolve: null };
    let eventCalls = 0;
    let bridgeAtPluginDispose: boolean | null = null;
    const plugin = fakePlugin({
      event: async () => {
        eventCalls += 1;
      },
      dispose: async () => {
        bridgeAtPluginDispose = getSessionBridge() !== null;
      },
    });
    const context = fakeContext({
      subscribe: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () =>
            new Promise<IteratorResult<unknown>>((resolve) => {
              delivery.resolve = resolve;
            }),
          return: async () => ({ done: true, value: undefined }),
        }),
      }),
    });
    const cleanup = await createV2Setup({
      ...setupDeps,
      init: () => plugin,
    })(context);
    await delay(0);
    assert(delivery.resolve !== null, "the relay is parked in its first next call");
    const pending = cleanup();
    await delay(0);
    delivery.resolve?.({ done: false, value: { type: "session.text.ended", data: { sessionID: "ses-drop" } } });
    await deadline(pending, 2000, "delivered-after-abort cleanup");
    assert(eventCalls === 0, "an event delivered after the abort is dropped");
    assert(
      bridgeAtPluginDispose === true,
      "the bridge stays readable through plugin.dispose",
    );
    assert(getSessionBridge() === null, "the bridge clears after plugin.dispose");
  }

  {
    let probeCalls = 0;
    let toolDisposed = 0;
    const plugin = fakePlugin({
      ready: async () => {
        probeCalls += 1;
        if (probeCalls === 1) return { ready: true };
        return new Promise<{ ready: boolean }>(() => {});
      },
    });
    const context = fakeContext({
      toolDispose: async () => {
        toolDisposed += 1;
      },
    });
    const cleanup = await createV2Setup({
      ...setupDeps,
      init: () => plugin,
    })(context);
    const startedAt = Date.now();
    await deadline(cleanup(), 2000, "parked refresh cleanup");
    assert(Date.now() - startedAt < 1000, "a parked refresh stop is released inside the bound");
    assert(probeCalls >= 2, "the refresh stop was waiting on the parked probe");
    assert(
      !captured.records.some(
        (record) => record.level === "warn" && record.message.includes("cleanup step refresh stop abandoned"),
      ),
      "the released refresh stop is not logged as abandoned",
    );
    assert(toolDisposed === 1, "the tool disposer still runs after the refresh bound");
    assert(getSessionBridge() === null, "the clears still run after the refresh bound");
  }

  {
    const order: string[] = [];
    let signalAbortedAt = -1;
    let pluginDisposedAt = -1;
    const bridgeState: { atPluginDispose: boolean | null } = { atPluginDispose: null };
    let toolDisposed = 0;
    const plugin = fakePlugin({
      dispose: async () => {
        pluginDisposedAt = order.length;
        order.push("plugin-dispose");
        bridgeState.atPluginDispose = getSessionBridge() !== null;
      },
    });
    const context = fakeContext({
      order,
      toolDispose: async () => {
        toolDisposed += 1;
      },
      contextDispose: () => new Promise<void>(() => {}),
      subscribe: (subscribeOptions) => {
        subscribeOptions?.signal?.addEventListener("abort", () => {
          signalAbortedAt = order.length;
          order.push("abort");
        });
        return idleStream();
      },
    });
    const cleanup = await createV2Setup({
      ...setupDeps,
      init: () => plugin,
    })(context);
    await deadline(cleanup(), 3000, "parked disposer cleanup");
    assert(signalAbortedAt === 0, "the abort is the first teardown step");
    assert(
      captured.records.some(
        (record) => record.level === "warn" && record.message.includes("cleanup step session context abandoned"),
      ),
      "the abandoned disposer is named in the log",
    );
    assert(toolDisposed === 1, "the tool disposer runs after the abandoned disposer");
    assert(pluginDisposedAt >= 0, "plugin.dispose runs after the abandoned disposer");
    assert(bridgeState.atPluginDispose === true, "the bridge is readable when plugin.dispose runs");
    assert(getSessionBridge() === null, "the bridge clears after plugin.dispose");
    assert(order.includes("experimental.idle-dispose"), "later session disposers still run");
  }

  {
    let toolDisposed = 0;
    let pluginDisposed = 0;
    const plugin = fakePlugin({
      dispose: async () => {
        pluginDisposed += 1;
      },
    });
    const context = fakeContext({
      toolDispose: async () => {
        toolDisposed += 1;
      },
    });
    const cleanup = await createV2Setup({
      ...setupDeps,
      init: () => plugin,
    })(context);
    await deadline(cleanup(), 2000, "first dispose");
    await deadline(cleanup(), 1000, "second dispose");
    assert(toolDisposed === 1, "the tool disposer runs exactly once across two disposes");
    assert(pluginDisposed === 1, "plugin.dispose runs exactly once across two disposes");
  }

  console.log(`PROOF PASS: teardown aborts first, bounds every step, and clears last (${passed} assertions)`);
} finally {
  captured.restore();
  rmSync(work, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
