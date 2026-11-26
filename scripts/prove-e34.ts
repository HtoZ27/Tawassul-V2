import "./proof-log-isolate.ts";
import { runChatMessageBridge } from "../src/v2/setup.ts";
import type { TawassulHooks } from "../src/plugin-types.ts";
import type { V2SessionEvent } from "../src/v2/types.ts";

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

type ChatOutput = {
  message: { role: string; text?: string; [key: string]: unknown };
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
};

function pluginWith(mutate: (output: ChatOutput) => void): TawassulHooks {
  return {
    "chat.message": async (_input: { sessionID: string }, output: unknown) => {
      mutate(output as ChatOutput);
    },
  } as unknown as TawassulHooks;
}

function run(
  plugin: TawassulHooks,
  event: V2SessionEvent,
  processed: Set<string> = new Set<string>(),
): Promise<void> {
  return runChatMessageBridge(plugin, event, processed);
}

async function main(): Promise<void> {
  const roleEvent: V2SessionEvent = {
    sessionID: "sess-e34-role",
    messages: [{ id: "msg-e34-1", role: "user", content: [{ type: "text", text: "hello" }] }],
  };
  await run(
    pluginWith((output) => {
      output.message.role = "system";
      output.message.agent = "dev";
      output.message.model = "opencode/big-pickle";
    }),
    roleEvent,
  );
  const roleMessage = roleEvent.messages![0]!;
  assert(roleMessage["role"] === "system", "a hook that changes the message role reaches the host request");
  assert(roleEvent.agent === "dev", "a hook that sets the message agent reaches the host request");
  assert(
    JSON.stringify(roleEvent.model) === JSON.stringify({ providerID: "opencode", modelID: "big-pickle" }),
    "a string model is normalized to provider and model ids",
  );

  const objectModelEvent: V2SessionEvent = {
    sessionID: "sess-e34-model",
    agent: "tawa",
    model: { providerID: "opencode", modelID: "big-pickle" },
    messages: [{ id: "msg-e34-2", role: "assistant", content: [{ type: "text", text: "reply" }] }],
  };
  await run(
    pluginWith((output) => {
      output.message.model = { providerID: "google", modelID: "gemini-flash-lite-latest" };
    }),
    objectModelEvent,
  );
  assert(
    JSON.stringify(objectModelEvent.model) ===
      JSON.stringify({ providerID: "google", modelID: "gemini-flash-lite-latest" }),
    "an object model replaces the host request model",
  );
  assert(objectModelEvent.agent === "tawa", "an untouched agent stays as the host sent it");

  const textEvent: V2SessionEvent = {
    sessionID: "sess-e34-text",
    messages: [{ id: "msg-e34-3", role: "user", content: "hello" }],
  };
  await run(
    pluginWith((output) => {
      output.message.text = "rewritten hello";
    }),
    textEvent,
  );
  assert(textEvent.messages![0]!["content"] === "rewritten hello", "a message text replacement reaches the host content");

  const invalidRoleEvent: V2SessionEvent = {
    sessionID: "sess-e34-invalid",
    messages: [{ id: "msg-e34-4", role: "assistant", content: [{ type: "text", text: "reply" }] }],
  };
  await run(
    pluginWith((output) => {
      output.message.role = "root";
      output.message.agent = "   ";
    }),
    invalidRoleEvent,
  );
  assert(invalidRoleEvent.messages![0]!["role"] === "assistant", "an unknown role is ignored instead of corrupting the request");
  assert(invalidRoleEvent.agent === undefined, "a blank agent is ignored");

  const appendEvent: V2SessionEvent = {
    sessionID: "sess-e34-append",
    messages: [{ id: "msg-e34-5", role: "user", content: [{ type: "text", text: "original" }] }],
  };
  await run(
    pluginWith((output) => {
      output.parts.push({ type: "text", text: "appended" });
    }),
    appendEvent,
  );
  const appendContent = appendEvent.messages![0]!["content"] as Array<{ type: string; text: string }>;
  assert(appendContent.length === 2 && appendContent[1]!.text === "appended", "an appended part still reaches the host content");

  const editEvent: V2SessionEvent = {
    sessionID: "sess-e34-edit",
    messages: [{ id: "msg-e34-6", role: "user", content: [{ type: "text", text: "before" }] }],
  };
  await run(
    pluginWith((output) => {
      output.parts[0]!.text = "after";
    }),
    editEvent,
  );
  const editContent = editEvent.messages![0]!["content"] as Array<{ type: string; text: string }>;
  assert(editContent[0]!.text === "after", "an edited part still reaches the host content");

  const untouchedEvent: V2SessionEvent = {
    sessionID: "sess-e34-untouched",
    messages: [{ id: "msg-e34-7", role: "user", content: [{ type: "text", text: "same" }] }],
  };
  await run(pluginWith(() => undefined), untouchedEvent);
  const untouched = untouchedEvent.messages![0]!;
  assert(untouched["role"] === "user", "a hook that changes nothing leaves the role alone");
  assert(
    (untouched["content"] as Array<{ text: string }>)[0]!.text === "same",
    "a hook that changes nothing leaves the content alone",
  );

  let calls = 0;
  const processed = new Set<string>();
  const dedupeEvent: V2SessionEvent = {
    sessionID: "sess-e34-dedupe",
    messages: [{ id: "msg-e34-8", role: "user", content: "once" }],
  };
  const plugin = pluginWith((output) => {
    calls++;
    output.message.agent = "dev";
  });
  await run(plugin, dedupeEvent, processed);
  await run(plugin, dedupeEvent, processed);
  assert(calls === 1, "the same message is bridged once");
}

try {
  await main();
  console.log(`PROOF PASS: message-level mutations reach the host request (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
