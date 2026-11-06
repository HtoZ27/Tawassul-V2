import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configLoadConfig } from "../src/context/facades/config-facade.ts";
import { configSchema } from "../src/context/config-schema.ts";
import { callDepthGuard } from "../src/hooks/guards/dispatch-guards.ts";
import {
  HOST_CALL_DEPTH_CEILING,
  MAX_CALL_DEPTH,
  MAX_TOTAL_TASKS,
  resolveMaxCallDepth,
  setMaxCallDepth,
  setMaxTotalTasks,
} from "../src/hooks/guards/shared/limits.ts";
import { PipelineState } from "../src/hooks/PipelineState.ts";
import { checkCap } from "../src/services/iteration-budget.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
  console.log(`ok ${message}`);
}

type Config = { maxCallDepth?: number; maxTotalTasks?: number };

function fakeCtx(config: Config) {
  return {
    configManager: { loadConfig: () => undefined, config },
    agentManager: {},
    preferenceManager: { setConfig: () => undefined },
    _configLoaded: false,
  };
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const session = "sess-call-depth-clamp";
const state = new PipelineState();
const ctx = { pipelineState: state } as never;

function appliedDepth(config: Config): { depth: number; logs: string[] } {
  const logs: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args.map((value) => String(value)).join(" "));
  };
  try {
    configLoadConfig(fakeCtx(config) as never);
  } finally {
    console.error = original;
  }
  return { depth: MAX_CALL_DEPTH, logs };
}

assert(HOST_CALL_DEPTH_CEILING === 3, "the host ceiling is 3");
assert(resolveMaxCallDepth(undefined) === undefined, "an absent request leaves the ceiling unchanged");
assert(resolveMaxCallDepth(0) === undefined, "zero is not a depth request");
assert(resolveMaxCallDepth(-1) === undefined, "a negative depth is not a request");
assert(resolveMaxCallDepth(Number.NaN) === undefined, "NaN is not a depth request");
assert(resolveMaxCallDepth(Number.POSITIVE_INFINITY) === undefined, "positive infinity is not a finite request");
assert(resolveMaxCallDepth(Number.NEGATIVE_INFINITY) === undefined, "negative infinity is not a request");
assert(resolveMaxCallDepth(21) === 3, "an out-of-range high request is bounded to 3");
assert(resolveMaxCallDepth(100) === 3, "an arbitrarily high request is bounded to 3");
assert(resolveMaxCallDepth(1.5) === 1.5, "a fractional request inside the ceiling is preserved");
assert(resolveMaxCallDepth(2.5) === 2.5, "a second fractional request inside the ceiling is preserved");
assert(resolveMaxCallDepth(3.5) === 3, "a fractional request above the ceiling is bounded to 3");

for (let knob = 1; knob <= 20; knob += 1) {
  const expected = Math.min(knob, 3);
  assert(resolveMaxCallDepth(knob) === expected, `the resolver maps knob ${knob} to ${expected}`);
  assert(configSchema.safeParse({ maxCallDepth: knob }).success, `the schema accepts knob ${knob}`);
}

assert(!configSchema.safeParse({ maxCallDepth: 0 }).success, "the schema rejects depth 0");
assert(!configSchema.safeParse({ maxCallDepth: 21 }).success, "the schema rejects depth 21");
assert(configSchema.safeParse({ maxCallDepth: 1.5 }).success, "the schema keeps the 1..20 numeric bound");

for (let knob = 1; knob <= 20; knob += 1) {
  const expected = Math.min(knob, 3);
  const result = appliedDepth({ maxCallDepth: knob });
  assert(result.depth === expected, `the load path applies ${expected} for knob ${knob}`);
  if (knob > 3) {
    assert(
      result.logs.some((line) => line.includes("bounded by the host ceiling")),
      `knob ${knob} logs the requested and effective depth`,
    );
  } else {
    assert(
      !result.logs.some((line) => line.includes("bounded by the host ceiling")),
      `knob ${knob} does not log a clamp`,
    );
  }
}

for (const config of [
  { maxCallDepth: 0 },
  { maxCallDepth: -4 },
  { maxCallDepth: Number.NaN },
  { maxCallDepth: Number.POSITIVE_INFINITY },
  { maxCallDepth: Number.NEGATIVE_INFINITY },
]) {
  setMaxCallDepth(2);
  const result = appliedDepth(config);
  assert(
    result.depth === 2,
    `invalid request ${String(config.maxCallDepth)} leaves the current ceiling of 2 unchanged`,
  );
}

setMaxCallDepth(3);
const invalidAtStartup = appliedDepth({ maxCallDepth: Number.NaN });
assert(invalidAtStartup.depth === 3, "an invalid request at startup leaves the default of 3");

setMaxCallDepth(3);
const fractional = appliedDepth({ maxCallDepth: 1.5 });
assert(fractional.depth === 1.5, "a fractional request inside the ceiling is applied unchanged");

const fractionalAbove = appliedDepth({ maxCallDepth: 3.5 });
assert(fractionalAbove.depth === 3, "a fractional request above the ceiling is clamped to 3");
assert(
  fractionalAbove.logs.some((line) => line.includes("bounded by the host ceiling")),
  "a fractional request above the ceiling logs the clamp",
);

const absent = appliedDepth({});
assert(absent.depth === 3, "an absent knob leaves the default of 3 in place");
assert(
  !absent.logs.some((line) => line.includes("bounded by the host ceiling")),
  "an absent knob logs no clamp",
);

const tasks = appliedDepth({ maxCallDepth: 9, maxTotalTasks: 40 });
assert(tasks.depth === 3, "the depth clamp does not disturb the total-task wiring");
assert(MAX_TOTAL_TASKS === 40, "the total-task knob still applies unchanged");
setMaxTotalTasks(25);

for (const ceiling of [1, 2, 3]) {
  setMaxCallDepth(ceiling);
  for (let prior = 0; prior <= 20; prior += 1) {
    state.resetCallDepth(session);
    state.callDepth.set(session, prior);
    const output: { args: Record<string, unknown>; error?: string } = { args: { subagent: "tester" } };
    const allowed = await callDepthGuard.check(
      ctx,
      { tool: "task", agent: "dev", sessionID: session },
      output,
    );
    const depth = prior + 1;
    const expectedAllowed = depth <= ceiling;
    assert(
      allowed === expectedAllowed,
      `ceiling ${ceiling}: depth ${depth} is ${expectedAllowed ? "allowed" : "blocked"}`,
    );
    if (expectedAllowed) {
      assert(
        checkCap("dev", depth, 0, 0) === null,
        `ceiling ${ceiling}: allowed depth ${depth} agrees with checkCap`,
      );
    } else {
      assert(
        output.error?.includes(`cannot exceed ${ceiling}`) === true,
        `ceiling ${ceiling}: depth ${depth} names the effective ceiling`,
      );
    }
  }
}

setMaxCallDepth(5);
state.resetCallDepth(session);
state.callDepth.set(session, 3);
const uncappedOutput: { args: Record<string, unknown>; error?: string } = { args: { subagent: "tester" } };
const uncappedAllowed = await callDepthGuard.check(
  ctx,
  { tool: "task", agent: "dev", sessionID: session },
  uncappedOutput,
);
assert(!uncappedAllowed, "an uncapped knob at depth 4 is still rejected");
assert(
  uncappedOutput.error?.includes("cannot exceed 5") !== true,
  "the MAX_CALL_DEPTH branch does not reject depth 4 when the knob is 5",
);
const uncappedCap = checkCap("dev", 4, 0, 0);
assert(
  uncappedCap !== null && uncappedCap.includes("max depth (3)"),
  "checkCap is the source that rejects depth 4, reproducing D13",
);
assert(
  uncappedOutput.error?.includes("max depth (3)") === true,
  "the caller sees the checkCap ceiling of 3, not the knob value of 5",
);
setMaxCallDepth(3);

state.resetCallDepth(session);
state.callDepth.set(session, 20);
const exemptOutput: { args: Record<string, unknown>; error?: string } = { args: { subagent: "explore" } };
const exemptAllowed = await callDepthGuard.check(
  ctx,
  { tool: "task", agent: "dev", sessionID: session },
  exemptOutput,
);
assert(exemptAllowed, "an explore target bypasses the depth guard inside the exempt budget");

state.sessionExemptCalls.set(session, state.MAX_EXEMPT_CALLS);
const exhaustedOutput: { args: Record<string, unknown>; error?: string } = { args: { subagent: "general" } };
const exhaustedAllowed = await callDepthGuard.check(
  ctx,
  { tool: "task", agent: "dev", sessionID: session },
  exhaustedOutput,
);
assert(!exhaustedAllowed, "an exhausted exempt budget returns the dispatch to the depth guard");
assert(
  exhaustedOutput.error?.includes("cannot exceed 3") === true,
  "the exhausted exempt path names the effective ceiling",
);

const rootOutput: { args: Record<string, unknown>; error?: string } = { args: { subagent: "tester" } };
assert(
  await callDepthGuard.check(ctx, { tool: "task", agent: "user", sessionID: session }, rootOutput),
  "a root-like caller skips the depth guard",
);

const handoffOutput: { args: Record<string, unknown>; error?: string } = { args: { subagent: "tester" } };
assert(
  await callDepthGuard.check(ctx, { tool: "handoff", agent: "dev", sessionID: session }, handoffOutput),
  "a non-task dispatch skips the depth guard",
);

const noSessionOutput: { args: Record<string, unknown>; error?: string } = { args: { subagent: "tester" } };
assert(
  await callDepthGuard.check(ctx, { tool: "task", agent: "dev", sessionID: "" }, noSessionOutput),
  "a dispatch without a session id skips the depth guard",
);

const facade = readFileSync(join(repo, "src", "context", "facades", "config-facade.ts"), "utf8");
assert(
  facade.includes("const requestedDepth = c.maxCallDepth;") &&
    facade.includes("resolveMaxCallDepth(requestedDepth)"),
  "the load path resolves the requested depth through the clamp",
);
assert(
  !facade.includes("setMaxCallDepth(c.maxCallDepth)"),
  "the load path no longer applies the raw knob",
);
assert(
  (facade.match(/setMaxCallDepth\(/g) ?? []).length === 1,
  "the load path has exactly one setMaxCallDepth call",
);

const limits = readFileSync(join(repo, "src", "hooks", "guards", "shared", "limits.ts"), "utf8");
assert(limits.includes("HOST_CALL_DEPTH_CEILING = 3"), "the host ceiling is a named constant");
assert(limits.includes("Math.min(requested, HOST_CALL_DEPTH_CEILING)"), "the clamp is single-sourced in the resolver");

const schemaSource = readFileSync(join(repo, "src", "context", "config-schema.ts"), "utf8");
assert(
  schemaSource.includes("bounded by the host ceiling of 3"),
  "the config description documents the clamp",
);

console.log("PROOF PASS: call-depth clamp covers validation, wiring, guard branches, and checkCap agreement");
