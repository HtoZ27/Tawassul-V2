import {
  computeBudget,
  resolveModelWindow,
  resolveReserve,
} from "../src/services/context-pack/accounting.ts";

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

  eq(resolveModelWindow({}), 128000, "unknown window falls back to 128000");
  eq(resolveModelWindow({ limitContext: 96000 }), 128000, "a sub-128k declaration is unknown");
  eq(resolveModelWindow({ limitContext: 128000 }), 128000, "128k is trusted");
  eq(resolveModelWindow({ limitContext: 200000 }), 128000, "an unconfirmed 200k is not trusted");
  eq(
    resolveModelWindow({ providerID: "anthropic", modelID: "claude-sonnet-4-20250514", limitContext: 200000 }),
    200000,
    "the pricing table confirms 200k",
  );
  eq(
    resolveModelWindow({ providerID: "deepseek", modelID: "deepseek-chat" }),
    128000,
    "a sub-128k pricing entry is treated as unknown",
  );
  eq(
    resolveModelWindow({ providerID: "anthropic", modelID: "claude-sonnet-4-20250514", limitContext: 300000 }),
    200000,
    "a host limit above the pricing table is capped",
  );
  console.log("PROOF PASS: reserve and budget stay explicit at every window");
}

main();
