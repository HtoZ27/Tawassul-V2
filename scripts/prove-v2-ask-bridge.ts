import { createAskBridge } from "../src/v2/ask.ts";
import { buildPluginInput } from "../src/v2/client-shim.ts";
import type { V2Context, V2ToolContext } from "../src/v2/types.ts";

let failures = 0;

function check(name: string, cond: boolean): void {
  if (cond) {
    console.log(`ok ${name}`);
    return;
  }
  failures += 1;
  console.error(`PROOF FAIL: ${name}`);
}

const toolContext = {
  sessionID: "session-proof",
  messageID: "message-proof",
  agent: "build",
  id: "call-proof",
  signal: new AbortController().signal,
  progress: async () => undefined,
} as unknown as V2ToolContext;

let assertCalls = 0;
let assertDenied = false;
const permissionContext = {
  session: {
    prompt: async () => undefined,
    interrupt: async () => undefined,
    hook: async () => ({ dispose: async () => undefined }),
  },
  tool: {
    transform: async () => ({ dispose: async () => undefined }),
    reload: async () => undefined,
    list: async () => [],
    hook: async () => ({ dispose: async () => undefined }),
  },
  event: { subscribe: async function* () {} },
  permission: {
    assert: async () => {
      assertCalls += 1;
      if (assertDenied) throw new Error("denied by host");
    },
    hook: async () => ({ dispose: async () => undefined }),
  },
} as unknown as V2Context;

const ask = createAskBridge(permissionContext, toolContext, true);
check("confirm bridge is available", typeof ask === "function");

if (ask) {
  const approved = await ask("Proceed?", { type: "confirm", default: false });
  check("approved confirm returns true", approved === true);
  check("approved confirm reaches the host", assertCalls === 1);

  assertDenied = true;
  const denied = await ask("Proceed?", { type: "confirm", default: true });
  check("denied confirm returns false", denied === false);

  let selectError = "";
  try {
    await ask("Pick one", { type: "select", options: ["a", "b"] });
  } catch (e) {
    selectError = e instanceof Error ? e.message : String(e);
  }
  check("select fails closed", selectError.includes("cannot be delivered"));

  let multiError = "";
  try {
    await ask("Pick many", { type: "multiselect", options: ["a", "b"] });
  } catch (e) {
    multiError = e instanceof Error ? e.message : String(e);
  }
  check("multiselect fails closed", multiError.includes("cannot be delivered"));
}

const disabledAsk = createAskBridge(permissionContext, toolContext, false);
check("disabled bridge is undefined", disabledAsk === undefined);

const noPermissionContext = {
  session: permissionContext.session,
  tool: permissionContext.tool,
  event: permissionContext.event,
} as unknown as V2Context;
check("missing permission API disables the bridge", createAskBridge(noPermissionContext, toolContext, true) === undefined);

type SessionCall = { kind: "prompt" | "synthetic"; text: string; delivery?: string };
const sessionCalls: SessionCall[] = [];
const shimSession = {
  prompt: async (input: { text: string; delivery?: string }) => {
    sessionCalls.push({ kind: "prompt", text: input.text, delivery: input.delivery });
    return "prompted";
  },
  synthetic: async (input: { text: string }) => {
    sessionCalls.push({ kind: "synthetic", text: input.text });
    return "synthetic";
  },
  interrupt: async () => undefined,
  hook: async () => ({ dispose: async () => undefined }),
};
const shimContext = {
  location: { directory: "/tmp" },
  session: shimSession,
  tool: permissionContext.tool,
  event: permissionContext.event,
} as unknown as V2Context;

const client = buildPluginInput(shimContext).client as unknown as {
  session: {
    prompt: (input: unknown) => Promise<unknown>;
    promptAsync: (input: unknown) => Promise<unknown>;
  };
};

sessionCalls.length = 0;
await client.session.prompt({
  sessionID: "session-proof",
  body: { parts: [{ type: "text", text: "notice" }], noReply: true },
});
check("noReply uses a synthetic message", sessionCalls.length === 1 && sessionCalls[0]?.kind === "synthetic");
check("noReply does not queue a user turn", sessionCalls.every((call) => call.kind !== "prompt"));

sessionCalls.length = 0;
await client.session.prompt({
  sessionID: "session-proof",
  body: { parts: [{ type: "text", text: "hello" }], noReply: false },
});
check("a normal prompt steers", sessionCalls.length === 1 && sessionCalls[0]?.kind === "prompt");
check("a normal prompt uses steer delivery", sessionCalls[0]?.delivery === "steer");

sessionCalls.length = 0;
await client.session.promptAsync({
  sessionID: "session-proof",
  body: { parts: [{ type: "text", text: "notice" }], noReply: true },
});
check("async noReply uses a synthetic message", sessionCalls.length === 1 && sessionCalls[0]?.kind === "synthetic");

const noSyntheticCalls: string[] = [];
const noSyntheticContext = {
  location: { directory: "/tmp" },
  session: {
    prompt: async (input: { text: string }) => {
      noSyntheticCalls.push(input.text);
      return "prompted";
    },
    interrupt: async () => undefined,
    hook: async () => ({ dispose: async () => undefined }),
  },
  tool: permissionContext.tool,
  event: permissionContext.event,
} as unknown as V2Context;
const noSyntheticClient = buildPluginInput(noSyntheticContext).client as unknown as {
  session: { prompt: (input: unknown) => Promise<unknown> };
};
const dropped = await noSyntheticClient.session.prompt({
  sessionID: "session-proof",
  body: { parts: [{ type: "text", text: "notice" }], noReply: true },
});
check("noReply without synthetic drops the message", dropped === undefined && noSyntheticCalls.length === 0);

if (failures > 0) {
  console.error(`PROOF FAIL: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("PROOF PASS: v2 questions fail closed and noReply never queues a user turn");
