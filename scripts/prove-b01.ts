import { z } from "zod";
import { INIT_READY } from "../src/plugin-types.ts";
import type { TawassulHooks } from "../src/plugin-types.ts";
import { tool, type ToolDefinition } from "../src/tool.ts";
import { collectToolSchemas } from "../src/v2/adapters.ts";
import { startSchemaRefresh } from "../src/v2/schema-refresh.ts";
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

type ToolEntry = { name?: string; input?: Record<string, unknown> };

type SetupRecords = {
  entries: ToolEntry[];
  reloads: number;
};

function fakeTool(description: string, args: z.ZodRawShape): ToolDefinition {
  return tool({ description, args, execute: async () => ({ output: "ok" }) });
}

function fakePlugin(
  argsFor: () => z.ZodRawShape,
  ready: () => Promise<{ ready: boolean; error?: { message?: string } }>,
): TawassulHooks {
  const counter: ToolDefinition = {
    get description(): string {
      return "counter";
    },
    get args(): z.ZodRawShape {
      return argsFor();
    },
    execute: async () => ({ output: "counted" }),
  };
  return { tool: { counter }, [INIT_READY]: ready } as unknown as TawassulHooks;
}

function fakeContext(records: SetupRecords): V2Context {
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
        callback({ add: (entry) => records.entries.push(entry as ToolEntry) });
        return { dispose: async () => undefined };
      },
      reload: async () => {
        records.reloads += 1;
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

async function fingerprintCases(): Promise<void> {
  const adapters = (await import("../src/v2/adapters.ts")) as unknown as {
    schemaFingerprint?: (schemas: Map<string, Record<string, unknown>>) => string;
  };
  assert(typeof adapters.schemaFingerprint === "function", "the adapter module exposes a schema fingerprint");
  const fingerprint = adapters.schemaFingerprint;
  if (!fingerprint) return;

  const one = new Map<string, Record<string, unknown>>([
    ["alpha", { type: "object", properties: { count: { type: "number" } }, required: ["count"] }],
    ["beta", { type: "object", properties: { path: { type: "string" } }, required: ["path"] }],
  ]);
  const reordered = new Map<string, Record<string, unknown>>([
    ["beta", { required: ["path"], properties: { path: { type: "string" } }, type: "object" }],
    ["alpha", { required: ["count"], properties: { count: { type: "number" } }, type: "object" }],
  ]);
  assert(fingerprint(one) === fingerprint(one), "the same schemas fingerprint to the same value");
  assert(
    fingerprint(one) === fingerprint(reordered),
    "the fingerprint ignores map and property insertion order",
  );

  const renamed = new Map(one);
  renamed.delete("beta");
  renamed.set("gamma", one.get("beta")!);
  assert(fingerprint(renamed) !== fingerprint(one), "a renamed tool changes the fingerprint");

  const retyped = new Map(one);
  retyped.set("alpha", {
    type: "object",
    properties: { count: { type: "string" } },
    required: ["count"],
  });
  assert(fingerprint(retyped) !== fingerprint(one), "a retyped argument changes the fingerprint");

  const widened = new Map(one);
  widened.set("alpha", { type: "object", properties: { count: { type: "number" } } });
  assert(fingerprint(widened) !== fingerprint(one), "a dropped required list changes the fingerprint");

  const empty = new Map<string, Record<string, unknown>>();
  assert(fingerprint(empty) === fingerprint(empty), "an empty schema map fingerprints stably");
  assert(fingerprint(empty) !== fingerprint(one), "an empty schema map differs from a populated one");
}

async function collectionCases(): Promise<void> {
  const tools: Record<string, ToolDefinition> = {
    counter: fakeTool("count", { count: z.number(), label: z.string().optional() }),
    reader: fakeTool("read", { path: z.string() }),
  };
  const first = await collectToolSchemas(tools);
  const second = await collectToolSchemas(tools);
  assert(first.size === 2, "every tool contributes a schema");
  assert(
    second.get("counter") === first.get("counter") && second.get("reader") === first.get("reader"),
    "a second collection reuses the generated schema objects instead of rebuilding them",
  );

  tools.counter = fakeTool("count", { count: z.string() });
  const third = await collectToolSchemas(tools);
  assert(
    third.get("counter") !== first.get("counter"),
    "a changed args shape is regenerated on the next collection",
  );
  assert(
    third.get("reader") === first.get("reader"),
    "an unchanged tool keeps its cached schema while its neighbour changes",
  );
}

async function waitForReload(records: SetupRecords, limitMs: number): Promise<void> {
  const started = Date.now();
  while (records.reloads === 0 && Date.now() - started < limitMs) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function fastBootCase(): Promise<void> {
  const records: SetupRecords = { entries: [], reloads: 0 };
  const cleanup = await createV2Setup({
    init: () =>
      fakePlugin(
        () => ({ count: z.number() }),
        async () => ({ ready: true }),
      ),
    refresh: { attempts: 2, delayMs: 1, initialWaitMs: 5 },
  })(fakeContext(records));
  await waitForReload(records, 250);
  assert(records.entries.length === 1, "the fast path registers the tool once");
  const properties = (records.entries[0]?.input?.properties ?? {}) as Record<string, unknown>;
  assert(
    Object.keys(properties).length === 1 && "count" in properties,
    "a registration after readiness carries the real schema",
  );
  assert(
    records.reloads === 0,
    "the setup skips the tool reload when the registered schemas are already current",
  );
  await cleanup();
}

async function slowBootCase(): Promise<void> {
  const records: SetupRecords = { entries: [], reloads: 0 };
  let live = false;
  const cleanup = await createV2Setup({
    init: () =>
      fakePlugin(
        (): z.ZodRawShape => (live ? { count: z.number() } : {}),
        async () => ({ ready: live }),
      ),
    refresh: { attempts: 3, delayMs: 1, initialWaitMs: 5 },
  })(fakeContext(records));
  live = true;
  await waitForReload(records, 1000);
  assert(records.reloads === 1, "the setup reloads the tool domain once the schemas really change");
  assert(records.entries.length === 1, "the slow path registers the tool once");
  assert(
    Object.keys(records.entries[0]?.input?.properties ?? {}).length === 0,
    "a registration before readiness advertises the placeholder schema",
  );
  await cleanup();
}

async function refreshContractCases(): Promise<void> {
  {
    const infos: string[] = [];
    let reloads = 0;
    const handle = startSchemaRefresh({
      probe: async () => ({ ready: true }),
      refresh: async () => false,
      reload: async () => {
        reloads += 1;
      },
      describe: () => "2 schemas",
      attempts: 1,
      logInfo: (message) => infos.push(message),
    });
    await handle.done;
    assert(reloads === 0, "an unchanged refresh never calls the tool reload");
    assert(
      infos.some((message) => message.includes("reload skipped")),
      "the skipped reload is reported instead of happening silently",
    );
  }

  {
    let reloads = 0;
    const handle = startSchemaRefresh({
      probe: async () => ({ ready: true }),
      refresh: async () => undefined,
      reload: async () => {
        reloads += 1;
      },
      describe: () => "2 schemas",
      attempts: 1,
      logInfo: () => undefined,
    });
    await handle.done;
    assert(reloads === 1, "a refresh without a change verdict keeps reloading for compatibility");
  }

  {
    const warnings: string[] = [];
    let reloads = 0;
    const handle = startSchemaRefresh({
      probe: async () => ({ ready: true }),
      refresh: async () => {
        throw new Error("collector exploded");
      },
      reload: async () => {
        reloads += 1;
      },
      describe: () => "0 schemas",
      attempts: 1,
      logInfo: () => undefined,
      logWarn: (message) => warnings.push(message),
    });
    await handle.done;
    assert(reloads === 0, "a failed collection does not reload the tool domain");
    assert(
      warnings.some((message) => message.includes("refresh failed")),
      "a failed collection is reported instead of escaping",
    );
  }
}

try {
  await fastBootCase();
  await slowBootCase();
  await refreshContractCases();
  await fingerprintCases();
  await collectionCases();
  console.log(
    `PROOF PASS: boot collects one schema per tool and skips the reload when nothing changed (${passed} assertions)`,
  );
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
