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

const SESSION = "ses-c03-root";
const CHILD = "ses-c03-child";
const NO_AGENT_CMD = "sudo systemctl status sshd";
const UNKNOWN_CMD = "git push origin main";
const KNOWN_CMD = "rm -rf /tmp/c03-known";
const SAFE_NO_AGENT = "ls -la";
const SAFE_UNKNOWN = "echo c03-safe";

type TranscriptCall = {
  kind: "prompt" | "synthetic";
  sessionID?: string;
  text: string;
};

type BootedPlugin = {
  "chat.message"?: (
    input: { sessionID: string; agent?: string; messageID?: string },
    output: {
      message: { role: string; text?: string; [key: string]: unknown };
      parts: { type: string; text?: string; [key: string]: unknown }[];
    },
  ) => Promise<void>;
  "tool.execute.before"?: (
    input: { tool: string; agent?: string; sessionID: string; callID: string },
    output: { args: Record<string, unknown>; error?: string },
  ) => Promise<void>;
};

function readTranscriptCall(kind: "prompt" | "synthetic", input: unknown): TranscriptCall {
  const rec = (input ?? {}) as {
    sessionID?: string;
    path?: { id?: string };
    text?: string;
    body?: { parts?: Array<{ text?: string }> };
  };
  const parts = Array.isArray(rec.body?.parts) ? rec.body.parts : [];
  const text = typeof rec.text === "string" ? rec.text : parts.map((part) => part.text ?? "").join("\n");
  return { kind, sessionID: rec.sessionID ?? rec.path?.id, text };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function liveBoot(): Promise<{
  work: string;
  bootLog: string;
  plugin: BootedPlugin;
  transcript: TranscriptCall[];
  hostAsks: { count: number };
}> {
  const work = mkdtempSync(join(tmpdir(), "tawassul-c03-"));
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

  const { initPlugin, getInitReady } = await import("../src/bootstrap/plugin-init.ts");
  const { buildPluginInput } = await import("../src/v2/client-shim.ts");

  const transcript: TranscriptCall[] = [];
  const hostAsks = { count: 0 };
  const ctx = {
    location: { directory: work },
    sessionId: SESSION,
    session: {
      hook: async () => ({ dispose: async () => undefined }),
      prompt: async (input: unknown) => {
        transcript.push(readTranscriptCall("prompt", input));
      },
      synthetic: async (input: unknown) => {
        transcript.push(readTranscriptCall("synthetic", input));
      },
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
      assert: async () => {
        hostAsks.count += 1;
      },
      hook: async () => ({ dispose: async () => undefined }),
    },
  } as never;

  const plugin = initPlugin(buildPluginInput(ctx)) as unknown as BootedPlugin;
  const probe = getInitReady(plugin as never);
  if (probe) await probe();
  const logPath = join(work, "tawassul.log");
  if (!existsSync(logPath)) fail(`isolated boot wrote no log at ${logPath}`);
  return { work, bootLog: readFileSync(logPath, "utf-8"), plugin, transcript, hostAsks };
}

async function userSays(plugin: BootedPlugin, content: string, messageID: string): Promise<void> {
  const hook = plugin["chat.message"];
  if (!hook) fail("the booted plugin has no chat.message hook");
  await hook(
    { sessionID: SESSION, messageID },
    { message: { role: "user", text: content }, parts: [{ type: "text", text: content }] },
  );
}

async function attempt(
  plugin: BootedPlugin,
  callID: string,
  command: string,
  agent: string | undefined,
  sessionID = CHILD,
): Promise<unknown> {
  const hook = plugin["tool.execute.before"];
  if (!hook) fail("the booted plugin has no tool.execute.before hook");
  try {
    await hook({ tool: "bash", agent, sessionID, callID }, { args: { command } });
    return undefined;
  } catch (e) {
    return e;
  }
}

function questionsFor(transcript: TranscriptCall[], command: string): TranscriptCall[] {
  return transcript.filter((call) => call.kind === "synthetic" && call.text.includes(command));
}

async function main(): Promise<void> {
  const { work, bootLog, plugin, transcript, hostAsks } = await liveBoot();
  const { resetConsentApprovals, ConsentBlockedError } = await import(
    "../src/hooks/guards/consent-gate-guard.ts"
  );
  resetConsentApprovals();
  assert(bootLog.includes("AskChannel enabled"), "the isolated boot registers the ask channel");
  assert(bootLog.includes("renderMode=transcript"), "the boot renders questions through the transcript");
  await userSays(plugin, "hello", "msg-c03-intro");

  const noAgent = await attempt(plugin, "c03-1", NO_AGENT_CMD, undefined);
  assert(noAgent instanceof ConsentBlockedError, "a no-agent dangerous command is blocked");
  await flush();
  const noAgentQuestions = questionsFor(transcript, NO_AGENT_CMD);
  assert(noAgentQuestions.length === 1, "the no-agent attempt parks one consent question");
  assert(noAgentQuestions[0]?.sessionID === SESSION, "the no-agent question reaches the root UI session");
  assert(
    noAgentQuestions.every((call) => call.kind === "synthetic"),
    "the no-agent question is a transcript note, not a model turn",
  );
  assert(hostAsks.count === 0, "the no-agent question uses the ask channel, not the host dialog");
  await userSays(plugin, "yes", "msg-c03-yes");
  assert((await attempt(plugin, "c03-2", NO_AGENT_CMD, undefined)) === undefined, "the no-agent command passes after chat approval");

  const unknown = await attempt(plugin, "c03-3", UNKNOWN_CMD, "build");
  assert(unknown instanceof ConsentBlockedError, "an unrecognized agent cannot bypass consent");
  await flush();
  const unknownQuestions = questionsFor(transcript, UNKNOWN_CMD);
  assert(unknownQuestions.length === 1, "the unrecognized-agent attempt parks one consent question");
  assert(unknownQuestions[0]?.sessionID === SESSION, "the unrecognized-agent question reaches the root UI session");
  assert(hostAsks.count === 0, "the unrecognized-agent question uses the ask channel");
  await userSays(plugin, "no", "msg-c03-no");
  const denied = await attempt(plugin, "c03-4", UNKNOWN_CMD, "build");
  assert(denied instanceof ConsentBlockedError, "the denied unrecognized-agent command stays blocked");
  assert(questionsFor(transcript, UNKNOWN_CMD).length === 1, "the cached denial adds no duplicate question");

  assert((await attempt(plugin, "c03-5", SAFE_NO_AGENT, undefined)) === undefined, "a safe no-agent command still passes");
  assert((await attempt(plugin, "c03-6", SAFE_UNKNOWN, "build")) === undefined, "a safe unrecognized-agent command still passes");
  assert(
    questionsFor(transcript, SAFE_NO_AGENT).length === 0 && questionsFor(transcript, SAFE_UNKNOWN).length === 0,
    "safe commands park no question",
  );

  const known = await attempt(plugin, "c03-7", KNOWN_CMD, "dev");
  assert(known instanceof ConsentBlockedError, "the managed-agent consent path is unchanged");
  await flush();
  assert(questionsFor(transcript, KNOWN_CMD).length === 1, "the managed-agent control parks its own question");

  await new Promise((resolve) => setTimeout(resolve, 100));
  rmSync(work, { recursive: true, force: true });
  console.log(`PROOF PASS: a missing or unrecognized agent cannot bypass the consent gate (${passed} assertions)`);
}

try {
  await main();
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
