export type FreeLimitSignal = "free-daily-limit" | "transient-rate-limit" | "no-limit";

export interface FreeLimitParseResult {
  signal: FreeLimitSignal;
  retryAfterMs?: number;
  matchedBy?: "error-type" | "text";
}

const FREE_LIMIT_TYPES = new Set(["provider.free-limit", "free-usage-limit", "provider.free_usage_limit"]);
const TRANSIENT_TYPES = new Set(["provider.rate-limit", "provider.rate_limit"]);
const FREE_LIMIT_TEXT_PATTERNS = [
  /free usage limit reached/i,
  /free usage limit has been reached/i,
  /today'?s free messages/i,
  /free daily limit/i,
  /you'?ve used all your free (messages|requests)/i,
  /exceeded your free (message|request) limit/i,
];
const TRANSIENT_TEXT_PATTERNS = [
  /rate ?limit/i,
  /too many requests/i,
  /\b429\b/,
  /throttled/i,
];

function readRetryAfterMs(source: Record<string, unknown>): number | undefined {
  const nestedError = source.error as Record<string, unknown> | undefined;
  const nestedData = nestedError?.data as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    source.retryAfterMs,
    source.retry_after_ms,
    (source.data as Record<string, unknown> | undefined)?.retryAfterMs,
    (source.data as Record<string, unknown> | undefined)?.retryAfter,
    nestedError?.retryAfterMs,
    nestedError?.retry_after_ms,
    nestedData?.retryAfterMs,
    nestedData?.retryAfter,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return Math.round(candidate);
    }
    if (typeof candidate === "string") {
      const seconds = Number(candidate);
      if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);
    }
  }
  return undefined;
}

function readErrorType(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const record = error as Record<string, unknown>;
  const fromType = record.type;
  if (typeof fromType === "string") return fromType;
  const fromName = record.name;
  if (typeof fromName === "string") return fromName;
  const fromError = record.error as { type?: unknown; name?: unknown } | undefined;
  if (typeof fromError?.type === "string") return fromError.type;
  if (typeof fromError?.name === "string") return fromError.name;
  return "";
}

function flattenErrorText(error: unknown): string {
  if (error === undefined || error === null) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return `${error.name} ${error.message}`;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function readFreeLimitResetAt(source: Record<string, unknown>): number | undefined {
  const candidates: unknown[] = [
    source.freeLimitResetAt,
    source.resetAt,
    (source.data as Record<string, unknown> | undefined)?.freeLimitResetAt,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return Math.max(0, Math.round(candidate - Date.now()));
    }
  }
  return undefined;
}

export function parseFreeLimitSignal(error: unknown): FreeLimitParseResult {
  if (error === undefined || error === null) return { signal: "no-limit" };

  const type = readErrorType(error);
  if (FREE_LIMIT_TYPES.has(type)) {
    const source = (typeof error === "object" ? (error as Record<string, unknown>) : {}) as Record<string, unknown>;
    return {
      signal: "free-daily-limit",
      retryAfterMs: readRetryAfterMs(source) ?? readFreeLimitResetAt(source),
      matchedBy: "error-type",
    };
  }
  if (TRANSIENT_TYPES.has(type)) {
    return { signal: "transient-rate-limit", matchedBy: "error-type" };
  }

  const text = flattenErrorText(error);
  if (FREE_LIMIT_TEXT_PATTERNS.some((pattern) => pattern.test(text))) {
    return { signal: "free-daily-limit", matchedBy: "text" };
  }
  if (TRANSIENT_TEXT_PATTERNS.some((pattern) => pattern.test(text))) {
    return { signal: "transient-rate-limit", matchedBy: "text" };
  }
  return { signal: "no-limit" };
}

export function isFreeDailyLimit(error: unknown): boolean {
  return parseFreeLimitSignal(error).signal === "free-daily-limit";
}

export function isTransientRateLimit(error: unknown): boolean {
  return parseFreeLimitSignal(error).signal === "transient-rate-limit";
}

export type FreeLimitBridgeConfig = { notice?: boolean; noRetry?: boolean };

export interface FreeLimitNotice {
  text: string;
  resetTime: string | null;
  hasDelay: boolean;
}

export interface FreeLimitNoticeStrings {
  heading: string;
  headingWithReset: string;
  sharedQuota: string;
  retryNoHelp: string;
}

export const DEFAULT_FREE_LIMIT_NOTICE_STRINGS: FreeLimitNoticeStrings = {
  heading: "OpenCode Zen free daily limit reached.",
  headingWithReset: "OpenCode Zen free daily limit reached — the quota resets in about {minutes} minute(s) at {time}.",
  sharedQuota:
    "The free daily quota is shared across every free model on the same identity (key/IP/trial bucket), so switching key or model does not help until the quota resets.",
  retryNoHelp: "Retrying is not useful until the quota resets.",
};

export function buildFreeLimitNotice(
  decision: FreeLimitBridgeDecision,
  now: number = Date.now(),
  strings: FreeLimitNoticeStrings = DEFAULT_FREE_LIMIT_NOTICE_STRINGS,
): FreeLimitNotice {
  if (decision.action !== "skip-retry") {
    return { text: "", resetTime: null, hasDelay: false };
  }
  const guidance = strings.sharedQuota;
  if (decision.retryAfterMs === undefined) {
    return {
      text: `${strings.heading} ${guidance} ${strings.retryNoHelp}`,
      resetTime: null,
      hasDelay: false,
    };
  }
  const resetTime = new Date(now + decision.retryAfterMs).toISOString();
  const minutes = Math.max(1, Math.round(decision.retryAfterMs / 60000));
  const heading = strings.headingWithReset
    .replace("{minutes}", String(minutes))
    .replace("{time}", resetTime);
  return {
    text: `${heading} ${guidance} ${strings.retryNoHelp}`,
    resetTime,
    hasDelay: true,
  };
}

export type FreeLimitBridgeDecision =
  | { action: "legacy"; reason: "flag-off" | "not-daily-limit" }
  | { action: "skip-retry"; reason: "daily-limit"; retryAfterMs?: number };

export function evaluateFreeLimitBridge(
  config: FreeLimitBridgeConfig | undefined,
  error: unknown,
): FreeLimitBridgeDecision {
  if (config?.noRetry !== true) {
    return { action: "legacy", reason: "flag-off" };
  }
  let signal: FreeLimitParseResult;
  try {
    signal = parseFreeLimitSignal(error);
  } catch {
    return { action: "legacy", reason: "not-daily-limit" };
  }
  if (signal.signal !== "free-daily-limit") {
    return { action: "legacy", reason: "not-daily-limit" };
  }
  return { action: "skip-retry", reason: "daily-limit", retryAfterMs: signal.retryAfterMs };
}
