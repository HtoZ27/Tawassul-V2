import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INIT_READY } from "../src/plugin-types.ts";
import type { TawassulHooks } from "../src/plugin-types.ts";
import { createV2Setup } from "../src/v2/setup.ts";
import { clearSessionBridge } from "../src/v2/session-bridge.ts";
import {
  classifyTerminalFailure,
  createFailurePack,
  listPackStatuses,
  readLedger,
  resolvePackRoot,
} from "../src/services/context-pack/index.ts";
import type { V2Context } from "../src/v2/types.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

const work = mkdtempSync(join(tmpdir(), "tawassul-context-failure-"));
const keyDir = join(work, "keys");
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
process.env.XDG_DATA_HOME = join(work, "data");
delete process.env.TAWASSUL_ISOLATED;
delete process.env.TAWASSUL_CONTEXT_HANDOFF;
const worktree = join(work, "workspace");
mkdirSync(worktree, { recursive: true });

type Deferred = { promise: Promise<void>; resolve: () => void };

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function main(): Promise<void> {
  const terminalTypes = [
    "provider.free-limit",
    "provider.quota",
    "provider.go-limit",
    "provider.chatgpt-limit",
    "provider.budget-limit",
    "provider.model-budget-limit",
    "provider.auth",
    "provider.no-route",
  ];
  for (const type of terminalTypes) {
    assert(classifyTerminalFailure({ type }).terminal, `${type} is terminal`);
  }
  assert(classifyTerminalFailure({ status: 402 }).terminal, "http 402 is terminal");
  assert(classifyTerminalFailure({ message: "payment_required" }).terminal, "payment_required is terminal");
  assert(
    classifyTerminalFailure({ error: { data: { code: "insufficient_quota" } } }).terminal,
    "a nested billing code is terminal",
  );
  const retry = classifyTerminalFailure({ type: "provider.quota", retryAfterMs: 4321 });
  assert(retry.terminal && retry.retryAfterMs === 4321, "retryAfterMs is extracted from a terminal error");
  assert(!classifyTerminalFailure({ message: "socket hang up" }).terminal, "a transient network error is not terminal");
  assert(!classifyTerminalFailure(new Error("timeout")).terminal, "an error object without a billing code is not terminal");
  assert(!classifyTerminalFailure(undefined).terminal, "a missing error is not terminal");

  const first = await createFailurePack({
    worktree,
    sessionID: "ses-fail-direct",
    agent: "dev",
    messages: [{ role: "user", content: "the failing request" }],
    error: { type: "provider.quota", retryAfterMs: 4321 },
  });
  assert(first !== null, "a terminal failure writes a pack");
  if (!first) return;
  assert(first.message.role === "user", "the failure pack is a normal user message");
  const directLedger = await readLedger(resolvePackRoot(worktree));
  const failureEntry = directLedger.find((entry) => entry.type === "failure" && entry.digest === first.digest);
  assert(failureEntry !== undefined, "the failure is recorded");
  assert(failureEntry?.reason === "provider.quota", "the failure reason is recorded");
  assert(failureEntry?.detail === "4321", "retryAfterMs is recorded");
  const beforeTransient = (await listPackStatuses(worktree)).length;
  const transient = await createFailurePack({
    worktree,
    sessionID: "ses-fail-transient",
    messages: [{ role: "user", content: "retry later" }],
    error: { message: "socket hang up" },
  });
  assert(transient === null, "a transient failure writes no pack");
  assert((await listPackStatuses(worktree)).length === beforeTransient, "the transient failure stores nothing");

  const handlers = new Map<string, (event: unknown) => unknown>();
  const calls: string[] = [];
  const processed = deferred();
  const ctx = {
    app: { version: "2.3.0" },
    location: { directory: worktree },
    session: {
      create: async () => {
        calls.push("create");
        return { id: "ses-unused" };
      },
      prompt: async () => {
        calls.push("prompt");
        return undefined;
      },
      context: async () => {
        calls.push("context");
        return [{ role: "user", content: "the failing request" }];
      },
      wait: async () => undefined,
      synthetic: async () => {
        calls.push("synthetic");
        return undefined;
      },
      interrupt: async () => undefined,
      hook: async (name: string, handler: (event: unknown) => unknown) => {
        handlers.set(name, handler);
        return { dispose: async () => undefined };
      },
    },
    tool: {
      transform: async () => ({ dispose: async () => undefined }),
      reload: async () => undefined,
      list: async () => [],
      hook: async () => ({ dispose: async () => undefined }),
    },
    event: {
      subscribe: async function* () {
        yield {
          type: "session.step.failed",
          data: {
            sessionID: "ses-fail-event",
            agent: "dev",
            error: { type: "provider.quota", retryAfterMs: 9876 },
          },
        };
        processed.resolve();
      },
    },
  } as unknown as V2Context;

  const cleanup = await createV2Setup({
    init: () => ({ tool: {}, [INIT_READY]: async () => ({ ready: true }) }) as unknown as TawassulHooks,
    refresh: { attempts: 1, delayMs: 1, initialWaitMs: 5 },
  })(ctx);
  await processed.promise;
  await new Promise((resolve) => setTimeout(resolve, 30));

  const statuses = await listPackStatuses(worktree);
  const eventPack = statuses.find((status) => status.sessionID === "ses-fail-event");
  assert(eventPack !== undefined, "session.step.failed writes a pack through the event stream");
  assert(eventPack?.handoffId === undefined, "the failure pack is not a handoff");
  assert(!calls.includes("prompt") && !calls.includes("create") && !calls.includes("synthetic"), "the failure event never prompts or creates");
  const eventLedger = await readLedger(resolvePackRoot(worktree));
  const eventEntry = eventLedger.find(
    (entry) => entry.type === "failure" && entry.sessionID === "ses-fail-event",
  );
  assert(eventEntry?.detail === "9876", "the event retryAfterMs is recorded");

  const retryHandler = handlers.get("retry");
  assert(retryHandler !== undefined, "the retry hook is registered");
  const terminalPayload: { error?: unknown; decision?: unknown } = { error: { type: "provider.quota" } };
  retryHandler?.(terminalPayload);
  assert(JSON.stringify(terminalPayload.decision) === JSON.stringify({ retry: false }), "the retry hook vetoes a terminal failure");
  const transientPayload: { error?: unknown; decision?: unknown } = { error: { message: "socket hang up" } };
  retryHandler?.(transientPayload);
  assert(transientPayload.decision === undefined, "the retry hook leaves transient failures alone");

  const source = readFileSync(join(process.cwd(), "src/services/context-pack/index.ts"), "utf-8");
  assert(!/\.prompt\s*\(/.test(source), "the failure pack module never prompts");
  assert(!/\.synthetic\s*\(/.test(source), "the failure pack module never synthesizes a message");
  assert(!/session\.create/.test(source), "the failure pack module never creates a session");

  await cleanup();
  console.log("PROOF PASS: terminal failures write one pack and never prompt, create, or retry");
}

try {
  await main();
} finally {
  clearSessionBridge();
  rmSync(work, { recursive: true, force: true });
}
