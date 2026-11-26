import "./proof-log-isolate.ts";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const PROJECT_ENTRY = join(REPO, ".opencode", "plugins", "tawassul.js");
const HOST_TIMEOUT = Number(process.env.TAWASSUL_E2E_TIMEOUT ?? 150);
const PRIMARY = "openai/mock-a";
const SECONDARY = "openai/mock-b";
const ANSWER = "ANSWER_FROM_B";
const FREE_LIMIT = JSON.stringify({
  error: {
    message: "Free usage limit reached. Resets in 3 hours.",
    type: "free_usage_limit",
    code: "free_usage_limit",
  },
});

type ModelCall = { model: string; path: string };

type MockProvider = {
  port: number;
  calls: ModelCall[];
  close: () => Promise<void>;
};

type ExportMessage = {
  type?: string;
  text?: string;
  model?: { id?: string; providerID?: string };
  previous?: { id?: string; providerID?: string };
};

type SessionExport = {
  info?: { model?: { id?: string; providerID?: string }; outcome?: string };
  messages?: ExportMessage[];
};

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
  console.log(`ok ${message}`);
}

function resolveHostBin(): string {
  const explicit = process.env.TAWASSUL_OPENCODE_BIN?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  const userBin = process.env.OPENCODE?.trim();
  if (userBin && existsSync(userBin)) return userBin;
  const local = join(process.env.HOME ?? "", ".opencode", "bin", "opencode");
  if (existsSync(local)) return local;
  const cliRoot = join(process.env.HOME ?? "", ".config", "ai.opencode.desktop", "cli");
  if (existsSync(cliRoot)) {
    const versions = readdirSync(cliRoot).sort();
    for (let i = versions.length - 1; i >= 0; i -= 1) {
      const candidate = join(cliRoot, versions[i] as string, "opencode-cli");
      if (existsSync(candidate)) return candidate;
    }
  }
  return spawnSync("which", ["opencode"], { encoding: "utf-8" }).stdout?.trim() ?? "";
}

function completionChunks(model: string, text: string): unknown[] {
  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  return [
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
    },
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
  ];
}

function responsesEvents(model: string, text: string): unknown[] {
  const id = `resp_${Date.now()}`;
  const itemID = `msg_${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const base = { id, object: "response", created_at: created, model };
  const item = {
    id: itemID,
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  return [
    { type: "response.created", response: { ...base, status: "in_progress", output: [] } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { id: itemID, type: "message", role: "assistant", status: "in_progress", content: [] },
    },
    { type: "response.output_text.delta", item_id: itemID, output_index: 0, content_index: 0, delta: text },
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: {
        ...base,
        status: "completed",
        output: [item],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    },
  ];
}

function startMock(): Promise<MockProvider> {
  return new Promise((resolve, reject) => {
    const calls: ModelCall[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const path = req.url ?? "";
        if (path.includes("/models")) {
          calls.push({ model: "", path: `${req.method} ${path}` });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ object: "list", data: [{ id: "mock-a" }, { id: "mock-b" }] }));
          return;
        }
        if (req.method !== "POST") {
          calls.push({ model: "", path: `${req.method} ${path}` });
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "not found" } }));
          return;
        }
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>;
        } catch {
          body = {};
        }
        const model = typeof body.model === "string" ? body.model : "";
        calls.push({ model, path });
        if (model === "mock-a") {
          res.writeHead(429, { "content-type": "application/json" });
          res.end(FREE_LIMIT);
          return;
        }
        const events = path.includes("/responses")
          ? responsesEvents(model, ANSWER)
          : completionChunks(model, ANSWER);
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        port,
        calls,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

function writeWorkspace(directory: string, stateDir: string, port: number, fallback: Record<string, unknown>): void {
  mkdirSync(join(directory, ".opencode", "plugins"), { recursive: true });
  mkdirSync(join(stateDir, ".opencode"), { recursive: true });
  copyFileSync(PROJECT_ENTRY, join(directory, ".opencode", "plugins", "tawassul.js"));
  const projectModules = join(REPO, ".opencode", "node_modules");
  const modules = existsSync(projectModules) ? projectModules : join(REPO, "node_modules");
  symlinkSync(modules, join(directory, ".opencode", "node_modules"), "dir");
  writeFileSync(
    join(directory, "opencode.json"),
    `${JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        providers: {
          openai: {
            settings: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "test-key" },
            models: { "mock-a": { name: "Mock A" }, "mock-b": { name: "Mock B" } },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(stateDir, ".opencode", "tawassul.json"), `${JSON.stringify({ fallback }, null, 2)}\n`);
}

function hostEnv(input: {
  home: string;
  workspace: string;
  db: string;
  state: string;
  log: string;
  n2: string;
}): NodeJS.ProcessEnv {
  return {
    PATH: "/usr/bin:/bin:/usr/local/bin",
    HOME: input.home,
    XDG_CONFIG_HOME: join(input.home, ".config"),
    XDG_DATA_HOME: join(input.home, ".local", "share"),
    XDG_STATE_HOME: join(input.home, ".local", "state"),
    XDG_CACHE_HOME: join(input.home, ".cache"),
    OPENCODE_DB: input.db,
    TAWASSUL_HMAC_KEY_DIR: join(input.home, "hmac"),
    TAWASSUL_V2_STATE_DIR: input.state,
    TAWASSUL_LOG_FILE: input.log,
    TAWASSUL_N2_LOG: input.n2,
    TAWASSUL_REGISTER_TRIGGERS: "off",
    PWD: input.workspace,
    OLDPWD: input.workspace,
  };
}

function runProcess(
  bin: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<{ status: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (status: number): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ status, out });
    };
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(-1);
    }, options.timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf-8");
    });
    child.on("error", () => finish(-1));
    child.on("close", (code) => finish(code ?? -1));
  });
}

function runHost(
  bin: string,
  workspace: string,
  env: NodeJS.ProcessEnv,
  model: string,
): Promise<{ status: number; out: string }> {
  return runProcess(
    bin,
    ["run", "--standalone", "--auto", "--format", "json", "--model", model, "Reply with exactly: OK"],
    { cwd: workspace, env, timeoutMs: HOST_TIMEOUT * 1000 },
  );
}

function sessionIDFrom(out: string): string | undefined {
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as { sessionID?: unknown };
      if (typeof parsed.sessionID === "string" && parsed.sessionID.startsWith("ses")) return parsed.sessionID;
    } catch {
      void 0;
    }
  }
  return undefined;
}

async function exportSession(
  bin: string,
  workspace: string,
  env: NodeJS.ProcessEnv,
  sessionID: string,
): Promise<SessionExport | undefined> {
  const result = await runProcess(bin, ["session", "export", sessionID, "--standalone"], {
    cwd: workspace,
    env,
    timeoutMs: HOST_TIMEOUT * 1000,
  });
  if (result.status !== 0) return undefined;
  try {
    return JSON.parse(result.out) as SessionExport;
  } catch {
    return undefined;
  }
}

function modelCalls(calls: ModelCall[]): ModelCall[] {
  return calls.filter((call) => call.model === "mock-a" || call.model === "mock-b");
}

async function main(): Promise<void> {
  const HOST_BIN = resolveHostBin();
  assert(HOST_BIN.length > 0 && existsSync(HOST_BIN), `host binary resolved (${HOST_BIN || "not found"})`);
  if (HOST_BIN.length === 0) fail("host binary missing");
  assert(existsSync(PROJECT_ENTRY), "the built project entry exists before the failover boot");

  const mock = await startMock();
  const ROOT = mkdtempSync(join(tmpdir(), "tawassul-failover-e2e-"));
  const HOME = join(ROOT, "home");
  for (const directory of [".config", ".local/share", ".local/state", ".cache", "hmac"]) {
    mkdirSync(join(HOME, directory), { recursive: true });
  }
  let failed = false;
  try {
    const positiveWorkspace = join(ROOT, "positive");
    const positiveState = join(ROOT, "positive-state");
    writeWorkspace(positiveWorkspace, positiveState, mock.port, {
      enabled: true,
      maxSwitches: 2,
      cooldownMs: 0,
      chains: { "*": [PRIMARY, SECONDARY] },
    });
    const positiveEnv = hostEnv({
      home: HOME,
      workspace: positiveWorkspace,
      db: join(ROOT, "positive.db"),
      state: positiveState,
      log: join(ROOT, "positive.log"),
      n2: join(ROOT, "positive-n2.jsonl"),
    });

    const beforePositive = mock.calls.length;
    const positive = await runHost(HOST_BIN, positiveWorkspace, positiveEnv, PRIMARY);
    const positiveSession = sessionIDFrom(positive.out);
    assert(positive.status === 0, `the refused turn completes after the switch (rc=${positive.status})`);
    assert(positiveSession !== undefined, "the positive turn reports a session id");
    if (!positiveSession) fail("positive session id missing");
    assert(positive.out.includes(ANSWER), "the positive turn streams the fallback answer");

    const positiveCalls = modelCalls(mock.calls.slice(beforePositive));
    assert(positiveCalls.length === 2, `the refused turn makes exactly two model calls (found ${positiveCalls.length})`);
    assert(positiveCalls[0]?.model === "mock-a", "the provider is asked for the primary model first");
    assert(positiveCalls[1]?.model === "mock-b", "the provider is asked for the fallback model second");

    const positiveExport = await exportSession(HOST_BIN, positiveWorkspace, positiveEnv, positiveSession);
    assert(positiveExport !== undefined, "the host exports the positive session");
    if (!positiveExport) fail("positive export missing");
    assert(
      positiveExport.info?.model?.id === "mock-b" && positiveExport.info?.model?.providerID === "openai",
      "the host records the session on the fallback model",
    );
    assert(positiveExport.info?.outcome === "succeeded", "the host marks the switched turn succeeded");
    const switches = (positiveExport.messages ?? []).filter((message) => message.type === "model-switched");
    assert(switches.length === 1, `the host records exactly one model switch (found ${switches.length})`);
    assert(
      switches[0]?.previous?.id === "mock-a" &&
        switches[0]?.previous?.providerID === "openai" &&
        switches[0]?.model?.id === "mock-b" &&
        switches[0]?.model?.providerID === "openai",
      "the recorded switch moves openai/mock-a to openai/mock-b",
    );
    const positiveLog = readFileSync(join(ROOT, "positive.log"), "utf-8");
    assert(
      new RegExp(`model failover: \\S+ session ${positiveSession} -> openai/mock-b`).test(positiveLog),
      "the plugin log records the failover for this session",
    );

    const negativeWorkspace = join(ROOT, "negative");
    const negativeState = join(ROOT, "negative-state");
    writeWorkspace(negativeWorkspace, negativeState, mock.port, { enabled: false });
    const negativeEnv = hostEnv({
      home: HOME,
      workspace: negativeWorkspace,
      db: join(ROOT, "negative.db"),
      state: negativeState,
      log: join(ROOT, "negative.log"),
      n2: join(ROOT, "negative-n2.jsonl"),
    });

    const beforeNegative = mock.calls.length;
    const negative = await runHost(HOST_BIN, negativeWorkspace, negativeEnv, PRIMARY);
    const negativeSession = sessionIDFrom(negative.out);
    assert(negative.status !== 0, `the disabled fallback fails the turn (rc=${negative.status})`);
    assert(negativeSession !== undefined, "the negative turn reports a session id");
    if (!negativeSession) fail("negative session id missing");
    assert(
      negative.out.includes("Free usage limit reached") && negative.out.includes("provider.quota"),
      "the disabled fallback surfaces the provider quota refusal",
    );

    const negativeCalls = modelCalls(mock.calls.slice(beforeNegative));
    assert(negativeCalls.length === 1, `the disabled fallback makes one model call (found ${negativeCalls.length})`);
    assert(negativeCalls[0]?.model === "mock-a", "the disabled fallback never asks for the fallback model");

    const negativeExport = await exportSession(HOST_BIN, negativeWorkspace, negativeEnv, negativeSession);
    assert(negativeExport !== undefined, "the host exports the negative session");
    if (!negativeExport) fail("negative export missing");
    assert(
      negativeExport.info?.model?.id === "mock-a" && negativeExport.info?.model?.providerID === "openai",
      "the disabled fallback leaves the session on the refused model",
    );
    assert(negativeExport.info?.outcome === "failed", "the host marks the refused turn failed");
    const negativeSwitches = (negativeExport.messages ?? []).filter(
      (message) => message.type === "model-switched",
    );
    assert(negativeSwitches.length === 0, "the disabled fallback records no model switch");
    const negativeLog = readFileSync(join(ROOT, "negative.log"), "utf-8");
    assert(
      !negativeLog.includes(`session ${negativeSession} ->`),
      "the plugin log records no failover for the refused session",
    );

    console.log(`PROOF PASS: a refused provider moves the live session to the fallback model`);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await mock.close();
    if (!failed) rmSync(ROOT, { recursive: true, force: true });
    else console.error(`diagnostics kept at ${ROOT}`);
  }
}

try {
  await main();
} catch (error) {
  if (!String((error as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(error as Error)?.message ?? error}`);
    process.exitCode = 1;
  }
}
