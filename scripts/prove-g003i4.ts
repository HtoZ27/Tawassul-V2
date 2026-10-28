import { evaluateFreeLimitBridge, buildFreeLimitNotice } from "../src/services/free-limit.ts";

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

const CONFIG = { notice: true, noRetry: true };
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

function localStamp(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function noticeFor(error: unknown): ReturnType<typeof buildFreeLimitNotice> {
  return buildFreeLimitNotice(evaluateFreeLimitBridge(CONFIG, error), NOW);
}

function delayCase(): void {
  const notice = noticeFor({ type: "provider.free-limit", data: { retryAfterMs: 3_600_000 } });
  const expected = localStamp(NOW + 3_600_000);
  assert(notice.hasDelay === true, "a delay-bearing limit produces a reset time");
  assert(notice.resetTime === expected, "the reset time is the delay added to now, in local time");
  assert(!/[TZ]/.test(notice.resetTime ?? ""), "the reset stamp is not a UTC ISO string");
  assert(notice.text.includes(`resets in about 60 minute(s) at ${expected}`), "the notice names the local reset time");
  assert(notice.text.startsWith("OpenCode Zen free daily limit reached"), "the notice names the cause");
  assert(notice.text.includes("switching key or model does not help"), "the notice carries the shared-quota guidance");
  assert(notice.text.includes("Retrying is not useful"), "the notice says retrying will not help");
  assert(notice.resetTime !== null && notice.text.includes(notice.resetTime), "the stamped time appears in the notice text");
}

function minutesRounding(): void {
  const seconds = noticeFor({ type: "provider.free-limit", data: { retryAfterMs: 90_000 } });
  assert(seconds.text.includes("about 2 minute(s)"), "a sub-hour delay rounds to whole minutes");
  assert(seconds.resetTime === localStamp(NOW + 90_000), "the short delay keeps an exact local stamp");
  const tiny = noticeFor({ type: "provider.free-limit", data: { retryAfterMs: 100 } });
  assert(tiny.text.includes("about 1 minute(s)"), "a tiny delay reports at least one minute");
}

function noDelayCase(): void {
  const notice = noticeFor({ type: "provider.free-limit" });
  assert(notice.hasDelay === false, "a delay-less limit reports no delay");
  assert(notice.resetTime === null, "no reset time is invented when the delay is missing");
  assert(notice.text.includes("free daily limit reached"), "the delay-less notice still states the cause");
  assert(notice.text.includes("switching key or model does not help"), "the delay-less notice carries the shared-quota guidance");
  assert(!notice.text.includes("resets in about"), "no fabricated reset estimate appears");
}

function skippedCases(): void {
  for (const error of [new Error("Rate limit exceeded"), undefined, null, { ok: true }]) {
    const decision = evaluateFreeLimitBridge(CONFIG, error);
    const notice = buildFreeLimitNotice(decision, NOW);
    assert(notice.text === "", `a non-daily-limit decision renders no notice: ${String(error)}`);
    assert(notice.resetTime === null && notice.hasDelay === false, "the skipped notice carries no delay fields");
  }
}

function determinism(): void {
  const error = { type: "provider.free-limit", data: { retryAfterMs: 600_000 } };
  const a = buildFreeLimitNotice(evaluateFreeLimitBridge(CONFIG, error), NOW);
  const b = buildFreeLimitNotice(evaluateFreeLimitBridge(CONFIG, error), NOW);
  assert(a.text === b.text && a.resetTime === b.resetTime, "the same input renders the same notice");
  const later = buildFreeLimitNotice(evaluateFreeLimitBridge(CONFIG, error), NOW + 60_000);
  assert(later.resetTime !== a.resetTime, "the reset time follows the current clock");
}

try {
  delayCase();
  minutesRounding();
  noDelayCase();
  skippedCases();
  determinism();
  console.log(`PROOF PASS: the free-limit notice renders the local reset time and shared-quota guidance (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
