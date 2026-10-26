import { buildWebTool, __resetFirecrawlBreakerForTest } from "../src/tools/web.ts";
import type { ToolContext, ToolResult } from "../src/tool.ts";

process.env.PI_FIRECRAWL_BASE_URL = "http://firecrawl.e29.invalid";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

function outputText(result: ToolResult): string {
  return typeof result === "string" ? result : result.output;
}

let fetchCalls = 0;
let responseStatus = 500;
let responseBody = "upstream failure";

globalThis.fetch = (async () => {
  fetchCalls++;
  const ok = responseStatus < 400;
  return {
    ok,
    status: responseStatus,
    statusText: ok ? "OK" : "Error",
    text: async () => (ok ? responseBody : `upstream failure ${responseStatus}`),
  } as unknown as Response;
}) as typeof fetch;

function context(signal?: AbortSignal): ToolContext {
  return {
    sessionID: "sess-e29",
    messageID: "msg-e29",
    agent: "tawa",
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: signal ?? new AbortController().signal,
    metadata: () => undefined,
  };
}

function fetchPage(signal?: AbortSignal): Promise<ToolResult> {
  return buildWebTool().execute(
    { action: "fetch", url: "https://example.com/e29", noCache: true },
    context(signal),
  );
}

async function failedRequestDoesNotTripTheBreaker(): Promise<void> {
  __resetFirecrawlBreakerForTest();
  fetchCalls = 0;
  responseStatus = 500;

  const first = outputText(await fetchPage());
  assert(first.includes("HTTP 500"), "a failed fetch reports the upstream status instead of a result");
  assert(fetchCalls === 4, "one failing request still makes the initial attempt plus three retries");

  const beforeSecond = fetchCalls;
  responseStatus = 404;
  const second = outputText(await fetchPage());
  assert(second.includes("HTTP 404"), "the next request is attempted instead of being refused by the breaker");
  assert(
    fetchCalls === beforeSecond + 1,
    "one failed request does not open the breaker: the next request still reaches the upstream",
  );
  assert(!second.includes("circuit OPEN"), "the second request is not refused with an open circuit");
}

async function separateFailuresStillOpenTheBreaker(): Promise<void> {
  __resetFirecrawlBreakerForTest();
  fetchCalls = 0;
  responseStatus = 404;

  for (let i = 0; i < 3; i++) {
    const out = outputText(await fetchPage());
    assert(out.includes("HTTP 404"), `client error ${i + 1} is reported as a failure`);
  }
  assert(fetchCalls === 3, "a client error is not retried, so each request costs one attempt");

  const beforeOpen = fetchCalls;
  const refused = outputText(await fetchPage());
  assert(fetchCalls === beforeOpen, "an open breaker refuses the request without calling the upstream");
  assert(refused.includes("circuit OPEN"), "the refused request names the open circuit");
}

async function successClearsTheFailureCount(): Promise<void> {
  __resetFirecrawlBreakerForTest();
  fetchCalls = 0;
  responseStatus = 404;
  await fetchPage();
  await fetchPage();
  assert(fetchCalls === 2, "two client errors are attempted once each");

  responseStatus = 200;
  responseBody = JSON.stringify({ success: true, data: { markdown: "# e29 ok", metadata: { title: "e29" } } });
  const ok = outputText(await fetchPage());
  assert(ok.includes("e29 ok"), "a successful request returns the fetched content");

  responseStatus = 404;
  const beforeFailures = fetchCalls;
  const afterSuccess = outputText(await fetchPage());
  const secondAfterSuccess = outputText(await fetchPage());
  assert(afterSuccess.includes("HTTP 404"), "a failure after a success is still attempted");
  assert(
    secondAfterSuccess.includes("HTTP 404"),
    "a success cleared the earlier failures, so two later failures still reach the upstream",
  );
  assert(fetchCalls === beforeFailures + 2, "the two failures after the success were both attempted once");
}

async function abortedRequestIsNotAServiceFailure(): Promise<void> {
  __resetFirecrawlBreakerForTest();
  fetchCalls = 0;
  responseStatus = 500;

  const controller = new AbortController();
  controller.abort();
  const out = outputText(await fetchPage(controller.signal));
  assert(!out.includes("HTTP 500"), "an aborted request does not report an upstream failure");

  responseStatus = 404;
  const probes: string[] = [];
  for (let i = 0; i < 3; i++) probes.push(outputText(await fetchPage()));
  assert(
    probes.every((out) => out.includes("HTTP 404")),
    "three client errors after an abort still reach the upstream, so the abort was not counted",
  );
}

try {
  await failedRequestDoesNotTripTheBreaker();
  await separateFailuresStillOpenTheBreaker();
  await successClearsTheFailureCount();
  await abortedRequestIsNotAServiceFailure();
  console.log(
    `PROOF PASS: the web breaker counts one failure per request and still protects the surface (${passed} assertions)`,
  );
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
