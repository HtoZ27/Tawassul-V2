import {
  evaluateFreeLimitBridge,
  buildFreeLimitNotice,
  isFreeDailyLimit,
  isTransientRateLimit,
  parseFreeLimitSignal,
} from "../src/services/free-limit.ts";

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

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const DAILY_TYPED = {
  type: "provider.free-limit",
  message: "Free usage limit reached",
  data: { retryAfterMs: 3_600_000 },
};

function caseTypedError(): void {
  const parsed = parseFreeLimitSignal(DAILY_TYPED);
  assert(parsed.signal === "free-daily-limit", "the typed provider.free-limit error is the daily limit");
  assert(parsed.matchedBy === "error-type", "the typed path is decided by the error type");
  assert(parsed.retryAfterMs === 3_600_000, "the typed delay is carried through unchanged");

  const decision = evaluateFreeLimitBridge({ noRetry: true }, DAILY_TYPED);
  assert(decision.action === "skip-retry", "the typed daily limit skips the backoff retry");
  const notice = buildFreeLimitNotice(decision, NOW);
  assert(notice.resetTime === "2026-10-27T13:00:00.000Z", "the typed delay becomes a local reset stamp");
  assert(
    notice.resetTime !== null && notice.text.includes(notice.resetTime),
    "the notice text names that reset stamp",
  );
}

function caseMissingRetryAfterMs(): void {
  const withoutData = { type: "provider.free-limit", message: "Free usage limit reached" };
  const parsed = parseFreeLimitSignal(withoutData);
  assert(parsed.signal === "free-daily-limit", "the typed limit is still recognized without a delay");
  assert(parsed.retryAfterMs === undefined, "a missing delay is not invented");

  const decision = evaluateFreeLimitBridge({ noRetry: true }, withoutData);
  assert(decision.action === "skip-retry", "the delay-less daily limit still skips the retry");
  const notice = buildFreeLimitNotice(decision, NOW);
  assert(notice.resetTime === null, "the delay-less notice carries no reset stamp");
  assert(notice.hasDelay === false, "the delay-less notice reports no delay");
  assert(!notice.text.includes("resets in about"), "no fabricated reset estimate appears in the text");
  assert(notice.text.includes("shared"), "the delay-less notice still carries the shared-quota guidance");
}

function caseTransientUnchanged(): void {
  const stringCases: Array<[string, string]> = [
    ["429 Too Many Requests", "429 Too Many Requests"],
    ["the provider answered 429", "the provider answered 429"],
    ["Rate limit exceeded", "Rate limit exceeded"],
    ["rate_limit_exceeded", "rate_limit_exceeded"],
  ];
  for (const [input, label] of stringCases) {
    assert(parseFreeLimitSignal(input).signal === "transient-rate-limit", `transient text stays transient: ${label}`);
    assert(isTransientRateLimit(input) === true, `the transient predicate agrees: ${label}`);
    assert(isFreeDailyLimit(input) === false, `the daily predicate rejects it: ${label}`);
    const decision = evaluateFreeLimitBridge({ notice: true, noRetry: true }, input);
    assert(decision.action === "legacy", `the bridge leaves the retry path alone: ${label}`);
  }

  const typedTransient = { type: "provider.rate-limit", message: "slow down" };
  assert(parseFreeLimitSignal(typedTransient).signal === "transient-rate-limit", "a typed transient stays transient");
  assert(
    evaluateFreeLimitBridge({ notice: true, noRetry: true }, typedTransient).action === "legacy",
    "the bridge leaves the typed transient on the legacy path",
  );
  assert(buildFreeLimitNotice(evaluateFreeLimitBridge({ noRetry: true }, typedTransient), NOW).text === "", "a transient limit renders no notice");
}

function caseFlagOffEqualsLegacy(): void {
  const corpus: unknown[] = [
    DAILY_TYPED,
    { type: "provider.free-limit" },
    new Error("Free usage limit reached today"),
    "429 Too Many Requests",
    "Rate limit exceeded",
    { type: "provider.rate-limit", message: "slow down" },
    "internal assembly error",
    undefined,
    null,
    { ok: true },
  ];
  const offConfigs = [{}, { notice: false }, { notice: true }, { noRetry: false }, { notice: false, noRetry: false }];
  for (const input of corpus) {
    const legacy = evaluateFreeLimitBridge(undefined, input);
    for (const config of offConfigs) {
      const candidate = evaluateFreeLimitBridge(config, input);
      assert(
        JSON.stringify(candidate) === JSON.stringify(legacy),
        `flag off equals legacy for ${String(input)} with ${JSON.stringify(config)}`,
      );
    }
  }
  assert(evaluateFreeLimitBridge(undefined, DAILY_TYPED).action === "legacy", "the absent config keeps the retry path");
  assert(
    evaluateFreeLimitBridge({ notice: true, noRetry: true }, DAILY_TYPED).action === "skip-retry",
    "only the explicit noRetry toggle changes the path",
  );
}

try {
  caseTypedError();
  caseMissingRetryAfterMs();
  caseTransientUnchanged();
  caseFlagOffEqualsLegacy();
  console.log(`PROOF PASS: the four free-limit contract cases hold — typed, delay-less, transient 429, flag-off legacy (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
