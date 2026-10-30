import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPauseTool, buildResumeTool, type PauseState } from "../src/tools/system-controls.ts";
import { buildImageGenTool } from "../src/tools/image-gen.ts";
import { TASK_TIMEOUT_MS, armTaskTimeout, clearTaskTimeout } from "../src/hooks/tool-execute.ts";
import { _taskTimeouts } from "../src/services/lifecycle-drain.ts";
import { logger } from "../src/utils/logger.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed += 1;
  console.log(`ok ${name}`);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Handoff = { id: string; status: string };

let pauseState: PauseState | null = null;
let handoffs: Handoff[] = [
  { id: "H-1", status: "pending" },
  { id: "H-2", status: "accepted" },
  { id: "H-3", status: "completed" },
];
let saves = 0;
const warnings: Array<{ agent: string; content: string; tags: string[]; importance: string }> = [];
const decisions: Array<{ agent: string; content: string; tags: string[]; importance: string }> = [];

const pauseTool = buildPauseTool(
  () => pauseState,
  (state) => {
    pauseState = state;
  },
  () => handoffs,
  (next) => {
    handoffs = next as Handoff[];
  },
  async () => {
    saves += 1;
  },
  (entry) => warnings.push(entry),
);

const resumeTool = buildResumeTool(
  () => pauseState,
  (state) => {
    pauseState = state;
  },
  () => handoffs,
  (next) => {
    handoffs = next as Handoff[];
  },
  async () => {
    saves += 1;
  },
  (entry) => decisions.push(entry),
);

const paused = (await pauseTool.execute({ reason: "review", scope: "handoffs" }, { agent: "dev" } as never)) as {
  output: string;
};
assert(paused.output.includes("System paused"), "pause reports the transition");
assert(paused.output.includes("review"), "pause reports the reason");
assert(paused.output.includes("handoffs"), "pause reports the scope");
assert(paused.output.includes("Affected:** 2"), "pause reports the affected handoff count");
assert(saves === 1, "pause persists state once");
assert(warnings.length === 1, "pause records one warning");
assert(warnings[0]?.tags.includes("pause") === true, "pause warning is tagged");

if (!pauseState) fail("pause did not store state");
const stored: PauseState = pauseState;
assert(stored.active === true, "pause state is active");
assert(stored.reason === "review", "pause state keeps the reason");
assert(stored.scope === "handoffs", "pause state keeps the scope");
assert(stored.pausedBy === "dev", "pause state records the caller");
assert(stored.affectedHandoffs.join(",") === "H-1,H-2", "pause state records the affected handoffs");
assert(stored.originalStatuses?.["H-1"] === "pending", "pause state records the pending status");
assert(stored.originalStatuses?.["H-2"] === "accepted", "pause state records the accepted status");
assert(handoffs.find((h) => h.id === "H-1")?.status === "paused", "pending handoff is paused");
assert(handoffs.find((h) => h.id === "H-2")?.status === "paused", "accepted handoff is paused");
assert(handoffs.find((h) => h.id === "H-3")?.status === "completed", "completed handoff is untouched");

const serialized = JSON.parse(JSON.stringify(stored)) as PauseState;
assert(serialized.affectedHandoffs.length === 2, "the paused set survives serialization");
assert(serialized.originalStatuses?.["H-2"] === "accepted", "the original statuses survive serialization");

const duplicate = (await pauseTool.execute({}, { agent: "dev" } as never)) as { output: string };
assert(duplicate.output.includes("already paused"), "a second pause is refused");
assert(saves === 1, "the refused pause does not save again");
assert(handoffs.filter((h) => h.status === "paused").length === 2, "the refused pause changes nothing");

const resumed = (await resumeTool.execute({}, { agent: "dev" } as never)) as { output: string };
assert(resumed.output.includes("System resumed"), "resume reports the transition");
assert(pauseState === null, "resume clears the pause state");
assert(handoffs.find((h) => h.id === "H-1")?.status === "pending", "resume restores pending");
assert(handoffs.find((h) => h.id === "H-2")?.status === "accepted", "resume restores accepted");
assert(saves === 2, "resume persists state once");
assert(decisions.length === 1, "resume records one decision");

assert(TASK_TIMEOUT_MS === 420_000, "the task timeout bound is 420 seconds");

const originalWarn = logger.warn;
const timeoutWarnings: string[] = [];
logger.warn = (msg: string) => {
  timeoutWarnings.push(msg);
};
try {
  armTaskTimeout("sess-a", "dev", 25);
  assert(_taskTimeouts.has("sess-a:dev"), "arming a task records its timer");
  armTaskTimeout("sess-a", "dev", 25);
  assert(_taskTimeouts.size === 1, "re-arming the same task replaces its timer");
  await sleep(60);
  assert(!_taskTimeouts.has("sess-a:dev"), "the task timer clears its entry at the bound");
  assert(timeoutWarnings.length === 1, "the task timer warns once");
  assert(timeoutWarnings[0]?.includes("P0.7: task timeout for dev") === true, "the timeout names the agent");
  assert(timeoutWarnings[0]?.includes("sess-a") === true, "the timeout names the session");

  armTaskTimeout("sess-b", "tester", 1000);
  clearTaskTimeout("sess-b", "tester");
  assert(!_taskTimeouts.has("sess-b:tester"), "clearing a task removes its timer");
  await sleep(30);
  assert(timeoutWarnings.length === 1, "a cleared task never warns");
} finally {
  logger.warn = originalWarn;
  clearTaskTimeout("sess-a", "dev");
  clearTaskTimeout("sess-b", "tester");
}

const work = mkdtempSync(join(tmpdir(), "tawassul-s053-"));
const previousEnv = {
  token: process.env.OPENAI_CODEX_ACCESS_TOKEN,
  refresh: process.env.OPENAI_CODEX_REFRESH_TOKEN,
  base: process.env.PI_IMAGE_GEN_BASE_URL,
  out: process.env.PI_IMAGE_GEN_OUTPUT_DIR,
};
const originalFetch = globalThis.fetch;
const imageCalls: Array<{ url: string; auth: string }> = [];
let imageMode: "success" | "double" = "success";
let imageAttempts = 0;
let refreshCalls = 0;

try {
  mkdirSync(join(work, "state"), { recursive: true });
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  process.env.OPENAI_CODEX_ACCESS_TOKEN = `header.${payload}.signature`;
  process.env.OPENAI_CODEX_REFRESH_TOKEN = "refresh-token";
  process.env.PI_IMAGE_GEN_BASE_URL = "https://image-proof.test";
  process.env.PI_IMAGE_GEN_OUTPUT_DIR = join(work, "images");

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    imageCalls.push({ url, auth: headers.Authorization ?? "" });
    if (url.endsWith("/token/refresh")) {
      refreshCalls += 1;
      return new Response(JSON.stringify({ access_token: `fresh-token-${refreshCalls}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    imageAttempts += 1;
    if (imageMode === "double") return new Response("rejected", { status: 401 });
    if (imageAttempts === 1) return new Response("rejected", { status: 401 });
    const result = Buffer.from("proof-image").toString("base64");
    const event = JSON.stringify({ item: { type: "image_generation_call", result, revised_prompt: "revised" } });
    return new Response(`data: ${event}\n\n`, { status: 200 });
  }) as typeof fetch;

  const imageTool = buildImageGenTool();
  const generated = (await imageTool.execute(
    { action: "generate", prompt: "proof image" },
    { directory: work, messageID: "proof", agent: "dev" } as never,
  )) as { output: string };
  assert(generated.output.includes("Image saved to"), "a 401 is refreshed once and retried");
  assert(generated.output.includes("Revised prompt: revised"), "the retried stream is parsed");
  assert(imageAttempts === 2, "the successful path makes two API attempts");
  assert(refreshCalls === 1, "the successful path refreshes the token once");
  assert(imageCalls[0]?.auth.startsWith("Bearer header.") === true, "the first attempt uses the stored token");
  assert(imageCalls.at(-1)?.auth === "Bearer fresh-token-1", "the retry uses the refreshed token");
  const savedPath = generated.output.split("Image saved to ")[1]?.split("\n")[0] ?? "";
  assert(savedPath.length > 0 && existsSync(savedPath), "the refreshed retry writes the image");

  imageMode = "double";
  imageAttempts = 0;
  refreshCalls = 0;
  imageCalls.length = 0;
  const failed = (await imageTool.execute(
    { action: "generate", prompt: "proof image" },
    { directory: work, messageID: "proof", agent: "dev" } as never,
  )) as { output: string };
  assert(failed.output.includes("renew OPENAI_CODEX_ACCESS_TOKEN"), "a second 401 fails closed with the renewal message");
  assert(imageAttempts === 2, "the failed path stops after two API attempts");
  assert(refreshCalls === 1, "the failed path refreshes only once");
  assert(imageCalls.length === 3, "the failed path never loops");
  assert(imageCalls.at(-1)?.auth === "Bearer fresh-token-1", "the failed retry uses the refreshed token");
} finally {
  globalThis.fetch = originalFetch;
  if (previousEnv.token === undefined) delete process.env.OPENAI_CODEX_ACCESS_TOKEN;
  else process.env.OPENAI_CODEX_ACCESS_TOKEN = previousEnv.token;
  if (previousEnv.refresh === undefined) delete process.env.OPENAI_CODEX_REFRESH_TOKEN;
  else process.env.OPENAI_CODEX_REFRESH_TOKEN = previousEnv.refresh;
  if (previousEnv.base === undefined) delete process.env.PI_IMAGE_GEN_BASE_URL;
  else process.env.PI_IMAGE_GEN_BASE_URL = previousEnv.base;
  if (previousEnv.out === undefined) delete process.env.PI_IMAGE_GEN_OUTPUT_DIR;
  else process.env.PI_IMAGE_GEN_OUTPUT_DIR = previousEnv.out;
  rmSync(work, { recursive: true, force: true });
}

assert(readFileSync(new URL("../src/hooks/tool-execute.ts", import.meta.url), "utf8").includes("420_000"), "the timeout constant stays pinned in source");

console.log(`PROOF PASS: S-053 pause transition, 420s task timeout, and single 401 refresh (${passed} assertions)`);
