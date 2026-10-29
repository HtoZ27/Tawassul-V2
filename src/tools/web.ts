import type { ToolContext } from "../tool.ts";
import { tool } from "../tool.ts";
import { mkdir, writeFile, readFile, readdir, unlink, stat, rename, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { unlinkSync } from "node:fs";
import { withTimeout } from "../utils/with-timeout.ts";
import { globalCacheBaseDir } from "../utils/path-resolver.ts";
import { v2NamespaceRoot } from "../utils/state-paths.ts";
import { CircuitBreaker } from "../services/circuit-breaker.ts";



const DEFAULT_FETCH_MAX_CHARS = 20_000;
const DEFAULT_SEARCH_RESULT_CHARS = 4_000;
const DEFAULT_CRAWL_PAGE_CHARS = 4_000;
const DEFAULT_MAX_BYTES = 200_000;
const DEFAULT_MAX_LINES = 4_000;
const DEFAULT_CACHE_TTL_MS = 15 * 60_000;


const FIRECRAWL_TIMEOUT_MS = 30_000; 
const FIRECRAWL_MAX_CONCURRENT = 3; 




const MAX_CACHE_FILES = 300;
const CACHE_EVICT_BUFFER = 50;

async function evictIfOverCap(): Promise<void> {
  try {
    let files: string[] = [];
    try {
      files = (await readdir(cacheDir())).filter((f) => f.endsWith(".txt") && !f.endsWith(".tmp"));
    } catch {
      return;
    }
    if (files.length <= MAX_CACHE_FILES) return;
    const target = MAX_CACHE_FILES - CACHE_EVICT_BUFFER;
    const withMtime = await Promise.all(
      files.map(async (f) => ({ f, m: (await stat(join(cacheDir(), f)).catch(() => null))?.mtimeMs ?? 0 })),
    );
    withMtime.sort((a, b) => a.m - b.m);
    const excess = withMtime.length - target;
    for (let i = 0; i < excess; i++) {
      const file = withMtime[i];
      if (!file) continue;
      await unlink(join(cacheDir(), file.f)).catch(() => {});
    }
  } catch {

  }
}


const _firecrawlBreaker = new CircuitBreaker(3, 60_000);

const _tempOutputs = new Set<string>();

export function registerTempFile(filePath: string): void {
  _tempOutputs.add(filePath);
}

export async function cleanupAllTempOutputs(): Promise<void> {
  for (const file of [..._tempOutputs]) {
    try {
      await unlink(file);
      _tempOutputs.delete(file);
      const sep = file.lastIndexOf("/");
      const dir = sep > 0 ? file.slice(0, sep) : undefined;
      if (dir && dir.startsWith(tmpdir())) {
        const remaining = await readdir(dir).catch(() => [] as string[]);
        if (remaining.length === 0) await rmEmptyDir(dir);
      }
    } catch {
      _tempOutputs.delete(file);
    }
  }
}

async function rmEmptyDir(dir: string): Promise<void> {
  try {
    await rmdir(dir);
  } catch {

  }
}

export function getTempOutputCount(): number {
  return _tempOutputs.size;
}

export function __resetTempOutputsForTest(): void {
  _tempOutputs.clear();
}

if (typeof process !== "undefined") {
  
  
  process.once("exit", () => {
    for (const file of _tempOutputs) {
      try {
        unlinkSync(file);
      } catch {

      }
    }
    _tempOutputs.clear();
  });
}


let _firecrawlPermits = FIRECRAWL_MAX_CONCURRENT;
const _firecrawlWaiters: Array<() => void> = [];

async function acquireFirecrawlPermit(): Promise<void> {
  if (_firecrawlPermits > 0) {
    _firecrawlPermits--;
    return;
  }
  await new Promise<void>((resolve) => _firecrawlWaiters.push(resolve));
}

function releaseFirecrawlPermit(): void {
  const next = _firecrawlWaiters.shift();
  if (next) next();
  else _firecrawlPermits++;
}

export function __resetFirecrawlBreakerForTest(): void {
  _firecrawlBreaker.resetAll();
}

function jitteredDelay(baseDelayMs: number): number {
  return Math.round(baseDelayMs * (0.8 + Math.random() * 0.4));
}



function isClientError(e: unknown): boolean {
  return e instanceof Error && /HTTP 4\d\d/.test(e.message);
}

class WebTerminalError extends Error {}

function describeCrawlError(status: Record<string, unknown>): string {
  const raw = status.error;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (raw && typeof raw === "object") {
    const message = (raw as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return "no reason given";
}


export function cacheDir(): string {
  return process.env.TAWASSUL_WEB_CACHE_DIR ?? join(v2NamespaceRoot(globalCacheBaseDir()), "web-cache");
}

const SSRF_BLOCKED_HOSTS = ["169.254.169.254", "127.0.0.1", "127.0.1.1", "0.0.0.0", "localhost", "::1"];
const SSRF_BLOCKED_PREFIXES = [
  "10.",
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  "192.168.",
];
const SSRF_BLOCKED_SUFFIXES = [".local", ".internal"];

function ipv4FromHex(hex: string): string | null {
  const num = parseInt(hex, 16);
  if (num >= 0 && num <= 0xffffffff) {
    return `${(num >> 24) & 0xff}.${(num >> 16) & 0xff}.${(num >> 8) & 0xff}.${num & 0xff}`;
  }
  return null;
}

function ipv4FromHexSegments(segments: string[]): string | null {
  if (segments.length !== 2) return null;
  const padded = segments.map((s) => s.padStart(4, "0"));
  const hex = padded.join("");
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length !== 8) return null;
  return ipv4FromHex(hex);
}

export function normalizeIpAddress(host: string): string {
  if (/^0x[0-9a-f]+$/i.test(host)) {
    return ipv4FromHex(host.slice(2)) ?? host;
  }

  if (host.includes(".")) {
    const parts = host.split(".");
    const hasOctal = parts.some((p) => p.length > 1 && p[0] === "0" && /^[0-7]+$/.test(p));
    if (parts.length === 4 && hasOctal) {
      return parts
        .map((p) => (p.length > 1 && p[0] === "0" && /^[0-7]+$/.test(p) ? parseInt(p, 8).toString(10) : p))
        .join(".");
    }
    return host;
  }

  if (/^\d+$/.test(host)) {
    const num = parseInt(host, 10);
    if (num >= 0 && num <= 0xffffffff) {
      return `${(num >> 24) & 0xff}.${(num >> 16) & 0xff}.${(num >> 8) & 0xff}.${num & 0xff}`;
    }
  }

  return host;
}

export function isBlockedUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return `SSRF: file:// protocol blocked`;
    if (parsed.protocol === "unix:") return `SSRF: unix socket blocked`;

    let host = parsed.hostname.toLowerCase();

    if (host.startsWith("[")) host = host.slice(1);
    if (host.endsWith("]")) host = host.slice(0, -1);

    if (host.startsWith("::ffff:")) {
      const suffix = host.slice(7);
      if (suffix.includes(".")) {
        const v = ipv4ToInt(suffix);
        if (v !== null) {
          host = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff].join(".");
        }
      } else {
        const segments = suffix.split(":");
        if (segments.length > 0) {
          const converted = ipv4FromHexSegments(segments);
          if (converted) host = converted;
        }
      }
    }

    if (host.endsWith(".")) {
      host = host.slice(0, -1);
    }

    host = normalizeIpAddress(host);

    if (SSRF_BLOCKED_HOSTS.includes(host)) return `SSRF: ${host} blocked`;
    for (const prefix of SSRF_BLOCKED_PREFIXES) {
      if (host.startsWith(prefix)) return `SSRF: private IP ${host} blocked`;
    }
    for (const suffix of SSRF_BLOCKED_SUFFIXES) {
      if (host.endsWith(suffix)) return `SSRF: internal hostname ${host} blocked`;
    }

    const v4 = ipv4ToInt(host);
    if (v4 !== null) {
      if (
        inCidr(v4, 0x7f000000, 8) ||
        inCidr(v4, 0x0a000000, 8) ||
        inCidr(v4, 0xac100000, 12) ||
        inCidr(v4, 0xc0a80000, 16) ||
        inCidr(v4, 0xa9fe0000, 16) ||
        inCidr(v4, 0x64400000, 10) ||
        v4 === 0x00000000
      ) {
        return `SSRF: private IP ${host} blocked`;
      }
    } else if (host.includes(":")) {
      const h = host.toLowerCase();
      if (h === "::1") return `SSRF: ${host} blocked`;
      if (h.startsWith("fc") || h.startsWith("fd")) return `SSRF: private IP ${host} blocked`;
      if (/^fe[89ab]/i.test(h.split(":")[0] ?? "")) return `SSRF: private IP ${host} blocked`;
    }

    return null;
  } catch {
    return `SSRF: invalid URL`;
  }
}

function docFinalUrl(doc: Record<string, unknown>): string | undefined {
  if (!doc || typeof doc !== "object") return undefined;
  const metadata = doc.metadata;
  if (metadata && typeof metadata === "object") {
    for (const key of ["sourceURL", "url"] as const) {
      const value = (metadata as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  const direct = doc.url;
  return typeof direct === "string" && direct.trim() ? direct.trim() : undefined;
}

export function blockedFinalUrl(requested: string, doc: Record<string, unknown>): string | null {
  const finalUrl = docFinalUrl(doc);
  if (!finalUrl || finalUrl === requested) return null;
  return isBlockedUrl(finalUrl);
}

export function partitionCrawlDocs(
  requested: string,
  docs: ReadonlyArray<Record<string, unknown>>,
): { safe: Array<Record<string, unknown>>; blocked: string[] } {
  const safe: Array<Record<string, unknown>> = [];
  const blocked: string[] = [];
  for (const doc of docs) {
    const reason = blockedFinalUrl(requested, doc);
    if (reason) blocked.push(reason);
    else safe.push(doc);
  }
  return { safe, blocked };
}

function ipv4ToInt(host: string): number | null {
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(p)) return null;
    const n =
      p.startsWith("0x") || p.startsWith("0X")
        ? parseInt(p, 16)
        : p.length > 1 && p[0] === "0" && /^[0-7]+$/.test(p)
          ? parseInt(p, 8)
          : parseInt(p, 10);
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null;
    nums.push(n);
  }
  let val = 0;
  if (nums.length === 1) {
    val = nums[0]!;
  } else {
    for (let i = 0; i < nums.length - 1; i++) {
      if (nums[i]! > 0xff) return null;
      val = (val << 8) | nums[i]!;
    }
    const last = nums[nums.length - 1]!;
    const maxLast = 2 ** (8 * (5 - nums.length)) - 1;
    if (last > maxLast) return null;
    val = (val << (8 * (4 - (nums.length - 1)))) | last;
  }
  return val >>> 0;
}

function inCidr(ip: number, net: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (net & mask);
}

export function cacheKey(action: string, params: Record<string, unknown>): string {
  return createHash("sha256")
    .update(`${action}:${JSON.stringify(params)}`)
    .digest("hex");
}

type CacheEnvelope = { expiresAt: number; text: string };

export async function cacheGet(key: string, ttlMs = DEFAULT_CACHE_TTL_MS): Promise<string | null> {
  try {
    const file = join(cacheDir(), `${key}.txt`);
    const raw = await readFile(file, "utf8");
    const envelope = JSON.parse(raw) as CacheEnvelope;
    if (!envelope || typeof envelope.text !== "string") return null;
    
    const effectiveExpiry = Math.min(envelope.expiresAt, Date.now() + ttlMs);
    if (Date.now() > effectiveExpiry) {
      await unlink(file).catch(() => {});
      return null;
    }
    return envelope.text;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, text: string): Promise<void> {
  await mkdir(cacheDir(), { recursive: true });
  const envelope: CacheEnvelope = { expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS, text };
  const target = join(cacheDir(), `${key}.txt`);
  const tmp = join(cacheDir(), `${key}.txt.tmp`);
  await writeFile(tmp, JSON.stringify(envelope), "utf8");
  await rename(tmp, target);
  await evictIfOverCap();
}

export async function cacheList(): Promise<{ key: string; bytes: number }[]> {
  try {
    const files = await readdir(cacheDir());
    const result: { key: string; bytes: number }[] = [];
    for (const f of files) {
      if (!f.endsWith(".txt") || f.endsWith(".tmp")) continue;
      const st = await stat(join(cacheDir(), f)).catch(() => null);
      if (!st) continue;
      result.push({ key: f.slice(0, -4), bytes: st.size });
    }
    return result;
  } catch {
    return [];
  }
}

export async function cacheClear(): Promise<number> {
  try {
    const files = await readdir(cacheDir());
    let n = 0;
    for (const f of files) {
      if (f.endsWith(".txt")) {
        await unlink(join(cacheDir(), f)).catch(() => {});
        n++;
      }
    }
    return n;
  } catch {
    return 0;
  }
}

function baseUrl(): string {
  const url = process.env.PI_FIRECRAWL_BASE_URL || process.env.FIRECRAWL_BASE_URL;
  if (!url) {
    throw new Error("Missing PI_FIRECRAWL_BASE_URL or FIRECRAWL_BASE_URL environment variable");
  }
  return url.replace(/\/+$/, "");
}

function apiKey(): string | undefined {
  return process.env.PI_FIRECRAWL_API_KEY || process.env.FIRECRAWL_API_KEY;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function parseCommaList(value: unknown, allowed?: readonly string[]): string[] {
  const raw = Array.isArray(value)
    ? value.map(String)
    : asString(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const allowedSet = allowed ? new Set(allowed) : undefined;
  return raw.filter((item) => !allowedSet || allowedSet.has(item));
}

function timeRangeToTbs(value: unknown): string | undefined {
  const normalized = asString(value).trim().toLowerCase();
  if (!normalized) return undefined;
  if (["day", "d", "24h"].includes(normalized)) return "qdr:d";
  if (["week", "w", "7d"].includes(normalized)) return "qdr:w";
  if (["month", "m", "30d"].includes(normalized)) return "qdr:m";
  if (["year", "y", "365d"].includes(normalized)) return "qdr:y";
  return normalized;
}

function headers(): Record<string, string> {
  const result: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "tawassul-web/1.0",
  };
  const key = apiKey();
  if (key) result.Authorization = `Bearer ${key}`;
  return result;
}

async function parseResponse(response: Response, path: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  let data: Record<string, unknown> | undefined;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = undefined;
  }
  if (!response.ok || data?.success === false) {
    const message = data?.error || data?.message || text.slice(0, 800) || response.statusText;
    throw new Error(`Firecrawl ${path} failed: HTTP ${response.status} - ${message}`);
  }
  return data ?? { raw: text };
}

async function firecrawlPost(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  maxRetries = 3,
): Promise<Record<string, unknown>> {
  if (_firecrawlBreaker.evaluate("firecrawl") === "OPEN") {
    throw new Error("Firecrawl circuit OPEN — skipping request (recent failures)");
  }
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await acquireFirecrawlPermit()
        .then(() =>
          withTimeout(
            (s) =>
              fetch(`${baseUrl()}${path}`, {
                method: "POST",
                headers: headers(),
                body: JSON.stringify(body),
                signal: s,
              }),
            { timeoutMs: FIRECRAWL_TIMEOUT_MS, signal },
          ),
        )
        .finally(() => releaseFirecrawlPermit());
      const parsed = await parseResponse(response, path);
      _firecrawlBreaker.recordSuccess("firecrawl");
      return parsed;
    } catch (e) {
      if (attempt === maxRetries || signal?.aborted || isClientError(e)) {
        if (!signal?.aborted) _firecrawlBreaker.recordFailure("firecrawl");
        throw e;
      }
      await new Promise((r) => setTimeout(r, jitteredDelay(Math.min(1000 * 2 ** attempt, 10_000))));
    }
  }
  throw new Error("unreachable");
}

async function firecrawlGet(path: string, signal?: AbortSignal, maxRetries = 2): Promise<Record<string, unknown>> {
  if (_firecrawlBreaker.evaluate("firecrawl") === "OPEN") {
    throw new Error("Firecrawl circuit OPEN — skipping request (recent failures)");
  }
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await acquireFirecrawlPermit()
        .then(() =>
          withTimeout(
            (s) =>
              fetch(`${baseUrl()}${path}`, {
                method: "GET",
                headers: headers(),
                signal: s,
              }),
            { timeoutMs: FIRECRAWL_TIMEOUT_MS, signal },
          ),
        )
        .finally(() => releaseFirecrawlPermit());
      const parsed = await parseResponse(response, path);
      _firecrawlBreaker.recordSuccess("firecrawl");
      return parsed;
    } catch (e) {
      if (attempt === maxRetries || signal?.aborted || isClientError(e)) {
        if (!signal?.aborted) _firecrawlBreaker.recordFailure("firecrawl");
        throw e;
      }
      await new Promise((r) => setTimeout(r, jitteredDelay(Math.min(1000 * 2 ** attempt, 5_000))));
    }
  }
  throw new Error("unreachable");
}

async function writeTempOutput(prefix: string, output: string): Promise<string> {
  const tempDir = join(tmpdir(), prefix);
  await mkdir(tempDir, { recursive: true });
  const tempFile = join(tempDir, `output-${Date.now()}-${randomBytes(4).toString("hex")}.txt`);
  await writeFile(tempFile, output, "utf8");
  
  
  registerTempFile(tempFile);
  return tempFile;
}

async function cleanupTempOutputs(paths: string[]): Promise<void> {
  for (const file of paths) {
    try {
      await unlink(file);
      _tempOutputs.delete(file);
    } catch {
      _tempOutputs.delete(file);
    }
  }
}

function truncateHead(output: string, opts: { maxLines: number; maxBytes: number }) {
  const totalBytes = Buffer.byteLength(output, "utf8");
  const lines = output.split("\n");
  const totalLines = lines.length;
  if (totalBytes <= opts.maxBytes && totalLines <= opts.maxLines) {
    return {
      truncated: false,
      content: output,
      outputLines: totalLines,
      totalLines,
      outputBytes: totalBytes,
      totalBytes,
    };
  }
  const kept = lines.slice(0, opts.maxLines).join("\n");
  const sliced = kept.slice(0, opts.maxBytes);
  return {
    truncated: true,
    content: sliced,
    outputLines: sliced.split("\n").length,
    totalLines,
    outputBytes: Buffer.byteLength(sliced, "utf8"),
    totalBytes,
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function truncateOutput(output: string, tempPrefix: string) {
  const truncation = truncateHead(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  if (!truncation.truncated) return { text: output };
  const fullOutputPath = await writeTempOutput(tempPrefix, output);
  let text = truncation.content;
  text += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
  text += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
  text += ` Full output saved to: ${fullOutputPath}]`;
  return { text, truncation, fullOutputPath };
}

function clip(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, maxChars)}\n\n[Field truncated at ${maxChars.toLocaleString()} of ${text.length.toLocaleString()} chars]`,
    truncated: true,
  };
}

function documentContent(doc: Record<string, unknown>, maxChars: number): { text: string; truncatedFields: string[] } {
  const parts: string[] = [];
  const truncatedFields: string[] = [];
  const add = (label: string, value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return;
    const clipped = clip(value.trim(), maxChars);
    if (clipped.truncated) truncatedFields.push(label);
    parts.push(`${label}:\n${clipped.text}`);
  };
  add("Markdown", (doc as Record<string, unknown>).markdown ?? (doc as Record<string, unknown>).content);
  add("Summary", (doc as Record<string, unknown>).summary);
  if ((doc as Record<string, unknown>).json !== undefined)
    add("JSON", JSON.stringify((doc as Record<string, unknown>).json, null, 2));
  if (
    Array.isArray((doc as Record<string, unknown>).links) &&
    ((doc as Record<string, unknown>).links as unknown[]).length
  )
    add("Links", ((doc as Record<string, unknown>).links as string[]).join("\n"));
  if (
    Array.isArray((doc as Record<string, unknown>).images) &&
    ((doc as Record<string, unknown>).images as unknown[]).length
  )
    add("Images", ((doc as Record<string, unknown>).images as string[]).join("\n"));
  add("HTML", (doc as Record<string, unknown>).html);
  add("Raw HTML", (doc as Record<string, unknown>).rawHtml);
  return { text: parts.join("\n\n") || "(No content returned.)", truncatedFields };
}

function documentHeader(doc: Record<string, unknown>): string {
  const metadata = ((doc as Record<string, unknown>).metadata ?? {}) as Record<string, unknown>;
  const docRecord = doc as Record<string, unknown>;
  const lines = [
    metadata.title || docRecord.title ? `Title: ${metadata.title || docRecord.title}` : undefined,
    metadata.description || docRecord.description
      ? `Description: ${metadata.description || docRecord.description}`
      : undefined,
    metadata.sourceURL || metadata.url || docRecord.url
      ? `URL: ${metadata.sourceURL || metadata.url || docRecord.url}`
      : undefined,
    metadata.statusCode ? `Status: ${metadata.statusCode}` : undefined,
    metadata.contentType ? `Content-Type: ${metadata.contentType}` : undefined,
  ].filter(Boolean);
  return lines.join("\n");
}

function parseFormats(value: unknown): string[] {
  const formats = parseCommaList(value || "markdown", ["markdown", "html", "rawHtml", "links", "images", "summary"]);
  return formats.length ? formats : ["markdown"];
}

async function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error("Cancelled");
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  if (signal?.aborted) throw new Error("Cancelled");
}

export function buildWebTool() {
  return tool({
    description:
      "Web fetch/search/map/crawl via a self-hosted Firecrawl instance (set FIRECRAWL_BASE_URL / FIRECRAWL_API_KEY). The local SSRF preflight blocks private targets, but Firecrawl performs the egress; a returned final URL is re-checked before its content is used.",
    args: {
      action: tool.schema.enum(["fetch", "search", "map", "crawl", "cache"]).describe("Web operation"),
      noCache: tool.schema
        .boolean()
        .optional()
        .describe("fetch/search/map: skip reading/writing the response cache (default false)"),
      cacheAction: tool.schema.string().optional().describe("cache: list (default) or clear"),
      url: tool.schema.string().optional().describe("URL for fetch/map/crawl"),
      query: tool.schema.string().optional().describe("Search query for search"),
      formats: tool.schema.string().optional().describe("fetch: comma list markdown,html,rawHtml,links,images,summary"),
      onlyMainContent: tool.schema.boolean().optional().describe("fetch: extract only main content (default true)"),
      waitFor: tool.schema.number().optional().describe("fetch: ms to wait after load (0-60000)"),
      timeout: tool.schema.number().optional().describe("fetch: Firecrawl timeout ms (1000-180000)"),
      maxChars: tool.schema.number().optional().describe("fetch: max chars per content field (1000-100000)"),
      limit: tool.schema.number().optional().describe("search/map/crawl: result/page limit"),
      sources: tool.schema.string().optional().describe("search: web,news,images"),
      categories: tool.schema.string().optional().describe("search: github,research,pdf"),
      timeRange: tool.schema.string().optional().describe("search: day,week,month,year or qdr:…"),
      scrapeResults: tool.schema.boolean().optional().describe("search: also scrape result pages (default false)"),
      search: tool.schema.string().optional().describe("map: filter discovered URLs"),
      sitemap: tool.schema.string().optional().describe("map: include|skip|only"),
      includeSubdomains: tool.schema.boolean().optional().describe("map: include subdomains (default true)"),
      includePaths: tool.schema.string().optional().describe("crawl: comma list include paths"),
      excludePaths: tool.schema.string().optional().describe("crawl: comma list exclude paths"),
      maxDiscoveryDepth: tool.schema.number().optional().describe("crawl: max discovery depth (0-10)"),
      wait: tool.schema.boolean().optional().describe("crawl: wait for completion (default true)"),
      maxWaitSeconds: tool.schema.number().optional().describe("crawl: max seconds to wait (5-300)"),
      maxCharsPerPage: tool.schema.number().optional().describe("crawl: max chars per page (500-20000)"),
    },
    async execute(args: Record<string, unknown>, cctx: ToolContext) {
      const createdThisRun: string[] = [];
      const trackTruncated = (truncated: { fullOutputPath?: string }) => {
        if (truncated.fullOutputPath) createdThisRun.push(truncated.fullOutputPath);
      };
      try {
        const signal = cctx.abort;
        switch (args.action) {
          case "fetch": {
            const url = asString(args.url).trim();
            if (!url) return { output: "❌ fetch requires a url" };
            const blocked = isBlockedUrl(url);
            if (blocked) return { output: `❌ ${blocked}` };
            const maxChars = clampInteger(args.maxChars, DEFAULT_FETCH_MAX_CHARS, 1000, 100000);
            const reqParams = {
              url,
              formats: args.formats,
              onlyMainContent: args.onlyMainContent,
              waitFor: args.waitFor,
              timeout: args.timeout,
            };
            const key = cacheKey("fetch", reqParams);
            if (!asBool(args.noCache, false)) {
              const cached = await cacheGet(key);
              if (cached !== null) return { title: "🌐 Web Fetch", output: `${cached}\n\n[cache hit]` };
            }
            const body: Record<string, unknown> = {
              url,
              formats: parseFormats(args.formats),
              onlyMainContent: asBool(args.onlyMainContent, true),
            };
            if (args.waitFor !== undefined) body.waitFor = clampInteger(args.waitFor, 0, 0, 60000);
            if (args.timeout !== undefined) body.timeout = clampInteger(args.timeout, 30000, 1000, 180000);
            const response = await firecrawlPost("/v2/scrape", body, signal);
            const doc = (response.data ?? {}) as Record<string, unknown>;
            const blockedFinal = blockedFinalUrl(url, doc);
            if (blockedFinal) return { output: `❌ redirect blocked: ${blockedFinal}` };
            const content = documentContent(doc, maxChars);
            const header = documentHeader(doc);
            const output = `${header ? `${header}\n\n` : ""}${content.text}`;
            const truncated = await truncateOutput(output, "tawassul-firecrawl-scrape-");
            trackTruncated(truncated);
            if (!asBool(args.noCache, false)) await cacheSet(key, truncated.text);
            return { title: "🌐 Web Fetch", output: truncated.text };
          }
          case "search": {
            const query = asString(args.query).trim();
            if (!query) return { output: "❌ search requires a query" };
            const limit = clampInteger(args.limit, 10, 1, 20);
            const sources = parseCommaList(args.sources || "web", ["web", "news", "images"]);
            const categories = parseCommaList(args.categories, ["github", "research", "pdf"]);
            const scrapeResults = asBool(args.scrapeResults, false);
            const maxCharsPerResult = clampInteger(args.maxCharsPerPage, DEFAULT_SEARCH_RESULT_CHARS, 500, 20000);
            const reqParams = { query, limit, sources, categories, timeRange: args.timeRange, scrapeResults };
            const key = cacheKey("search", reqParams);
            if (!asBool(args.noCache, false)) {
              const cached = await cacheGet(key);
              if (cached !== null) return { title: "🔎 Web Search", output: `${cached}\n\n[cache hit]` };
            }
            const body: Record<string, unknown> = { query, limit, sources: sources.length ? sources : ["web"] };
            if (categories.length) body.categories = categories;
            const tbs = timeRangeToTbs(args.timeRange);
            if (tbs) body.tbs = tbs;
            if (scrapeResults) body.scrapeOptions = { formats: ["markdown"], onlyMainContent: true };
            const response = await firecrawlPost("/v2/search", body, signal);
            const data = (response.data ?? {}) as Record<string, unknown>;
            const sections: string[] = [];
            const sourceUrls: string[] = [];
            for (const source of ["web", "news", "images"] as const) {
              const results = Array.isArray(data[source]) ? (data[source] as Record<string, unknown>[]) : [];
              if (!results.length) continue;
              sections.push(`## ${source}`);
              results.slice(0, limit).forEach((result: Record<string, unknown>, index: number) => {
                const url = asString(result.url);
                if (url) sourceUrls.push(url);
                const lines = [
                  `### ${index + 1}. ${result.title || "Untitled"}`,
                  url ? `URL: ${url}` : undefined,
                  result.description || result.snippet
                    ? `Description: ${result.description || result.snippet}`
                    : undefined,
                ].filter(Boolean) as string[];
                if (typeof result.markdown === "string" && result.markdown.trim()) {
                  lines.push(`Markdown:\n${clip(result.markdown.trim(), maxCharsPerResult).text}`);
                }
                sections.push(lines.join("\n"));
              });
            }
            let output = sections.length ? sections.join("\n\n") : "No Firecrawl search results found.";
            
            
            if (sourceUrls.length) {
              output += `\n\nSources:\n${sourceUrls.map((u, i) => `${i + 1}. ${u}`).join("\n")}`;
            }
            const truncated = await truncateOutput(output, "tawassul-firecrawl-search-");
            trackTruncated(truncated);
            if (!asBool(args.noCache, false)) await cacheSet(key, truncated.text);
            return { title: "🔎 Web Search", output: truncated.text };
          }
          case "map": {
            const url = asString(args.url).trim();
            if (!url) return { output: "❌ map requires a url" };
            const blocked = isBlockedUrl(url);
            if (blocked) return { output: `❌ ${blocked}` };
            const reqParams = {
              url,
              limit: args.limit,
              search: args.search,
              sitemap: args.sitemap,
              includeSubdomains: args.includeSubdomains,
            };
            const key = cacheKey("map", reqParams);
            if (!asBool(args.noCache, false)) {
              const cached = await cacheGet(key);
              if (cached !== null) return { title: "🗺️ Web Map", output: `${cached}\n\n[cache hit]` };
            }
            const body: Record<string, unknown> = {
              url,
              limit: clampInteger(args.limit, 100, 1, 5000),
              includeSubdomains: asBool(args.includeSubdomains, true),
            };
            if (args.search) body.search = asString(args.search);
            const sitemap = asString(args.sitemap).trim();
            if (["include", "skip", "only"].includes(sitemap)) body.sitemap = sitemap;
            const response = await firecrawlPost("/v2/map", body, signal);
            const links = Array.isArray(response.links) ? response.links : [];
            const safeLinks = links.filter((link) => typeof link !== "string" || isBlockedUrl(link) === null);
            const blockedLinks = links.length - safeLinks.length;
            const listing = safeLinks.length
              ? safeLinks.map((link: string, i: number) => `${i + 1}. ${link}`).join("\n")
              : "No links found.";
            const output = blockedLinks
              ? `Blocked ${blockedLinks} link(s) to private or local targets.\n\n${listing}`
              : listing;
            const truncated = await truncateOutput(output, "tawassul-firecrawl-map-");
            trackTruncated(truncated);
            if (!asBool(args.noCache, false)) await cacheSet(key, truncated.text);
            return { title: "🗺️ Web Map", output: truncated.text };
          }
          case "crawl": {
            const url = asString(args.url).trim();
            if (!url) return { output: "❌ crawl requires a url" };
            const blocked = isBlockedUrl(url);
            if (blocked) return { output: `❌ ${blocked}` };
            const limit = clampInteger(args.limit, 10, 1, 100);
            const body: Record<string, unknown> = {
              url,
              limit,
              scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
            };
            const includePaths = parseCommaList(args.includePaths);
            const excludePaths = parseCommaList(args.excludePaths);
            if (includePaths.length) body.includePaths = includePaths;
            if (excludePaths.length) body.excludePaths = excludePaths;
            if (args.maxDiscoveryDepth !== undefined)
              body.maxDiscoveryDepth = clampInteger(args.maxDiscoveryDepth, 2, 0, 10);
            const started = await firecrawlPost("/v2/crawl", body, signal);
            const id = started.id;
            const statusUrl = started.url || `${baseUrl()}/v2/crawl/${id}`;
            if (!asBool(args.wait, true)) {
              return { title: "🕸️ Web Crawl", output: `Started Firecrawl crawl ${id}\nStatus: ${statusUrl}` };
            }
            const maxWaitSeconds = clampInteger(args.maxWaitSeconds, 60, 5, 300);
            const maxCharsPerPage = clampInteger(args.maxCharsPerPage, DEFAULT_CRAWL_PAGE_CHARS, 500, 20000);
            const deadline = Date.now() + maxWaitSeconds * 1000;
            let status: Record<string, unknown> = started;
            while (Date.now() < deadline) {
              await pause(2000, signal);
              status = await firecrawlGet(`/v2/crawl/${id}`, signal);
              if (["completed", "failed", "cancelled"].includes(String(status.status))) break;
            }
            const crawlStatus = String(status.status ?? "");
            if (crawlStatus === "failed" || crawlStatus === "cancelled") {
              throw new WebTerminalError(`Crawl ${id} ${crawlStatus}: ${describeCrawlError(status)}`);
            }
            const docs = Array.isArray(status.data) ? (status.data as Record<string, unknown>[]) : [];
            const { safe: safeDocs, blocked: blockedPages } = partitionCrawlDocs(url, docs);
            if (docs.length > 0 && safeDocs.length === 0) {
              return { output: `❌ crawl blocked after redirect: ${blockedPages.join("; ")}` };
            }
            const sections = safeDocs.map((doc: Record<string, unknown>, index: number) => {
              const header = documentHeader(doc) || `Page ${index + 1}`;
              const content = documentContent(doc, maxCharsPerPage);
              return `## Page ${index + 1}\n${header}\n\n${content.text}`;
            });
            let output = sections.length
              ? sections.join("\n\n---\n\n")
              : `Crawl ${id} status: ${status.status ?? "unknown"}\nStatus: ${statusUrl}`;
            if (blockedPages.length) {
              output = `Blocked ${blockedPages.length} page(s) after redirect: ${blockedPages.join("; ")}\n\n${output}`;
            }
            const truncated = await truncateOutput(output, "tawassul-firecrawl-crawl-");
            trackTruncated(truncated);
            return { title: "🕸️ Web Crawl", output: truncated.text };
          }
          case "cache": {
            const sub = asString(args.cacheAction).trim().toLowerCase();
            if (sub === "clear") {
              const n = await cacheClear();
              return { title: "💾 Web Cache", output: `Cleared ${n} cached response(s).` };
            }
            const entries = await cacheList();
            if (!entries.length) return { title: "💾 Web Cache", output: "Cache is empty." };
            const lines = entries.map((e) => `${e.key} (${formatSize(e.bytes)})`);
            return { title: "💾 Web Cache", output: `${entries.length} cached response(s):\n${lines.join("\n")}` };
          }
          default:
            return { output: `❌ Unknown web action: ${String(args.action)}` };
        }
      } catch (e) {
        
        
        await cleanupTempOutputs(createdThisRun);
        if (e instanceof WebTerminalError) throw e;
        return { title: "❌ Web", output: `Error: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });
}
