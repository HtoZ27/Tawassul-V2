import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SHADOW_DISPATCH_TOOLS,
  SHADOW_ECHO_MIN_CHARS,
  SHADOW_ECHO_OVERLAP,
  SHADOW_ECHO_TRIP_TURNS,
  SHADOW_FANOUT_OVERLAP,
  SHADOW_FANOUT_TRIP_COUNT,
  SHADOW_FANOUT_WINDOW_MS,
  SHADOW_REPEAT_TRIP_AT,
  SHADOW_REPEAT_WARN_AT,
  UsageShadow,
  normalizeText,
  similarity,
  taskTextOf,
  type ShadowObservation,
} from "../src/services/usage-shadow.ts";
import { UsageLedger } from "../src/services/usage-ledger.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
  console.log(`ok ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) fail(`${message} (expected ${String(expected)}, got ${String(actual)})`);
  console.log(`ok ${message}`);
}

const base =
  "the quick brown fox jumps over the lazy dog while the calm river carries every autumn leaf toward the wide open sea and the distant hills stay quiet under a pale morning sky and the old stone road waits for travelers who never come";
const near = base.replace("quiet", "silent");
const unrelated =
  "database migrations require careful ordering because a failed rollback can leave the schema in a state that no later migration expects or repairs";

const work = mkdtempSync(join(tmpdir(), "tawassul-usage-shadow-"));
const clock = { value: 1_700_000_000_000 };
const now = (): number => clock.value;

try {
  equal(similarity(base, base), 1, "an identical text is fully similar");
  equal(similarity(base, unrelated), 0, "disjoint texts share no trigram");
  assert(similarity(base, near) >= SHADOW_FANOUT_OVERLAP, "a one-word edit stays above the overlap threshold");
  equal(similarity("Alpha, BETA!", "alpha beta"), 1, "case and punctuation do not change similarity");
  equal(similarity("yes", "yes"), 1, "a short identical text is fully similar");
  equal(similarity("yes", "no"), 0, "short disjoint texts are not similar");
  equal(similarity("", ""), 1, "two empty texts are equal");
  equal(similarity("", base), 0, "an empty text is not similar to a full text");
  equal(normalizeText("  Hello,   World  "), "hello world", "normalization collapses separators");
  equal(taskTextOf({ task: "  Fix   the bug " }), "fix the bug", "task text normalizes whitespace");
  equal(taskTextOf({ prompt: "Prompt text" }), "prompt text", "prompt is a fallback");
  equal(taskTextOf({ description: "Short description" }), "short description", "description is a fallback");
  equal(taskTextOf({ task: "first", prompt: "second" }), "first", "task wins over prompt");
  equal(taskTextOf({ task: 42 }), "", "a non-string task is ignored");
  equal(taskTextOf(undefined), "", "absent args produce no text");
  assert(SHADOW_DISPATCH_TOOLS.includes("task"), "task is a dispatch tool");
  assert(SHADOW_DISPATCH_TOOLS.includes("handoff"), "handoff is a dispatch tool");
  assert(SHADOW_DISPATCH_TOOLS.includes("fasttrack"), "fasttrack is a dispatch tool");
  equal(SHADOW_REPEAT_WARN_AT, 3, "the balanced repeat warning is 3");
  equal(SHADOW_REPEAT_TRIP_AT, 5, "the balanced repeat trip is 5");
  equal(SHADOW_ECHO_TRIP_TURNS, 12, "the balanced echo trip is 12 turns");
  equal(SHADOW_ECHO_MIN_CHARS, 200, "a turn must reach 200 characters before it counts");
  equal(SHADOW_FANOUT_TRIP_COUNT, 6, "the balanced fan-out trip is 6");
  equal(SHADOW_FANOUT_WINDOW_MS, 600000, "the fan-out window is 10 minutes");
  equal(SHADOW_ECHO_OVERLAP, 0.8, "the balanced overlap is 80 percent");

  const repeatRows: ShadowObservation[] = [];
  const repeatShadow = new UsageShadow({ emit: (row) => repeatRows.push(row), now });
  equal(
    repeatShadow.observeRepeat({ sessionID: "s1", agent: "dev", tool: "bash", count: 1, success: true }),
    undefined,
    "a first call is not a repeat",
  );
  equal(
    repeatShadow.observeRepeat({ sessionID: "s1", agent: "dev", tool: "bash", count: 2, success: true }),
    undefined,
    "a second call is not a repeat",
  );
  const warn = repeatShadow.observeRepeat({ sessionID: "s1", agent: "dev", tool: "bash", count: 3, success: true });
  equal(warn?.tripped, false, "the third identical call is a shadow warning");
  equal(warn?.count, 3, "the warning carries the repeat count");
  equal(warn?.detail.tool, "bash", "the warning names the tool");
  equal(warn?.detail.agentMissing, false, "a present agent is recorded");
  equal(
    repeatShadow.observeRepeat({ sessionID: "s1", agent: "dev", tool: "bash", count: 4, success: true }),
    undefined,
    "the fourth call adds no row",
  );
  const trip = repeatShadow.observeRepeat({ sessionID: "s1", agent: "dev", tool: "bash", count: 5, success: true });
  equal(trip?.tripped, true, "the fifth identical call trips the shadow repeat");
  equal(trip?.count, 5, "the trip carries the count");
  equal(
    repeatShadow.observeRepeat({ sessionID: "s1", agent: "dev", tool: "bash", count: 6, success: true }),
    undefined,
    "a sixth call adds no second trip",
  );
  const otherTool = repeatShadow.observeRepeat({ sessionID: "s1", agent: "dev", tool: "grep", count: 3, success: true });
  equal(otherTool?.tripped, false, "a different tool has its own repeat state");
  equal(
    repeatShadow.observeRepeat({ sessionID: "s1", agent: "dev", tool: "read", count: 9, success: false }),
    undefined,
    "a failed call is not counted",
  );
  equal(
    repeatShadow.observeRepeat({ sessionID: "", agent: "dev", tool: "read", count: 9, success: true }),
    undefined,
    "a repeat without a session is ignored",
  );
  equal(
    repeatShadow.observeRepeat({ sessionID: "s1", tool: "glob", count: 3, success: true })?.detail.agentMissing,
    true,
    "a missing agent is labelled",
  );

  const echoRows: ShadowObservation[] = [];
  const echoShadow = new UsageShadow({ emit: (row) => echoRows.push(row), now });
  const drive = (shadow: UsageShadow, sessionID: string, id: string, text: string, tool = false): void => {
    if (tool) shadow.handleEvent({ type: "session.tool.called", data: { sessionID, assistantMessageID: id } });
    shadow.handleEvent({ type: "session.text.ended", data: { sessionID, assistantMessageID: id, text } });
    shadow.handleEvent({ type: "session.usage.updated", data: { sessionID } });
  };
  const turn = (sessionID: string, id: string, text: string, tool = false): void =>
    drive(echoShadow, sessionID, id, text, tool);
  assert(!echoShadow.handleEvent(null), "a non-object event is ignored");
  assert(!echoShadow.handleEvent({ type: "session.text.ended", data: {} }), "a text event without a session is ignored");
  assert(
    !echoShadow.handleEvent({ type: "session.text.ended", data: { sessionID: "s", assistantMessageID: "m", text: "  " } }),
    "blank text is ignored",
  );
  assert(!echoShadow.handleEvent({ type: "session.idle", data: { sessionID: "s" } }), "an unrelated event is ignored");
  for (let turnIndex = 1; turnIndex <= 11; turnIndex += 1) turn("echo", `m${turnIndex}`, base);
  equal(echoRows.length, 0, "eleven identical no-tool turns do not trip");
  turn("echo", "m12", base);
  equal(echoRows.length, 1, "the twelfth identical no-tool turn trips");
  equal(echoRows[0]?.detector, "echo", "the echo row names its detector");
  equal(echoRows[0]?.count, 12, "the echo row carries the streak length");
  equal(echoRows[0]?.tripped, true, "the echo row is a trip");
  turn("echo", "m13", base);
  equal(echoRows.length, 1, "a longer streak does not duplicate the trip");
  turn("echo", "tool12", base, true);
  for (let turnIndex = 1; turnIndex <= 11; turnIndex += 1) turn("echo", `r${turnIndex}`, base);
  equal(echoRows.length, 1, "a tool turn resets the echo streak");
  turn("echo", "r12", base);
  equal(echoRows.length, 2, "a fresh streak trips again");
  for (let turnIndex = 0; turnIndex < 20; turnIndex += 1) {
    turn("alternating", `a${turnIndex}`, turnIndex % 2 === 0 ? base : unrelated);
  }
  equal(echoRows.length, 2, "low overlap does not trip the echo detector");
  turn("parts", "p1", base);
  echoShadow.handleEvent({ type: "session.text.ended", data: { sessionID: "parts", assistantMessageID: "p1", text: near } });
  echoShadow.handleEvent({ type: "session.text.ended", data: { sessionID: "parts", assistantMessageID: "p1", text: near } });
  echoShadow.handleEvent({ type: "session.usage.updated", data: { sessionID: "parts" } });
  for (let turnIndex = 2; turnIndex <= 10; turnIndex += 1) turn("parts", `p${turnIndex}`, near);
  equal(echoRows.length, 2, "replaced text parts count once per message");
  turn("parts", "p11", near);
  equal(echoRows.length, 3, "the replaced part counts toward the trip");
  const nearTrip = echoRows[2];
  assert(typeof nearTrip?.detail.similarity === "number", "the echo row records the similarity");
  equal(echoRows[0]?.detail.chars, base.length, "the echo row records the text length");
  equal(echoRows[0]?.detail.minChars, SHADOW_ECHO_MIN_CHARS, "the echo row records the minimum length");

  const shortRows: ShadowObservation[] = [];
  const shortShadow = new UsageShadow({ emit: (row) => shortRows.push(row), now });
  for (let turnIndex = 1; turnIndex <= 50; turnIndex += 1) {
    drive(shortShadow, "short", `s${turnIndex}`, "done");
  }
  equal(shortRows.length, 0, "fifty identical short replies never trip the echo detector");

  const lengthRows: ShadowObservation[] = [];
  const lengthShadow = new UsageShadow({ emit: (row) => lengthRows.push(row), now });
  for (let turnIndex = 1; turnIndex <= 11; turnIndex += 1) {
    drive(lengthShadow, "len", `l${turnIndex}`, base);
  }
  drive(lengthShadow, "len", "l12", "done");
  equal(lengthRows.length, 0, "a short turn does not count toward the streak");
  for (let turnIndex = 1; turnIndex <= 11; turnIndex += 1) {
    drive(lengthShadow, "len", `la${turnIndex}`, base);
  }
  equal(lengthRows.length, 0, "eleven long turns after a short turn stay below the trip");
  drive(lengthShadow, "len", "la12", base);
  equal(lengthRows.length, 1, "the short turn broke the consecutive run");

  const toolRows: ShadowObservation[] = [];
  const toolShadow = new UsageShadow({ emit: (row) => toolRows.push(row), now });
  for (let turnIndex = 1; turnIndex <= 11; turnIndex += 1) {
    drive(toolShadow, "tool", `t${turnIndex}`, base);
  }
  drive(toolShadow, "tool", "t12", "done", true);
  equal(toolRows.length, 0, "a tool turn with a short text does not count");
  for (let turnIndex = 1; turnIndex <= 11; turnIndex += 1) {
    drive(toolShadow, "tool", `ta${turnIndex}`, base);
  }
  equal(toolRows.length, 0, "a tool turn resets the streak even when its text is short");
  drive(toolShadow, "tool", "ta12", base);
  equal(toolRows.length, 1, "a fresh run after a short tool turn trips");

  const toolOnlyRows: ShadowObservation[] = [];
  const toolOnlyShadow = new UsageShadow({ emit: (row) => toolOnlyRows.push(row), now });
  for (let turnIndex = 1; turnIndex <= 11; turnIndex += 1) {
    drive(toolOnlyShadow, "tool-only", `o${turnIndex}`, base);
  }
  toolOnlyShadow.handleEvent({ type: "session.tool.called", data: { sessionID: "tool-only", assistantMessageID: "o-tool" } });
  toolOnlyShadow.handleEvent({ type: "session.usage.updated", data: { sessionID: "tool-only" } });
  for (let turnIndex = 1; turnIndex <= 11; turnIndex += 1) {
    drive(toolOnlyShadow, "tool-only", `p${turnIndex}`, base);
  }
  equal(toolOnlyRows.length, 0, "a tool-only message breaks the streak without adding a text turn");
  drive(toolOnlyShadow, "tool-only", "p12", base);
  equal(toolOnlyRows.length, 1, "a fresh run after a tool-only message trips");

  const boundaryRows: ShadowObservation[] = [];
  const boundaryShadow = new UsageShadow({ emit: (row) => boundaryRows.push(row), now });
  const exact = base.slice(0, SHADOW_ECHO_MIN_CHARS);
  for (let turnIndex = 1; turnIndex <= 11; turnIndex += 1) {
    drive(boundaryShadow, "boundary", `b${turnIndex}`, exact);
  }
  equal(boundaryRows.length, 0, "eleven turns at exactly the minimum do not trip");
  drive(boundaryShadow, "boundary", "b12", exact);
  equal(boundaryRows.length, 1, "a turn at exactly the minimum is counted");
  equal(exact.length, SHADOW_ECHO_MIN_CHARS, "the boundary text is exactly 200 characters");

  const belowRows: ShadowObservation[] = [];
  const belowShadow = new UsageShadow({ emit: (row) => belowRows.push(row), now });
  const below = base.slice(0, SHADOW_ECHO_MIN_CHARS - 1);
  for (let turnIndex = 1; turnIndex <= 30; turnIndex += 1) {
    drive(belowShadow, "below", `c${turnIndex}`, below);
  }
  equal(belowRows.length, 0, "thirty turns one character below the minimum never trip");
  equal(below.length, SHADOW_ECHO_MIN_CHARS - 1, "the below-boundary text is one character short");

  const fanRows: ShadowObservation[] = [];
  const fanShadow = new UsageShadow({ emit: (row) => fanRows.push(row), now });
  for (let call = 1; call <= 5; call += 1) {
    fanShadow.observeDispatch({ sessionID: "fan", tool: "task", args: { task: base } });
  }
  equal(fanRows.length, 0, "five duplicate dispatches do not trip");
  const fanTrip = fanShadow.observeDispatch({ sessionID: "fan", tool: "task", args: { task: near } });
  equal(fanTrip?.tripped, true, "the sixth near-duplicate dispatch trips");
  equal(fanTrip?.count, 6, "the fan-out row carries the cluster size");
  equal(
    fanShadow.observeDispatch({ sessionID: "fan", tool: "task", args: { task: base } })?.count,
    undefined,
    "a seventh dispatch adds no second trip",
  );
  equal(
    fanShadow.fanoutBlocked({ sessionID: "fan", tool: "task", args: { task: base } })?.count,
    7,
    "the enforcement check sees the tripped cluster after the seventh dispatch",
  );
  equal(
    fanShadow.fanoutBlocked({ sessionID: "fan", tool: "task", args: { task: unrelated } }),
    undefined,
    "the enforcement check ignores a dissimilar task",
  );
  equal(
    fanShadow.fanoutBlocked({ sessionID: "fan", tool: "read", args: { task: base } }),
    undefined,
    "the enforcement check ignores a non-dispatch tool",
  );
  equal(
    fanShadow.observeDispatch({ sessionID: "fan", tool: "read", args: { task: base } }),
    undefined,
    "a non-dispatch tool is ignored",
  );
  equal(
    fanShadow.observeDispatch({ sessionID: "fan", tool: "task", args: { task: "   " } }),
    undefined,
    "blank dispatch text is ignored",
  );
  for (let call = 1; call <= 5; call += 1) {
    fanShadow.observeDispatch({ sessionID: "distinct", tool: "task", args: { task: `${base} variant ${call}` } });
  }
  equal(fanRows.length, 1, "five distinct dispatches do not trip");
  clock.value += SHADOW_FANOUT_WINDOW_MS + 1;
  equal(
    fanShadow.fanoutBlocked({ sessionID: "fan", tool: "task", args: { task: base } }),
    undefined,
    "the enforcement check forgets an expired cluster",
  );
  for (let call = 1; call <= 5; call += 1) {
    fanShadow.observeDispatch({ sessionID: "fan", tool: "task", args: { task: base } });
  }
  equal(fanRows.length, 1, "an expired window starts a new cluster");
  const windowTrip = fanShadow.observeDispatch({ sessionID: "fan", tool: "task", args: { task: base } });
  equal(windowTrip?.tripped, true, "the new cluster trips inside its own window");
  equal(
    fanShadow.observeDispatch({ sessionID: "other", tool: "handoff", args: { prompt: base } })?.detector,
    undefined,
    "a first dispatch in another session does not trip",
  );
  for (let call = 2; call <= 6; call += 1) {
    fanShadow.observeDispatch({ sessionID: "other", tool: "handoff", args: { prompt: base } });
  }
  equal(fanRows.length, 3, "another session keeps an independent fan-out cluster");

  const ledgerPath = join(work, "shadow.jsonl");
  const observations: ShadowObservation[] = [];
  const ledger = new UsageLedger({ path: ledgerPath, now });
  const bridge = new UsageShadow({
    emit: (row) => {
      observations.push(row);
      ledger.recordShadow(row);
    },
    now,
  });
  await ledger.start();
  for (let call = 1; call <= 5; call += 1) {
    bridge.observeRepeat({ sessionID: "ses-repeat", agent: "dev", tool: "bash", count: call >= 3 ? call : 0, success: true });
  }
  for (let call = 1; call <= 12; call += 1) {
    bridge.handleEvent({ type: "session.text.ended", data: { sessionID: "ses-echo", assistantMessageID: `e${call}`, text: base } });
    bridge.handleEvent({ type: "session.usage.updated", data: { sessionID: "ses-echo" } });
  }
  for (let call = 1; call <= 6; call += 1) {
    bridge.observeDispatch({ sessionID: "ses-fan", tool: "task", args: { task: base } });
  }
  await ledger.flush();
  const summary = ledger.summary();
  equal(summary.shadowRows, observations.length, "every shadow observation reaches the ledger");
  equal(summary.repeatSessions, 1, "the ledger counts one repeat session");
  equal(summary.echoSessions, 1, "the ledger counts one echo session");
  equal(summary.fanoutSessions, 1, "the ledger counts one fan-out session");
  const lines = readFileSync(ledgerPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { kind: string; detector?: string });
  assert(lines.some((line) => line.kind === "shadow" && line.detector === "echo"), "the echo row is persisted");
  await ledger.dispose();
  const reloaded = new UsageLedger({ path: ledgerPath, now });
  await reloaded.start();
  equal(reloaded.summary().shadowRows, summary.shadowRows, "reload restores shadow rows");
  equal(reloaded.summary().echoSessions, 1, "reload restores the echo session count");
  await reloaded.dispose();
  equal(observations.length, 4, "the integrated sink saw the repeat warning, repeat trip, echo, and fan-out");

  const repo = dirname(dirname(fileURLToPath(import.meta.url)));
  const setup = readFileSync(join(repo, "src", "v2", "setup.ts"), "utf8");
  assert(setup.includes("installUsageShadow"), "the v2 setup installs the shadow detectors");
  assert(setup.includes("usageShadow.handleEvent(raw)"), "the event relay feeds the shadow detectors");
  assert(setup.includes("clearUsageShadow"), "the v2 cleanup clears the shadow detectors");
  const toolExecute = readFileSync(join(repo, "src", "hooks", "tool-execute.ts"), "utf8");
  assert(toolExecute.includes("observeDispatch"), "the tool hook feeds the fan-out detector");
  assert(toolExecute.includes("observeRepeat"), "the tool hook feeds the repeat detector");
  const health = readFileSync(join(repo, "src", "tools", "tawa", "health.ts"), "utf8");
  assert(health.includes("Shadow: repeat"), "health reports the shadow readings");
  const plan = readFileSync(join(repo, "docs", "plan-token-burn-control.md"), "utf8");
  assert(plan.includes("### 17.8 P2 ledger shadow"), "the plan records the P2 status");

  console.log("PROOF PASS: shadow detectors cover repeat, echo, fan-out, ledger rows, reload, and wiring");
} finally {
  rmSync(work, { recursive: true, force: true });
}
