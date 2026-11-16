import {
  SHADOW_ECHO_MIN_CHARS,
  UsageShadow,
  type ShadowObservation,
} from "../../../src/services/usage-shadow.ts";
import {
  computeBudget,
  resolveModelWindow,
  resolveReserve,
} from "../../../src/services/context-pack/accounting.ts";
import {
  DEFAULT_CONTEXT_WINDOW,
  WINDOW_SANITY_FLOOR,
} from "../../../src/services/context-pack/types.ts";

function fail(message: string): never {
  console.error(`RECEIPT FAIL: ${message}`);
  process.exit(1);
}

function eq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) fail(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

function assert(condition: unknown, label: string): void {
  if (!condition) fail(label);
}

const longText =
  "the quick brown fox jumps over the lazy dog while the calm river carries every autumn leaf toward the wide open sea and the distant hills stay quiet under a pale morning sky and the old stone road waits for travelers who never come";
const exact = longText.slice(0, SHADOW_ECHO_MIN_CHARS);
const below = longText.slice(0, SHADOW_ECHO_MIN_CHARS - 1);

function runEcho(turns: Array<{ text: string; tool?: boolean }>): ShadowObservation[] {
  const rows: ShadowObservation[] = [];
  const shadow = new UsageShadow({ emit: (row) => rows.push(row) });
  turns.forEach((turn, index) => {
    const id = `m${index}`;
    if (turn.tool) shadow.handleEvent({ type: "session.tool.called", data: { sessionID: "receipt", assistantMessageID: id } });
    shadow.handleEvent({ type: "session.text.ended", data: { sessionID: "receipt", assistantMessageID: id, text: turn.text } });
    shadow.handleEvent({ type: "session.usage.updated", data: { sessionID: "receipt" } });
  });
  return rows;
}

eq(SHADOW_ECHO_MIN_CHARS, 200, "the echo minimum is 200 characters");
assert(exact.length === SHADOW_ECHO_MIN_CHARS, "the boundary text is exactly 200 characters");
assert(below.length === SHADOW_ECHO_MIN_CHARS - 1, "the below-boundary text is 199 characters");

const shortOnly = runEcho(Array.from({ length: 40 }, () => ({ text: "ok" })));
eq(shortOnly.length, 0, "forty identical short replies never trip");

const exactRun = runEcho(Array.from({ length: 12 }, () => ({ text: exact })));
eq(exactRun.length, 1, "twelve 200-character turns trip");
eq(exactRun[0]?.count, 12, "the trip carries the 12-turn streak");
eq(exactRun[0]?.detail.chars, SHADOW_ECHO_MIN_CHARS, "the trip records the text length");
eq(exactRun[0]?.detail.minChars, SHADOW_ECHO_MIN_CHARS, "the trip records the minimum length");

const belowRun = runEcho(Array.from({ length: 30 }, () => ({ text: below })));
eq(belowRun.length, 0, "thirty 199-character turns never trip");

const broken = [
  ...Array.from({ length: 11 }, () => ({ text: longText })),
  { text: "done" },
  ...Array.from({ length: 11 }, () => ({ text: longText })),
];
const brokenRun = runEcho(broken);
eq(brokenRun.length, 0, "a short turn breaks the consecutive run");
const afterBreak = runEcho([...broken, { text: longText }]);
eq(afterBreak.length, 1, "the run restarts after the short turn and trips at its twelfth turn");

const toolShort = [
  ...Array.from({ length: 11 }, () => ({ text: longText })),
  { text: "done", tool: true },
];
const toolRun = runEcho(toolShort);
eq(toolRun.length, 0, "a short tool turn does not count");
const toolAfter = runEcho([...toolShort, ...Array.from({ length: 12 }, () => ({ text: longText }))]);
eq(toolAfter.length, 1, "a tool turn resets before the length check and a fresh run trips");

const windows = [
  { label: "unknown model", input: {}, expected: DEFAULT_CONTEXT_WINDOW },
  { label: "host 96k", input: { limitContext: 96000 }, expected: 96000 },
  { label: "host 200k", input: { limitContext: 200000 }, expected: 200000 },
  { label: "host 1M", input: { limitContext: 1000000 }, expected: 1000000 },
  { label: "host 12M", input: { limitContext: 12000000 }, expected: 12000000 },
  { label: "host below floor", input: { limitContext: WINDOW_SANITY_FLOOR - 1 }, expected: DEFAULT_CONTEXT_WINDOW },
  { label: "host at floor", input: { limitContext: WINDOW_SANITY_FLOOR }, expected: WINDOW_SANITY_FLOOR },
  { label: "fractional host", input: { limitContext: 2500.7 }, expected: 2500 },
  { label: "string host", input: { limitContext: "200000" }, expected: DEFAULT_CONTEXT_WINDOW },
  { label: "negative host", input: { limitContext: -1 }, expected: DEFAULT_CONTEXT_WINDOW },
  {
    label: "catalog fill",
    input: { providerID: "deepseek", modelID: "deepseek-chat" },
    expected: 64000,
  },
  {
    label: "host over catalog",
    input: { providerID: "opencode", modelID: "deepseek-v4.1-flash-free", limitContext: 1000000 },
    expected: 1000000,
  },
];
for (const entry of windows) {
  const actual = resolveModelWindow(entry.input);
  eq(actual, entry.expected, entry.label);
  console.log(`window ${entry.label}: ${actual}`);
}

eq(resolveReserve(DEFAULT_CONTEXT_WINDOW), 50000, "the reserve at 200k is 50k");
eq(resolveReserve(0), 50000, "a non-positive window uses the default reserve");
assert(!computeBudget(1000000, 100000).overflow, "a 1M host window with 100k of history fits");
assert(computeBudget(128000, 100000).overflow, "the old 128k clamp overflows at the same history");

console.log(`short replies: ${shortOnly.length} rows`);
console.log(`200-character run: ${exactRun.length} row at turn ${exactRun[0]?.count}`);
console.log(`199-character run: ${belowRun.length} rows`);
console.log(`broken run: ${brokenRun.length} rows, after restart: ${afterBreak.length} row`);
console.log(`short tool turn: ${toolRun.length} rows, after restart: ${toolAfter.length} row`);
console.log("RECEIPT PASS: echo counts only 200-character turns and the window trusts the host verbatim");
