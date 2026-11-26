import "./proof-log-isolate.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { INIT_READY } from "../src/plugin-types.ts";
import type { TawassulHooks } from "../src/plugin-types.ts";
import { tool } from "../src/tool.ts";
import {
  createV2Setup,
  OPTIONAL_TIMEOUT_MS,
  REGISTRATION_WATCHDOG_MS,
} from "../src/v2/setup.ts";
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

function fakePlugin(toolCount = 2): TawassulHooks {
  const tools: Record<string, ReturnType<typeof tool>> = {};
  for (let index = 0; index < toolCount; index += 1) {
    tools[`echo${index}`] = tool({
      description: `echo ${index}`,
      args: { text: z.string() },
      execute: async (args) => ({ output: (args as { text: string }).text }),
    });
  }
  return {
    tool: tools,
    [INIT_READY]: async () => ({ ready: true }),
  } as unknown as TawassulHooks;
}

type FakeOptions = {
  order?: string[];
  transform?: (callback: (editor: { add: (entry: unknown) => void }) => void) => Promise<{ dispose: () => Promise<void> }>;
  permissionHook?: () => Promise<{ dispose: () => Promise<void> }>;
  skillTransform?: (callback: (editor: { add: (entry: unknown) => void }) => void) => Promise<{ dispose: () => Promise<void> }>;
  commandTransform?: (callback: (editor: { add: (entry: unknown) => void }) => void) => Promise<{ dispose: () => Promise<void> }>;
};

function fakeRegistration(order: string[] | undefined, label: string, counter?: { count: number }) {
  return {
    dispose: async () => {
      if (counter) counter.count += 1;
      order?.push(label);
    },
  };
}

function fakeContext(options: FakeOptions = {}): V2Context {
  const order = options.order;
  return {
    app: { version: "2.3.0" },
    location: { directory: process.cwd() },
    session: {
      hook: async (name: string) => fakeRegistration(order, `${name}-dispose`),
      get: async () => ({}),
      list: async () => ({ data: [], cursor: { next: null } }),
      prompt: async () => undefined,
      synthetic: async () => undefined,
      interrupt: async () => undefined,
    },
    tool: {
      transform: async (callback: (editor: { add: (entry: unknown) => void }) => void) => {
        order?.push("tool-transform");
        if (options.transform) return options.transform(callback);
        callback({ add: () => undefined });
        return fakeRegistration(order, "tool-dispose");
      },
      reload: async () => undefined,
      list: async () => [],
      hook: async () => fakeRegistration(order, "tool-hook-dispose"),
    },
    permission: {
      assert: async () => undefined,
      hook: async () => {
        order?.push("ask");
        if (options.permissionHook) return options.permissionHook();
        return fakeRegistration(order, "ask-dispose");
      },
    },
    skill: {
      transform: async (callback: (editor: { add: (entry: unknown) => void }) => void) => {
        order?.push("skills");
        if (options.skillTransform) return options.skillTransform(callback);
        callback({ add: () => undefined });
        return fakeRegistration(order, "skills-dispose");
      },
    },
    command: {
      transform: async (callback: (editor: { add: (entry: unknown) => void }) => void) => {
        order?.push("command");
        if (options.commandTransform) return options.commandTransform(callback);
        callback({ add: () => undefined });
        return fakeRegistration(order, "command-dispose");
      },
    },
    event: { subscribe: async function* () {} },
  } as unknown as V2Context;
}

const work = mkdtempSync(join(tmpdir(), "tawassul-setup-budget-"));
process.env.TAWASSUL_SCOPE = "project";
process.env.TAWASSUL_USAGE_LEDGER = join(work, "usage-ledger.jsonl");

const captured = captureLogger();
const setupDeps = {
  optionalTimeoutMs: 20,
  teardownTimeoutMs: 50,
  registrationWatchdogMs: 100,
  refresh: { attempts: 1, delayMs: 1, initialWaitMs: 5 },
};

function healthRecords(): LogRecord[] {
  return captured.records.filter((record) => record.message.includes("v2 health"));
}

try {
  assert(OPTIONAL_TIMEOUT_MS === 2000, "the optional step bound defaults to 2 s");
  assert(REGISTRATION_WATCHDOG_MS === 10000, "the registration watchdog defaults to 10 s");

  {
    const order: string[] = [];
    const counters = { tool: 0, plugin: 0, ask: 0, skills: 0, command: 0 };
    const plugin = fakePlugin(2);
    plugin.dispose = async () => {
      counters.plugin += 1;
    };
    const context = fakeContext({
      order,
      transform: async (callback) => {
        callback({ add: () => undefined });
        return {
          dispose: async () => {
            counters.tool += 1;
          },
        };
      },
      permissionHook: async () => ({
        dispose: async () => {
          counters.ask += 1;
        },
      }),
      skillTransform: async (callback) => {
        callback({ add: () => undefined });
        return {
          dispose: async () => {
            counters.skills += 1;
          },
        };
      },
      commandTransform: async (callback) => {
        callback({ add: () => undefined });
        return {
          dispose: async () => {
            counters.command += 1;
          },
        };
      },
    });
    const cleanup = await deadline(createV2Setup({ ...setupDeps, init: () => plugin })(context), 2000, "full setup");
    const health = healthRecords().at(-1);
    assert(health !== undefined, "a full run emits a health line");
    assert(
      health?.message === "[tawassul] v2 health: tools=2 schemas=2 ask=true skills=1",
      "the health line reports tools, schemas, ask, and skills",
    );
    assert(health?.level === "info", "a healthy registration logs the health line at info");
    assert(
      captured.records.some(
        (record) =>
          record.level === "info" &&
          record.message.includes("v2 setup ") &&
          record.message.includes(" ready ") &&
          /tools=2(?:\s|$)/.test(record.message),
      ),
      "the setup-ready line reports the registered tool surface",
    );
    assert(
      order.filter((entry) => entry === "ask" || entry === "skills" || entry === "command").join(",") ===
        "ask,skills,command",
      "the optional steps keep the ask to skills to command order",
    );
    assert(
      captured.records.some((record) => record.message.includes("setup step ask done")),
      "the ask breadcrumb records completion",
    );
    assert(
      captured.records.some((record) => record.message.includes("setup step skills done")),
      "the skills breadcrumb records completion",
    );
    await deadline(cleanup(), 2000, "full cleanup");
    assert(counters.tool === 1, "the full run disposes the tool registration once");
    assert(counters.plugin === 1, "the full run disposes the plugin once");
    assert(counters.ask === 1, "the full run disposes the ask registration once");
    assert(counters.skills === 1, "the full run disposes the skills registration once");
    assert(counters.command === 1, "the full run disposes the command registration once");
  }

  {
    const commandGate: { resolve: (() => void) | null } = { resolve: null };
    const counters = { command: 0 };
    const parked = new Promise<void>((resolve) => {
      commandGate.resolve = resolve;
    });
    let commandStarts = 0;
    const plugin = fakePlugin(2);
    const context = fakeContext({
      commandTransform: async () => {
        commandStarts += 1;
        await parked;
        return {
          dispose: async () => {
            counters.command += 1;
          },
        };
      },
    });
    const cleanup = await deadline(
      createV2Setup({ ...setupDeps, init: () => plugin })(context),
      2000,
      "parked command setup",
    );
    assert(commandStarts === 1, "a parked command step is attempted once");
    assert(
      captured.records.some(
        (record) => record.level === "warn" && record.message.includes("setup step command abandoned after"),
      ),
      "the abandoned command step is named in the log",
    );
    const health = healthRecords().at(-1);
    assert(health?.message.includes("tools=2"), "registration proceeds after the command abandonment");
    assert(health?.level === "info", "an abandoned optional step does not fail the health line");
    await deadline(cleanup(), 2000, "parked command cleanup");
    assert(counters.command === 0, "an abandoned command registration is not disposed before it resolves");
    commandGate.resolve?.();
    await delay(0);
    assert(counters.command === 1, "a late command registration is disposed exactly once");
  }

  {
    const askGate: { resolve: ((registration: { dispose: () => Promise<void> }) => void) | null } = { resolve: null };
    const counters = { ask: 0 };
    const plugin = fakePlugin(2);
    const context = fakeContext({
      permissionHook: () =>
        new Promise((resolve) => {
          askGate.resolve = resolve;
        }),
    });
    const cleanup = await deadline(
      createV2Setup({ ...setupDeps, init: () => plugin })(context),
      2000,
      "parked ask setup",
    );
    assert(
      captured.records.some(
        (record) =>
          record.level === "error" &&
          record.message.includes("setup step ask abandoned after") &&
          record.message.includes("ask confirmations are unavailable"),
      ),
      "an abandoned ask step is an error, not a warning",
    );
    const health = healthRecords().at(-1);
    assert(health?.message.includes("ask=false"), "an abandoned ask step disables ask in the health line");
    await deadline(cleanup(), 2000, "parked ask cleanup");
    askGate.resolve?.({
      dispose: async () => {
        counters.ask += 1;
      },
    });
    await delay(0);
    assert(counters.ask === 1, "a late ask registration is disposed exactly once");
  }

  {
    const order: string[] = [];
    const plugin = fakePlugin(2);
    const context = fakeContext({
      order,
      transform: async () => {
        throw new Error("transform rejected");
      },
    });
    const cleanup = await deadline(
      createV2Setup({ ...setupDeps, init: () => plugin })(context),
      2000,
      "rejected transform setup",
    );
    const health = healthRecords().at(-1);
    assert(health?.level === "error", "a rejected tool.transform logs the health line at error");
    assert(
      health?.message.includes("tools=2") && health?.message.includes("applied=0"),
      "a rejected tool.transform reports the surface and zero applied tools",
    );
    assert(
      health?.message.includes("reason=tool registration failed"),
      "a rejected tool.transform names the failure reason",
    );
    assert(
      captured.records.some(
        (record) => record.level === "error" && record.message.includes("v2 tool registration failed"),
      ),
      "the registration failure is logged",
    );
    await deadline(cleanup(), 2000, "rejected transform cleanup");
    assert(order.includes("context-dispose"), "the other bridges stay registered after a transform failure");
  }

  {
    const plugin = fakePlugin(2);
    const context = fakeContext({
      transform: async (callback) => {
        callback({ add: () => undefined });
        throw new Error("late reject");
      },
    });
    const cleanup = await deadline(
      createV2Setup({ ...setupDeps, init: () => plugin })(context),
      2000,
      "adds-then-rejects setup",
    );
    const health = healthRecords().at(-1);
    assert(health?.level === "error", "a callback that adds then rejects logs the health line at error");
    assert(health?.message.includes("tools=2"), "the health line reports the tools the callback added");
    assert(
      health?.message.includes("reason=tool registration failed"),
      "a callback that adds then rejects still names the failure",
    );
    await deadline(cleanup(), 2000, "adds-then-rejects cleanup");
  }

  {
    const gate: { resolve: ((registration: { dispose: () => Promise<void> }) => void) | null } = { resolve: null };
    const plugin = fakePlugin(2);
    const context = fakeContext({
      transform: () =>
        new Promise((resolve) => {
          gate.resolve = resolve;
        }),
    });
    const setupPromise = createV2Setup({
      ...setupDeps,
      registrationWatchdogMs: 30,
      init: () => plugin,
    })(context);
    let watchdog: LogRecord | undefined;
    for (let attempt = 0; attempt < 200 && watchdog === undefined; attempt += 1) {
      await delay(5);
      watchdog = captured.records.find((record) => record.message.includes("still pending"));
    }
    assert(watchdog !== undefined, "the registration watchdog reports a parked tool.transform");
    assert(
      watchdog?.message.includes("tool-registration") && watchdog?.message.includes("pending=tool-registration"),
      "the watchdog names the pending step set",
    );
    gate.resolve?.({ dispose: async () => undefined });
    const cleanup = await deadline(setupPromise, 2000, "watchdog recovery setup");
    const watchdogCount = captured.records.filter((record) => record.message.includes("still pending")).length;
    await delay(80);
    assert(
      captured.records.filter((record) => record.message.includes("still pending")).length === watchdogCount,
      "the registration watchdog timer is cleared on a successful run",
    );
    await deadline(cleanup(), 2000, "watchdog cleanup");
  }

  {
    let detected = false;
    try {
      await deadline(new Promise<void>(() => {}), 10, "wall-clock watchdog");
    } catch {
      detected = true;
    }
    assert(detected, "the wall-clock watchdog fails a hung step instead of hanging");
  }

  console.log(`PROOF PASS: optional steps are bounded, named, and registered once (${passed} assertions)`);
} finally {
  captured.restore();
  rmSync(work, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
