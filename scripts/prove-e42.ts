import assert from "node:assert/strict";
import { toV2Result } from "../src/v2/adapters.ts";
import {
  applyV1AfterOutput,
  jsonSafeMetadata,
  jsonSafeValue,
  V1_TITLE_KEY,
  withTitleMetadata,
} from "../src/v2/result-bridge.ts";

let passed = 0;

function check(condition: unknown, name: string): void {
  if (!condition) {
    console.error(`PROOF FAIL: ${name}`);
    process.exitCode = 1;
    throw new Error(name);
  }
  passed += 1;
  console.log(`ok ${name}`);
}

function isJsonSafe(value: unknown, seen?: WeakSet<object>): boolean {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return true;
  if (kind === "number") return Number.isFinite(value as number);
  if (kind === "undefined" || kind === "function" || kind === "symbol" || kind === "bigint") {
    return false;
  }
  if (kind !== "object") return false;
  const object = value as object;
  if (object instanceof Date) return !Number.isNaN(object.getTime());
  const visited = seen ?? new WeakSet<object>();
  if (visited.has(object)) return false;
  visited.add(object);
  const ok = Array.isArray(object)
    ? object.every((item) => isJsonSafe(item, visited))
    : Object.values(object as Record<string, unknown>).every((item) => isJsonSafe(item, visited));
  visited.delete(object);
  return ok;
}

function roundTripEquals(value: Record<string, unknown>): boolean {
  try {
    const parsed = JSON.parse(JSON.stringify(value)) as unknown;
    assert.deepStrictEqual(parsed, value);
    return true;
  } catch {
    return false;
  }
}

const freshEntry = {
  id: "H-901",
  from: "build",
  to: "dev",
  task: "Probe the handoff result bridge",
  context: "A fresh handoff entry carries optional fields before any save.",
  files: [],
  checkpoint: undefined,
  timestamp: "2026-10-27T10:30:00.000Z",
  status: "pending",
  decisionRuleId: undefined,
  decision: {
    action: "allow",
    reason: "Default allow",
    confidence: 0.6,
    metadata: { ruleId: "DEFAULT-001", classifier: { action: "allow", confidence: 0.5 } },
  },
};

const rawMetadata = {
  handoff: freshEntry,
  feedback: [],
  helpRequest: false,
};

check(!isJsonSafe(rawMetadata), "a fresh handoff metadata value is not JSON-safe");
check(Object.prototype.hasOwnProperty.call(freshEntry, "checkpoint"), "the fresh entry carries an undefined checkpoint key");
check(Object.prototype.hasOwnProperty.call(freshEntry, "decisionRuleId"), "the fresh entry carries an undefined decisionRuleId key");

check(jsonSafeValue("text") === "text", "a string survives sanitizing");
check(jsonSafeValue(3) === 3, "a finite number survives sanitizing");
check(jsonSafeValue(null) === null, "null survives sanitizing");
check(jsonSafeValue(undefined) === undefined, "undefined sanitizes to nothing");
check(jsonSafeValue(() => 1) === undefined, "a function sanitizes to nothing");
check(jsonSafeValue(Symbol("x")) === undefined, "a symbol sanitizes to nothing");
check(jsonSafeValue(Number.NaN) === null, "NaN sanitizes to null");
check(jsonSafeValue(Number.POSITIVE_INFINITY) === null, "Infinity sanitizes to null");
check(jsonSafeValue(12n) === "12", "a bigint sanitizes to a string");
check(jsonSafeValue(new Date("2026-10-27T00:00:00.000Z")) === "2026-10-27T00:00:00.000Z", "a date sanitizes to an ISO string");

const dropped = jsonSafeMetadata({ keep: 1, drop: undefined }) as Record<string, unknown>;
check(Object.keys(dropped).length === 1 && dropped.keep === 1, "sanitizing drops undefined object keys");
check(jsonSafeMetadata({ drop: undefined }) === undefined, "an entirely undefined metadata object becomes absent");
check(jsonSafeMetadata(undefined) === undefined, "missing metadata stays absent");

const arrayValue = jsonSafeValue([1, undefined, () => 1, 2]) as unknown[];
check(arrayValue.length === 4 && arrayValue[1] === null && arrayValue[2] === null, "undefined array slots become null");

const cyclic: Record<string, unknown> = { name: "loop" };
cyclic.self = cyclic;
const cyclicSafe = jsonSafeValue(cyclic) as Record<string, unknown>;
check(cyclicSafe.name === "loop" && cyclicSafe.self === undefined, "a cycle is dropped instead of throwing");

const nested = jsonSafeMetadata({
  outer: { inner: undefined, keep: "yes", list: [{ gone: undefined, stay: 2 }] },
}) as Record<string, unknown>;
const outer = nested.outer as Record<string, unknown>;
const list = outer.list as Array<Record<string, unknown>>;
check(outer.keep === "yes" && !("inner" in outer), "nested undefined keys are dropped");
check(list[0]?.stay === 2 && !(list[0] && "gone" in list[0]), "nested array objects are sanitized");

const before = structuredClone(rawMetadata);
const sanitized = jsonSafeMetadata(rawMetadata) as Record<string, unknown>;
check(isJsonSafe(sanitized), "sanitized handoff metadata is JSON-safe");
check(roundTripEquals(sanitized), "sanitized handoff metadata survives a JSON round trip");
assert.deepStrictEqual(rawMetadata, before);
check(true, "sanitizing does not mutate the input metadata");
const sanitizedEntry = sanitized.handoff as Record<string, unknown>;
check(!("checkpoint" in sanitizedEntry), "the sanitized entry drops the undefined checkpoint");
check(!("decisionRuleId" in sanitizedEntry), "the sanitized entry drops the undefined decisionRuleId");
check((sanitizedEntry.decision as Record<string, unknown>).metadata !== undefined, "the sanitized entry keeps the rule decision");

const result = toV2Result({
  title: "🤝 H-901: build → dev",
  output: "## 🤝 Handoff H-901",
  metadata: rawMetadata,
}) as { content: Array<{ text: string }>; metadata?: Record<string, unknown> };
check(Array.isArray(result.content) && result.content[0]?.text === "## 🤝 Handoff H-901", "a handoff result keeps its content text");
check(typeof result.metadata === "object" && result.metadata !== undefined, "a handoff result keeps its metadata");
const resultMetadata = result.metadata as Record<string, unknown>;
check(isJsonSafe(resultMetadata), "the tool result metadata is JSON-safe");
check(roundTripEquals(resultMetadata), "the tool result metadata survives a JSON round trip");
check(resultMetadata[V1_TITLE_KEY] === "🤝 H-901: build → dev", "the tool result keeps the title metadata");

const metadataOnly = toV2Result({
  output: "done",
  metadata: { checkpoint: undefined, note: undefined },
}) as { metadata?: Record<string, unknown> };
check(metadataOnly.metadata === undefined, "a result whose metadata is all undefined exposes no metadata");

const stringResult = toV2Result("plain text") as { content: Array<{ text: string }> };
check(stringResult.content[0]?.text === "plain text", "a string result stays a text content part");

const afterResult = {
  content: [{ type: "text" as const, text: "before" }],
  metadata: withTitleMetadata({ handoff: freshEntry }, "old title"),
};
applyV1AfterOutput(
  afterResult,
  "before",
  afterResult.metadata,
  {
    title: "new title",
    output: "after",
    metadata: { status: "completed", extra: undefined, handoff: freshEntry },
  },
  false,
);
check(afterResult.content[0]?.text === "after", "the after hook still writes back new text");
check(isJsonSafe(afterResult.metadata), "the after hook keeps metadata JSON-safe");
check(afterResult.metadata?.[V1_TITLE_KEY] === "new title", "the after hook keeps the rewritten title");

const errorMetadata = jsonSafeMetadata(withTitleMetadata({ status: "error", detail: undefined }, "failed"));
check(errorMetadata !== undefined && isJsonSafe(errorMetadata), "an error metadata write-back is JSON-safe");
check(errorMetadata?.status === "error" && !("detail" in (errorMetadata ?? {})), "an error metadata write-back drops undefined details");

console.log(`PROOF PASS: tool result metadata is JSON-safe for the host encoder (${passed} assertions)`);
