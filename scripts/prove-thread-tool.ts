import "./proof-log-isolate.ts";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { HandoffEntry } from "../src/context/types.ts";
import type { TawassulContext } from "../src/context.ts";
import { buildThreadTool } from "../src/tools/thread.ts";
import { ToolDeduplicator } from "../src/services/tool-dedup.ts";
import { ToolRunLog } from "../src/services/tool-run-log.ts";
import { evaluateDuplicateGuard, isIdempotentGoalCall, isIdempotentThreadCall } from "../src/hooks/duplicate-guard.ts";
import type { ToolContext } from "../src/tool.ts";
import { clearSessionBridge, installSessionBridge } from "../src/v2/session-bridge.ts";
import { activatePack, createPack } from "../src/services/context-pack/index.ts";
import type { PackMessage } from "../src/services/context-pack/types.ts";
import type { V2Context } from "../src/v2/types.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

const work = mkdtempSync(join(tmpdir(), "tawassul-thread-tool-"));
const keyDir = join(work, "keys");
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
process.env.XDG_DATA_HOME = join(work, "data");
delete process.env.TAWASSUL_ISOLATED;
delete process.env.TAWASSUL_CONTEXT_HANDOFF;
const worktree = join(work, "workspace");
mkdirSync(worktree, { recursive: true });
writeFileSync(join(worktree, "README.md"), "sentinel\n", "utf-8");
mkdirSync(join(worktree, "src"), { recursive: true });
writeFileSync(join(worktree, "src", "one.ts"), "export const one = 1;\n", "utf-8");

function treeHash(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        hash.update(`d:${relative(root, path)}\n`);
        walk(path);
      } else if (entry.isFile()) {
        hash.update(`f:${relative(root, path)}:${readFileSync(path).toString("base64")}\n`);
      }
    }
  };
  walk(root);
  return hash.digest("hex");
}

function handoff(): HandoffEntry {
  return {
    id: "H-100",
    from: "analyst",
    to: "dev",
    task: "Port the thread tool",
    context: "The handoff carries the packable context",
    files: ["src/tools/thread.ts"],
    timestamp: new Date().toISOString(),
    status: "pending",
    checkpoint: {
      completed: ["wrote the tool"],
      remaining: ["prove the tool"],
      filesChanged: ["src/tools/thread.ts"],
      decisions: [],
    },
  };
}

async function main(): Promise<void> {
  const handoffs = new Map<string, HandoffEntry>();
  let saves = 0;
  const ctx = {
    handoffs,
    config: { innovations: { contextHandoff: { enabled: true } } },
    saveState: async () => {
      saves += 1;
    },
  } as unknown as TawassulContext;

  let stored: PackMessage[] = [{ role: "user", content: "short history" }];
  const created: Array<Record<string, unknown>> = [];
  const prompts: Array<Record<string, unknown>> = [];
  installSessionBridge({
    session: {
      create: async (input: Record<string, unknown>) => {
        created.push(input);
        return { id: "ses-next" };
      },
      prompt: async (input: Record<string, unknown>) => {
        prompts.push(input);
        return undefined;
      },
      context: async () => stored,
      wait: async () => undefined,
      hook: async () => ({ dispose: async () => undefined }),
      interrupt: async () => undefined,
    },
    model: { list: async () => ({ data: [] }) },
  } as unknown as V2Context);

  const tool = buildThreadTool(ctx);
  const cctx: ToolContext = {
    sessionID: "ses-source",
    messageID: "msg_proof",
    agent: "dev",
    directory: worktree,
    worktree,
    abort: new AbortController().signal,
    metadata: () => undefined,
  };
  const run = async (args: Record<string, unknown>): Promise<{ output: string; metadata?: Record<string, unknown> }> => {
    const result = await tool.execute(args as never, cctx);
    if (typeof result === "string") return { output: result };
    return result;
  };

  const before = treeHash(worktree);

  assert(isIdempotentThreadCall("thread", { action: "list" }), "thread list is idempotent");
  assert(isIdempotentThreadCall("thread", { action: "read" }), "thread read is idempotent");
  assert(isIdempotentThreadCall("thread", { action: "pack" }), "thread pack is idempotent");
  assert(!isIdempotentThreadCall("thread", { action: "continue" }), "thread continue is state changing");
  assert(!isIdempotentThreadCall("thread", { action: "revoke" }), "thread revoke is state changing");
  assert(!isIdempotentThreadCall("thread", { action: "unknown" }), "an unknown thread action is not exempt");
  assert(!isIdempotentThreadCall("thread", null), "a missing thread payload is not exempt");
  assert(!isIdempotentThreadCall("bash", { action: "list" }), "another tool is never exempt");

  const guardLog = new ToolRunLog(join(work, "guard-state"));
  const guardDedup = new ToolDeduplicator();
  const guardNow = Date.now();
  for (const action of ["list", "read", "pack"]) {
    const args = action === "read" ? { action, digest: "0".repeat(64) } : action === "pack" ? { action, handoffId: "H-100" } : { action };
    const argsJson = JSON.stringify(args);
    guardLog.record({
      tool: "thread",
      agent: "dev",
      sessionId: "ses-prior",
      argsHash: argsJson,
      status: "success",
      timestamp: guardNow - 1000,
    });
    const checksBefore = guardDedup.metrics.totalChecks;
    const verdict = evaluateDuplicateGuard({
      tool: "thread",
      agent: "dev",
      sessionID: "ses-source",
      args,
      argsJson,
      now: guardNow,
      deduplicator: guardDedup,
      runLog: guardLog,
    });
    assert(!verdict.blocked, `thread ${action} bypasses the cross-session duplicate guard`);
    for (let i = 1; i <= 5; i++) {
      const repeated = evaluateDuplicateGuard({
        tool: "thread",
        agent: "dev",
        sessionID: "ses-source",
        args,
        argsJson,
        now: guardNow + i,
        deduplicator: guardDedup,
        runLog: guardLog,
      });
      assert(!repeated.blocked, `repeated thread ${action} calls stay unblocked`);
    }
    assert(guardDedup.metrics.totalChecks === checksBefore, `thread ${action} never enters the session deduplicator`);
  }

  assert(isIdempotentGoalCall("goal", { board: true }), "goal board is idempotent");
  assert(isIdempotentGoalCall("goal", { get: "G-001" }), "goal get is idempotent");
  assert(isIdempotentGoalCall("goal", { list: true, filter: "completed" }), "goal list is idempotent");
  assert(!isIdempotentGoalCall("goal", { close: "G-001" }), "goal close is state changing");
  assert(!isIdempotentGoalCall("goal", { update: "G-001", state: "completed" }), "goal update is state changing");
  assert(!isIdempotentGoalCall("goal", { board: false }), "a false board flag is not a read");
  assert(!isIdempotentGoalCall("goal", null), "a missing goal payload is not exempt");
  assert(!isIdempotentGoalCall("bash", { board: true }), "another tool is never exempt by a goal-shaped payload");

  for (const args of [{ board: true }, { get: "G-001" }, { list: true, filter: "completed" }]) {
    const argsJson = JSON.stringify(args);
    guardLog.record({
      tool: "goal",
      agent: "dev",
      sessionId: "ses-prior",
      argsHash: argsJson,
      status: "success",
      timestamp: guardNow - 1000,
    });
    const checksBefore = guardDedup.metrics.totalChecks;
    const verdict = evaluateDuplicateGuard({
      tool: "goal",
      agent: "dev",
      sessionID: "ses-source",
      args,
      argsJson,
      now: guardNow,
      deduplicator: guardDedup,
      runLog: guardLog,
    });
    assert(!verdict.blocked, `goal ${argsJson} bypasses the cross-session duplicate guard`);
    for (let i = 1; i <= 5; i++) {
      const repeated = evaluateDuplicateGuard({
        tool: "goal",
        agent: "dev",
        sessionID: "ses-source",
        args,
        argsJson,
        now: guardNow + i,
        deduplicator: guardDedup,
        runLog: guardLog,
      });
      assert(!repeated.blocked, `repeated goal ${argsJson} calls stay unblocked`);
    }
    assert(guardDedup.metrics.totalChecks === checksBefore, `goal ${argsJson} never enters the session deduplicator`);
  }

  for (const action of ["continue", "revoke"]) {
    const args = { action, sessionID: "ses-prior", confirm: true };
    const argsJson = JSON.stringify(args);
    guardLog.record({
      tool: "thread",
      agent: "dev",
      sessionId: "ses-prior",
      argsHash: argsJson,
      status: "success",
      timestamp: guardNow - 1000,
    });
    const verdict = evaluateDuplicateGuard({
      tool: "thread",
      agent: "dev",
      sessionID: "ses-source",
      args,
      argsJson,
      now: guardNow,
      deduplicator: guardDedup,
      runLog: guardLog,
    });
    assert(verdict.blocked, `thread ${action} stays guarded across sessions`);
    assert(verdict.reason?.includes("Cross-session duplicate") === true, `thread ${action} reports the cross-session guard`);
  }

  const bashArgs = { command: "echo proof" };
  const bashJson = JSON.stringify(bashArgs);
  let bashBlocked = false;
  for (let i = 0; i < 4; i++) {
    const verdict = evaluateDuplicateGuard({
      tool: "bash",
      agent: "dev",
      sessionID: "ses-guard",
      args: bashArgs,
      argsJson: bashJson,
      now: guardNow + i,
      deduplicator: guardDedup,
      runLog: guardLog,
    });
    if (verdict.blocked) bashBlocked = true;
  }
  assert(bashBlocked, "non-thread tools still hit the same-session skip guard");


  const empty = await run({ action: "list" });
  assert(empty.output.includes("No context packs stored"), "list reports an empty workspace");

  const entry = handoff();
  handoffs.set(entry.id, entry);
  const packed = await run({ action: "pack", handoffId: "H-100" });
  assert(packed.output.includes("Packed handoff H-100"), "pack builds from a handoff");
  assert(typeof entry.contextPackDigest === "string" && entry.contextPackDigest.length === 64, "the handoff gets a digest");
  assert(entry.contextPackId?.startsWith("pck_") === true, "the handoff gets a pack id");
  assert(entry.context.includes("Portable Context Pack"), "the handoff context gains the pack preview");
  assert(saves >= 1, "the pack action saves state");
  const digest = entry.contextPackDigest ?? "";
  const activation = await activatePack({ worktree, sessionID: "ses-source", digest });
  assert(activation.ok, "the handoff pack can be warmed before revoke");

  const repacked = await run({ action: "pack", handoffId: "H-100" });
  assert(repacked.output.includes("Already packed"), "packing the same handoff twice is idempotent");
  assert(entry.contextPackDigest === digest, "the second pack keeps the same digest");
  assert(entry.context.split("## Portable Context Pack ").length - 1 === 1, "the handoff carries one preview block");

  const listed = await run({ action: "list" });
  assert(listed.output.includes(digest.slice(0, 16)), "list shows the stored digest prefix");
  assert(listed.output.includes("handoff=H-100"), "list shows the handoff id");
  assert(listed.output.includes(" live "), "list shows a live pack");

  const read = await run({ action: "read", handoffId: "H-100" });
  assert(read.output.includes(`digest=${digest}`), "read resolves the handoff digest");
  assert(read.output.includes("Portable context pack"), "read shows the pack body");

  const malformedModel = await run({ action: "continue", sessionID: "ses-source", model: "nope" });
  assert(malformedModel.output.includes("model must be provider/model"), "a malformed model fails explicitly");
  assert(created.length === 0 && prompts.length === 0, "a malformed model creates no successor");

  const unknown = await run({ action: "pause" });
  assert(unknown.output.includes("Unknown action"), "an unknown action is rejected explicitly");

  const noTransfer = await run({ action: "continue", sessionID: "ses-source" });
  assert(noTransfer.output.includes("within budget"), "a within-budget session is not rewritten");
  assert(created.length === 0 && prompts.length === 0, "no successor is created without overflow");

  const overflowBefore: PackMessage[] = stored;
  stored = [
    { role: "user", content: "F".repeat(90000) },
    { role: "assistant", content: "A".repeat(90000) },
    { role: "user", content: "CURRENT" },
  ];
  const snapshot = JSON.stringify(stored);
  const continued = await run({ action: "continue", sessionID: "ses-source" });
  assert(continued.output.includes("Source session: ses-source"), "an overflowing session is transferred");
  assert(continued.output.includes("Successor session: ses-next"), "the successor id is reported");
  assert(created.length === 1, "exactly one successor is created");
  assert(prompts.length === 1, "exactly one transfer prompt is sent");
  assert(String(created[0]?.metadata ? JSON.stringify(created[0]?.metadata) : "").includes("ses-source"), "the successor records the parent");
  const promptKeys = Object.keys(prompts[0] ?? {}).sort().join(",");
  assert(promptKeys === "delivery,files,sessionID,text", "the transfer prompt stays flat");
  assert(JSON.stringify(stored) === snapshot, "the continue action never mutates the source messages");
  stored = overflowBefore;
  void overflowBefore;

  const revokeWarm = await run({ action: "revoke", handoffId: "H-100" });
  assert(revokeWarm.output.includes("tombstoned"), "revoking an injected pack tombstones it");
  assert(entry.contextPackDigest === undefined, "the handoff drops the digest on revoke");
  assert(!entry.context.includes("Portable Context Pack"), "the handoff context loses the preview on revoke");
  assert(saves >= 2, "the revoke action saves state");

  const reactivated = await activatePack({ worktree, sessionID: "ses-other", digest });
  assert(!reactivated.ok, "a revoked pack refuses activation for a fresh session");

  const replacement = await createPack({ worktree, sessionID: "ses-source", agent: "dev", selection: "REPLACEMENT-PACK" });
  const replaced = await activatePack({ worktree, sessionID: "ses-source", digest: replacement.digest });
  assert(replaced.ok, "a new pack replaces the session index entry");
  const oldAfterReplace = await activatePack({ worktree, sessionID: "ses-source", digest });
  assert(!oldAfterReplace.ok, "a revoked digest stays refused after the index entry is replaced");

  const cold = await createPack({ worktree, sessionID: "ses-cold", agent: "dev", selection: "COLD-PACK" });
  const unconfirmed = await run({ action: "revoke", digest: cold.digest });
  assert(unconfirmed.output.includes("confirm: true"), "a destructive revoke asks for confirmation");
  const bucket = join(work, "data", "tawassul", "context-packs", readdirSync(join(work, "data", "tawassul", "context-packs"))[0] ?? "");
  assert(existsSync(join(bucket, "packs", `${cold.digest}.json`)), "the unconfirmed pack stays on disk");
  const revoked = await run({ action: "revoke", digest: cold.digest, confirm: true });
  assert(revoked.output.includes("removed from disk"), "revoking before injection removes the pack");
  assert(!existsSync(join(bucket, "packs", `${cold.digest}.json`)), "the removed pack file is gone");

  const victimPath = join(bucket, "victim.json");
  writeFileSync(victimPath, "SENTINEL\n", "utf-8");
  const traversal = await run({ action: "revoke", digest: "../victim", confirm: true });
  assert(traversal.output.includes("Invalid digest"), "a traversal digest is rejected before any unlink");
  assert(existsSync(victimPath), "a sentinel outside the packs directory survives revoke");
  assert(readFileSync(victimPath, "utf-8") === "SENTINEL\n", "the sentinel outside the packs directory is unchanged");

  const longPack = await createPack({ worktree, sessionID: "ses-long", agent: "dev", selection: "L".repeat(12000) });
  const truncated = await run({ action: "read", digest: longPack.digest });
  assert(truncated.output.includes("[truncated: showing 8192 of"), "a large pack is truncated with a notice");
  assert(truncated.metadata?.truncated === true, "the truncation is reported in metadata");

  const unavailable = await run({ action: "read", digest: "f".repeat(64) });
  assert(unavailable.output.includes("unavailable"), "reading a missing pack fails explicitly");

  const after = treeHash(worktree);
  assert(before === after, "the tool never mutates the source checkout");
  assert(statSync(worktree).isDirectory(), "the source checkout stays in place");

  clearSessionBridge();
  console.log("PROOF PASS: five thread actions, flat transfer, and zero source checkout mutation");
}

try {
  await main();
} finally {
  clearSessionBridge();
  rmSync(work, { recursive: true, force: true });
}
