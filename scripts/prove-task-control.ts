import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKGROUND_SNAPSHOT_TTL_MS,
  MAX_SNAPSHOT_SESSIONS,
  backgroundControl,
  installBackgroundControl,
  readBackgroundSnapshot,
  recordBackgroundSnapshot,
  resetBackgroundState,
  uninstallBackgroundControl,
} from "../src/services/background-tasks.ts";
import { buildTaskControlTool } from "../src/tools/task-control.ts";
import { registeredToolNames } from "../src/bootstrap/tool-registry.ts";
import { TAWASSUL_TOOL_NAMES } from "../src/tool-names.ts";
import type { ToolContext, ToolResult } from "../src/tool.ts";
import type { V2Session } from "../src/v2/types.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
  console.log(`ok ${message}`);
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

function context(sessionID: string): ToolContext {
  return {
    sessionID,
    messageID: "msg_task_control",
    agent: "dev",
    directory: repo,
    worktree: repo,
    abort: new AbortController().signal,
    metadata: () => undefined,
  };
}

function outputOf(result: ToolResult): string {
  return typeof result === "string" ? result : result.output;
}

function metadataOf(result: ToolResult): Record<string, unknown> {
  return typeof result === "string" ? {} : (result.metadata ?? {});
}

async function rejects(
  run: () => Promise<unknown>,
  needle: string,
  name: string,
): Promise<void> {
  try {
    await run();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    assert(message.includes(needle), name);
    return;
  }
  fail(name);
}

function assertSessionTypes(session: V2Session): void {
  void session.prompt({ sessionID: "s", text: "t", resume: true });
  void session.interrupt({ sessionID: "s", resume: false });
}

if (false) assertSessionTypes(null as unknown as V2Session);

const tool = buildTaskControlTool();
const args = tool.args as Record<string, unknown>;
const actionSchema = args.action as unknown as { options?: readonly string[] };

assert(TAWASSUL_TOOL_NAMES.includes("task_control"), "tool-names advertises task_control");
assert(TAWASSUL_TOOL_NAMES.length === 44, "the advertised surface is 44 tools");
assert(!TAWASSUL_TOOL_NAMES.includes("task"), "the v1 task name is not reused");
assert(
  registeredToolNames(undefined).has("task_control"),
  "task_control is registered even without the optional stores",
);
assert(
  JSON.stringify(actionSchema.options) === JSON.stringify(["status", "cancel", "revive"]),
  "the action enum carries exactly status, cancel, and revive",
);
assert(
  Object.keys(args).sort().join(",") === "action,childSessionID,sessionID,text",
  "the tool takes one action and three optional fields",
);
assert(
  tool.description.includes("UNKNOWN, EMPTY, and STALE"),
  "the description names the three honest snapshot states",
);
assert(
  tool.description.includes("never guesses a session id"),
  "the description states the fail-closed id rule",
);

const registry = readFileSync(join(repo, "src", "bootstrap", "tool-registry.ts"), "utf-8");
assert(
  registry.includes("task_control: buildTaskControlTool()"),
  "the registry builds task_control",
);
assert(
  registry.includes("buildTaskControlTool,"),
  "the registry imports the task control builder",
);

resetBackgroundState();
const unknown = readBackgroundSnapshot("s-unknown");
assert(!unknown.found && !unknown.stale, "a missing snapshot is unknown, not stale");
assert(backgroundControl() === undefined, "no control is installed after a reset");

const unknownStatus = await tool.execute({ action: "status" }, context("s-unknown"));
assert(outputOf(unknownStatus).includes("UNKNOWN"), "an unknown session is reported as UNKNOWN");
assert(metadataOf(unknownStatus).found === false, "the unknown status metadata says found=false");

const emptyNow = Date.now();
recordBackgroundSnapshot("s-empty", [], emptyNow);
const emptyStatus = await tool.execute(
  { action: "status", sessionID: "s-empty" },
  context("s-other"),
);
assert(outputOf(emptyStatus).includes("EMPTY"), "a recorded empty snapshot is reported as EMPTY");
assert(metadataOf(emptyStatus).items === 0, "the empty status metadata counts zero items");

const shell = {
  kind: "shell" as const,
  sessionID: "s-full",
  shellID: "sh_1",
  command: `echo ${"x".repeat(400)} tail`,
};
const subagent = {
  kind: "subagent" as const,
  sessionID: "s-full",
  childSessionID: "child-1",
  agent: "dev",
  description: "fix the parser",
};
const image = {
  kind: "image" as const,
  sessionID: "s-full",
  path: "/tmp/render.png",
  model: "image-model",
};

const fullNow = Date.now();
recordBackgroundSnapshot("s-full", [subagent, shell, image], fullNow);
const fullStatus = await tool.execute({ action: "status" }, context("s-full"));
const fullOutput = outputOf(fullStatus);
assert(fullOutput.includes("3 item(s)"), "the full snapshot counts every background item");
assert(fullOutput.includes("child-1"), "the full snapshot names the subagent child");
assert(fullOutput.includes("agent=dev"), "the full snapshot names the subagent agent");
assert(fullOutput.includes("sh_1"), "the full snapshot names the shell");
assert(fullOutput.includes("/tmp/render.png"), "the full snapshot names the image");
assert(fullOutput.includes("..."), "a long shell command is clipped for the status line");
assert(!fullOutput.includes("tail"), "the clipped shell command drops its tail");

const defaultStatus = await tool.execute({ action: "status" }, context("s-full"));
assert(
  outputOf(defaultStatus).includes("s-full"),
  "status defaults to the calling session",
);

const staleNow = Date.now();
recordBackgroundSnapshot("s-stale", [subagent], staleNow - BACKGROUND_SNAPSHOT_TTL_MS - 1_000);
const staleStatus = await tool.execute({ action: "status" }, context("s-stale"));
assert(outputOf(staleStatus).includes("STALE"), "an aged snapshot is reported as STALE");
assert(metadataOf(staleStatus).stale === true, "the stale status metadata says stale=true");

resetBackgroundState();
recordBackgroundSnapshot("s-live", [subagent], Date.now());
await rejects(
  () => tool.execute({ action: "cancel", childSessionID: "child-1" }, context("s-live")),
  "not installed",
  "cancel fails closed without a control channel",
);
await rejects(
  () =>
    tool.execute(
      { action: "revive", childSessionID: "child-1", text: "continue" },
      context("s-live"),
    ),
  "not installed",
  "revive fails closed without a control channel",
);

const calls: string[] = [];
installBackgroundControl({
  cancelSubagent: async (childSessionID) => {
    calls.push(`cancel:${childSessionID}`);
  },
  reviveSubagent: async (childSessionID, text) => {
    calls.push(`revive:${childSessionID}:${text}`);
  },
});
assert(backgroundControl() !== undefined, "a control channel can be installed");

recordBackgroundSnapshot("s-full", [subagent, shell, image], Date.now());

const cancelled = await tool.execute(
  { action: "cancel", childSessionID: "child-1" },
  context("s-live"),
);
assert(calls.includes("cancel:child-1"), "cancel reaches the installed control with the child id");
assert(metadataOf(cancelled).action === "cancel", "cancel reports its action in metadata");
assert(metadataOf(cancelled).childSessionID === "child-1", "cancel reports the child in metadata");
assert(
  outputOf(cancelled).includes("agent=dev"),
  "cancel names the subagent it interrupted",
);

await rejects(
  () => tool.execute({ action: "cancel", childSessionID: "child-missing" }, context("s-live")),
  "not in the latest background snapshot",
  "cancel refuses an id absent from the snapshot",
);
await rejects(
  () => tool.execute({ action: "cancel", childSessionID: "sh_1" }, context("s-full")),
  "shell work, not a subagent",
  "cancel refuses shell work",
);
recordBackgroundSnapshot("s-stale", [subagent], Date.now() - BACKGROUND_SNAPSHOT_TTL_MS - 1_000);
await rejects(
  () => tool.execute({ action: "cancel", childSessionID: "sh_1" }, context("s-stale")),
  "is stale",
  "cancel refuses to act on a stale snapshot",
);
await rejects(
  () => tool.execute({ action: "cancel", childSessionID: "child-1" }, context("s-none")),
  "No background snapshot",
  "cancel refuses an unknown session",
);
await rejects(
  () => tool.execute({ action: "cancel" }, context("s-live")),
  "requires childSessionID",
  "cancel requires a child id",
);

await rejects(
  () =>
    tool.execute(
      { action: "revive", childSessionID: "child-1", text: "   " },
      context("s-live"),
    ),
  "requires non-empty text",
  "revive refuses blank instructions",
);
const revived = await tool.execute(
  { action: "revive", childSessionID: "child-1", text: "continue with the fix" },
  context("s-live"),
);
assert(
  calls.includes("revive:child-1:continue with the fix"),
  "revive passes the trimmed instructions to the child",
);
assert(metadataOf(revived).action === "revive", "revive reports its action in metadata");
assert(
  metadataOf(revived).textLength === "continue with the fix".length,
  "revive reports the instruction length",
);

const items = [
  { kind: "shell" as const, sessionID: "s-copy", shellID: "sh_copy", command: "echo original" },
];
recordBackgroundSnapshot("s-copy", items, Date.now());
items[0]!.command = "echo mutated";
const copied = readBackgroundSnapshot("s-copy").items[0];
assert(
  copied?.kind === "shell" && copied.command === "echo original",
  "the snapshot copies the host items instead of aliasing them",
);

resetBackgroundState();
const boundNow = Date.now();
for (let index = 0; index < MAX_SNAPSHOT_SESSIONS; index += 1) {
  recordBackgroundSnapshot(`s-bound-${index}`, [], boundNow + index);
}
assert(
  readBackgroundSnapshot("s-bound-0").found,
  "the oldest session survives while the table is at its cap",
);
recordBackgroundSnapshot("s-bound-0", [], boundNow + MAX_SNAPSHOT_SESSIONS);
recordBackgroundSnapshot("s-bound-new", [], boundNow + MAX_SNAPSHOT_SESSIONS + 1);
assert(
  readBackgroundSnapshot("s-bound-0").found,
  "re-recording a session refreshes its place in the table",
);
assert(
  !readBackgroundSnapshot("s-bound-1").found,
  "the least recently recorded session is evicted first",
);
assert(
  readBackgroundSnapshot("s-bound-new").found,
  "a session added past the cap is still stored",
);

uninstallBackgroundControl();
assert(backgroundControl() === undefined, "uninstalling the control closes the channel");
resetBackgroundState();

const setup = readFileSync(join(repo, "src", "v2", "setup.ts"), "utf-8");
assert(
  setup.includes('ctx.session.hook("experimental.idle"'),
  "setup registers the idle snapshot hook",
);
assert(
  setup.includes("recordBackgroundSnapshot(snapshot.sessionID"),
  "the idle hook records the host background list",
);
assert(setup.includes("installBackgroundControl({"), "setup installs the background control");
assert(setup.includes("uninstallBackgroundControl()"), "cleanup removes the background control");
assert(setup.includes("resume: true"), "revive resumes the child through the host prompt");

console.log("PROOF PASS: task control reads the idle snapshot and never invents a child id");
