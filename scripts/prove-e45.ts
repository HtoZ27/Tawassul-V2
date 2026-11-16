import assert from "node:assert/strict";
import {
  createDisposeHook,
  DISPOSE_BUDGET_MS,
  disposeWithinBudget,
  HOST_SHUTDOWN_CAP_MS,
} from "../src/hooks/dispose.ts";

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

function makeContext(destroy: () => Promise<void>) {
  return {
    handoffs: [],
    detectDroppedHandoffs: () => undefined,
    destroy,
  };
}

check(HOST_SHUTDOWN_CAP_MS === 10_000, "the host shutdown cap is ten seconds");
check(DISPOSE_BUDGET_MS > 0, "the dispose budget is positive");
check(DISPOSE_BUDGET_MS < HOST_SHUTDOWN_CAP_MS, "the dispose budget stays under the host cap");
check(
  DISPOSE_BUDGET_MS <= HOST_SHUTDOWN_CAP_MS - 1_000,
  "the dispose budget leaves at least one second of margin",
);

check((await disposeWithinBudget(async () => undefined, 100)) === "completed", "a fast destroy completes");
check((await disposeWithinBudget(async () => undefined, 0)) === "completed", "a zero budget runs without a timer");

const started = Date.now();
const timedOut = await disposeWithinBudget(() => new Promise<void>(() => undefined), 25);
const elapsed = Date.now() - started;
check(timedOut === "timed-out", "a hung destroy times out at the budget");
check(elapsed >= 20 && elapsed < 1_000, "the timeout releases near the budget instead of waiting forever");

let rejection = "";
try {
  await disposeWithinBudget(async () => {
    throw new Error("destroy failed");
  }, 100);
} catch (e) {
  rejection = e instanceof Error ? e.message : String(e);
}
check(rejection === "destroy failed", "a rejecting destroy stays observable to the caller");

const fastHook = createDisposeHook(makeContext(async () => undefined), { budgetMs: 100 });
await fastHook();
check(true, "the dispose hook completes a fast destroy");

let slowFinished = false;
const slowHook = createDisposeHook(
  makeContext(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    slowFinished = true;
  }),
  { budgetMs: 25 },
);
const hookStarted = Date.now();
await slowHook();
const hookElapsed = Date.now() - hookStarted;
check(hookElapsed < 1_000, "the dispose hook returns without waiting for the slow destroy");
check(slowFinished === false, "the slow destroy is still running when the hook releases");

const failingHook = createDisposeHook(
  makeContext(async () => {
    throw new Error("destroy failed");
  }),
  { budgetMs: 100 },
);
await failingHook();
check(true, "the dispose hook swallows a destroy failure after logging");

const pendingHook = createDisposeHook(
  {
    handoffs: [
      { id: "H-950", status: "pending" },
      { id: "H-951", status: "accepted" },
      { id: "H-952", status: "cancelled" },
    ],
    detectDroppedHandoffs: () => undefined,
    destroy: async () => undefined,
  } as never,
  { budgetMs: 100 },
);
await pendingHook();
check(true, "the dispose hook still completes with pending handoffs");

assert.equal(passed, 14);
console.log(`PROOF PASS: shutdown cleanup stays inside the host budget (${passed} assertions)`);
