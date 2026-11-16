import { z } from "zod";
import { ConsentBlockedError } from "../src/hooks/guards/consent-gate-guard.ts";
import { ToolBlockedError } from "../src/hooks/tool-execute.ts";
import { tool } from "../src/tool.ts";
import type { TawassulHooks } from "../src/plugin-types.ts";
import { createV2Setup, runChatMessageBridge } from "../src/v2/setup.ts";
import type { V2Context, V2SessionEvent } from "../src/v2/types.ts";

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

type BeforeOutput = { args: Record<string, unknown>; error?: string };

type BeforeHook = (input: unknown, output: BeforeOutput) => Promise<void>;

type CallInput = {
  tool: string;
  sessionID: string;
  agent: string;
  id: string;
  input: unknown;
};

function fakePlugin(before?: BeforeHook, chat?: (input: unknown, output: unknown) => Promise<void>): TawassulHooks {
  const echo = tool({
    description: "echo",
    args: { text: z.string() },
    execute: async (args) => ({ output: (args as { text: string }).text }),
  });
  const hooks: Record<string, unknown> = { tool: { echo } };
  if (before) hooks["tool.execute.before"] = before;
  if (chat) hooks["chat.message"] = chat;
  return hooks as unknown as TawassulHooks;
}

type ToolHook = (input: unknown) => unknown;

function fakeContext(toolHooks: Map<string, ToolHook>): V2Context {
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
        callback({ add: () => undefined });
        return { dispose: async () => undefined };
      },
      reload: async () => undefined,
      list: async () => [],
      hook: async (name: string, callback: ToolHook) => {
        toolHooks.set(name, callback);
        return { dispose: async () => undefined };
      },
    },
    event: {
      subscribe: async function* () {
        yield* [];
      },
    },
  } as unknown as V2Context;
}

type Setup = {
  run: (input: CallInput) => Promise<void>;
  cleanup: () => Promise<void>;
};

async function setupWith(before: BeforeHook): Promise<Setup> {
  const toolHooks = new Map<string, ToolHook>();
  const cleanup = await createV2Setup({ init: () => fakePlugin(before) })(fakeContext(toolHooks));
  const hook = toolHooks.get("execute.before");
  if (!hook) fail("the setup registered the execute.before hook");
  return {
    run: async (input: CallInput) => {
      await hook(input);
    },
    cleanup,
  };
}

function callInput(id: string, command = "echo hi"): CallInput {
  return { tool: "bash", sessionID: "sess-e18", agent: "dev", id, input: { command } };
}

async function catchError(run: () => Promise<void>): Promise<unknown> {
  try {
    await run();
    return undefined;
  } catch (e) {
    return e;
  }
}

async function bridgeCases(): Promise<void> {
  {
    const event: V2SessionEvent = {
      sessionID: "sess-e18-consent",
      messages: [{ id: "msg-e18-1", role: "user", content: "deploy" }],
    };
    const plugin = {
      "chat.message": async () => {
        throw new ConsentBlockedError("consent denied");
      },
    } as unknown as TawassulHooks;
    const error = await catchError(() => runChatMessageBridge(plugin, event, new Set()));
    assert(error instanceof ConsentBlockedError, "a consent denial from chat.message is not swallowed");
    assert((error as Error).message === "consent denied", "the consent denial keeps its reason");
  }

  {
    const event: V2SessionEvent = {
      sessionID: "sess-e18-tool",
      messages: [{ id: "msg-e18-2", role: "user", content: "push" }],
    };
    const plugin = {
      "chat.message": async () => {
        throw new ToolBlockedError("tool blocked");
      },
    } as unknown as TawassulHooks;
    const error = await catchError(() => runChatMessageBridge(plugin, event, new Set()));
    assert(error instanceof ToolBlockedError, "a tool block from chat.message is not swallowed");
  }

  {
    const event: V2SessionEvent = {
      sessionID: "sess-e18-fault",
      messages: [{ id: "msg-e18-3", role: "user", content: "hello" }],
    };
    let calls = 0;
    const plugin = {
      "chat.message": async () => {
        calls++;
        throw new Error("unexpected payload shape");
      },
    } as unknown as TawassulHooks;
    const error = await catchError(() => runChatMessageBridge(plugin, event, new Set()));
    assert(error === undefined, "an infrastructure fault in chat.message stays fail-open");
    assert(calls === 1, "the chat.message hook ran once before failing open");
    assert(event.messages![0]!["content"] === "hello", "a failed cosmetic hook leaves the content alone");
  }
}

async function beforeCases(): Promise<void> {
  {
    const setup = await setupWith(async (_input, output) => {
      output.error = "denied by policy";
      output.args.command = "rm -rf /";
    });
    const error = await catchError(() => setup.run(callInput("call-e18-1")));
    assert(error instanceof ToolBlockedError, "a guard error string blocks the tool call");
    assert((error as Error).message === "denied by policy", "the guard error string reaches the host");
    await setup.cleanup();
  }

  {
    const setup = await setupWith(async () => {
      throw new ConsentBlockedError("no consent");
    });
    const error = await catchError(() => setup.run(callInput("call-e18-2")));
    assert(error instanceof ConsentBlockedError, "a consent denial from execute.before is not swallowed");
    await setup.cleanup();
  }

  {
    const setup = await setupWith(async (_input, output) => {
      output.args.command = "rewritten";
    });
    const input = callInput("call-e18-3");
    const error = await catchError(() => setup.run(input));
    assert(error === undefined, "a successful guard lets the call through");
    assert(
      JSON.stringify(input.input) === JSON.stringify({ command: "rewritten" }),
      "an argument rewrite from a successful guard reaches the host",
    );
    await setup.cleanup();
  }

  {
    const setup = await setupWith(async (_input, output) => {
      output.error = "   ";
    });
    const error = await catchError(() => setup.run(callInput("call-e18-4")));
    assert(error === undefined, "a blank guard error does not block the call");
    await setup.cleanup();
  }

  {
    const setup = await setupWith(async () => {
      throw new Error("infrastructure fault on bash");
    });
    const input = callInput("call-e18-5");
    const error = await catchError(() => setup.run(input));
    assert(error === undefined, "an infrastructure fault in execute.before stays fail-open");
    assert(
      JSON.stringify(input.input) === JSON.stringify({ command: "echo hi" }),
      "a failed safety hook leaves the call arguments intact",
    );
    await setup.cleanup();
  }
}

try {
  await bridgeCases();
  await beforeCases();
  console.log(`PROOF PASS: guard decisions propagate while infrastructure faults fail open (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
