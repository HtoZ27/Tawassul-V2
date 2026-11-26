import "./proof-log-isolate.ts";
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
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



type Captured = { body?: { noReply?: boolean; parts?: Array<{ text?: string }> } };

function isRetryPrompt(captured: Captured): boolean {
  const parts = captured.body?.parts ?? [];
  return parts.some((part) => typeof part.text === "string" && part.text.toLowerCase().includes("rate limit"));
}

function noticeText(captured: Captured): string {
  return (captured.body?.parts ?? []).map((part) => part.text ?? "").join("");
}

function isNoticePrompt(captured: Captured): boolean {
  return captured.body?.noReply === true && noticeText(captured).includes("free daily limit");
}

async function boot(config: { notice: boolean; noRetry: boolean } | undefined): Promise<{
  emit: (input: unknown) => Promise<void>;
  prompts: Captured[];
  work: string;
  bootLog: string;
}> {
  const work = mkdtempSync(join(tmpdir(), "tawassul-g003i3-"));
  const keyDir = join(work, "hmac");
  mkdirSync(join(work, ".opencode", "agents"), { recursive: true });
  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  copyFileSync(
    join(process.cwd(), ".opencode", "agents", "dev.md"),
    join(work, ".opencode", "agents", "dev.md"),
  );
  const stateDir = join(work, "state");
  const configBlock: Record<string, unknown> = {
    agent: { dev: { model: "opencode/big-pickle", mode: "subagent", permission: { edit: "allow", bash: "allow" } } },
  };
  if (config) configBlock.freeLimit = config;
  mkdirSync(join(stateDir, ".opencode"), { recursive: true });
  writeFileSync(join(stateDir, ".opencode", "tawassul.json"), JSON.stringify(configBlock, null, 2));
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

  Object.assign(process.env, {
    TAWASSUL_SCOPE: "project",
    TAWASSUL_PROJECT_DIR: work,
    TAWASSUL_V2_STATE_DIR: join(work, "state"),
    TAWASSUL_HMAC_KEY_DIR: keyDir,
    TAWASSUL_LOG_FILE: join(work, "tawassul.log"),
    TAWASSUL_ASK_CHANNEL: "1",
    OPENCODE_DB: join(work, "opencode.db"),
    HOME: join(work, "home"),
    XDG_CONFIG_HOME: join(work, "xdg-config"),
    XDG_DATA_HOME: join(work, "xdg-data"),
    XDG_CACHE_HOME: join(work, "xdg-cache"),
    XDG_STATE_HOME: join(work, "xdg-state"),
  });
  mkdirSync(join(work, "home"), { recursive: true });

  const prompts: Captured[] = [];
  const ctx = {
    directory: work,
    sessionId: "sess-main",
    client: {
      session: {
        promptAsync: async (o: unknown) => {
          prompts.push(o as Captured);
          return {};
        },
      },
    },
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

  const { initPlugin, getInitReady } = await import("../src/bootstrap/plugin-init.ts");
  const hooks = initPlugin(ctx);
  const probe = getInitReady(hooks as never);
  if (probe) await probe();
  const runner = (hooks as unknown as { event: (i: unknown) => Promise<unknown> }).event;
  const bootLog = existsSync(join(work, "tawassul.log")) ? await import("node:fs").then((fs) => fs.readFileSync(join(work, "tawassul.log"), "utf8")) : "";
  return { emit: async (input) => { await runner(input); }, prompts, work, bootLog };
}

const DAILY_ERROR = {
  type: "provider.free-limit",
  message: "Free usage limit reached",
  data: { retryAfterMs: 3_600_000 },
};

async function waitFor(predicate: () => boolean, budgetMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < budgetMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

async function flagOnDailyLimit(): Promise<void> {
  const session = await boot({ notice: true, noRetry: true });
  try {
    await session.emit({
      type: "session.error",
      properties: { sessionID: "sess-main", error: DAILY_ERROR },
    });
    const sawNotice = await waitFor(() => session.prompts.length > 0, 2000);
    
    assert(sawNotice, "the bridged daily limit delivers exactly the notice through the real bridge");
    assert(
      session.prompts.every((p) => isNoticePrompt(p)),
      "the bridged daily limit injects no model-facing prompt of its own",
    );
    const retried = await waitFor(() => session.prompts.some((p) => isRetryPrompt(p)), 6000);
    assert(retried === false, "the bridged daily limit never schedules the legacy backoff retry prompt");
    assert(
      noticeText(session.prompts[0] ?? {}).includes("switching key or model does not help"),
      "the delivered notice carries the shared-quota guidance",
    );
  } finally {
    rmSync(session.work, { recursive: true, force: true });
  }
}

async function flagOffDailyLimitKeepsTheOldStringPath(): Promise<void> {
  const session = await boot({ notice: false, noRetry: false });
  try {
    await session.emit({
      type: "session.error",
      properties: { sessionID: "sess-main", error: "rate limit exceeded by the provider" },
    });
    const saw = await waitFor(() => session.prompts.some((p) => isRetryPrompt(p)), 6000);
    assert(saw, "with the bridge disabled the legacy retry still runs for a transient limit");
    assert(
      session.prompts.every((p) => !isNoticePrompt(p)),
      "the disabled bridge renders no notice",
    );
  } finally {
    rmSync(session.work, { recursive: true, force: true });
  }
}

async function transientUnchanged(): Promise<void> {
  const session = await boot({ notice: true, noRetry: true });
  try {
    await session.emit({
      type: "session.error",
      properties: { sessionID: "sess-main", error: { type: "provider.rate-limit", message: "Rate limit exceeded" } },
    });
    const saw = await waitFor(() => session.prompts.some((p) => isRetryPrompt(p)), 6000);
    assert(saw, "a transient rate limit keeps the legacy backoff retry while the bridge is on");
    assert(
      session.prompts.every((p) => !isNoticePrompt(p)),
      "a transient rate limit gets no free-limit notice",
    );
  } finally {
    rmSync(session.work, { recursive: true, force: true });
  }
}

try {
  await flagOnDailyLimit();
  await flagOffDailyLimitKeepsTheOldStringPath();
  await transientUnchanged();
  console.log(`PROOF PASS: the daily free limit stops the blind retry and injection while transient retries survive (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
