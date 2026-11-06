import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, resolvePackRoot } from "../src/services/context-pack/index.ts";
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

const work = mkdtempSync(join(tmpdir(), "tawassul-model-switch-"));
const keyDir = join(work, "keys");
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
process.env.XDG_DATA_HOME = join(work, "data");
delete process.env.TAWASSUL_ISOLATED;
delete process.env.TAWASSUL_CONTEXT_HANDOFF;
const worktree = join(work, "workspace");
mkdirSync(worktree, { recursive: true });

function overflowMessages(): PackMessage[] {
  return [
    { role: "user", content: "F".repeat(50000) },
    { role: "assistant", content: "A".repeat(50000) },
    { role: "user", content: "CURRENT" },
  ];
}

async function main(): Promise<void> {
  const calls: string[] = [];
  const creates: Array<Record<string, unknown>> = [];
  const prompts: Array<Record<string, unknown>> = [];
  const bridge: SessionBridge = {
    create: async (input) => {
      calls.push("create");
      creates.push(input as Record<string, unknown>);
      return { id: `ses-${creates.length}` };
    },
    prompt: async (input) => {
      calls.push("prompt");
      prompts.push(input as Record<string, unknown>);
      return undefined;
    },
    context: async () => overflowMessages(),
    wait: async () => undefined,
    modelList: async () => ({ data: [] }),
    get: async () => ({ id: "ses-model-switch" }),
    list: async () => ({ data: [] }),
  };

  const smallPlan = planOutbound([{ role: "user", content: "small" }], 128000);
  assert(!smallPlan.overflow, "a small request does not overflow");
  const small = await transferOverflow({
    worktree,
    sourceSessionID: "ses-source",
    messages: [{ role: "user", content: "small" }],
    bridge,
    window: 128000,
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
  });
  assert(!small.transferred, "a provider change alone never transfers");
  assert(calls.length === 0, "a within-budget provider change creates nothing and prompts nothing");

  const overflow = await transferOverflow({
    worktree,
    sourceSessionID: "ses-source",
    messages: overflowMessages(),
    bridge,
    window: 128000,
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
    agent: "dev",
    title: "Model continuation",
    text: "Carry on with the pack.",
    delivery: "steer",
  });
  assert(overflow.transferred, "a measured overflow transfers");
  if (!overflow.transferred) return;
  assert(calls.join(",") === "create,prompt", "the transfer creates one session and sends one prompt");
  const create = creates[0];
  assert(create?.title === "Model continuation", "the requested title reaches create");
  assert(create?.agent === "dev", "the requested agent reaches create");
  const model = create?.model as { providerID?: string; id?: string } | undefined;
  assert(model?.providerID === "anthropic" && model?.id === "claude-sonnet-4-20250514", "create carries the chosen model");
  assert(!("fork" in (create ?? {})), "create never carries fork");

  const prompt = prompts[0];
  assert(prompt?.sessionID === overflow.sessionID, "the prompt targets the successor");
  assert(prompt?.text === "Carry on with the pack.", "the requested prompt text is preserved");
  assert(prompt?.delivery === "steer", "the requested delivery mode is preserved");
  assert(Array.isArray(prompt?.files) && (prompt?.files as unknown[]).length >= 1, "the pack travels as a file");

  const ledger = await readLedger(resolvePackRoot(worktree));
  assert(
    ledger.some((entry) => entry.type === "write" && entry.sessionID === overflow.sessionID),
    "the successor pack is recorded",
  );
  assert(
    ledger.some((entry) => entry.type === "transfer" && entry.sessionID === overflow.sessionID),
    "the successor transfer is recorded",
  );

  const bare = await transferOverflow({
    worktree,
    sourceSessionID: "ses-source-bare",
    messages: overflowMessages(),
    bridge,
    window: 128000,
  });
  assert(bare.transferred, "a transfer without a model still succeeds");
  const bareCreate = creates[1];
  assert(bareCreate !== undefined && !("model" in bareCreate), "create omits the model key when none is chosen");
  assert(!("agent" in (bareCreate ?? {})), "create omits the agent key when none is chosen");

  const scanned = ["src/services/context-pack/outbound.ts", "src/services/context-pack/index.ts"]
    .map((file) => readFileSync(join(process.cwd(), file), "utf-8"))
    .join("\n");
  assert(!/\bfork\s*\(/.test(scanned), "no transfer path calls fork");
  assert(!/\.synthetic\s*\(/.test(scanned), "no transfer path calls synthetic");
  assert(!/FALLBACK_CHAINS/.test(scanned), "the transfer never consults fallback chains");
  assert(!/candidateModels|candidate_models/.test(scanned), "the transfer never builds a candidate list");

  console.log("PROOF PASS: no rewrite without measured overflow, model is passed through, and the prompt stays flat");
}

try {
  await main();
} finally {
  rmSync(work, { recursive: true, force: true });
}
