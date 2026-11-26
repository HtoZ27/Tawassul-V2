import "./proof-log-isolate.ts";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TawassulContext } from "../src/context-class.ts";
import { MAX_HANDOFFS_DEFAULT, MAX_RECORDS_DEFAULT } from "../src/context/constants.ts";
import { buildRecordTool } from "../src/tools/record.ts";
import type { RecordEntry } from "../src/context/types.ts";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "tawassul-e12-"));

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

const envKeys = [
  "TAWASSUL_SCOPE",
  "TAWASSUL_PROJECT_DIR",
  "TAWASSUL_STATE_DIR",
  "TAWASSUL_V2_STATE_DIR",
  "TAWASSUL_HMAC_KEY_DIR",
  "TAWASSUL_LOG_FILE",
  "TAWASSUL_QUIET",
  "OPENCODE_DB",
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
] as const;

const savedEnv = new Map<string, string | undefined>();
for (const key of envKeys) savedEnv.set(key, process.env[key]);

const fakeHome = join(work, "home");
process.env.HOME = fakeHome;
process.env.XDG_CONFIG_HOME = join(fakeHome, ".config");
process.env.XDG_DATA_HOME = join(fakeHome, ".local", "share");
process.env.XDG_STATE_HOME = join(fakeHome, ".local", "state");
process.env.XDG_CACHE_HOME = join(fakeHome, ".cache");
delete process.env.TAWASSUL_STATE_DIR;
delete process.env.TAWASSUL_V2_STATE_DIR;
delete process.env.TAWASSUL_PROJECT_DIR;

function makeProject(label: string): string {
  const dir = join(work, label);
  mkdirSync(join(dir, ".opencode", "agents"), { recursive: true });
  copyFileSync(join(repo, ".opencode", "agents", "dev.md"), join(dir, ".opencode", "agents", "dev.md"));
  return dir;
}

function toolContext(dir: string): {
  sessionID: string;
  messageID: string;
  agent: string;
  directory: string;
  worktree: string;
  abort: AbortSignal;
  metadata(): void;
} {
  return {
    sessionID: "ses_e12",
    messageID: "msg_e12",
    agent: "dev",
    directory: dir,
    worktree: dir,
    abort: new AbortController().signal,
    metadata() {},
  };
}

function onDisk(path: string): RecordEntry[] {
  const raw = readFileSync(path, "utf8");
  const start = raw.indexOf("{");
  if (start < 0) fail("the state file carries no JSON payload");
  const parsed = JSON.parse(raw.slice(start)) as { records?: RecordEntry[] };
  return parsed.records ?? [];
}

async function durability(): Promise<void> {
  const dir = makeProject("durable");
  const ctx = new TawassulContext(dir);
  ctx.ensureConfig();
  const tool = buildRecordTool(ctx);
  const result = await tool.execute(
    { type: "decision", title: "durable record", detail: "written before the tool returned" },
    toolContext(dir),
  );
  const output = typeof result === "string" ? result : result.output;
  assert(output.includes("R-001"), "record returns the new id");
  assert(existsSync(ctx.statePath()), "the state file exists the moment the tool returns");
  const written = onDisk(ctx.statePath());
  assert(written.length === 1, "the record is on disk the moment the tool returns");
  assert(written[0]?.title === "durable record", "the on-disk record carries the title");
  assert(
    ctx.lifecycleManager.getDirtyGeneration() <= ctx.lifecycleManager.getPersistedGeneration(),
    "saveState awaited the observed dirty generation",
  );
  const reread = new TawassulContext(dir);
  await reread.lifecycleManager.loadStateAsync();
  assert(reread.records.length === 1, "a second context loads the record without a flush");
}

async function concurrentMutation(): Promise<void> {
  const dir = makeProject("concurrent");
  const ctx = new TawassulContext(dir);
  ctx.ensureConfig();
  const manager = ctx.stateManager;
  const original = manager.saveWithRevision.bind(manager);
  let calls = 0;
  manager.saveWithRevision = (async (...args: Parameters<typeof original>) => {
    calls++;
    if (calls === 1) await new Promise<void>((resolve) => setTimeout(resolve, 60));
    return original(...args);
  }) as typeof manager.saveWithRevision;
  const first = ctx.saveState();
  ctx.records.push({
    id: "R-001",
    timestamp: new Date().toISOString(),
    agent: "dev",
    type: "decision",
    title: "first mutation",
    detail: "in flight when the second lands",
    provenance: "tool_observed",
  });
  ctx.recSeq = 1;
  await first;
  const second = ctx.saveState();
  ctx.records.push({
    id: "R-002",
    timestamp: new Date().toISOString(),
    agent: "dev",
    type: "note",
    title: "second mutation",
    detail: "arrives during the first save",
    provenance: "tool_observed",
  });
  ctx.recSeq = 2;
  await second;
  const written = onDisk(ctx.statePath());
  assert(written.length === 2, "a mutation during an in-flight save is not dropped");
  assert(
    written.some((entry) => entry.title === "second mutation"),
    "the later mutation is present on disk",
  );
  assert(
    ctx.lifecycleManager.getPersistedGeneration() >= ctx.lifecycleManager.getDirtyGeneration(),
    "the persisted generation catches up with the dirty generation",
  );
}

async function killAfterRecord(): Promise<void> {
  const dir = makeProject("kill");
  const childPath = join(work, "child.ts");
  const contextUrl = pathToFileURL(join(repo, "src", "context-class.ts")).href;
  const recordUrl = pathToFileURL(join(repo, "src", "tools", "record.ts")).href;
  writeFileSync(
    childPath,
    [
      `import { TawassulContext } from ${JSON.stringify(contextUrl)};`,
      `import { buildRecordTool } from ${JSON.stringify(recordUrl)};`,
      `const dir = ${JSON.stringify(dir)};`,
      "const ctx = new TawassulContext(dir);",
      "ctx.ensureConfig();",
      "const tool = buildRecordTool(ctx);",
      "const result = await tool.execute(",
      '  { type: "incident", title: "killed after record", detail: "must survive SIGKILL", severity: "minor" },',
      "  {",
      '    sessionID: "ses_e12_kill",',
      '    messageID: "msg_e12_kill",',
      '    agent: "dev",',
      "    directory: dir,",
      "    worktree: dir,",
      "    abort: new AbortController().signal,",
      "    metadata() {},",
      "  },",
      ");",
      "const output = typeof result === \"string\" ? result : result.output;",
      "if (!output.includes(\"R-001\")) {",
      '  console.error("PROOF FAIL: the child did not record");',
      "  process.exit(7);",
      "}",
      "process.kill(process.pid, \"SIGKILL\");",
      "await new Promise(() => {});",
      "",
    ].join("\n"),
  );
  assert(existsSync(childPath), "the child probe script exists");
  const run = spawnSync("bun", [childPath], {
    encoding: "utf8",
    env: { ...process.env },
    timeout: 60_000,
  });
  assert(run.signal === "SIGKILL", `the record process is killed immediately (signal ${String(run.signal)})`);
  assert(run.status !== 7, "the child recorded before it was killed");
  const reader = new TawassulContext(dir);
  await reader.lifecycleManager.loadStateAsync();
  const kept = reader.records.find((entry) => entry.title === "killed after record");
  assert(kept !== undefined, "a record survives a kill right after saveState resolves");
  assert(kept?.type === "incident", "the recovered record keeps its type");
  assert(kept?.severity === "minor", "the recovered record keeps its severity");
}

try {
  assert(MAX_RECORDS_DEFAULT >= 5000, "the record cap default leaves room beyond the legacy 500");
  assert(MAX_HANDOFFS_DEFAULT >= 2000, "the handoff cap default leaves room beyond the legacy 500");
  await durability();
  await concurrentMutation();
  await killAfterRecord();
  console.log(`PROOF PASS: saveState resolves only after the observed generation is on disk (${passed} assertions)`);
} finally {
  for (const key of envKeys) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(work, { recursive: true, force: true });
}
