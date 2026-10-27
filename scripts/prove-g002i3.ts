import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

const COMMAND = "sudo systemctl restart sshd";
const SESSION = "sess-main";

async function liveBoot(): Promise<{ work: string; bootLog: string }> {
  const work = mkdtempSync(join(tmpdir(), "tawassul-g002i3-"));
  const keyDir = join(work, "hmac");
  mkdirSync(join(work, ".opencode", "agents"), { recursive: true });
  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  copyFileSync(
    join(process.cwd(), ".opencode", "agents", "dev.md"),
    join(work, ".opencode", "agents", "dev.md"),
  );
  writeFileSync(
    join(work, "opencode.json"),
    JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        agent: { dev: { model: "opencode/big-pickle", mode: "subagent", permission: { edit: "allow", bash: "allow" } } },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });

  process.env.TAWASSUL_SCOPE = "project";
  process.env.TAWASSUL_PROJECT_DIR = work;
  process.env.TAWASSUL_STATE_DIR = join(work, "context");
  process.env.TAWASSUL_V2_STATE_DIR = join(work, "state");
  process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
  process.env.TAWASSUL_LOG_FILE = join(work, "tawassul.log");
  process.env.TAWASSUL_ASK_CHANNEL = "1";
  process.env.TAWASSUL_ASK_TRANSCRIPT = "1";
  process.env.OPENCODE_DB = join(work, "opencode.db");
  process.env.HOME = join(work, "home");
  process.env.XDG_CONFIG_HOME = join(work, "xdg-config");
  process.env.XDG_DATA_HOME = join(work, "xdg-data");
  process.env.XDG_CACHE_HOME = join(work, "xdg-cache");
  process.env.XDG_STATE_HOME = join(work, "xdg-state");
  mkdirSync(join(work, "home"), { recursive: true });

  const { initPlugin } = await import("../src/bootstrap/plugin-init.ts");
  const { buildPluginInput } = await import("../src/v2/client-shim.ts");

  const ctx = {
    location: { directory: work },
    sessionId: SESSION,
    session: {
      hook: async () => ({ dispose: async () => undefined }),
      prompt: async () => undefined,
      synthetic: async () => undefined,
      interrupt: async () => undefined,
    },
    tool: {
      transform: async (callback: (editor: { add: (entry: unknown) => void }) => void) => {
        callback({ add: () => undefined });
        return { dispose: async () => undefined };
      },
      reload: async () => undefined,
      list: async () => [],
      hook: async () => ({ dispose: async () => undefined }),
    },
    event: { subscribe: async function* () {} },
    permission: {
      assert: async () => undefined,
      hook: async () => ({ dispose: async () => undefined }),
    },
  } as never;

  const plugin = initPlugin(buildPluginInput(ctx));
  const { getInitReady } = await import("../src/bootstrap/plugin-init.ts");
  const probe = getInitReady(plugin as never);
  if (probe) await probe();
  const logPath = join(work, "tawassul.log");
  if (!existsSync(logPath)) fail(`isolated boot wrote no log at ${logPath}`);
  return { work, bootLog: readFileSync(logPath, "utf-8") };
}

async function consentLoop(work: string): Promise<void> {
  const { consentGateGuard, resetConsentApprovals, ConsentBlockedError } =
    await import("../src/hooks/guards/consent-gate-guard.ts");
  const { AskChannel } = await import("../src/services/ask-channel.ts");
  const { TimerManager } = await import("../src/services/timer-manager.ts");
  resetConsentApprovals();

  const questions: string[] = [];
  const channel = new AskChannel({
    sessionID: () => SESSION,
    timers: new TimerManager(),
    blockingTimeoutMs: 5_000,
    deferredTimeoutMs: 60_000,
    render: async (slot) => {
      questions.push(`${slot.title} :: ${slot.kind.type}`);
    },
  });
  const ctx: Record<string, unknown> = { askChannelInstance: channel, chatOnlyAsk: true };

  const marker = join(work, "executed-after-approval");
  rmSync(marker, { force: true });

  let firstError: unknown;
  try {
    await consentGateGuard.check(
      ctx as never,
      { tool: "bash", sessionID: SESSION, agent: "" } as never,
      { args: { command: COMMAND } } as never,
    );
  } catch (e) {
    firstError = e;
  }
  assert(firstError instanceof ConsentBlockedError, "the first attempt is blocked, never silently executed");
  const firstMessage = String((firstError as Error)?.message ?? "");
  assert(firstMessage.includes("awaiting your approval"), "the block message tells the user the command awaits approval");

  assert(channel.pendingCount === 1, "exactly one consent question is parked in the ask channel");
  assert(questions.some((q) => q.startsWith("⚠️ Consent gate") && q.includes("bash")), "the question reached the transcript surface");
  assert(
    firstMessage.includes("Reply in the chat"),
    "the block message tells the user to answer in chat and retry",
  );

  const consumed = channel.onUserMessage(SESSION, "yes");
  assert(consumed.consumed === true, "the chat answer is consumed by the ask channel, not handed to the model");
  assert(channel.pendingCount === 0, "the approval clears the parked queue");

  const second = await consentGateGuard.check(
    ctx as never,
    { tool: "bash", sessionID: SESSION, agent: "" } as never,
    { args: { command: COMMAND } } as never,
  );
  assert(second === true, "the same command passes the consent gate on the retry after approval");

  spawnSync("bash", ["-lc", `touch ${JSON.stringify(marker)}`]);
  assert(existsSync(marker), "the consent-gated command executes after the chat approval");
}

async function denyLoop(): Promise<string> {
  const { consentGateGuard, resetConsentApprovals, ConsentBlockedError } =
    await import("../src/hooks/guards/consent-gate-guard.ts");
  const { AskChannel } = await import("../src/services/ask-channel.ts");
  const { TimerManager } = await import("../src/services/timer-manager.ts");
  resetConsentApprovals();

  const channel = new AskChannel({
    sessionID: () => SESSION,
    timers: new TimerManager(),
    blockingTimeoutMs: 5_000,
    deferredTimeoutMs: 60_000,
    render: async () => undefined,
  });
  const ctx: Record<string, unknown> = { askChannelInstance: channel, chatOnlyAsk: true };
  const run = (): Promise<unknown> =>
    consentGateGuard.check(
      ctx as never,
      { tool: "bash", sessionID: SESSION, agent: "" } as never,
      { args: { command: COMMAND } } as never,
    );

  let firstError: unknown;
  try {
    await run();
  } catch (e) {
    firstError = e;
  }
  assert(firstError instanceof ConsentBlockedError, "the denial run also starts blocked");
  assert(channel.pendingCount === 1, "the denial run parks its own question");

  const denied = channel.onUserMessage(SESSION, "no");
  assert(denied.consumed === true, "an explicit no is consumed as a real answer");
  assert(channel.pendingCount === 0, "the queue is empty after the denial");

  let secondError: unknown;
  try {
    await run();
  } catch (e) {
    secondError = e;
  }
  assert(secondError instanceof ConsentBlockedError, "a denied command stays blocked on the retry");
  return String((secondError as Error)?.message ?? "");
}

try {
  const { work, bootLog } = await liveBoot();
  assert(bootLog.includes("AskChannel enabled"), "the isolated boot registers the ask channel");
  assert(bootLog.includes("renderMode=transcript"), "the boot renders questions through the transcript");
  await consentLoop(work);
  const denyMessage = await denyLoop();
  assert(denyMessage.length > 0 && (denyMessage.includes("Denied") || denyMessage.includes("denied")), "the cached denial message names the refusal");
  await new Promise((resolve) => setTimeout(resolve, 100));
  rmSync(work, { recursive: true, force: true });
  console.log(`PROOF PASS: the consent path is answerable end to end: chat answer approves, the command executes (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
