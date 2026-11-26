import "./proof-log-isolate.ts";
import { buildWebTool, __resetFirecrawlBreakerForTest } from "../src/tools/web.ts";
import type { ToolContext, ToolResult } from "../src/tool.ts";

process.env.PI_FIRECRAWL_BASE_URL = "http://firecrawl.e36.invalid";

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

type Scenario = { status: string; error?: unknown; data?: unknown[] };

let scenario: Scenario = { status: "completed", data: [] };
let startFails = false;
let crawlCounter = 0;

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

globalThis.fetch = (async (input: unknown) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
  if (href.endsWith("/v2/crawl")) {
    if (startFails) {
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "upstream failure",
      } as unknown as Response;
    }
    const id = `crawl-${++crawlCounter}`;
    return jsonResponse({ success: true, id, url: `${process.env.PI_FIRECRAWL_BASE_URL}/v2/crawl/${id}` });
  }
  if (/\/v2\/crawl\/[^/]+$/.test(href)) {
    return jsonResponse({ success: true, ...scenario });
  }
  throw new Error(`unexpected fetch ${href}`);
}) as typeof fetch;

function context(): ToolContext {
  return {
    sessionID: "sess-e36",
    messageID: "msg-e36",
    agent: "tawa",
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata: () => undefined,
  };
}

function runCrawl(): Promise<ToolResult> {
  return buildWebTool().execute(
    { action: "crawl", url: "https://example.com", maxWaitSeconds: 5, wait: true },
    context(),
  );
}

function outputText(result: ToolResult): string {
  return typeof result === "string" ? result : result.output;
}

async function rejection(promise: Promise<ToolResult>): Promise<Error | undefined> {
  try {
    await promise;
    return undefined;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

async function failedCrawlRejects(): Promise<void> {
  scenario = { status: "failed", error: "blocked by robots.txt" };
  const error = await rejection(runCrawl());
  assert(error !== undefined, "a failed crawl rejects instead of returning a successful result");
  assert(error?.message.includes("failed") === true, "the rejection names the failed crawl");
  assert(
    error?.message.includes("blocked by robots.txt") === true,
    "the rejection carries the upstream failure reason",
  );
}

async function cancelledCrawlRejects(): Promise<void> {
  scenario = { status: "cancelled", error: { message: "stopped by the operator" } };
  const error = await rejection(runCrawl());
  assert(error !== undefined, "a cancelled crawl rejects instead of returning a successful result");
  assert(error?.message.includes("cancelled") === true, "the rejection names the cancelled crawl");
  assert(
    error?.message.includes("stopped by the operator") === true,
    "the rejection carries a structured upstream reason",
  );
}

async function completedCrawlStillSucceeds(): Promise<void> {
  scenario = {
    status: "completed",
    data: [{ markdown: "# E36 page", metadata: { title: "E36 page" } }],
  };
  const result = await runCrawl();
  const text = outputText(result);
  assert(text.includes("E36 page"), "a completed crawl still returns its pages");
  assert(
    typeof result !== "string" && result.title === "🕸️ Web Crawl",
    "a completed crawl keeps its normal result title",
  );
}

async function emptyCrawlIsNotAFailure(): Promise<void> {
  scenario = { status: "completed", data: [] };
  const result = await runCrawl();
  const text = outputText(result);
  assert(text.includes("status: completed"), "a legitimately empty completed crawl is not treated as a failure");
}

async function nonTerminalErrorsStayReadable(): Promise<void> {
  startFails = true;
  const result = await runCrawl();
  startFails = false;
  const text = outputText(result);
  assert(text.includes("Error:") && text.includes("HTTP 404"), "a start failure still returns a readable error result");
}

try {
  __resetFirecrawlBreakerForTest();
  await failedCrawlRejects();
  await cancelledCrawlRejects();
  await completedCrawlStillSucceeds();
  await emptyCrawlIsNotAFailure();
  await nonTerminalErrorsStayReadable();
  console.log(
    `PROOF PASS: a failed or cancelled crawl is an error, while a completed crawl is still a result (${passed} assertions)`,
  );
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
