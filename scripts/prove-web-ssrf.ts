import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __resetFirecrawlBreakerForTest,
  blockedFinalUrl,
  buildWebTool,
  cacheDir,
  isBlockedUrl,
  partitionCrawlDocs,
} from "../src/tools/web.ts";
import type { ToolContext, ToolResult } from "../src/tool.ts";

process.env.PI_FIRECRAWL_BASE_URL = "http://firecrawl.ssrf.invalid";
const cacheRoot = mkdtempSync(join(tmpdir(), "tawassul-web-ssrf-"));
process.env.TAWASSUL_WEB_CACHE_DIR = cacheRoot;

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

function context(): ToolContext {
  return {
    sessionID: "sess-web-ssrf",
    messageID: "msg-web-ssrf",
    agent: "tawa",
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata: () => undefined,
  };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let scrapeDoc: Record<string, unknown> = {};
let mapLinks: string[] = [];
let crawlDocs: Array<Record<string, unknown>> = [];

globalThis.fetch = (async (input: unknown) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
  if (href.endsWith("/v2/scrape")) return jsonResponse({ success: true, data: scrapeDoc });
  if (href.endsWith("/v2/map")) return jsonResponse({ success: true, links: mapLinks });
  if (href.endsWith("/v2/crawl")) {
    return jsonResponse({
      success: true,
      id: "crawl-ssrf",
      url: `${process.env.PI_FIRECRAWL_BASE_URL}/v2/crawl/crawl-ssrf`,
    });
  }
  if (href.endsWith("/v2/crawl/crawl-ssrf")) {
    return jsonResponse({ success: true, status: "completed", data: crawlDocs });
  }
  throw new Error(`unexpected fetch ${href}`);
}) as typeof fetch;

function cacheFiles(): string[] {
  try {
    return readdirSync(cacheDir()).filter((file) => file.endsWith(".txt"));
  } catch {
    return [];
  }
}

type WebArgs = Parameters<ReturnType<typeof buildWebTool>["execute"]>[0];

function run(args: WebArgs): Promise<ToolResult> {
  __resetFirecrawlBreakerForTest();
  return buildWebTool().execute(args, context());
}

const evil = [
  "http://127.0.0.1/",
  "http://0x7f.0.0.1/",
  "http://0177.0.0.1/",
  "http://2130706433/",
  "http://10.0.0.5/",
  "http://192.168.1.1/",
  "http://172.16.0.1/",
  "http://169.254.169.254/",
  "http://0.0.0.0/",
  "http://[::1]/",
  "http://[fc00::1]/",
  "http://[fe80::1]/",
  "http://[::ffff:127.0.0.2]/",
  "file:///etc/passwd",
];

const benign = ["https://example.com/", "https://8.8.8.8/", "https://1.1.1.1/"];

async function main(): Promise<void> {
  for (const url of evil) {
    if (isBlockedUrl(url) === null) fail(`evil url passed: ${url}`);
  }
  passed += evil.length;
  console.log(`evil ok (${evil.length} blocked)`);

  for (const url of benign) {
    const reason = isBlockedUrl(url);
    if (reason !== null) fail(`benign url blocked: ${url} :: ${reason}`);
  }
  passed += benign.length;
  console.log(`benign ok (${benign.length} passed)`);

  assert(
    blockedFinalUrl("https://example.com/start", {
      metadata: { sourceURL: "http://169.254.169.254/latest/meta-data" },
    }) !== null,
    "a redirect to the metadata service is blocked",
  );
  assert(
    blockedFinalUrl("https://example.com/start", {
      metadata: { sourceURL: "https://example.com/final" },
    }) === null,
    "a redirect to a public host stays clean",
  );
  assert(
    blockedFinalUrl("https://example.com/start", {}) === null,
    "a response without a final URL is not a false positive",
  );
  assert(
    blockedFinalUrl("https://example.com/start", { url: "http://10.0.0.5/" }) !== null,
    "a top-level final URL is re-checked",
  );
  assert(
    blockedFinalUrl("https://example.com/start", {
      metadata: { sourceURL: "file:///etc/passwd" },
    }) !== null,
    "a file final URL is blocked",
  );

  const mixed = partitionCrawlDocs("https://example.com/start", [
    { markdown: "clean", metadata: { sourceURL: "https://example.com/page" } },
    { markdown: "secret", metadata: { sourceURL: "http://192.168.1.10/admin" } },
  ]);
  assert(mixed.safe.length === 1 && mixed.blocked.length === 1, "crawl partitions a clean page from a blocked page");
  const allBlocked = partitionCrawlDocs("https://example.com/start", [
    { metadata: { sourceURL: "http://127.0.0.1/" } },
  ]);
  assert(allBlocked.safe.length === 0 && allBlocked.blocked.length === 1, "crawl can detect an all-blocked result");

  scrapeDoc = {
    markdown: "SECRET METADATA",
    metadata: { sourceURL: "http://169.254.169.254/latest/meta-data", statusCode: 200 },
  };
  const blockedFetch = outputText(
    await run({ action: "fetch", url: "https://example.com/start", noCache: true }),
  );
  assert(blockedFetch.includes("redirect blocked"), "fetch reports a blocked redirect");
  assert(!blockedFetch.includes("SECRET METADATA"), "fetch does not return the redirected body");
  assert(cacheFiles().length === 0, "a blocked redirect is not cached");

  scrapeDoc = {
    markdown: "clean body",
    metadata: { sourceURL: "https://example.com/final", statusCode: 200 },
  };
  const cleanFetch = outputText(
    await run({ action: "fetch", url: "https://example.com/start", noCache: true }),
  );
  assert(cleanFetch.includes("clean body"), "a clean redirect returns its content");
  assert(!cleanFetch.includes("redirect blocked"), "a clean redirect is not rejected");

  scrapeDoc = { markdown: "SECRET DIRECT", url: "http://10.0.0.5/" };
  const directFetch = outputText(
    await run({ action: "fetch", url: "https://example.com/start", noCache: true }),
  );
  assert(directFetch.includes("redirect blocked"), "a top-level final URL is rejected in the fetch path");
  assert(!directFetch.includes("SECRET DIRECT"), "the top-level final URL body is not returned");

  scrapeDoc = { markdown: "no url body" };
  const noUrlFetch = outputText(
    await run({ action: "fetch", url: "https://example.com/start", noCache: true }),
  );
  assert(noUrlFetch.includes("no url body"), "a response without a final URL is still returned");

  mapLinks = [
    "https://example.com/ok",
    "http://127.0.0.1/admin",
    "http://10.0.0.5/private",
  ];
  const mapOutput = outputText(
    await run({ action: "map", url: "https://example.com", noCache: true }),
  );
  assert(mapOutput.includes("https://example.com/ok"), "map keeps a public link");
  assert(!mapOutput.includes("127.0.0.1"), "map drops a loopback link");
  assert(!mapOutput.includes("10.0.0.5"), "map drops a private link");
  assert(mapOutput.includes("Blocked 2 link(s)"), "map reports the dropped links");

  crawlDocs = [
    { markdown: "clean page", metadata: { sourceURL: "https://example.com/page" } },
    { markdown: "SECRET CRAWL", metadata: { sourceURL: "http://192.168.1.10/admin" } },
  ];
  const crawlOutput = outputText(
    await run({ action: "crawl", url: "https://example.com", wait: true, maxWaitSeconds: 5 }),
  );
  assert(crawlOutput.includes("clean page"), "crawl keeps a clean page");
  assert(!crawlOutput.includes("SECRET CRAWL"), "crawl drops a blocked page");
  assert(crawlOutput.includes("Blocked 1 page(s)"), "crawl reports the dropped page");

  console.log(`PROOF PASS: web SSRF CIDR backstop and final-URL recheck (${passed} assertions)`);
}

main()
  .catch((e) => {
    if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
      console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
      process.exitCode = 1;
    }
  })
  .finally(() => {
    delete process.env.TAWASSUL_WEB_CACHE_DIR;
    delete process.env.PI_FIRECRAWL_BASE_URL;
    rmSync(cacheRoot, { recursive: true, force: true });
  });
