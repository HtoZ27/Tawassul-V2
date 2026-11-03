import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HostGoalMirror,
  formatHostGoal,
  normalizeHostGoal,
  readHostGoal,
  setActiveHostGoalMirror,
  type HostGoalChange,
  type HostGoalState,
} from "../src/services/host-goal.ts";
import { GoalStore } from "../src/services/goal-store.ts";
import { buildGoalTool } from "../src/tools/goal.ts";
import { createV2Setup } from "../src/v2/setup.ts";
import { installHostGoalMirror, uninstallHostGoalMirror } from "../src/v2/host-goal.ts";
import type { V2Context } from "../src/v2/types.ts";
import type { ToolContext } from "../src/tool.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

function state(partial: Partial<HostGoalState> = {}): HostGoalState {
  return {
    id: "goal-1",
    objective: "Ship the slice",
    status: "active",
    rounds: 2,
    maxRounds: 8,
    boot: "boot-1",
    updatedAt: 1_700_000_000_000,
    ...partial,
  };
}

function proveNormalize(): void {
  assert(normalizeHostGoal(state())?.objective === "Ship the slice", "normalize accepts a valid state");
  assert(normalizeHostGoal({ ...state(), status: "running" }) === null, "normalize rejects an unknown status");
  assert(normalizeHostGoal({ ...state(), objective: "  " }) === null, "normalize rejects an empty objective");
  assert(normalizeHostGoal({ ...state(), rounds: "2" }) === null, "normalize rejects a string round count");
  assert(normalizeHostGoal(null) === null, "normalize rejects null");
  const withOptionals = normalizeHostGoal({ ...state(), reason: "reviewer asked", stalls: 1 });
  assert(withOptionals?.reason === "reviewer asked" && withOptionals.stalls === 1, "normalize keeps optionals");
  console.log("normalize ok");
}

async function proveCache(): Promise<void> {
  let reads = 0;
  let now = 1000;
  const mirror = new HostGoalMirror(
    {
      read: async () => {
        reads += 1;
        return state();
      },
      subscribe: () => () => undefined,
    },
    { ttlMs: 50, now: () => now },
  );
  assert((await mirror.get("s1"))?.status === "active", "mirror reads the host state");
  assert((await mirror.get("s1"))?.rounds === 2, "mirror returns the cached state");
  assert(reads === 1, "mirror caches within the ttl");
  now += 51;
  await mirror.get("s1");
  assert(reads === 2, "mirror refreshes after the ttl");
  assert((await mirror.get("")) === null, "mirror ignores an empty session id");
  assert(reads === 2, "empty session id does not read the host");
  mirror.dispose();
  console.log("cache ok");
}

async function proveChanges(): Promise<void> {
  const changes: Array<(change: HostGoalChange) => void> = [];
  let unsubscribed = false;
  const mirror = new HostGoalMirror({
    read: async () => null,
    subscribe: (handler) => {
      changes.push(handler);
      return () => {
        unsubscribed = true;
      };
    },
  });
  mirror.start();
  assert(changes.length === 1, "mirror subscribes once");
  changes[0]?.({ sessionID: "s1", goal: state({ rounds: 3 }) });
  assert(mirror.peek("s1")?.rounds === 3, "changed event updates the cache");
  changes[0]?.({ sessionID: "s1", goal: null });
  assert(mirror.peek("s1") === null, "null changed event clears the cache");
  changes[0]?.({ sessionID: "", goal: state() });
  assert(mirror.peek("") === null, "empty changed event is ignored");
  mirror.dispose();
  assert(unsubscribed, "dispose unsubscribes");
  console.log("changes ok");
}

async function proveErrorsAndCap(): Promise<void> {
  const fallback = new HostGoalMirror(
    {
      read: async () => {
        throw new Error("rpc down");
      },
      subscribe: () => () => undefined,
    },
    { ttlMs: 0 },
  );
  assert((await fallback.get("s1")) === null, "read error returns null without cache");
  fallback.dispose();

  let calls = 0;
  const capped = new HostGoalMirror(
    {
      read: async (sessionID) => {
        calls += 1;
        return state({ id: sessionID });
      },
      subscribe: () => () => undefined,
    },
    { cap: 2, ttlMs: 60_000 },
  );
  await capped.get("a");
  await capped.get("b");
  await capped.get("c");
  assert(capped.peek("a") === null, "cap evicts the oldest session");
  assert(capped.peek("c") !== null, "cap keeps the newest session");
  assert(calls === 3, "cap reads each session once");
  capped.dispose();
  console.log("errors-and-cap ok");
}

async function proveFormat(): Promise<void> {
  const line = formatHostGoal(state({ reason: "needs review" }));
  assert(line.includes("active"), "format includes the status");
  assert(line.includes("2/8"), "format includes the rounds");
  assert(line.includes("Ship the slice"), "format includes the objective");
  assert(line.includes("needs review"), "format includes the reason");
  console.log("format ok");
}

function fakeContext(store: GoalStore) {
  const directory = mkdtempSync(join(tmpdir(), "tawassul-host-goal-tool-"));
  const tool = buildGoalTool(store);
  const context: ToolContext = {
    sessionID: "s1",
    messageID: "m1",
    agent: "analyst",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => undefined,
  };
  return {
    directory,
    tool,
    context,
    execute: async (args: Record<string, unknown>) =>
      (tool.execute as unknown as (value: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>)(
        args,
        context,
      ),
  };
}

function outputOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const rec = value as { output?: unknown };
  return typeof rec.output === "string" ? rec.output : "";
}

async function proveToolSurface(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-host-goal-store-"));
  const store = new GoalStore(dir, { lockManager: null, minEvidenceIntervalMs: 0 });
  const fake = fakeContext(store);
  let present = true;
  const mirror = new HostGoalMirror(
    {
      read: async (sessionID) => (present && sessionID === "s1" ? state() : null),
      subscribe: () => () => undefined,
    },
    { ttlMs: 0 },
  );
  setActiveHostGoalMirror(mirror);
  try {
    const host = outputOf(await fake.execute({ host: true }));
    assert(host.includes("Ship the slice"), "goal(host: true) reads the host goal");
    assert(host.includes("2/8"), "goal(host: true) shows rounds");
    const alias = outputOf(await fake.execute({ get: "host" }));
    assert(alias.includes("Ship the slice"), "goal(get: host) is an alias for the host read");
    const board = outputOf(await fake.execute({ board: true }));
    assert(board.includes("Host /goal"), "goal(board: true) appends the host goal");
    present = false;
    const missing = outputOf(await fake.execute({ host: true }));
    assert(missing.includes("No host /goal"), "host read reports a missing goal");
    const guarded = outputOf(await fake.execute({ update: "host", detail: "x" }));
    assert(guarded.includes("not a ledger goal"), "write operations reject the host id");
    assert(store.get("host") === undefined, "host guard does not touch the ledger");
    const created = await store.create({ title: "completed item display", owner: "@dev", items: ["finished work"] });
    if (!created.ok) fail(`display seed failed: ${created.reason}`);
    const itemId = created.goal.items[0]?.id ?? "";
    const done = await store.update(created.goal.id, {
      itemEvidence: [{ itemId, text: "the finished work has a receipt" }],
      itemStates: [{ itemId, state: "done" }],
    });
    if (!done.ok) fail(`display item completion failed: ${done.reason}`);
    const shown = outputOf(await fake.execute({ get: created.goal.id }));
    assert(shown.includes("completed:"), "goal(get) shows the completed section");
    assert(shown.includes("finished work"), "goal(get) shows the archived item title");
    console.log("tool-surface ok");
  } finally {
    setActiveHostGoalMirror(null);
    mirror.dispose();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fake.directory, { recursive: true, force: true });
  }
}

async function proveBridge(): Promise<void> {
  const seen: {
    definition: { id?: string; methods?: Record<string, unknown>; events?: Record<string, unknown> } | null;
  } = { definition: null };
  const listeners: Array<(event: unknown) => void> = [];
  let unsubscribed = false;
  let reads = 0;
  const ctx = {
    session: { hook: async () => ({ dispose: async () => undefined }) },
    tool: { transform: async () => ({ dispose: async () => undefined }) },
    event: { subscribe: () => (async function* () {})() },
    rpc: (value: { id: string; methods: Record<string, unknown>; events: Record<string, unknown> }) => {
      seen.definition = value;
      return {
        get: async () => {
          reads += 1;
          return state();
        },
        events: {
          on: (name: string, handler: (event: unknown) => void) => {
            assert(name === "changed", "bridge subscribes to the changed event");
            listeners.push(handler);
            return () => {
              unsubscribed = true;
            };
          },
        },
      };
    },
  } as unknown as V2Context;

  const mirror = installHostGoalMirror(ctx);
  assert(mirror !== null, "bridge attaches when the rpc domain is present");
  assert(seen.definition?.id === "opencode.goal", "bridge uses the host goal rpc id");
  assert(Object.keys(seen.definition?.methods ?? {}).includes("get"), "bridge declares the get method");
  assert(Object.keys(seen.definition?.events ?? {}).includes("changed"), "bridge declares the changed event");
  assert((await readHostGoal("s1"))?.status === "active", "bridge reads through the rpc get method");
  assert(reads === 1, "bridge calls get once");
  listeners[0]?.({ sessionID: "s1", goal: state({ rounds: 5 }) });
  const afterEvent = await readHostGoal("s1");
  assert(afterEvent?.rounds === 5, "bridge keeps the event cache reachable");
  uninstallHostGoalMirror(mirror);
  assert(unsubscribed, "bridge dispose stops the event subscription");
  assert((await readHostGoal("s1")) === null, "bridge dispose detaches the mirror");
  console.log("bridge ok");
}

async function proveMissingRpc(): Promise<void> {
  const ctx = {
    session: { hook: async () => ({ dispose: async () => undefined }) },
    tool: { transform: async () => ({ dispose: async () => undefined }) },
    event: { subscribe: () => (async function* () {})() },
  } as unknown as V2Context;
  assert(installHostGoalMirror(ctx) === null, "bridge stays disabled without an rpc domain");
  console.log("missing-rpc ok");
}

async function proveSetupOwnsIdleSnapshots(): Promise<void> {
  const hooked: string[] = [];
  const directory = mkdtempSync(join(tmpdir(), "tawassul-host-goal-setup-"));
  const ctx = {
    location: { directory },
    session: {
      hook: async (name: string) => {
        hooked.push(name);
        return { dispose: async () => undefined };
      },
      prompt: async () => undefined,
      interrupt: async () => undefined,
    },
    tool: {
      transform: async (callback: (editor: { add: () => void }) => void) => {
        callback({ add: () => undefined });
        return { dispose: async () => undefined };
      },
      reload: async () => undefined,
    },
    event: { subscribe: () => (async function* () {})() },
  } as unknown as V2Context;
  const cleanup = await createV2Setup({ init: () => ({}) })(ctx);
  assert(hooked.includes("experimental.idle"), "setup registers the idle snapshot hook");
  assert(
    hooked.filter((name) => name === "experimental.idle").length === 1,
    "the idle snapshot hook is registered exactly once",
  );
  await cleanup();
  rmSync(directory, { recursive: true, force: true });
  console.log("setup-idle ok");
}

function proveHostContract(): void {
  const source = readFileSync(join(repo, "node_modules", "@opencode", "schema", "dist", "goal.d.ts"), "utf-8");
  assert(source.includes('"opencode.goal"'), "host goal rpc id is present");
  for (const field of ["objective", "status", "rounds", "maxRounds", "stalls", "boot", "updatedAt"]) {
    assert(source.includes(field), `host goal state carries ${field}`);
  }
  assert(source.includes("changed:"), "host goal publishes the changed event");
  console.log("host-contract ok");
}

proveNormalize();
await proveCache();
await proveChanges();
await proveErrorsAndCap();
await proveFormat();
await proveToolSurface();
await proveBridge();
await proveMissingRpc();
await proveSetupOwnsIdleSnapshots();
proveHostContract();
console.log("PROOF PASS: host goal mirror");
