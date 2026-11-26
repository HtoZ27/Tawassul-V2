import "./proof-log-isolate.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tool, type ToolDefinition } from "../src/tool.ts";
import {
  ToolDisposedError,
  closeToolSlots,
  makeV2Tool,
  type ToolSlotState,
} from "../src/v2/adapters.ts";
import type { V2Context, V2ToolContext, V2ToolDefinition } from "../src/v2/types.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed += 1;
  console.log(`ok ${name}`);
}

const gc = (globalThis as { Bun?: { gc?: (force?: boolean) => void } }).Bun?.gc;
if (typeof gc !== "function") fail("Bun.gc is unavailable; run this proof with bun");
console.log(`runtime: bun ${(globalThis as { Bun?: { version?: string } }).Bun?.version ?? "unknown"}`);

const work = mkdtempSync(join(tmpdir(), "tawassul-tool-retention-"));
const ctx = { location: { directory: work } } as unknown as V2Context;
const toolCtx = {
  sessionID: "ses-retention",
  messageID: "msg-retention",
  agent: "",
  id: "call-retention",
  signal: new AbortController().signal,
  progress: async () => undefined,
} as unknown as V2ToolContext;

const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function collect(refs: Array<WeakRef<object>>): Promise<boolean[]> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const canary = new WeakRef({});
    gc!(true);
    for (let spin = 0; spin < 4; spin += 1) await turn();
    if (canary.deref() === undefined) return refs.map((ref) => ref.deref() !== undefined);
  }
  fail("the GC canary did not clear within the retry budget");
}

function resultText(result: unknown): string {
  const rec = result as { content?: Array<{ text?: string }> };
  if (Array.isArray(rec?.content)) return rec.content.map((part) => part.text ?? "").join("");
  return typeof result === "string" ? result : JSON.stringify(result);
}

async function expectDisposed(run: () => Promise<unknown>, name: string): Promise<void> {
  try {
    await run();
  } catch (e) {
    assert(e instanceof ToolDisposedError, `${name} throws ToolDisposedError`);
    assert((e as ToolDisposedError).code === "TOOL_DISPOSED", `${name} carries the TOOL_DISPOSED code`);
    return;
  }
  fail(`${name} did not throw`);
}

type HostHeld = {
  execute: V2ToolDefinition["execute"];
  state: ToolSlotState;
  ctxRef: WeakRef<object>;
  defRef: WeakRef<object>;
  sentinelRef: WeakRef<object>;
};

function makeHostTool(name: string): HostHeld {
  const state: ToolSlotState = { closed: false, slots: [] };
  const sentinel = { tag: name };
  const localCtx = { location: { directory: work } } as unknown as V2Context;
  const def: ToolDefinition = tool({
    description: name,
    args: {},
    execute: async () => {
      const tag = sentinel.tag;
      return tag === name ? name : "mismatch";
    },
  });
  const wrapper = makeV2Tool(localCtx, name, def, undefined, undefined, state);
  return {
    execute: wrapper.execute,
    state,
    ctxRef: new WeakRef<object>(localCtx),
    defRef: new WeakRef<object>(def),
    sentinelRef: new WeakRef<object>(sentinel),
  };
}

try {
  const negative = makeHostTool("negative");
  const negativeAlive = await collect([negative.ctxRef, negative.defRef, negative.sentinelRef]);
  assert(negativeAlive[0] === true, "without close the host-held execute keeps the context alive");
  assert(negativeAlive[1] === true, "without close the host-held execute keeps the definition alive");
  assert(negativeAlive[2] === true, "without close the host-held execute keeps the sentinel alive");
  closeToolSlots(negative.state);

  const positive = makeHostTool("positive");
  closeToolSlots(positive.state);
  const positiveAlive = await collect([positive.ctxRef, positive.defRef, positive.sentinelRef]);
  assert(positiveAlive[0] === false, "closeToolSlots releases the context while the host keeps execute");
  assert(positiveAlive[1] === false, "closeToolSlots releases the definition while the host keeps execute");
  assert(positiveAlive[2] === false, "closeToolSlots releases the sentinel while the host keeps execute");
  await expectDisposed(() => positive.execute({}, toolCtx), "a stale call");

  const inFlightState: ToolSlotState = { closed: false, slots: [] };
  let releaseGate!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const inFlightDef = tool({
    description: "inflight",
    args: {},
    execute: async () => {
      markStarted();
      await gate;
      return "inflight-ok";
    },
  });
  const inFlight = makeV2Tool(ctx, "inflight", inFlightDef, undefined, undefined, inFlightState);
  const pending = inFlight.execute({}, toolCtx);
  await started;
  closeToolSlots(inFlightState);
  releaseGate();
  const inFlightResult = await pending;
  assert(resultText(inFlightResult) === "inflight-ok", "an in-flight call completes from its captured references");

  const first = makeHostTool("first");
  const second = makeHostTool("second");
  closeToolSlots(first.state);
  await expectDisposed(() => first.execute({}, toolCtx), "the closed state");
  assert(resultText(await second.execute({}, toolCtx)) === "second", "a second ToolSlotState keeps working after the first closes");
  closeToolSlots(second.state);

  const bornDeadState: ToolSlotState = { closed: true, slots: [] };
  const bornDeadDef = tool({
    description: "born-dead",
    args: {},
    execute: async () => "born-dead",
  });
  const bornDead = makeV2Tool(ctx, "born-dead", bornDeadDef, undefined, undefined, bornDeadState);
  assert(bornDeadState.slots.length === 0, "a closed ToolSlotState accepts no new slot");
  await expectDisposed(() => bornDead.execute({}, toolCtx), "a tool born after close");

  console.log(`PROOF PASS: the host-held execute cannot retain def or the context after close (${passed} assertions)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
