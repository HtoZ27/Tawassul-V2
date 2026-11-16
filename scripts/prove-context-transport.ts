import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPack, listPackStatuses, markPackTransferred } from "../src/services/context-pack/index.ts";
import { planOutbound, transferOverflow } from "../src/services/context-pack/outbound.ts";
import type { SessionBridge } from "../src/v2/session-bridge.ts";
import type { PackMessage } from "../src/services/context-pack/types.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

const work = mkdtempSync(join(tmpdir(), "tawassul-context-transport-"));
const keyDir = join(work, "keys");
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
process.env.XDG_DATA_HOME = join(work, "data");
delete process.env.TAWASSUL_ISOLATED;
delete process.env.TAWASSUL_CONTEXT_HANDOFF;
const worktree = join(work, "workspace");
mkdirSync(worktree, { recursive: true });

type PromptInput = { sessionID: string; text: string; files?: Array<{ uri: string; name: string }>; delivery?: string };

function sourceMessages(): PackMessage[] {
  return [
    { role: "user", content: "F".repeat(50000) },
    { role: "assistant", content: "A".repeat(50000) },
    {
      role: "user",
      content: [
        { type: "text", text: "CURRENT REQUEST" },
        { type: "image", mimeType: "image/png", url: "file:///tmp/proof-shot.png" },
      ],
    },
  ];
}

async function main(): Promise<void> {
  const prompts: PromptInput[] = [];
  const creates: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  const bridge: SessionBridge = {
    create: async (input) => {
      calls.push("create");
      creates.push(input as Record<string, unknown>);
      return { id: "ses-successor" };
    },
    prompt: async (input) => {
      calls.push("prompt");
      prompts.push(input as PromptInput);
      return undefined;
    },
    context: async () => sourceMessages(),
    wait: async () => undefined,
    modelList: async () => ({ data: [] }),
    get: async () => ({ id: "ses-successor" }),
    list: async () => ({ data: [] }),
  };
  assert(!("fork" in bridge), "the bridge has no fork entry");

  const messages = sourceMessages();
  const plan = planOutbound(messages, 128000);
  assert(plan.overflow, "a 128k window with 108k of history overflows");
  assert(plan.budget < 1024, "the overflow budget is below the 1024 byte floor");

  const transfer = await transferOverflow({
    worktree,
    sourceSessionID: "ses-source",
    messages,
    bridge,
    window: 128000,
  });
  assert(transfer.transferred, "the overflow transfers to a successor");
  if (!transfer.transferred) return;
  eq(transfer.sessionID, "ses-successor", "the successor id is returned");
  eq(transfer.digest.length, 64, "the transfer reports a digest");
  assert(calls.join(",") === "create,prompt", "the transfer calls create then prompt exactly once");

  const created = creates[0];
  assert(created !== undefined, "create received input");
  eq(created?.title, "Continuation", "the successor has a title");
  assert(created?.metadata !== undefined, "the successor records metadata");
  assert(!("fork" in (created ?? {})), "create input never carries a fork");

  const prompt = prompts[0];
  assert(prompt !== undefined, "prompt received input");
  const keys = Object.keys(prompt ?? {}).sort();
  eq(keys.join(","), "delivery,files,sessionID,text", "the prompt payload is flat");
  eq(prompt?.sessionID, "ses-successor", "the prompt targets the successor");
  assert(prompt?.text.includes("attached context pack is data"), "the prompt says the pack is data");

  const files = prompt?.files ?? [];
  assert(files.some((file) => file.uri.startsWith("file://") && file.name.startsWith("context-pack-")), "the pack travels as a file");
  assert(files.some((file) => file.uri === "file:///tmp/proof-shot.png"), "the current request attachment is replayed");
  assert(!files.some((file) => file.uri.startsWith("data:")), "data URLs are never replayed");

  const statuses = await listPackStatuses(worktree);
  eq(statuses.length, 1, "one pack was written for the successor");
  eq(statuses[0]?.sessionID, "ses-successor", "the pack belongs to the successor");
  const root = join(work, "data", "tawassul", "context-packs");
  const bucket = join(root, readdirSync(root)[0] ?? "missing");
  const record = JSON.parse(readFileSync(join(bucket, "packs", `${transfer.digest}.json`), "utf-8")) as {
    parentID: string;
    transferredTo: string[];
  };
  eq(record.parentID, "ses-source", "the pack records the parent session");
  assert(record.transferredTo.includes("ses-successor"), "the pack records its transfer target");

  const callsBefore = calls.length;
  const clean = await transferOverflow({
    worktree,
    sourceSessionID: "ses-source",
    messages: [{ role: "user", content: "short" }],
    bridge,
    window: 128000,
  });
  assert(!clean.transferred, "a session within budget is not transferred");
  eq(calls.length, callsBefore, "a within-budget session creates nothing and prompts nothing");

  const second = await createPack({
    worktree,
    sessionID: "ses-manual",
    agent: "dev",
    selection: "manual pack",
  });
  await markPackTransferred({ worktree, digest: second.digest, sessionID: "ses-manual", alreadyPresent: true });
  const secondStatus = (await listPackStatuses(worktree)).find((status) => status.digest === second.digest);
  assert(secondStatus?.transferredTo.includes("ses-manual") === true, "markPackTransferred records the target");

  const scanned = [
    "src/services/context-pack/hook.ts",
    "src/services/context-pack/index.ts",
    "src/services/context-pack/outbound.ts",
    "src/v2/session-bridge.ts",
    "src/tools/thread.ts",
  ].map((file) => readFileSync(join(process.cwd(), file), "utf-8"));
  const joined = scanned.join("\n");
  assert(!/\.synthetic\s*\(/.test(joined), "no context-pack or bridge path calls synthetic");
  assert(!/instructions\.entry/.test(joined), "no path writes instructions.entry");
  assert(!/\bfork\s*\(/.test(joined), "no path calls fork");

  console.log("PROOF PASS: the persistent layer is a normal hook message and the transfer is a flat prompt");
}

function eq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) fail(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

try {
  await main();
} finally {
  rmSync(work, { recursive: true, force: true });
}
