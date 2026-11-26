import "./proof-log-isolate.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TawassulContext } from "../src/context.ts";
import type { PluginInput } from "../src/plugin-types.ts";
import { buildPluginInput, resolveV2ServerUrl } from "../src/v2/client-shim.ts";
import type { V2Context } from "../src/v2/types.ts";
import {
  clearRateLimitRetry,
  handleRateLimitError,
  injectTranscriptQuestion,
  notifySession,
} from "../src/bootstrap/plugin-init.ts";
import { readAskRenderEnv, resolveAskRenderer } from "../src/services/ask-render.ts";
import { ASK_MARKER } from "../src/services/ask-channel-parse.ts";
import { TimerManager } from "../src/services/timer-manager.ts";

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

type SessionCall = { kind: "prompt" | "synthetic"; text: string; delivery?: string };

function shimContext(calls: SessionCall[], directory: string): V2Context {
  return {
    location: { directory },
    session: {
      prompt: async (input: { text: string; delivery?: string }) => {
        calls.push({ kind: "prompt", text: input.text, delivery: input.delivery });
        return "prompted";
      },
      synthetic: async (input: { text: string }) => {
        calls.push({ kind: "synthetic", text: input.text });
        return "synthetic";
      },
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
  } as unknown as V2Context;
}

function shimAdvertisesOnlyRealCapabilities(directory: string): void {
  const input = buildPluginInput(shimContext([], directory));
  const client = input.client as {
    tui?: { appendPrompt?: unknown; showToast?: unknown };
    session?: unknown;
  };
  assert(!("tui" in client), "the v2 shim does not advertise a v1 TUI it cannot reach");
  assert(client.tui?.appendPrompt === undefined, "there is no appendPrompt that logs instead of prompting");
  assert(client.tui?.showToast === undefined, "there is no showToast that logs instead of notifying");
  assert(client.session !== undefined, "the session bridge stays available for transcript delivery");
}

function rendererHasNoSilentFallback(): void {
  const env = readAskRenderEnv({});
  assert(env.transcriptEnabled === true, "the transcript renderer is enabled by default");
  assert(
    resolveAskRenderer({ transcriptEnabled: env.transcriptEnabled }) === "transcript",
    "without a TUI the ask renderer resolves to the transcript",
  );
  assert(
    resolveAskRenderer({ transcriptEnabled: false }) === "none",
    "disabling the transcript leaves no append path that silently drops the question",
  );
  assert(
    readAskRenderEnv({ TAWASSUL_ASK_TRANSCRIPT: "0" }).transcriptEnabled === false,
    "the transcript flag can still disable rendering",
  );
}

async function questionReachesTheTranscript(directory: string): Promise<void> {
  const calls: SessionCall[] = [];
  const input = buildPluginInput(shimContext(calls, directory));
  await injectTranscriptQuestion(input, "ses-e33-ask", "Approve the deployment?", {
    type: "confirm",
    default: false,
  });
  assert(calls.length === 1, "a question is delivered exactly once");
  assert(calls[0]?.kind === "synthetic", "the question is a synthetic note, not a queued user turn");
  assert(calls[0]?.text.startsWith(`${ASK_MARKER}\n`) === true, "the question carries the ask marker");
  assert(
    calls[0]?.text.includes("Approve the deployment?") === true,
    "the question text actually reaches the user",
  );
}

async function rateLimitNoticesReachTheTranscript(directory: string): Promise<void> {
  const calls: SessionCall[] = [];
  const input = buildPluginInput(shimContext(calls, directory));
  const timers = new TimerManager();
  const tawaCtx = {
    configManager: { config: { rateLimits: { apiRetryMax: 1, apiRetryBaseMs: 3_600_000 } } },
    timerManager: timers,
  } as unknown as TawassulContext;
  const sessionID = `ses-e33-${Date.now()}`;
  clearRateLimitRetry(sessionID);
  try {
    const retried = await handleRateLimitError(input, tawaCtx, sessionID, "429 Too Many Requests");
    assert(retried === true, "a rate-limited session is still scheduled for retry");
    assert(calls.length === 1, "the retry notice is delivered once");
    assert(calls[0]?.kind === "synthetic", "the retry notice reaches the transcript instead of a fake toast");
    assert(
      calls[0]?.text.includes("Rate limit hit") === true,
      "the retry notice tells the user the retry is happening",
    );

    const exhausted = await handleRateLimitError(input, tawaCtx, sessionID, "429 Too Many Requests");
    assert(exhausted === false, "an exhausted retry budget still stops the automatic retry");
    assert(calls.length === 2, "the exhaustion notice is delivered once");
    assert(
      calls[1]?.kind === "synthetic" && calls[1]?.text.includes("automatic retry stopped") === true,
      "the exhaustion notice tells the user that the retry stopped",
    );
    assert(
      calls.every((call) => call.kind === "synthetic"),
      "neither rate-limit notice queues a user turn",
    );
  } finally {
    timers.dispose();
    clearRateLimitRetry(sessionID);
  }
}

async function undeliveredNoticeIsReported(directory: string): Promise<void> {
  const bare: PluginInput = { client: {}, directory, worktree: directory };
  assert(
    (await notifySession(bare, "ses-e33-bare", "notice")) === false,
    "a missing transcript bridge reports the notice as undelivered instead of pretending",
  );
}

function serverUrlComesFromTheHost(): void {
  assert(resolveV2ServerUrl({}) === undefined, "no host port means no invented server URL");
  assert(
    resolveV2ServerUrl({ OPENCODE_SERVER_PORT: "4321" }) === "http://localhost:4321",
    "the host server port becomes a server URL",
  );
  assert(
    resolveV2ServerUrl({ OPENCODE_PORT: "4321" }) === "http://localhost:4321",
    "the legacy port name is honored",
  );
  assert(resolveV2ServerUrl({ OPENCODE_SERVER_PORT: "0" }) === undefined, "a zero port is rejected");
  assert(resolveV2ServerUrl({ OPENCODE_SERVER_PORT: "70000" }) === undefined, "an out-of-range port is rejected");
  assert(
    resolveV2ServerUrl({ OPENCODE_SERVER_PORT: "http://host:4321" }) === undefined,
    "a non-numeric port is rejected instead of guessed",
  );

  const saved = process.env.OPENCODE_SERVER_PORT;
  process.env.OPENCODE_SERVER_PORT = "4567";
  try {
    const input = buildPluginInput(shimContext([], process.cwd()));
    assert(input.serverUrl === "http://localhost:4567", "the plugin input carries the host URL instead of undefined");
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_SERVER_PORT;
    else process.env.OPENCODE_SERVER_PORT = saved;
  }
}

async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), "tawassul-e33-"));
  try {
    shimAdvertisesOnlyRealCapabilities(work);
    rendererHasNoSilentFallback();
    await questionReachesTheTranscript(work);
    await rateLimitNoticesReachTheTranscript(work);
    await undeliveredNoticeIsReported(work);
    serverUrlComesFromTheHost();
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

try {
  await main();
  console.log(
    `PROOF PASS: the v2 shim advertises only reachable capabilities, notices reach the transcript, and the host URL is kept (${passed} assertions)`,
  );
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
