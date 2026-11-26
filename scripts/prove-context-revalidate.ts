import "./proof-log-isolate.ts";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INIT_READY } from "../src/plugin-types.ts";
import type { TawassulHooks } from "../src/plugin-types.ts";
import { createV2Setup } from "../src/v2/setup.ts";
import { clearSessionBridge } from "../src/v2/session-bridge.ts";
import {
  activatePack,
  clearInjectionCache,
  createPack,
  handleContextEvent,
  isInjectionWarm,
  markPackTransferred,
  readLedger,
  refreshSessionInjection,
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

const work = mkdtempSync(join(tmpdir(), "tawassul-context-revalidate-"));
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
  clearInjectionCache();
  const record = await createPack({
    worktree,
    sessionID: "ses-reval",
    agent: "dev",
    selection: "REVALIDATE-PACK",
  });
  const activation = await activatePack({ worktree, sessionID: "ses-reval", digest: record.digest });
  assert(activation.ok, "the pack is activated and indexed before setup");
  clearInjectionCache();
  const root = resolvePackRoot(worktree);

  const goFirst = deferred();
  const firstProcessed = deferred();
  const goSecond = deferred();
  const secondProcessed = deferred();
  let stored: Array<Record<string, unknown>> = [{ role: "user", content: [{ type: "text", text: record.text }] }];
  const calls: string[] = [];
  const handlers = new Map<string, (event: unknown) => unknown>();

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
        return stored;
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
        await goFirst.promise;
        yield { type: "session.compaction.ended", data: { sessionID: "ses-reval" } };
        firstProcessed.resolve();
        await goSecond.promise;
        yield { type: "session.compaction.ended", data: { sessionID: "ses-reval" } };
        secondProcessed.resolve();
      },
    },
  } as unknown as V2Context;

  const cleanup = await createV2Setup({
    init: () => ({ tool: {}, [INIT_READY]: async () => ({ ready: true }) }) as unknown as TawassulHooks,
    refresh: { attempts: 1, delayMs: 1, initialWaitMs: 5 },
  })(ctx);

  assert(isInjectionWarm("ses-reval", record.digest), "setup warms the live pack from the index");

  goFirst.resolve();
  await firstProcessed.promise;
  await new Promise((resolve) => setTimeout(resolve, 20));
  let ledger = await readLedger(root);
  assert(
    ledger.some((entry) => entry.type === "compaction" && entry.digest === record.digest),
    "session.compaction.ended is recorded in the ledger",
  );
  assert(calls.filter((call) => call === "context").length >= 2, "the refresh reads the stored session through the bridge");
  assert(!calls.includes("prompt") && !calls.includes("create") && !calls.includes("synthetic"), "the refresh never prompts or creates");

  const survivors: Array<Record<string, unknown>> = [
    { role: "user", content: "summary" },
    { role: "user", content: [{ type: "text", text: record.text }] },
  ];
  assert(handleContextEvent({ sessionID: "ses-reval", messages: survivors }) === 0, "a surviving pack is not re-injected");
  assert(isInjectionWarm("ses-reval", record.digest), "the pack stays warm after compaction");

  stored = [];
  goSecond.resolve();
  await secondProcessed.promise;
  await new Promise((resolve) => setTimeout(resolve, 20));
  ledger = await readLedger(root);
  assert(
    ledger.filter((entry) => entry.type === "compaction" && entry.digest === record.digest).length >= 2,
    "a second compaction is recorded",
  );

  const vanished: Array<Record<string, unknown>> = [{ role: "user", content: "summary only" }];
  assert(handleContextEvent({ sessionID: "ses-reval", messages: vanished }) === 1, "a vanished pack returns once on the next request");
  assert(JSON.stringify(vanished[1]).includes(record.digest), "the returned pack keeps its digest");

  const transferred = await createPack({
    worktree,
    sessionID: "ses-tr",
    agent: "dev",
    selection: "TRANSFERRED-PACK",
  });
  await markPackTransferred({ worktree, digest: transferred.digest, sessionID: "ses-tr", alreadyPresent: true });
  await refreshSessionInjection({
    worktree,
    sessionID: "ses-tr",
    readMessages: async () => [{ role: "user", content: [{ type: "file", uri: `file:///packs/${transferred.digest}.json` }] }],
  });
  assert(
    handleContextEvent({ sessionID: "ses-tr", messages: [{ role: "user", content: "summary" }] }) === 0,
    "a transferred pack that survived compaction is not injected again",
  );
  await refreshSessionInjection({ worktree, sessionID: "ses-tr", readMessages: async () => [] });
  const lost: Array<Record<string, unknown>> = [{ role: "user", content: "summary only" }];
  assert(
    handleContextEvent({ sessionID: "ses-tr", messages: lost }) === 1,
    "a transferred pack that vanished after compaction returns once",
  );
  assert(JSON.stringify(lost[1]).includes(transferred.digest), "the restored transferred pack keeps its digest");

  await cleanup();
  console.log("PROOF PASS: compaction is recorded without re-injection and the next request still carries the pack");
}

try {
  await main();
} finally {
  clearSessionBridge();
  clearInjectionCache();
  rmSync(work, { recursive: true, force: true });
}
