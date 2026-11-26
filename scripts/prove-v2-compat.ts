import "./proof-log-isolate.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyV1AfterOutput, resultText, writeBackV1Output } from "../src/v2/result-bridge.ts";
import { toV2Result } from "../src/v2/adapters.ts";
import { createN2AutoHook } from "../src/hooks/n2-auto.ts";
import { createAskBridge, registerAskPermission } from "../src/v2/ask.ts";
import { getInitReady } from "../src/bootstrap/plugin-init.ts";
import { INIT_READY, type InitReadyProbe } from "../src/plugin-types.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

type V2ResultShape = {
  content?: unknown;
  metadata?: Record<string, unknown>;
  output?: unknown;
};

function shape(value: unknown): V2ResultShape {
  assert(value !== null && typeof value === "object", "result is an object");
  return value as V2ResultShape;
}

const stringResult = shape(toV2Result("plain text"));
assert(!("output" in stringResult), "string result has no output key");
assert(JSON.stringify(stringResult.content) === JSON.stringify([{ type: "text", text: "plain text" }]), "string result is content text");

const legacyResult = shape(toV2Result({ title: "t", output: "body", metadata: { k: 1 } }));
assert(!("output" in legacyResult), "legacy output is not forwarded as output");
assert(JSON.stringify(legacyResult.content) === JSON.stringify([{ type: "text", text: "body" }]), "legacy output becomes content text");
assert(legacyResult.metadata?.k === 1, "legacy metadata is preserved");

const nonStringOutput = shape(toV2Result({ output: { a: 1 } }));
assert(!("output" in nonStringOutput), "non-string output key is dropped");

const emptyResult = shape(toV2Result({ metadata: { only: true } }));
assert(!("output" in emptyResult), "metadata-only result has no output key");
assert(emptyResult.metadata?.only === true, "metadata-only result keeps metadata");

const writeTarget: V2ResultShape = {
  content: [
    { type: "text", text: "first" },
    { type: "file", uri: "file:///a.png", mime: "image/png" },
    { type: "text", text: "second" },
  ],
  metadata: { status: "completed", keep: 1 },
};
writeBackV1Output(writeTarget as never, resultText(writeTarget as never), "redacted");
assert(
  JSON.stringify(writeTarget.content) ===
    JSON.stringify([
      { type: "text", text: "redacted" },
      { type: "file", uri: "file:///a.png", mime: "image/png" },
      { type: "text", text: "second" },
    ]),
  "write-back replaces the first text part and preserves every other part",
);

const noText: V2ResultShape = { content: [{ type: "file", uri: "file:///b.bin" }] };
writeBackV1Output(noText as never, "", "summary");
assert(
  JSON.stringify(noText.content) ===
    JSON.stringify([
      { type: "text", text: "summary" },
      { type: "file", uri: "file:///b.bin" },
    ]),
  "write-back prepends text when the result has no text part",
);

const stringContent: V2ResultShape = { content: "old" };
writeBackV1Output(stringContent as never, "old", "new");
assert(stringContent.content === "new", "write-back replaces a string result");

const emptyRedaction: V2ResultShape = {
  content: [
    { type: "text", text: "secret" },
    { type: "text", text: "keep" },
  ],
};
writeBackV1Output(emptyRedaction as never, "secret\nkeep", "");
assert(
  JSON.stringify(emptyRedaction.content) ===
    JSON.stringify([
      { type: "text", text: "" },
      { type: "text", text: "keep" },
    ]),
  "write-back keeps later parts when redacting to empty",
);

const unchanged: V2ResultShape = { content: [{ type: "text", text: "same" }] };
writeBackV1Output(unchanged as never, "same", "same");
assert(JSON.stringify(unchanged.content) === JSON.stringify([{ type: "text", text: "same" }]), "unchanged text is untouched");

const afterTarget: V2ResultShape = { content: [{ type: "text", text: "raw" }], metadata: { keep: 1 } };
applyV1AfterOutput(
  afterTarget as never,
  "raw",
  { keep: 1 },
  { title: "", output: "raw", metadata: { keep: 1, status: "completed", added: 2 } },
  true,
);
assert(afterTarget.metadata?.status === undefined, "synthetic status is stripped from metadata");
assert(afterTarget.metadata?.added === 2 && afterTarget.metadata?.keep === 1, "real metadata mutations are copied back");

const dir = mkdtempSync(join(tmpdir(), "tawassul-n2-"));
const logPath = join(dir, "n2-auto.jsonl");
process.env.TAWASSUL_N2_LOG = logPath;
const hook = createN2AutoHook();
const readLog = (): string => (existsSync(logPath) ? readFileSync(logPath, "utf8").trim() : "");
await hook({ event: { type: "message.part.updated", properties: { part: { type: "text", id: "p1", sessionID: "s1", messageID: "m-user", text: "hello" } } } });
assert(!readLog(), "user text part is ignored");
await hook({ event: { type: "message.part.updated", properties: { part: { type: "text", id: "p2", sessionID: "s1", messageID: "m-unknown", text: "hello" } } } });
assert(!readLog(), "unannounced message part is ignored");
await hook({ event: { type: "message.updated", properties: { info: { id: "m-user", role: "user" } } } });
assert(!readLog(), "user message announcement does not open the gate");
await hook({ event: { type: "message.part.updated", properties: { part: { type: "text", id: "p3", sessionID: "s1", messageID: "m-user", text: "hello" } } } });
assert(!readLog(), "announced user message still does not record");
await hook({ event: { type: "message.updated", properties: { info: { id: "m-assistant", role: "assistant" } } } });
await hook({ event: { type: "message.part.updated", properties: { part: { type: "text", id: "p4", sessionID: "s1", messageID: "m-assistant", text: "answer" } } } });
const recorded = readLog().split("\n").filter(Boolean);
assert(recorded.length === 1, "first assistant text part records once");
const record = JSON.parse(recorded[0] ?? "{}") as { message_id?: string; len?: number; role_gate?: boolean };
assert(record.message_id === "m-assistant" && record.len === 6, "record carries the assistant message id");
assert(record.role_gate === true, "record carries the post-gate marker");
await hook({ event: { type: "message.part.updated", properties: { part: { type: "text", id: "p5", sessionID: "s1", messageID: "m-assistant", text: "second" } } } });
assert(readLog().split("\n").filter(Boolean).length === 1, "later parts are not recorded");

const v2Log = join(dir, "n2-v2.jsonl");
process.env.TAWASSUL_N2_LOG = v2Log;
const v2Hook = createN2AutoHook();
await v2Hook({ event: { type: "session.text.started", data: { sessionID: "s2", assistantMessageID: "m-v2", ordinal: 0 } } });
const v2Lines = (): string[] => (existsSync(v2Log) ? readFileSync(v2Log, "utf8").trim() : "").split("\n").filter(Boolean);
assert(v2Lines().length === 1, "v2 session text start records once");
const v2Record = JSON.parse(v2Lines()[0] ?? "{}") as { source?: string; len?: number; message_id?: string; role_gate?: boolean };
assert(v2Record.source === "event:session.text.started" && v2Record.message_id === "m-v2" && v2Record.len === 1, "v2 record carries the started event");
assert(v2Record.role_gate === true, "v2 record carries the post-gate marker");
await v2Hook({ event: { type: "session.text.delta", data: { sessionID: "s2", assistantMessageID: "m-v2", ordinal: 0, delta: "later" } } });
assert(v2Lines().length === 1, "later v2 deltas are not recorded");
delete process.env.TAWASSUL_N2_LOG;
rmSync(dir, { recursive: true, force: true });

let probeCalls = 0;
const probe: InitReadyProbe = async () => {
  probeCalls += 1;
  return { ready: true };
};
assert(getInitReady({ [INIT_READY]: probe }) === probe, "readiness probe is discoverable by symbol");
assert(getInitReady({}) === undefined, "hooks without the symbol have no probe");
await probe();
assert(probeCalls === 1, "probe invocation counts");

const repo = dirname(fileURLToPath(import.meta.url));
const initSource = readFileSync(join(repo, "..", "src", "bootstrap", "plugin-init.ts"), "utf8");
const setupSource = readFileSync(join(repo, "..", "src", "v2", "setup.ts"), "utf8");
assert(initSource.includes("[INIT_READY]: ensureReady"), "initPlugin attaches the readiness probe");
assert(setupSource.includes("ctx.tool.reload()"), "setup reloads tool schemas after init");
assert(setupSource.includes("applyV1AfterOutput"), "setup writes after-hook mutations back");

const noPermissionCtx = { session: {}, tool: {}, event: {} } as never;
assert((await registerAskPermission(noPermissionCtx)) === undefined, "ask is disabled without a permission domain");

let evaluateHook: ((input: unknown) => void | Promise<void>) | undefined;
const asserted: Array<Record<string, unknown>> = [];
let denyNext = false;
const permissionCtx = {
  session: {},
  tool: {},
  event: {},
  permission: {
    hook: async (_name: string, callback: (input: unknown) => void | Promise<void>) => {
      evaluateHook = callback;
      return { dispose: async () => undefined };
    },
    assert: async (input: Record<string, unknown>) => {
      asserted.push(input);
      if (denyNext) throw new Error("rejected by user");
    },
  },
} as never;
const askRegistration = await registerAskPermission(permissionCtx);
assert(askRegistration !== undefined && typeof evaluateHook === "function", "ask registers the evaluate hook");
const evaluation: Record<string, unknown> = { action: "tawassul.ask", effect: "allow", metadata: { title: "Delete files?" } };
await evaluateHook?.(evaluation);
assert(evaluation.effect === "ask" && evaluation.message === "Delete files?", "evaluate hook forces ask and carries the title");
const other: Record<string, unknown> = { action: "bash", effect: "allow" };
await evaluateHook?.(other);
assert(other.effect === "allow", "evaluate hook leaves unrelated actions alone");
const toolContext = {
  sessionID: "ses_ask",
  messageID: "msg_ask",
  agent: "tawa",
  id: "call_ask",
  progress: async () => undefined,
} as never;
const ask = createAskBridge(permissionCtx, toolContext, askRegistration !== undefined);
assert(typeof ask === "function", "confirm bridge is exposed when the hook is active");
assert((await ask?.("Delete files?", { type: "confirm", default: false })) === true, "confirm resolves true when allowed");
assert(asserted.length === 1 && asserted[0]?.action === "tawassul.ask", "confirm asserts the dedicated action");
denyNext = true;
assert((await ask?.("Delete files?", { type: "confirm", default: false })) === false, "confirm resolves false when rejected");
let selectRejected = false;
try {
  await ask?.("Pick one", { type: "select", options: ["a", "b"] });
} catch {
  selectRejected = true;
}
assert(selectRejected, "select fails closed instead of returning undefined");
assert(createAskBridge(permissionCtx, toolContext, false) === undefined, "inactive registration exposes no ask");

console.log("PROOF PASS: v2 host compatibility contract");
