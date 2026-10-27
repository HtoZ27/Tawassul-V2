import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { V2Context, V2SessionEvent } from "../src/v2/types.ts";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

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

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
}

type Part = { type: string; text?: string; [key: string]: unknown };

type ChatHook = (
  input: { sessionID: string; messageID?: string },
  output: { message: { role: string; text?: string; [key: string]: unknown }; parts: Part[] },
) => Promise<void> | void;

const work = mkdtempSync(join(tmpdir(), "tawassul-c02-"));

const envKeys = [
  "TAWASSUL_SCOPE",
  "TAWASSUL_PROJECT_DIR",
  "TAWASSUL_STATE_DIR",
  "TAWASSUL_V2_STATE_DIR",
  "TAWASSUL_HMAC_KEY_DIR",
  "TAWASSUL_LOG_FILE",
  "TAWASSUL_ASK_CHANNEL",
  "TAWASSUL_ASK_TRANSCRIPT",
  "OPENCODE_DB",
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
] as const;

const savedEnv = new Map<string, string | undefined>();
for (const key of envKeys) savedEnv.set(key, process.env[key]);

const keyDir = join(work, "hmac");
mkdirSync(join(work, ".opencode", "agents"), { recursive: true });
mkdirSync(keyDir, { recursive: true, mode: 0o700 });
copyFileSync(join(repo, ".opencode", "agents", "dev.md"), join(work, ".opencode", "agents", "dev.md"));
writeFileSync(
  join(work, "opencode.json"),
  JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      agent: {
        dev: {
          model: "opencode/big-pickle",
          mode: "subagent",
          permission: { edit: "allow", bash: "allow" },
        },
      },
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

const { resetConsentApprovals } = await import("../src/hooks/guards/consent-gate-guard.ts");
const { ASK_MARKER, isAskInjection } = await import("../src/services/ask-channel-parse.ts");
const { getMessageContent } = await import("../src/utils/format.ts");
const { createV2Setup, runChatMessageBridge } = await import("../src/v2/setup.ts");

type BridgePlugin = Parameters<typeof runChatMessageBridge>[0];

function fakePlugin(hook: ChatHook): BridgePlugin {
  return { "chat.message": hook } as unknown as BridgePlugin;
}

function bridgeEvent(sessionID: string, id: string, content: unknown): V2SessionEvent {
  return { sessionID, messages: [{ role: "user", id, content }] };
}

async function unitCases(): Promise<void> {
  {
    const content: Part[] = [
      { type: "text", text: "hello" },
      { type: "file", uri: "file:///tmp/proof.txt", mime: "text/plain" },
    ];
    let seen = "";
    let seededParts = 0;
    const plugin = fakePlugin((_input, output) => {
      seen = getMessageContent(output);
      seededParts = output.parts.length;
      output.parts.push({ type: "text", text: "System Concordance" });
    });
    await runChatMessageBridge(plugin, bridgeEvent("ses_c02_unit_a", "msg_c02_unit_a", content), new Set());
    assert(seen.trim() === "hello", "the hook sees the real user text after the array seed");
    assert(seededParts === 2, "the bridge seeds every original part, including non-text parts");
    assert(content.length === 3, "the bridge writes exactly one added part back");
    assert(content[0]?.text === "hello", "the original text part stays in place");
    assert(
      content.filter((part) => part.text === "hello").length === 1,
      "the bridge does not duplicate the original text",
    );
    assert(content[2]?.text === "System Concordance", "the hook-added part lands after the originals");
  }

  {
    const content: Part[] = [{ type: "text", text: "original" }];
    const plugin = fakePlugin((_input, output) => {
      output.parts[0]!.text = "rewritten";
    });
    await runChatMessageBridge(plugin, bridgeEvent("ses_c02_unit_b", "msg_c02_unit_b", content), new Set());
    assert(content[0]?.text === "rewritten", "an edit to a seeded text part is written back in place");
    assert(content.length === 1, "an edit alone adds no part");
  }

  {
    const message: Record<string, unknown> = { role: "user", content: "plain string" };
    let seen = "";
    const plugin = fakePlugin((_input, output) => {
      seen = getMessageContent(output);
      output.parts.push({ type: "text", text: "injected" });
    });
    await runChatMessageBridge(plugin, { sessionID: "ses_c02_unit_c", messages: [message] }, new Set());
    assert(seen.trim() === "plain string", "string content is seeded as message text and one part");
    const content = message["content"];
    assert(Array.isArray(content) && content.length === 2, "string content becomes an array when a part is added");
    const parts = content as Part[];
    assert(parts[0]?.text === "plain string", "the string text stays first");
    assert(parts[1]?.text === "injected", "the added part follows the string text");
  }

  {
    const message: Record<string, unknown> = { role: "user", content: "original" };
    const plugin = fakePlugin((_input, output) => {
      output.parts[0]!.text = "rewritten";
    });
    await runChatMessageBridge(plugin, { sessionID: "ses_c02_unit_d", messages: [message] }, new Set());
    assert(message["content"] === "rewritten", "a string-content edit is written back as a string");
  }

  {
    const content: Part[] = [{ type: "text", text: "hello" }];
    const plugin = fakePlugin(() => undefined);
    await runChatMessageBridge(plugin, bridgeEvent("ses_c02_unit_e", "msg_c02_unit_e", content), new Set());
    assert(
      content.length === 1 && content[0]?.text === "hello",
      "a hook that changes nothing leaves the content untouched",
    );
  }

  {
    const content: Part[] = [{ type: "text", text: "hello" }];
    let calls = 0;
    const plugin = fakePlugin((_input, output) => {
      calls += 1;
      output.parts.push({ type: "text", text: "once" });
    });
    const processed = new Set<string>();
    const event = bridgeEvent("ses_c02_unit_f", "msg_c02_unit_f", content);
    await runChatMessageBridge(plugin, event, processed);
    await runChatMessageBridge(plugin, event, processed);
    assert(calls === 1, "the bridge dedupes the same message id");
    assert(content.length === 2, "a duplicate event does not duplicate the injected part");
  }

  {
    const question = `${ASK_MARKER}\nApprove git push?`;
    const content: Part[] = [{ type: "text", text: "hello" }];
    const plugin = fakePlugin((_input, output) => {
      output.parts.push({ type: "text", text: question });
    });
    await runChatMessageBridge(plugin, bridgeEvent("ses_c02_unit_g", "msg_c02_unit_g", content), new Set());
    const injected = content.find((part) => typeof part.text === "string" && part.text.startsWith(ASK_MARKER));
    assert(injected !== undefined, "the ask marker survives the write-back verbatim");
    assert(isAskInjection({ parts: [injected!] }), "the written-back question is recognized as an ask injection");
    assert(!isAskInjection({ parts: content }), "a message that starts with real text is not an ask injection");
  }

  assert(
    getMessageContent({ message: { role: "user" }, parts: [] }) === "",
    "the pre-fix empty bridge shape yields no text, so the answer loop cannot see it",
  );
}

async function liveChain(): Promise<void> {
  const repoDir = join(work, "repo");
  const remoteDir = join(work, "remote.git");
  mkdirSync(repoDir, { recursive: true });
  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const git = (args: string[], cwd = work) => spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv });
  assert(git(["init", "--bare", remoteDir]).status === 0, "proof setup creates a local bare remote");
  assert(git(["init", "-b", "main"], repoDir).status === 0, "proof setup creates a local working repo");
  assert(git(["config", "user.email", "proof@tawassul.local"], repoDir).status === 0, "proof setup pins the git email");
  assert(git(["config", "user.name", "Tawassul Proof"], repoDir).status === 0, "proof setup pins the git name");
  writeFileSync(join(repoDir, "README.md"), "consent proof\n");
  assert(git(["add", "README.md"], repoDir).status === 0, "proof setup stages a file");
  assert(git(["commit", "-m", "init"], repoDir).status === 0, "proof setup commits the file");
  assert(git(["remote", "add", "origin", remoteDir], repoDir).status === 0, "proof setup wires the local remote");

  const sessionHooks = new Map<string, (event: V2SessionEvent) => unknown>();
  const toolHooks = new Map<string, (input: unknown) => unknown>();
  const injected: string[] = [];
  const registration = () => ({ dispose: async () => undefined });
  const ctx = {
    location: { directory: work },
    session: {
      hook: async (name: string, callback: (event: V2SessionEvent) => unknown) => {
        sessionHooks.set(name, callback);
        return registration();
      },
      prompt: async () => undefined,
      synthetic: async (input: { sessionID?: string; text?: string }) => {
        if (typeof input?.text === "string") injected.push(input.text);
      },
      interrupt: async () => undefined,
    },
    tool: {
      transform: async (callback: (editor: { add: (tool: unknown) => void }) => void) => {
        callback({ add: () => undefined });
        return registration();
      },
      reload: async () => undefined,
      list: async () => [],
      hook: async (name: string, callback: (input: unknown) => unknown) => {
        toolHooks.set(name, callback);
        return registration();
      },
    },
    event: {
      subscribe: async function* () {
        yield* [];
      },
    },
    permission: {
      assert: async () => undefined,
      hook: async () => registration(),
    },
  } as unknown as V2Context;

  resetConsentApprovals();
  const cleanup = await createV2Setup()(ctx);
  try {
    const contextHook = sessionHooks.get("context");
    const beforeHook = toolHooks.get("execute.before");
    assert(typeof contextHook === "function", "the v2 setup registers the session.context bridge");
    assert(typeof beforeHook === "function", "the v2 setup registers tool.execute.before");
    if (!contextHook || !beforeHook) fail("the v2 setup is missing a required hook");

    const gate = async (sessionID: string, id: string, command: string): Promise<unknown> => {
      try {
        await beforeHook({ tool: "bash", sessionID, agent: "dev", id, input: { command } });
        return undefined;
      } catch (e) {
        return e;
      }
    };

    const rootSession = "ses_c02_root";
    const childSession = "ses_c02_child";
    const firstContent: Part[] = [{ type: "text", text: "please push the release with elevated privileges" }];
    await contextHook({
      sessionID: rootSession,
      messages: [{ role: "user", id: "msg_c02_first", content: firstContent }],
    });
    assert(
      firstContent.some((part) => typeof part.text === "string" && part.text.includes("System Concordance")),
      "the live bridge runs the real hook and writes its guidance into the message",
    );

    const firstBlock = await gate(childSession, "call_c02_push_1", "sudo git push origin main");
    assert(
      firstBlock instanceof Error && firstBlock.name === "ConsentBlockedError",
      "the first elevated push is blocked by the consent gate",
    );
    assert(
      firstBlock instanceof Error && firstBlock.message.includes("blocked awaiting your approval"),
      "the block message asks the user to answer in chat",
    );
    await flush();
    assert(injected.length === 1, "the deferred question is injected into the transcript");
    assert(injected[0]?.startsWith(ASK_MARKER) === true, "the injected question carries the ask marker");
    assert(injected[0]?.includes("git push origin main") === true, "the injected question names the exact command");
    assert(
      isAskInjection({ parts: [{ type: "text", text: injected[0] ?? "" }] }),
      "the injected question is a recognized ask injection",
    );

    await contextHook({
      sessionID: rootSession,
      messages: [{ role: "user", id: "msg_c02_yes", content: [{ type: "text", text: "yes" }] }],
    });
    const retry = await gate(childSession, "call_c02_push_2", "git push origin main");
    assert(retry === undefined, "the retried elevated push passes the gate after the chat approval");
    assert(injected.length === 1, "the approval adds no new question");

    const push = git(["push", "origin", "main"], repoDir);
    assert(
      push.status === 0,
      `the approved command reaches the real remote (status ${push.status}: ${(push.stderr ?? "").slice(0, 160)})`,
    );
    const remoteHead = git(["--git-dir", remoteDir, "rev-parse", "--verify", "main"]);
    assert(
      remoteHead.status === 0 && /^[0-9a-f]{40}$/i.test(remoteHead.stdout.trim()),
      "the bare remote has the pushed main commit",
    );
    const remoteFile = git(["--git-dir", remoteDir, "show", "main:README.md"]);
    assert(remoteFile.stdout === "consent proof\n", "the pushed commit carries the expected file");

    const otherBlock = await gate(childSession, "call_c02_push_3", "sudo git push origin dev");
    assert(
      otherBlock instanceof Error && otherBlock.name === "ConsentBlockedError",
      "a different elevated push is still blocked",
    );
    await flush();
    assert(injected.length === 2, "the different command gets its own question");
    assert(injected[1]?.includes("git push origin dev") === true, "the second question names the different command");

    await contextHook({
      sessionID: rootSession,
      messages: [{ role: "user", id: "msg_c02_no", content: [{ type: "text", text: "no" }] }],
    });
    const denied = await gate(childSession, "call_c02_push_4", "sudo git push origin dev");
    assert(denied instanceof Error && denied.name === "ConsentBlockedError", "the denied command stays blocked on retry");
    assert(
      denied instanceof Error && denied.message.includes("previously denied"),
      "the retry reports the cached denial",
    );
    await flush();
    assert(injected.length === 2, "a cached denial creates no new question");

    const stillApproved = await gate(childSession, "call_c02_push_5", "sudo git push origin main");
    assert(stillApproved === undefined, "the approval stays scoped to its own command");
  } finally {
    try {
      await cleanup();
    } catch (e) {
      console.error(`PROOF WARN: v2 cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

try {
  await unitCases();
  await liveChain();
  console.log(`PROOF PASS: v2 chat bridge seeds real content and the consent answer loop executes (${passed} assertions)`);
} finally {
  for (const key of envKeys) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(work, { recursive: true, force: true });
}
