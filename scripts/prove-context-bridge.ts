import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INIT_READY } from "../src/plugin-types.ts";
import type { TawassulHooks } from "../src/plugin-types.ts";
import { createV2Setup } from "../src/v2/setup.ts";
import { clearSessionBridge, getSessionBridge, installSessionBridge } from "../src/v2/session-bridge.ts";
import { createPack, warmInjection } from "../src/services/context-pack/index.ts";
import type { V2Context } from "../src/v2/types.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

const work = mkdtempSync(join(tmpdir(), "tawassul-context-bridge-"));
const keyDir = join(work, "keys");
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
process.env.XDG_DATA_HOME = join(work, "data");
delete process.env.TAWASSUL_ISOLATED;
delete process.env.TAWASSUL_CONTEXT_HANDOFF;
const worktree = join(work, "workspace");
mkdirSync(worktree, { recursive: true });

type Handler = (event: Record<string, unknown>) => unknown;

function fakeContext(handlers: Map<string, Handler>, calls: string[]): V2Context {
  return {
    app: { version: "2.2.2" },
    location: { directory: worktree },
    session: {
      create: async (input: Record<string, unknown>) => {
        calls.push(`create:${String(input.title ?? "")}`);
        return { id: "ses-created" };
      },
      prompt: async (input: Record<string, unknown>) => {
        calls.push(`prompt:${String(input.sessionID ?? "")}`);
        return undefined;
      },
      context: async () => {
        calls.push("context");
        return [{ role: "user", content: "history" }];
      },
      wait: async () => {
        calls.push("wait");
        return undefined;
      },
      synthetic: async () => {
        calls.push("synthetic");
        return undefined;
      },
      interrupt: async () => undefined,
      hook: async (name: string, handler: Handler) => {
        calls.push(`hook:${name}`);
        handlers.set(name, handler);
        return {
          dispose: async () => {
            handlers.delete(name);
          },
        };
      },
    },
    tool: {
      transform: async (callback: (editor: { add: (entry: unknown) => void }) => void) => {
        callback({ add: () => undefined });
        return { dispose: async () => undefined };
      },
      reload: async () => undefined,
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

function pluginWithChat(calls: string[]): TawassulHooks {
  return {
    tool: {},
    [INIT_READY]: async () => ({ ready: true }),
    "chat.message": async (input: { messageID?: string }, output: { parts: Array<{ type: string; text?: string }> }) => {
      calls.push(`chat:${String(input.messageID ?? "")}`);
      output.parts.push({ type: "text", text: "HOOK-ADDED" });
    },
    "experimental.session.compacting": async (
      _input: unknown,
      output: { context: string[]; prompt?: string },
    ) => {
      output.context.push("COMPACT-CONTEXT");
      output.prompt = "COMPACT-PROMPT";
    },
  } as unknown as TawassulHooks;
}

async function main(): Promise<void> {
  clearSessionBridge();
  const handlers = new Map<string, Handler>();
  const calls: string[] = [];
  const pluginCalls: string[] = [];
  const cleanup = await createV2Setup({
    init: () => pluginWithChat(pluginCalls),
    refresh: { attempts: 1, delayMs: 1, initialWaitMs: 5 },
  })(fakeContext(handlers, calls));

  assert(getSessionBridge() !== null, "setup installs the session bridge");
  assert(calls.includes("hook:context"), "setup registers the context hook");
  assert(calls.includes("hook:retry"), "setup registers the retry hook");
  assert(calls.includes("hook:compaction"), "setup registers the compaction hook");

  const bridge = getSessionBridge();
  if (!bridge) return;
  const created = await bridge.create({ title: "proof" });
  assert(created.id === "ses-created", "the bridge create delegates to the session domain");
  assert(calls.includes("create:proof"), "the create input reaches the host");
  await bridge.prompt({ sessionID: "ses-created", text: "transfer", files: [{ uri: "file:///p", name: "p" }], delivery: "queue" });
  assert(calls.includes("prompt:ses-created"), "the bridge prompt delegates to the session domain");
  const history = await bridge.context({ sessionID: "ses-created" });
  assert(history.length === 1, "the bridge context delegates to the session domain");
  await bridge.wait({ sessionID: "ses-created" });
  assert(calls.includes("wait"), "the bridge wait delegates to the session domain");
  const models = await bridge.modelList();
  assert(models.data.length === 0, "the bridge model list falls back to empty without a model domain");

  const record = await createPack({
    worktree,
    sessionID: "ses-bridge",
    agent: "dev",
    selection: "BRIDGE-PACK",
  });
  warmInjection({ sessionID: "ses-bridge", digest: record.digest, message: record.message, alreadyPresent: false });

  const contextHandler = handlers.get("context");
  assert(contextHandler !== undefined, "the context handler is callable");
  if (!contextHandler) return;

  const firstRequest: Array<Record<string, unknown>> = [{ role: "user", content: "hello", id: "msg_a" }];
  await contextHandler({ sessionID: "ses-bridge", messages: firstRequest, agent: "dev" });
  assert(pluginCalls.filter((call) => call === "chat:msg_a").length === 1, "the chat bridge runs once for the message");
  assert(firstRequest.length === 2, "the pack is appended after the chat bridge");
  assert(JSON.stringify(firstRequest[0]).includes("HOOK-ADDED"), "the chat bridge edits survive the injection");

  const repeated: Array<Record<string, unknown>> = [{ role: "user", content: "hello", id: "msg_a" }];
  await contextHandler({ sessionID: "ses-bridge", messages: repeated, agent: "dev" });
  assert(pluginCalls.filter((call) => call === "chat:msg_a").length === 1, "the chat bridge dedupes the repeated message");
  assert(repeated.length === 2, "the injection still runs when the chat bridge dedupes");
  assert(JSON.stringify(repeated[1]).includes(record.digest), "the deduped request still carries the pack");

  const compactionHandler = handlers.get("compaction");
  assert(compactionHandler !== undefined, "the compaction handler is callable");
  if (!compactionHandler) return;
  const system: Array<Record<string, unknown>> = [{ type: "text", text: "base" }];
  await compactionHandler({ sessionID: "ses-bridge", system });
  assert(system.length === 3, "compaction appends instead of replacing");
  assert(system[0]?.text === "base", "the host system entry stays first");
  assert(system[1]?.text === "COMPACT-CONTEXT", "compaction context reaches the host array");
  assert(String(system[2]?.text).includes("COMPACT-PROMPT"), "the compaction prompt reaches the host array");
  assert(Array.isArray(system) && system.length === 3, "the host array is mutated in place, not reassigned");

  await cleanup();
  assert(getSessionBridge() === null, "cleanup clears the bridge");
  assert(handlers.size === 0, "cleanup disposes the registered hooks");

  const bareHandlers = new Map<string, Handler>();
  const bareCalls: string[] = [];
  const bareCleanup = await createV2Setup({
    init: () => ({ tool: {}, [INIT_READY]: async () => ({ ready: true }) }) as unknown as TawassulHooks,
    refresh: { attempts: 1, delayMs: 1, initialWaitMs: 5 },
  })(fakeContext(bareHandlers, bareCalls));
  assert(bareHandlers.has("context"), "the context hook registers even without a chat.message hook");
  const bareBridge = getSessionBridge();
  assert(bareBridge !== null, "the bare setup still installs one bridge");
  if (bareBridge) {
    const direct = installSessionBridge(fakeContext(new Map(), []));
    assert(direct === getSessionBridge(), "installing again replaces rather than nests the bridge");
  }
  await bareCleanup();
  assert(getSessionBridge() === null, "bare cleanup clears the bridge");

  console.log("PROOF PASS: one bridge, splice-in-place compaction, and dedupe never swallows the injection");
}

try {
  await main();
} finally {
  clearSessionBridge();
  rmSync(work, { recursive: true, force: true });
}
