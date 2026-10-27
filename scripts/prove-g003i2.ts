import { evaluateFreeLimitBridge } from "../src/services/free-limit.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

function flagOffPreservesLegacy(): void {
  const dailyTyped = { type: "provider.free-limit", message: "Free usage limit reached", data: { retryAfterMs: 60_000 } };
  const configs: Array<[string, { notice?: boolean; noRetry?: boolean }]> = [
    ["undefined", undefined as unknown as { notice?: boolean; noRetry?: boolean }],
    ["an empty object", {}],
    ["notice only", { notice: true }],
    ["noRetry off", { notice: true, noRetry: false }],
  ];
  for (const [label, config] of configs) {
    const decision = evaluateFreeLimitBridge(config, dailyTyped);
    assert(decision.action === "legacy", `${label} keeps the legacy retry path`);
    assert(
      (decision as { reason?: string }).reason === "flag-off",
      `${label} reports the flag as the reason`,
    );
  }
}

function flagOnSkipsOnlyTheDailyLimit(): void {
  const config = { notice: true, noRetry: true };
  const typed = evaluateFreeLimitBridge(config, {
    type: "provider.free-limit",
    message: "Free usage limit reached",
    data: { retryAfterMs: 3_600_000 },
  });
  assert(typed.action === "skip-retry", "the typed daily limit skips the backoff retry");
  assert(
    (typed as { retryAfterMs?: number }).retryAfterMs === 3_600_000,
    "the decision carries the reset delay for the notice",
  );

  const textOnly = evaluateFreeLimitBridge(config, new Error("Free usage limit reached today"));
  assert(textOnly.action === "skip-retry", "the text fallback also skips the backoff retry");

  const noDelay = evaluateFreeLimitBridge(config, { type: "provider.free-limit" });
  assert(noDelay.action === "skip-retry", "a delay-less typed limit still skips the retry");
  assert(
    (noDelay as { retryAfterMs?: number }).retryAfterMs === undefined,
    "a missing delay stays undefined instead of being guessed",
  );
}

function transientStaysLegacy(): void {
  const config = { notice: true, noRetry: true };
  const inputs: unknown[] = [
    { type: "provider.rate-limit", message: "slow down" },
    new Error("Rate limit exceeded"),
    "throttled by the gateway",
    { ok: true },
    undefined,
    null,
  ];
  for (const input of inputs) {
    const decision = evaluateFreeLimitBridge(config, input);
    assert(decision.action === "legacy", `a transient or non-limit error keeps retrying: ${String(input)}`);
    assert(
      (decision as { reason?: string }).reason === "not-daily-limit",
      "the reason is the signal class, not the flag",
    );
  }
}

function parserFailuresFailOpen(): void {
  const config = { notice: true, noRetry: true };
  const hostile: unknown[] = [
    { get type(): string { throw new Error("boom"); } },
    { toJSON(): never { throw new Error("no json"); }, toString(): never { throw new Error("no string"); } },
    Object.create(null),
    new Map<string, string>([["type", "provider.free-limit"]]),
  ];
  for (const input of hostile) {
    let decision: { action: string };
    try {
      decision = evaluateFreeLimitBridge(config, input);
    } catch (e) {
      fail(`the bridge threw on a hostile input instead of failing open: ${String(e)}`);
      return;
    }
    assert(
      decision.action === "legacy" || decision.action === "skip-retry",
      `a hostile input never throws out of the bridge: ${Object.prototype.toString.call(input)}`,
    );
    if (decision.action === "legacy") {
      assert(
        (decision as { reason?: string }).reason === "not-daily-limit",
        "a non-throwing parse that finds no daily limit falls back to legacy",
      );
    }
  }
}

try {
  flagOffPreservesLegacy();
  flagOnSkipsOnlyTheDailyLimit();
  transientStaysLegacy();
  parserFailuresFailOpen();
  console.log(`PROOF PASS: the free-limit bridge is flag-gated, daily-only, and fails open (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
