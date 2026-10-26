import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TawassulContext } from "../src/context.ts";
import { AskChannel, ASK_UNAVAILABLE, type AskKind } from "../src/services/ask-channel.ts";
import type { EffortAnalysis } from "../src/services/effort-analyzer.ts";
import { runElicitationGate } from "../src/services/elicitation-gate.ts";
import { TimerManager } from "../src/services/timer-manager.ts";
import type { ToolContext, ToolResult } from "../src/tool.ts";
import { buildKickTool } from "../src/tools/agent-management.ts";
import { buildReviewTool } from "../src/tools/misc-tools.ts";

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

const SELECT: AskKind = { type: "select", options: ["alpha", "beta"] };
const CONFIRM: AskKind = { type: "confirm", default: false };

type ChannelBundle = { channel: AskChannel; timers: TimerManager };

function makeChannel(opts: {
  maxPending?: number;
  maxPerSession?: number;
  sessionID?: string;
} = {}): ChannelBundle {
  const timers = new TimerManager();
  const channel = new AskChannel({
    sessionID: () => opts.sessionID ?? "sess-main",
    timers,
    blockingTimeoutMs: 5_000,
    maxPending: opts.maxPending,
    maxPerSession: opts.maxPerSession,
  });
  return { channel, timers };
}

function outputText(result: ToolResult): string {
  return typeof result === "string" ? result : result.output;
}

function toolContext(ask: ToolContext["ask"], agent = "tawa"): ToolContext {
  return {
    sessionID: "sess-e25",
    messageID: "msg-e25",
    agent,
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask,
  };
}

async function globalCapCase(): Promise<void> {
  const { channel, timers } = makeChannel({ maxPending: 1, maxPerSession: 4 });
  try {
    const first = channel.ask("Pick one", SELECT);
    const refused = await channel.ask("Pick another", SELECT);
    assert(refused === ASK_UNAVAILABLE, "a full channel refuses a new question instead of inventing an answer");
    assert(typeof refused === "symbol", "the refusal is a distinct sentinel, not an empty string or a default");
    assert(refused !== "" && refused !== false, "the refusal cannot pass for a real select or confirm answer");
    assert(channel.pendingCount === 1, "the refused question did not consume a slot");
    channel.onUserMessage("sess-main", "2");
    assert((await first) === "beta", "the queued question still resolves with the real user answer");
  } finally {
    channel.dispose();
    timers.dispose();
  }
}

async function perSessionCapCase(): Promise<void> {
  const { channel, timers } = makeChannel({ maxPending: 10, maxPerSession: 1 });
  try {
    const first = channel.ask("Pick one", SELECT);
    const refused = await channel.ask("Pick two", SELECT);
    assert(refused === ASK_UNAVAILABLE, "a second question in one session is refused at the per-session cap");
    const other = channel.askForSession("Pick three", SELECT, "sess-other");
    channel.onUserMessage("sess-other", "alpha");
    assert((await other) === "alpha", "another session still reaches the user past the per-session cap");
    channel.onUserMessage("sess-main", "beta");
    assert((await first) === "beta", "the first session keeps its own question");
  } finally {
    channel.dispose();
    timers.dispose();
  }
}

async function confirmCapCase(): Promise<void> {
  const { channel, timers } = makeChannel({ maxPending: 1 });
  try {
    const held = channel.askForSession("hold", SELECT, "sess-hold");
    const refused = await channel.ask("Approve the deletion?", CONFIRM);
    assert(refused === ASK_UNAVAILABLE, "an unavailable confirm ask is reported as unavailable");
    assert(refused !== false, "an unavailable confirm is not reported as a denial");
    assert(refused !== true, "an unavailable confirm is never reported as consent");
    channel.onUserMessage("sess-hold", "alpha");
    assert((await held) === "alpha", "the held question still resolves normally");
  } finally {
    channel.dispose();
    timers.dispose();
  }
}

async function disposedCase(): Promise<void> {
  const { channel, timers } = makeChannel();
  try {
    const pending = channel.ask("Pick one", SELECT);
    channel.dispose();
    assert(
      (await pending) === ASK_UNAVAILABLE,
      "disposing settles a pending question as unavailable instead of fabricating an answer",
    );
    assert(
      (await channel.ask("Pick two", SELECT)) === ASK_UNAVAILABLE,
      "a disposed channel refuses a new question instead of answering it",
    );
  } finally {
    timers.dispose();
  }
}

async function deferCapCase(): Promise<void> {
  const { channel, timers } = makeChannel({ maxPending: 1 });
  try {
    channel.askForSession("hold", SELECT, "sess-hold");
    assert(
      channel.deferConsent("Allow the command?", CONFIRM, "sess-tool") === undefined,
      "a deferred consent ask is refused at capacity rather than parked without a slot",
    );
    assert(
      channel.deferAskResolvable("Pick one", SELECT, "sess-main", () => undefined) === undefined,
      "a deferred elicitation is refused at capacity rather than parked without a slot",
    );
  } finally {
    channel.dispose();
    timers.dispose();
  }
}

async function elicitationCase(): Promise<void> {
  const analysis = { ambiguity: 1, action_hint: "fix the parser" } as unknown as EffortAnalysis;
  const result = await runElicitationGate(analysis, "fix the parser", {
    ask: async () => ASK_UNAVAILABLE,
  });
  assert(result.selected === false, "the elicitation gate never selects an option from a refused question");
  assert(
    result.selected === false && result.reason === "unavailable",
    "the elicitation gate reports the refused question as unavailable",
  );
}

async function reviewCases(): Promise<void> {
  const review = buildReviewTool();
  const args = { agents: ["dev"], summary: "refactored the parser" };

  const refused = outputText(await review.execute(args, toolContext(async () => ASK_UNAVAILABLE)));
  assert(refused.includes("could not reach the user"), "the review gate says the question could not be delivered");
  assert(!refused.includes("approved the implementation"), "a refused review question never approves the work");
  assert(!refused.includes("✅"), "a refused review question returns no success marker");

  const approved = outputText(await review.execute(args, toolContext(async () => true)));
  assert(approved.includes("User approved the implementation"), "a real yes still approves the work");

  const rejected = outputText(await review.execute(args, toolContext(async () => false)));
  assert(rejected.includes("User rejected the implementation"), "a real no still rejects the work");

  const dismissed = outputText(await review.execute(args, toolContext(async () => undefined)));
  assert(dismissed.includes("User rejected the implementation"), "a dismissed review question is treated as a rejection");
}

type KickChannelStub = {
  currentSessionOverride?: string;
  hasPending: (sessionID: string) => boolean;
  askForRoot: (title: string, kind: AskKind, sessionID: string) => Promise<unknown>;
};

function kickContext(channel: KickChannelStub, stateDir: string): TawassulContext {
  return {
    config: { team: [] },
    dynamicAgents: [],
    agentModelMap: {},
    stateDir,
    agentManager: { hasConfigAgent: () => false },
    askChannelInstance: channel,
    saveState: () => undefined,
    modelManager: { markModelFailed: () => undefined },
  } as unknown as TawassulContext;
}

async function kickCases(stateDir: string): Promise<void> {
  const args = { agent: "ghost-one ghost-two with model zeta from nowhere" };

  const refusedKick = buildKickTool(
    kickContext(
      { hasPending: () => false, askForRoot: async () => ASK_UNAVAILABLE },
      stateDir,
    ),
  );
  const refused = outputText(await refusedKick.execute(args, toolContext(undefined, "")));
  assert(
    refused.includes("Bulk deletion requires confirmation"),
    "a bulk deletion whose question was refused reports the question as undelivered",
  );
  assert(!refused.includes("agents removed"), "a refused bulk question removes nothing");

  const cancelledKick = buildKickTool(
    kickContext({ hasPending: () => false, askForRoot: async () => false }, stateDir),
  );
  const cancelled = outputText(await cancelledKick.execute(args, toolContext(undefined, "")));
  assert(cancelled.includes("Deletion cancelled"), "a real no still cancels the deletion");

  const approvedKick = buildKickTool(
    kickContext({ hasPending: () => false, askForRoot: async () => true }, stateDir),
  );
  const approved = outputText(await approvedKick.execute(args, toolContext(undefined, "")));
  assert(approved.includes("Not found"), "a real yes proceeds to the removal pass");
  assert(!approved.includes("agents removed"), "the removal pass finds nothing to remove in the fixture");
}

async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), "tawassul-e25-"));
  try {
    await globalCapCase();
    await perSessionCapCase();
    await confirmCapCase();
    await disposedCase();
    await deferCapCase();
    await elicitationCase();
    await reviewCases();
    await kickCases(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

try {
  await main();
  console.log(
    `PROOF PASS: the ask channel refuses instead of fabricating answers and every caller fails closed (${passed} assertions)`,
  );
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
