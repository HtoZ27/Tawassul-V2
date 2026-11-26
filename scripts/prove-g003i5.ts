import "./proof-log-isolate.ts";
import { configSchema } from "../src/context/config-schema.ts";
import { evaluateFreeLimitBridge } from "../src/services/free-limit.ts";
import { setLanguage, t } from "../src/translations.ts";

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

function schemaAcceptsTheBlock(): void {
  const parsed = configSchema.safeParse({ freeLimit: { notice: true, noRetry: true } });
  assert(parsed.success === true, "the schema accepts a freeLimit block with both toggles");
  if (parsed.success) {
    assert(
      (parsed.data as { freeLimit?: { notice?: boolean; noRetry?: boolean } }).freeLimit?.notice === true,
      "the parsed notice toggle survives the round trip",
    );
    assert(
      (parsed.data as { freeLimit?: { notice?: boolean; noRetry?: boolean } }).freeLimit?.noRetry === true,
      "the parsed noRetry toggle survives the round trip",
    );
  }
}

function schemaDefaultsToSafe(): void {
  const bare = configSchema.safeParse({});
  assert(bare.success === true, "a config without the block still validates");
  if (bare.success) {
    const cfg = bare.data as { freeLimit?: { notice?: boolean; noRetry?: boolean } };
    assert(cfg.freeLimit === undefined, "the block is absent when unset");
  }
  const partial = configSchema.safeParse({ freeLimit: {} });
  assert(partial.success === true, "an empty block validates");
  if (partial.success) {
    const cfg = partial.data as { freeLimit?: { notice?: boolean; noRetry?: boolean } };
    assert(cfg.freeLimit?.notice === undefined, "notice stays off when unset");
    assert(cfg.freeLimit?.noRetry === undefined, "noRetry stays off when unset");
  }
  const legacy = evaluateFreeLimitBridge(undefined, { type: "provider.free-limit" });
  assert(legacy.action === "legacy", "an absent block keeps the legacy retry path");
}

function schemaRejectsWrongTypes(): void {
  const bad = configSchema.safeParse({ freeLimit: { notice: "yes" } });
  assert(bad.success === false, "a boolean-typed toggle rejects a string");
  const badNumber = configSchema.safeParse({ freeLimit: { noRetry: 1 } });
  assert(badNumber.success === false, "a boolean-typed toggle rejects a number");
}

function flagOffEqualsLegacy(): void {
  const daily = { type: "provider.free-limit", message: "limit", data: { retryAfterMs: 1000 } };
  const off = evaluateFreeLimitBridge({ notice: false, noRetry: false }, daily);
  const absent = evaluateFreeLimitBridge(undefined, daily);
  assert(off.action === "legacy" && absent.action === "legacy", "off and absent behave identically");
  const noticeOnly = evaluateFreeLimitBridge({ notice: true, noRetry: false }, daily);
  assert(noticeOnly.action === "legacy", "notice alone never changes the retry behavior");
}

function stringsExist(): void {
  setLanguage("en");
  const keys = ["freeLimitHeading", "freeLimitHeadingWithReset", "freeLimitSharedQuota", "freeLimitRetryNoHelp"];
  for (const key of keys) {
    const value = t(key);
    assert(typeof value === "string" && value.length > 0, `the key ${key} resolves to text`);
    assert(value !== key, `the key ${key} is not returned raw`);
  }
  const heading = t("freeLimitHeading");
  assert(heading.includes("free daily limit"), "the heading names the daily free limit");
  const withReset = t("freeLimitHeadingWithReset", { minutes: "60", time: "STAMP" });
  assert(withReset.includes("60") && withReset.includes("STAMP"), "the reset template substitutes its placeholders");
  const quota = t("freeLimitSharedQuota");
  assert(quota.includes("shared") && quota.includes("identity"), "the shared-quota string explains the bucket");
  const noHelp = t("freeLimitRetryNoHelp");
  assert(noHelp.toLowerCase().includes("retrying"), "the retry statement names retrying");
  for (const key of keys) {
    const raw = t(key);
    assert(!raw.includes("{") || key === "freeLimitHeadingWithReset", `the resolved ${key} has no unfilled placeholder`);
  }
}

try {
  schemaAcceptsTheBlock();
  schemaDefaultsToSafe();
  schemaRejectsWrongTypes();
  flagOffEqualsLegacy();
  stringsExist();
  console.log(`PROOF PASS: the freeLimit flag is schemaed with safe defaults and localized strings (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
