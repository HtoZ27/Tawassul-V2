import "./proof-log-isolate.ts";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createV2Setup, isBlockError } from "../src/v2/setup.ts";
import { ToolBlockedError } from "../src/hooks/tool-execute.ts";
import type { TawassulHooks } from "../src/plugin-types.ts";
import type { V2Context } from "../src/v2/types.ts";

const ROOT = mkdtempSync(join(tmpdir(), "tawassul-blocked-tool-"));
const SENTINEL = join(ROOT, "sentinel");

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

type ToolHook = (input: unknown) => unknown;

function fakePlugin(calls: string[]): TawassulHooks {
  return {
    tool: {},
    "tool.execute.before": async (input: { tool?: string; agent?: string }) => {
      calls.push(`${input.agent}:${input.tool}`);
    },
  } as unknown as TawassulHooks;
}

function fakeContext(toolHooks: Map<string, ToolHook>): V2Context {
  return {
    location: { directory: ROOT },
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

async function caught(run: () => unknown): Promise<unknown> {
  try {
    await run();
    return undefined;
  } catch (e) {
    return e;
  }
}

try {
  const named = new Error("consent");
  named.name = "ConsentBlockedError";
  assert(isBlockError(new ToolBlockedError("blocked")), "isBlockError recognizes ToolBlockedError");
  assert(isBlockError(named), "isBlockError recognizes ConsentBlockedError");
  assert(!isBlockError(new Error("plain")), "isBlockError rejects a generic error");

  const calls: string[] = [];
  const toolHooks = new Map<string, ToolHook>();
  const cleanup = await createV2Setup({ init: () => fakePlugin(calls) })(fakeContext(toolHooks));
  try {
    const before = toolHooks.get("execute.before");
    assert(typeof before === "function", "the setup registers the host execute.before hook");
    if (!before) fail("the execute.before hook is missing");
    const call = (agent: string, tool: string, id: string, input: Record<string, unknown>) =>
      before({ tool, sessionID: "ses-blocked", agent, id, input });

    const bashError = await caught(() => call("tawa", "bash", "call-1", { command: `touch ${SENTINEL}` }));
    assert(bashError instanceof ToolBlockedError, "tawa bash fails with ToolBlockedError");
    assert(!existsSync(SENTINEL), "the blocked bash command produced no side effect");
    assert(calls.length === 0, "the plugin bridge never sees the blocked tawa bash call");

    const editError = await caught(() => call("tawa", "edit", "call-2", { filePath: SENTINEL, content: "x" }));
    assert(editError instanceof ToolBlockedError, "tawa edit fails with ToolBlockedError");
    assert(calls.length === 0, "the plugin bridge never sees the blocked tawa edit call");

    const writeError = await caught(() => call("tawa", "write", "call-3", { filePath: SENTINEL, content: "x" }));
    assert(writeError instanceof ToolBlockedError, "tawa write fails with ToolBlockedError");

    const allowed = await caught(() => call("tawa", "read", "call-4", { filePath: ROOT }));
    assert(allowed === undefined, "tawa read passes the block gate");
    assert(calls.at(-1) === "tawa:read", "the plugin bridge sees an allowed tawa tool");

    const dev = await caught(() => call("dev", "bash", "call-5", { command: "true" }));
    assert(dev === undefined, "a non-tawa agent is not blocked by the tawa list");
    assert(calls.at(-1) === "dev:bash", "the plugin bridge sees the non-tawa bash call");

    console.log(`PROOF PASS: tawa blocked tools fail through the host execute.before hook with no side effect (${passed} assertions)`);
  } finally {
    await cleanup();
  }
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
