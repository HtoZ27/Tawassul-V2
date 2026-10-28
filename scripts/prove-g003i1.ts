import { parseFreeLimitSignal, isFreeDailyLimit, isTransientRateLimit } from "../src/services/free-limit.ts";

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

function typedFreeLimit(withRetryAfter: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: "ProviderError",
    type: "provider.free-limit",
    message: "Free usage limit reached",
  };
  if (withRetryAfter !== undefined) base.data = { retryAfterMs: withRetryAfter };
  return base;
}

function nonLimitInputs(): void {
  const inputs: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["a plain string", "your request failed to parse"],
    ["a generic Error", new Error("internal assembly error")],
    ["a success object", { ok: true, output: "done" }],
  ];
  for (const [label, input] of inputs) {
    const parsed = parseFreeLimitSignal(input);
    assert(parsed.signal === "no-limit", `${label} is not a limit signal`);
    assert(parsed.retryAfterMs === undefined, `${label} carries no retry delay`);
  }
}

function typedPaths(): void {
  const withDelay = parseFreeLimitSignal(typedFreeLimit(3_600_000));
  assert(withDelay.signal === "free-daily-limit", "a typed provider.free-limit error is the daily limit");
  assert(withDelay.matchedBy === "error-type", "the typed path reports an error-type match");
  assert(withDelay.retryAfterMs === 3_600_000, "the typed path reads retryAfterMs in milliseconds");

  const noDelay = parseFreeLimitSignal(typedFreeLimit(undefined));
  assert(noDelay.signal === "free-daily-limit", "a typed limit without a delay is still the daily limit");
  assert(noDelay.retryAfterMs === undefined, "a missing retryAfterMs yields undefined, not a guess");

  const stringDelay = parseFreeLimitSignal({
    type: "provider.free-limit",
    data: { retryAfterMs: "1800" },
  });
  assert(stringDelay.signal === "free-daily-limit", "a string retry delay still parses");
  assert(stringDelay.retryAfterMs === 1_800_000, "a seconds-string delay converts to milliseconds");

  const nested = parseFreeLimitSignal({
    error: { type: "free-usage-limit", message: "limit", data: { retryAfterMs: 500 } },
  });
  assert(nested.signal === "free-daily-limit", "a nested error object is read through the error field");
  assert(nested.retryAfterMs === 500, "the nested retry delay is read");

  const resetAt = parseFreeLimitSignal({
    type: "provider.free-limit",
    freeLimitResetAt: Date.now() + 60_000,
  });
  assert(resetAt.signal === "free-daily-limit", "an absolute reset timestamp is recognized");
  assert(
    typeof resetAt.retryAfterMs === "number" && resetAt.retryAfterMs > 50_000 && resetAt.retryAfterMs <= 60_000,
    "an absolute reset converts to a relative wait",
  );

  const secondsReset = parseFreeLimitSignal({
    type: "provider.free-limit",
    data: { resetAt: Math.floor((Date.now() + 60_000) / 1000) },
  });
  assert(
    typeof secondsReset.retryAfterMs === "number" &&
      secondsReset.retryAfterMs > 50_000 &&
      secondsReset.retryAfterMs <= 60_000,
    "an epoch-seconds reset converts to a relative wait",
  );

  const bareType = parseFreeLimitSignal({ name: "FreeUsageLimitError" });
  assert(bareType.signal === "free-daily-limit", "a bare FreeUsageLimitError type is the daily limit");
  assert(bareType.matchedBy === "error-type", "the bare class name decides by type, not text");

  const quota = parseFreeLimitSignal(new Error("quota exceeded"));
  assert(quota.signal === "transient-rate-limit", "a generic quota-exceeded message is a transient limit");

  const transient = parseFreeLimitSignal({ type: "provider.rate-limit", message: "slow down" });
  assert(transient.signal === "transient-rate-limit", "a typed provider.rate-limit stays transient");
  assert(transient.retryAfterMs === undefined, "a transient typed error has no daily reset delay");
}

function textFallbacks(): void {
  const texts = [
    "FreeUsageLimitError: Free usage limit reached today",
    "Free usage limit has been reached, come back tomorrow",
    "you have used all of today's free messages",
    "You've used all your free messages",
    "exceeded your free request limit",
    "free daily limit reached",
  ];
  for (const message of texts) {
    const parsed = parseFreeLimitSignal(new Error(message));
    assert(parsed.signal === "free-daily-limit", `text fallback matches: ${message}`);
    assert(parsed.matchedBy === "text", `text fallback reports a text match: ${message}`);
  }

  const transientTexts = ["Rate limit exceeded", "HTTP 429 too many requests", "throttled by the gateway"];
  for (const message of transientTexts) {
    assert(parseFreeLimitSignal(message).signal === "transient-rate-limit", `transient text matches: ${message}`);
  }
}

function predicateConsistency(): void {
  assert(isFreeDailyLimit(typedFreeLimit(1000)) === true, "isFreeDailyLimit agrees with the typed daily limit");
  assert(isFreeDailyLimit({ type: "provider.rate-limit" }) === false, "isFreeDailyLimit rejects a transient limit");
  assert(isFreeDailyLimit("nothing here") === false, "isFreeDailyLimit rejects a non-limit string");
  assert(isTransientRateLimit({ type: "provider.rate-limit" }) === true, "isTransientRateLimit agrees with the typed transient");
  assert(isTransientRateLimit(typedFreeLimit(1000)) === false, "isTransientRateLimit rejects the daily limit");
}

try {
  nonLimitInputs();
  typedPaths();
  textFallbacks();
  predicateConsistency();
  console.log(`PROOF PASS: the free-limit parser recognizes the typed error and its delay with a text fallback (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
