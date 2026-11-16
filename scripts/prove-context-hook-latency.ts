import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  clearInjectionCache,
  createPack,
  handleContextEvent,
  isInjectionWarm,
  warmInjection,
} from "../src/services/context-pack/index.ts";
import { packHeader } from "../src/services/context-pack/render.ts";
import { PACK_ENVELOPE_BYTES } from "../src/services/context-pack/types.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

const work = mkdtempSync(join(tmpdir(), "tawassul-context-latency-"));
const keyDir = join(work, "keys");
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
process.env.XDG_DATA_HOME = join(work, "data");
delete process.env.TAWASSUL_ISOLATED;
delete process.env.TAWASSUL_CONTEXT_HANDOFF;
const worktree = join(work, "workspace");
mkdirSync(worktree, { recursive: true });

function percentile(samples: number[], ratio: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1);
  return sorted[index] ?? Number.POSITIVE_INFINITY;
}

async function main(): Promise<void> {
  const record = await createPack({
    worktree,
    sessionID: "ses-latency",
    agent: "dev",
    handoffId: "H-latency",
    selection: "x".repeat(61000),
  });
  assert(record.bytes > 60000, "the measured pack is in the 64KB class");
  assert(record.bytes <= 64000, "the measured pack stays under the cap");
  const header = packHeader({ ...record, id: record.id });
  assert(Buffer.byteLength(header, "utf8") <= PACK_ENVELOPE_BYTES, "the envelope stays within 2048 bytes");

  warmInjection({ sessionID: "ses-latency", digest: record.digest, message: record.message, alreadyPresent: false });
  assert(isInjectionWarm("ses-latency", record.digest), "the big pack is warm");

  const smallSamples: number[] = [];
  for (let index = 0; index < 400; index += 1) {
    const messages: Array<Record<string, unknown>> = [{ role: "user", content: `request ${index}` }];
    const started = performance.now();
    const appended = handleContextEvent({ sessionID: "ses-latency", messages });
    smallSamples.push(performance.now() - started);
    if (appended !== 1) fail("each request must receive exactly one pack append");
  }
  const smallP95 = percentile(smallSamples, 0.95);
  assert(smallP95 <= 2, `the small-request p95 is ${smallP95.toFixed(3)}ms, expected at or below 2ms`);

  const history: Array<Record<string, unknown>> = [
    { role: "user", content: "first".repeat(100) },
  ];
  for (let index = 0; index < 400; index += 1) {
    history.push({ role: index % 2 === 0 ? "assistant" : "user", content: `turn ${index}` });
  }
  const largeSamples: number[] = [];
  for (let index = 0; index < 400; index += 1) {
    const messages = history.slice();
    const started = performance.now();
    const appended = handleContextEvent({ sessionID: "ses-latency", messages });
    largeSamples.push(performance.now() - started);
    if (appended !== 1) fail("a long history must still receive one pack append");
  }
  const largeP95 = percentile(largeSamples, 0.95);
  assert(largeP95 <= 2, `the long-history p95 is ${largeP95.toFixed(3)}ms, expected at or below 2ms`);

  const source = readFileSync(join(process.cwd(), "src/services/context-pack/hook.ts"), "utf-8");
  assert(!/node:fs|node:crypto|node:path|node:os/.test(source), "the handler module imports no filesystem or crypto module");
  assert(!/\bawait\b/.test(source), "the handler module contains no asynchronous work");
  assert(!/ctx\.session|session\.context|session\.prompt|session\.create/.test(source), "the handler never calls the session domain");
  assert(Object.getPrototypeOf(handleContextEvent).constructor.name === "Function", "the handler is synchronous");

  console.log(
    `PROOF PASS: p95 ${smallP95.toFixed(3)}ms small, ${largeP95.toFixed(3)}ms long history, pack ${record.bytes} bytes`,
  );
}

try {
  await main();
} finally {
  clearInjectionCache();
  rmSync(work, { recursive: true, force: true });
}
