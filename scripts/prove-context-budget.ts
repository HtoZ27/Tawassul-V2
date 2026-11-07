import {
  computeBudget,
  resolveModelWindow,
  resolveReserve,
} from "../src/services/context-pack/accounting.ts";
import { DEFAULT_CONTEXT_WINDOW, WINDOW_SANITY_FLOOR } from "../src/services/context-pack/types.ts";
import { resolveMaxContextTokens } from "../src/hooks/message-updated.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

function eq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) fail(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

function main(): void {
  eq(resolveReserve(96000), 24000, "reserve at 96k");
  eq(resolveReserve(8000), 4000, "reserve at 8k never exceeds half");
  eq(resolveReserve(64000), 16000, "reserve floor is 16k");

  const wide = computeBudget(96000, 1000);
  eq(wide.room, 71000, "room at 96k");
  eq(wide.budget, 64000, "budget is capped at 64000");
  assert(!wide.overflow, "96k with a small request is not an overflow");

  const narrow = computeBudget(8000, 5000);
  eq(narrow.room, -1000, "room can go negative");
  eq(narrow.budget, -1000, "budget follows room");
  assert(narrow.overflow, "8k with a 5k request overflows");

  const reserve = resolveReserve(100000);
  const atBoundary = computeBudget(100000, 100000 - reserve - 1024);
  eq(atBoundary.budget, 1024, "the overflow boundary is 1024");
  assert(!atBoundary.overflow, "1024 bytes is still usable");
  const belowBoundary = computeBudget(100000, 100000 - reserve - 1023);
  eq(belowBoundary.budget, 1023, "one byte below the boundary");
  assert(belowBoundary.overflow, "below 1024 bytes overflows");

  eq(resolveModelWindow({}), DEFAULT_CONTEXT_WINDOW, "an unknown model falls back to the labelled 200k window");
  eq(resolveModelWindow({ limitContext: 96000 }), 96000, "a host 96k declaration is trusted verbatim");
  eq(resolveModelWindow({ limitContext: 200000 }), 200000, "a host 200k declaration is trusted verbatim");
  eq(resolveModelWindow({ limitContext: 1000000 }), 1000000, "a host million-token declaration is not clamped");
  eq(
    resolveModelWindow({ limitContext: 12000000 }),
    12000000,
    "no upper clamp is applied to a host declaration",
  );
  eq(
    resolveModelWindow({ limitContext: WINDOW_SANITY_FLOOR - 1 }),
    DEFAULT_CONTEXT_WINDOW,
    "a declaration below the sanity floor is ignored",
  );
  eq(resolveModelWindow({ limitContext: WINDOW_SANITY_FLOOR }), WINDOW_SANITY_FLOOR, "the sanity floor is trusted");
  eq(resolveModelWindow({ limitContext: 2500.7 }), 2500, "a fractional declaration is floored");
  eq(resolveModelWindow({ limitContext: "200000" }), DEFAULT_CONTEXT_WINDOW, "a string declaration is ignored");
  eq(resolveModelWindow({ limitContext: -1 }), DEFAULT_CONTEXT_WINDOW, "a negative declaration is ignored");
  eq(
    resolveModelWindow({ providerID: "deepseek", modelID: "deepseek-chat" }),
    64000,
    "the catalog fills a missing host window",
  );
  eq(
    resolveModelWindow({ providerID: "anthropic", modelID: "claude-sonnet-4-20250514", limitContext: 300000 }),
    300000,
    "the host overrides the catalog upward",
  );
  eq(
    resolveModelWindow({
      providerID: "opencode",
      modelID: "deepseek-v4.1-flash-free",
      limitContext: 1000000,
    }),
    1000000,
    "a catalog 200k entry does not cap a host million-token window",
  );
  eq(
    resolveModelWindow({ providerID: "opencode", modelID: "deepseek-v4.1-flash-free" }),
    200000,
    "the catalog fills the free model window when the host is silent",
  );
  eq(resolveReserve(DEFAULT_CONTEXT_WINDOW), 50000, "the reserve at the 200k default is 50k");
  eq(resolveReserve(0), 50000, "a non-positive window uses the default reserve");
  eq(resolveReserve(Number.NaN), 50000, "a non-finite window uses the default reserve");
  const hostMillion = computeBudget(1000000, 100000);
  assert(!hostMillion.overflow, "a host 1M window with 100k of history does not overflow");
  const oldClamp = computeBudget(128000, 100000);
  assert(oldClamp.overflow, "the removed 128k clamp is why a 1M window used to transfer");
  eq(
    resolveMaxContextTokens({ providerID: "unknown", modelID: "brand-new-model" }, undefined, undefined),
    DEFAULT_CONTEXT_WINDOW,
    "the nudge fallback for an unknown model is the 200k default",
  );
  eq(
    resolveMaxContextTokens({ providerID: "deepseek", modelID: "deepseek-chat" }, undefined, undefined),
    64000,
    "the catalog fills the nudge window when the host is silent",
  );
  eq(
    resolveMaxContextTokens(undefined, { dev: "opencode/deepseek-v4.1-flash-free" }, "dev"),
    200000,
    "the agent model map supplies the nudge window",
  );
  const previous = process.env.TAWASSUL_MAX_CONTEXT_TOKENS;
  process.env.TAWASSUL_MAX_CONTEXT_TOKENS = "123456";
  eq(
    resolveMaxContextTokens({ providerID: "unknown", modelID: "brand-new-model" }, undefined, undefined),
    123456,
    "the environment override wins over the default",
  );
  if (previous === undefined) delete process.env.TAWASSUL_MAX_CONTEXT_TOKENS;
  else process.env.TAWASSUL_MAX_CONTEXT_TOKENS = previous;
  console.log("PROOF PASS: reserve and budget stay explicit at every window");
}

main();
