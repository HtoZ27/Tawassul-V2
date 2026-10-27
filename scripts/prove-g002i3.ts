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
const SESSION = "ses-main";
const CHILD = "ses-child";
const DENY_CHILD = "ses-child-deny";

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
  const { getInitReady } = await import("../src/bootstrap/plugin-init.ts");
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

async function gate(plugin: BootedPlugin, callID: string, command: string, sessionID = CHILD): Promise<unknown> {
  const hook = plugin["tool.execute.before"];
  if (!hook) fail("the booted plugin has no tool.execute.before hook");
  try {
    await hook(
      { tool: "bash", agent: "dev", sessionID, callID },
      { args: { command } },
    );
    return undefined;
  } catch (e) {
    return e;
  }
}

function questionsFor(transcript: TranscriptCall[], command: string): TranscriptCall[] {
  return transcript.filter((call) => call.kind === "synthetic" && call.text.includes(command));
}

async function consentLoop(
  plugin: BootedPlugin,
  transcript: TranscriptCall[],
  work: string,
  hostAsks: { count: number },
): Promise<void> {
  const { resetConsentApprovals, ConsentBlockedError } = await import(
    "../src/hooks/guards/consent-gate-guard.ts"
  );
  resetConsentApprovals();

  const marker = join(work, "executed-after-approval");
  rmSync(marker, { force: true });

  await userSays(plugin, "hello", "msg-main-intro");

  const firstError = await gate(plugin, "call-1", COMMAND);
  assert(firstError instanceof ConsentBlockedError, "the first attempt is blocked, never silently executed");
  const firstMessage = String((firstError as Error)?.message ?? "");
  assert(firstMessage.includes("awaiting your approval"), "the block message tells the user the command awaits approval");
  assert(firstMessage.includes("Reply in the chat"), "the block message tells the user to answer in chat and retry");

  await flush();
  const questions = questionsFor(transcript, COMMAND);
  assert(questions.length === 1, "exactly one consent question reaches the UI transcript");
  const question = questions[0]!;
  assert(question.sessionID === SESSION, "the question is delivered to the root UI session, not the tool child session");
  assert(question.text.startsWith("\u0002TAWASSUL_ASK\u0002"), "the rendered question carries the ask marker");
  assert(question.text.includes("Consent gate"), "the rendered question names the consent gate");
  assert(question.text.includes("bash"), "the rendered question names the gated tool");
  assert(
    question.text.includes("To accept, reply with any acceptance token: yes, sure, ok, okay, go ahead"),
    "the rendered question shows the acceptance tokens the user can type",
  );
  assert(
    transcript.every((call) => call.kind === "synthetic"),
    "the question is a synthetic transcript note, not a queued model turn",
  );
  assert(
    hostAsks.count === 0,
    "the consent question uses the ask channel, not the host permission dialog",
  );

  await userSays(plugin, "yes", "msg-main-yes");
  const retryError = await gate(plugin, "call-2", COMMAND);
  assert(retryError === undefined, "the same command passes the consent gate on the retry after chat approval");
  assert(questionsFor(transcript, COMMAND).length === 1, "the approval adds no duplicate question");

  spawnSync("bash", ["-lc", `touch ${JSON.stringify(marker)}`]);
  assert(existsSync(marker), "the consent-gated command executes after the chat approval");
}

async function denyLoop(plugin: BootedPlugin, transcript: TranscriptCall[]): Promise<string> {
  const { resetConsentApprovals, ConsentBlockedError } = await import(
    "../src/hooks/guards/consent-gate-guard.ts"
  );
  const { resetToolLoopState } = await import("../src/hooks/guards/tool-loop-guard.ts");
  resetConsentApprovals();
  resetToolLoopState();

  const firstError = await gate(plugin, "call-3", COMMAND, DENY_CHILD);
  assert(firstError instanceof ConsentBlockedError, "the denial run also starts blocked");
  await flush();
  assert(questionsFor(transcript, COMMAND).length === 2, "the denial run parks its own second question");

  await userSays(plugin, "no", "msg-main-no");
  const secondError = await gate(plugin, "call-4", COMMAND, DENY_CHILD);
  assert(secondError instanceof ConsentBlockedError, "a denied command stays blocked on the retry");
  assert(questionsFor(transcript, COMMAND).length === 2, "a cached denial creates no new question");
  return String((secondError as Error)?.message ?? "");
}

try {
  const { work, bootLog, plugin, transcript, hostAsks } = await liveBoot();
  assert(bootLog.includes("AskChannel enabled"), "the isolated boot registers the ask channel");
  assert(bootLog.includes("renderMode=transcript"), "the boot renders questions through the transcript");
  await consentLoop(plugin, transcript, work, hostAsks);
  const denyMessage = await denyLoop(plugin, transcript);
  assert(
    denyMessage.length > 0 && (denyMessage.includes("Denied") || denyMessage.includes("denied")),
    "the cached denial message names the refusal",
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  rmSync(work, { recursive: true, force: true });
  console.log(
    `PROOF PASS: the consent question reaches the OpenCode transcript UI and the chat answer drives the gate (${passed} assertions)`,
  );
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
