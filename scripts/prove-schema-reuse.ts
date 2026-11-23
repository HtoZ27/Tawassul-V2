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

function makeTool(name: string, description: string) {
  return tool({
    description,
    args: { text: z.string() },
    execute: async (args) => ({ output: `${name}:${(args as { text: string }).text}` }),
  });
}

function fakePlugin(
  ready: () => Promise<{ ready: boolean; error?: { message?: string } }>,
  tools: Record<string, unknown>,
): TawassulHooks {
  return {
    tool: tools,
    [INIT_READY]: ready,
  } as unknown as TawassulHooks;
}

type Options = {
  transform?: (callback: (editor: { add: (entry: unknown) => void }) => void) => Promise<unknown>;
  reload?: () => Promise<void>;
};

function fakeContext(options: Options = {}): V2Context {
  return {
    location: { directory: process.cwd() },
    session: {
      hook: async () => ({ dispose: async () => undefined }),
      prompt: async () => undefined,
      synthetic: async () => undefined,
      interrupt: async () => undefined,
    },
    tool: {
      transform:
        options.transform ??
        (async (callback: (editor: { add: (entry: unknown) => void }) => void) => {
          callback({ add: () => undefined });
          return { dispose: async () => undefined };
        }),
      reload: options.reload ?? (async () => undefined),
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

async function readyGeneration(): Promise<void> {
  let collections = 0;
  let reloads = 0;
  let probes = 0;
  const tools = { echo: makeTool("echo", "echo") };
  const cleanup = await createV2Setup({
    init: () =>
      fakePlugin(async () => {
        probes += 1;
        return { ready: true };
      }, tools),
    collectSchemas: async (toolMap) => {
      collections += 1;
      return collectToolSchemas(toolMap);
    },
    refresh: { attempts: 3, delayMs: 1 },
  })(
    fakeContext({
      reload: async () => {
        reloads += 1;
      },
    }),
  );
  await delay(100);
  await cleanup();
  assert(collections === 1, "a ready generation collects schemas exactly once");
  assert(probes === 2, "the refresh loop probed once after the initial collection");
  assert(reloads === 0, "an unchanged generation never reloads the tool domain");
}

async function lateInitGeneration(): Promise<void> {
  let collections = 0;
  let reloads = 0;
  let probes = 0;
  const tools = { echo: makeTool("echo", "echo") };
  const cleanup = await createV2Setup({
    init: () =>
      fakePlugin(async () => {
        probes += 1;
        return probes === 1 ? { ready: false } : { ready: true };
      }, tools),
    collectSchemas: async (toolMap) => {
      collections += 1;
      return collectToolSchemas(toolMap);
    },
    refresh: { attempts: 3, delayMs: 1, initialWaitMs: 5 },
  })(fakeContext({ reload: async () => {
    reloads += 1;
  } }));
  await delay(100);
  await cleanup();
  assert(collections === 1, "a late-init generation still collects its only schema set");
  assert(reloads === 1, "a late-init generation reloads the tool domain once");
}

async function registrationFailure(): Promise<void> {
  let collections = 0;
  let reloads = 0;
  const tools = { echo: makeTool("echo", "echo") };
  const cleanup = await createV2Setup({
    init: () => fakePlugin(async () => ({ ready: true }), tools),
    collectSchemas: async (toolMap) => {
      collections += 1;
      return collectToolSchemas(toolMap);
    },
    refresh: { attempts: 3, delayMs: 1 },
  })(
    fakeContext({
      transform: async () => {
        throw new Error("registration denied");
      },
      reload: async () => {
        reloads += 1;
      },
    }),
  );
  await delay(100);
  await cleanup();
  assert(collections === 2, "a failed registration fails open and collects again");
  assert(reloads === 1, "a failed registration still reloads once the schemas are current");
}

async function changedNameSet(): Promise<void> {
  let collections = 0;
  let reloads = 0;
  let lastSize = 0;
  const tools: Record<string, unknown> = { echo: makeTool("echo", "echo") };
  const cleanup = await createV2Setup({
    init: () => fakePlugin(async () => ({ ready: true }), tools),
    collectSchemas: async (toolMap) => {
      collections += 1;
      const result = await collectToolSchemas(toolMap);
      lastSize = result.size;
      if (collections === 1) {
        queueMicrotask(() => {
          tools.echo2 = makeTool("echo2", "echo twice");
        });
      }
      return result;
    },
    refresh: { attempts: 3, delayMs: 1 },
  })(fakeContext({ reload: async () => {
    reloads += 1;
  } }));
  await delay(100);
  await cleanup();
  assert(collections === 2, "a changed name set fails open and collects again");
  assert(lastSize === 2, "the second collection sees the changed tool surface");
  assert(reloads === 1, "a changed name set reloads the tool domain");
}

async function generationsDoNotShareState(): Promise<void> {
  let collections = 0;
  const tools = { echo: makeTool("echo", "echo") };
  const deps = {
    init: () => fakePlugin(async () => ({ ready: true }), tools),
    collectSchemas: async (toolMap: Parameters<typeof collectToolSchemas>[0]) => {
      collections += 1;
      return collectToolSchemas(toolMap);
    },
    refresh: { attempts: 2, delayMs: 1 },
  };
  const first = await createV2Setup(deps)(fakeContext());
  await first();
  const second = await createV2Setup(deps)(fakeContext());
  await second();
  assert(collections === 2, "each generation collects exactly once");
}

try {
  await readyGeneration();
  await lateInitGeneration();
  await registrationFailure();
  await changedNameSet();
  await generationsDoNotShareState();
  console.log(`PROOF PASS: schema reuse skips the redundant collection without hiding a drift (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(e);
    process.exitCode = 1;
  }
}
