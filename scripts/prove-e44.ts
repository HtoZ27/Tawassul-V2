import assert from "node:assert/strict";
import { handleRateLimitError } from "../src/bootstrap/plugin-init.ts";
import {
  hostRetriesThrottledRequests,
  parseHostVersion,
  shouldDeferRateLimitToHost,
} from "../src/services/free-limit.ts";
import type { PluginInput } from "../src/plugin-types.ts";
import { buildPluginInput } from "../src/v2/client-shim.ts";

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

check(parseHostVersion("2.2.0")?.join(".") === "2.2.0", "a plain host version parses");
check(parseHostVersion("v2.2.0")?.join(".") === "2.2.0", "a v-prefixed host version parses");
check(parseHostVersion("2.2")?.join(".") === "2.2.0", "a major.minor host version parses with patch zero");
check(parseHostVersion("2.2.0-beta.3")?.join(".") === "2.2.0", "a prerelease host version parses the numeric core");
check(parseHostVersion("3.0.1")?.join(".") === "3.0.1", "a later major host version parses");
check(parseHostVersion(undefined) === undefined, "an absent host version does not parse");
check(parseHostVersion("") === undefined, "an empty host version does not parse");
check(parseHostVersion("nightly") === undefined, "a non-numeric host version does not parse");
check(parseHostVersion("2.x.0") === undefined, "a malformed host version does not parse");

check(hostRetriesThrottledRequests("2.2.0"), "the 2.2.0 host retries throttled requests");
check(hostRetriesThrottledRequests("v2.2.1"), "a later patch on 2.2 still retries throttled requests");
check(hostRetriesThrottledRequests("2.3.0"), "a later minor still retries throttled requests");
check(hostRetriesThrottledRequests("3.0.0"), "a later major still retries throttled requests");
check(!hostRetriesThrottledRequests("2.1.4"), "the 2.1.4 host does not retry throttled requests");
check(!hostRetriesThrottledRequests("2.1.99"), "a 2.1 patch never retries throttled requests");
check(!hostRetriesThrottledRequests(undefined), "an unknown host version keeps the legacy retry");
check(!hostRetriesThrottledRequests("nightly"), "a non-numeric host version keeps the legacy retry");

const typedTransient = {
  type: "provider.rate-limit",
  message: "Too many requests",
  data: { retryAfterMs: 2000 },
};
const textTransient = "429 Too Many Requests";
const dailyLimit = {
  type: "provider.free-limit",
  message: "Free usage limit reached",
  data: { retryAfterMs: 86_400_000 },
};

check(shouldDeferRateLimitToHost("2.2.0", typedTransient), "a typed transient is left to the 2.2.0 host");
check(shouldDeferRateLimitToHost("2.2.0", textTransient), "a text transient is left to the 2.2.0 host");
check(
  shouldDeferRateLimitToHost("2.2.0", "throttled by the provider"),
  "a throttled message is left to the 2.2.0 host",
);
check(!shouldDeferRateLimitToHost("2.1.4", typedTransient), "a typed transient still retries on the 2.1.4 host");
check(!shouldDeferRateLimitToHost("2.2.0", dailyLimit), "a daily limit is never deferred to the host retry");
check(!shouldDeferRateLimitToHost("2.2.0", "a plain tool failure"), "a non-rate-limit is not deferred");
check(!shouldDeferRateLimitToHost(undefined, typedTransient), "an unknown host keeps the plugin retry");

const mapped = buildPluginInput({
  app: { version: "2.2.0" },
  location: { directory: "/tmp/opencode/e44" },
} as never);
check(mapped.hostVersion === "2.2.0", "the v2 host version reaches the plugin input");
const unmapped = buildPluginInput({ location: { directory: "/tmp/opencode/e44" } } as never);
check(unmapped.hostVersion === undefined, "a host without a version leaves the plugin input unset");

type TimerCall = { fn: () => void; delay: number };

function makeInput(hostVersion: string | undefined, prompts: string[]): PluginInput {
  return {
    client: {
      session: {
        promptAsync: async (input: unknown) => {
          const rec = input as { body?: { parts?: Array<{ text?: string }> } };
          const text = rec.body?.parts?.map((part) => part.text ?? "").join("") ?? "";
          prompts.push(text);
          return undefined;
        },
      },
    },
    directory: "/tmp/opencode/e44",
    worktree: "/tmp/opencode/e44",
    hostVersion,
  };
}

function makeTawaContext(timers: TimerCall[]): never {
  return {
    configManager: { config: { rateLimits: { apiRetryMax: 2, apiRetryBaseMs: 1 } } },
    timerManager: {
      setTimeout: (fn: () => void, delay: number) => {
        timers.push({ fn, delay });
        return 0;
      },
    },
  } as never;
}

const hostPrompts: string[] = [];
const hostTimers: TimerCall[] = [];
const hostDeferred = await handleRateLimitError(
  makeInput("2.2.0", hostPrompts),
  makeTawaContext(hostTimers),
  "ses_e44_host",
  "provider.rate-limit 429 Too Many Requests",
);
check(hostDeferred === false, "the 2.2.0 host path reports no plugin retry");
check(hostPrompts.length === 0, "the 2.2.0 host path sends no retry notice");
check(hostTimers.length === 0, "the 2.2.0 host path schedules no retry timer");

const legacyPrompts: string[] = [];
const legacyTimers: TimerCall[] = [];
const legacyRetried = await handleRateLimitError(
  makeInput("2.1.4", legacyPrompts),
  makeTawaContext(legacyTimers),
  "ses_e44_legacy",
  "429 Too Many Requests",
);
check(legacyRetried === true, "the 2.1.4 host path still retries");
check(legacyPrompts.length === 1, "the 2.1.4 host path sends one retry notice");
check(legacyTimers.length === 1, "the 2.1.4 host path schedules one retry timer");

const unknownPrompts: string[] = [];
const unknownTimers: TimerCall[] = [];
const unknownRetried = await handleRateLimitError(
  makeInput(undefined, unknownPrompts),
  makeTawaContext(unknownTimers),
  "ses_e44_unknown",
  "provider.rate-limit Too many requests",
);
check(unknownRetried === true, "an unknown host keeps the legacy plugin retry");
check(unknownPrompts.length === 1 && unknownTimers.length === 1, "an unknown host schedules the legacy retry once");

const dailyPrompts: string[] = [];
const dailyTimers: TimerCall[] = [];
const dailyRetried = await handleRateLimitError(
  makeInput("2.2.0", dailyPrompts),
  makeTawaContext(dailyTimers),
  "ses_e44_daily",
  "provider.free-limit Free usage limit reached",
);
check(dailyRetried === false, "a daily limit does not fall into the host retry path");
check(dailyPrompts.length === 0 && dailyTimers.length === 0, "a daily limit schedules no host retry from the plugin");

assert.equal(passed, 36);
console.log(`PROOF PASS: transient rate limits defer to the host retry (${passed} assertions)`);
