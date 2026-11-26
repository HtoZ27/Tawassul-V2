import "./proof-log-isolate.ts";
import { mapV2EventToV1 } from "../src/v2/event-adapter.ts";
import { createToolOutputStreamHook } from "../src/hooks/tool-output-stream.ts";

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

const SESSION = "sess-e15";
const CALL = "call-e15-1";

function sessionEvent(type: string, data: Record<string, unknown>): unknown {
  return { id: `evt-${type}`, created: Date.now(), type, data };
}

async function main(): Promise<void> {
  const lines: string[] = [];
  const hook = createToolOutputStreamHook({
    isIsolationActive: () => false,
    logLine: (line) => lines.push(line),
  });
  const toolOf = (id: string): string | undefined => (id === CALL ? "bash" : undefined);

  const relay = async (event: unknown): Promise<unknown[]> => {
    const mapped = mapV2EventToV1(event, { toolOf });
    for (const ev of mapped) await hook({ event: ev });
    return mapped as unknown[];
  };

  const called = await relay(
    sessionEvent("session.tool.called", { sessionID: SESSION, assistantMessageID: "msg-1", id: CALL, input: { command: "ls" } }),
  );
  assert(called.length === 2, "a v2 tool call maps to the raw event plus a v1 part update");
  assert(
    (called[0] as { type?: string }).type === "session.tool.called",
    "the raw v2 event is still forwarded for the v2-native listeners",
  );
  const part = (called[1] as { properties: { part: { id: string; tool: string; state: { status: string } } } }).properties.part;
  assert(part.id === CALL, "the mapped part carries the v2 call id");
  assert(part.tool === "bash", "the mapped part carries the tool name from the execute hook");
  assert(part.state.status === "running", "a call that just started is mapped as running");
  assert(lines.length === 0, "starting a tool prints nothing");

  await relay(
    sessionEvent("session.tool.progress", {
      sessionID: SESSION,
      assistantMessageID: "msg-1",
      id: CALL,
      metadata: { output: "first line\n" },
    }),
  );
  assert(lines.some((l) => l.includes("first line")), "streamed v2 progress reaches the console stream");

  await relay(
    sessionEvent("session.tool.success", {
      sessionID: SESSION,
      assistantMessageID: "msg-1",
      id: CALL,
      content: [{ type: "text", text: "first line\nsecond line\n" }],
    }),
  );
  assert(lines.some((l) => l.includes("second line")), "the completion output reaches the console stream");
  assert(
    lines.filter((l) => l.includes("first line")).length === 1,
    "a line already streamed as progress is not printed twice",
  );

  const before = lines.length;
  await relay(
    sessionEvent("session.tool.failed", {
      sessionID: SESSION,
      assistantMessageID: "msg-2",
      id: "call-e15-2",
      error: { type: "unknown", message: "command not found: nope" },
      executed: true,
    }),
  );
  assert(
    lines.length === before,
    "a failed call from a tool the stream does not track stays quiet",
  );

  const failures: string[] = [];
  const failingHook = createToolOutputStreamHook({
    isIsolationActive: () => false,
    logLine: (line) => failures.push(line),
  });
  const mappedFailure = mapV2EventToV1(
    sessionEvent("session.tool.failed", {
      sessionID: SESSION,
      assistantMessageID: "msg-3",
      id: CALL,
      error: { type: "unknown", message: "command not found: nope" },
      executed: true,
    }),
    { toolOf },
  );
  for (const ev of mappedFailure) await failingHook({ event: ev });
  assert(
    failures.some((l) => l.includes("command not found: nope")),
    "a failed tracked tool prints its error",
  );

  const unmapped = mapV2EventToV1(
    sessionEvent("session.tool.success", {
      sessionID: SESSION,
      assistantMessageID: "msg-4",
      id: "call-never-seen",
      content: [{ type: "text", text: "ghost output" }],
    }),
    { toolOf },
  );
  assert(
    ((unmapped[1] as { properties: { part: Record<string, unknown> } }).properties.part as { tool?: string }).tool === undefined,
    "a call with no recorded tool name maps to a part the stream skips",
  );

  const textDelta = mapV2EventToV1(
    sessionEvent("session.text.delta", { sessionID: SESSION, assistantMessageID: "msg-5", ordinal: 0, delta: "hello" }),
  );
  const textPart = (textDelta[1] as { type: string; properties: Record<string, unknown> }).properties;
  assert((textDelta[1] as { type: string }).type === "message.part.delta", "a v2 text delta maps to the v1 delta shape");
  assert(textPart.partID === "msg-5" && textPart.delta === "hello", "the text delta keeps its part and text");

  const legacy: string[] = [];
  const legacyHook = createToolOutputStreamHook({
    isIsolationActive: () => false,
    logLine: (line) => legacy.push(line),
  });
  await legacyHook({
    event: {
      type: "message.part.updated",
      properties: {
        part: { id: "p1", type: "tool", tool: "bash", state: { status: "completed", output: "legacy line\n" } },
      },
    },
  });
  assert(legacy.some((l) => l.includes("legacy line")), "a v1-shaped part still streams on a v1 host");
}

try {
  await main();
  console.log(`PROOF PASS: v2 tool and text events reach the v1 stream listeners (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
