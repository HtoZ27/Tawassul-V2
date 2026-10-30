import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TawassulContext } from "../src/context.ts";
import { buildThreadTool } from "../src/tools/thread.ts";
import type { ToolContext } from "../src/tool.ts";
import {
  PackDisabledError,
  activatePack,
  attachPackToHandoff,
  createFailurePack,
  createPack,
  isContextHandoffEnabled,
  refreshSessionInjection,
  setContextHandoffConfig,
  warmWorkspace,
} from "../src/services/context-pack/index.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

const work = mkdtempSync(join(tmpdir(), "tawassul-context-kill-"));
const keyDir = join(work, "keys");
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
process.env.XDG_DATA_HOME = join(work, "data");
delete process.env.TAWASSUL_ISOLATED;
const worktree = join(work, "workspace");
mkdirSync(worktree, { recursive: true });

async function main(): Promise<void> {
  delete process.env.TAWASSUL_CONTEXT_HANDOFF;
  assert(isContextHandoffEnabled(undefined), "the feature is enabled by default");
  assert(isContextHandoffEnabled({}), "an empty config enables the feature");
  assert(isContextHandoffEnabled({ innovations: { contextHandoff: { enabled: true } } }), "enabled true keeps the feature on");
  assert(!isContextHandoffEnabled({ innovations: { contextHandoff: { enabled: false } } }), "config disabled turns the feature off");

  setContextHandoffConfig({ innovations: { contextHandoff: { enabled: false } } });
  assert(!isContextHandoffEnabled(undefined), "the runtime config gate disables the feature");
  let runtimeThrew = false;
  try {
    await createPack({ worktree, sessionID: "ses-runtime-off", agent: "dev", selection: "blocked" });
  } catch (error) {
    runtimeThrew = error instanceof PackDisabledError;
  }
  assert(runtimeThrew, "createPack refuses under the runtime config gate");
  assert(
    (await createFailurePack({
      worktree,
      sessionID: "ses-runtime-off",
      messages: [{ role: "user", content: "blocked" }],
      error: { type: "provider.quota" },
    })) === null,
    "the event failure path refuses under the runtime config gate",
  );
  setContextHandoffConfig(null);
  assert(isContextHandoffEnabled(undefined), "clearing the runtime gate restores the default");

  for (const value of ["0", "false", "off", "no", "FALSE", " Off "]) {
    process.env.TAWASSUL_CONTEXT_HANDOFF = value;
    assert(!isContextHandoffEnabled(undefined), `env ${JSON.stringify(value)} disables the feature`);
    assert(
      !isContextHandoffEnabled({ innovations: { contextHandoff: { enabled: true } } }),
      `env ${JSON.stringify(value)} disables the feature even when config is on`,
    );
  }
  process.env.TAWASSUL_CONTEXT_HANDOFF = "1";
  assert(isContextHandoffEnabled(undefined), "env 1 keeps the feature on");
  process.env.TAWASSUL_CONTEXT_HANDOFF = "0";
  assert(!isContextHandoffEnabled(undefined), "env 0 disables the feature");

  let threw = false;
  try {
    await createPack({ worktree, sessionID: "ses-off", agent: "dev", selection: "blocked" });
  } catch (error) {
    threw = error instanceof PackDisabledError;
  }
  assert(threw, "createPack refuses while the kill switch is off");

  const activated = await activatePack({ worktree, sessionID: "ses-off", digest: "a".repeat(64) });
  assert(!activated.ok && activated.reason === "disabled", "activatePack refuses while the kill switch is off");

  const attached = await attachPackToHandoff({
    worktree,
    sessionID: "ses-off",
    agent: "dev",
    entry: {
      id: "H-off",
      from: "analyst",
      to: "dev",
      task: "blocked",
      context: "blocked",
      files: [],
    },
  });
  assert(attached === null, "attachPackToHandoff refuses while the kill switch is off");

  const failure = await createFailurePack({
    worktree,
    sessionID: "ses-off",
    messages: [{ role: "user", content: "blocked" }],
    error: { type: "provider.quota" },
  });
  assert(failure === null, "createFailurePack refuses while the kill switch is off");
  assert((await warmWorkspace({ worktree })) === 0, "warmWorkspace refuses while the kill switch is off");
  assert(!(await refreshSessionInjection({ worktree, sessionID: "ses-off" })), "refresh refuses while the kill switch is off");

  delete process.env.TAWASSUL_CONTEXT_HANDOFF;
  const envOff = buildThreadTool({
    config: { innovations: { contextHandoff: { enabled: false } } },
    handoffs: new Map(),
  } as unknown as TawassulContext);
  const cctx: ToolContext = {
    sessionID: "ses-off",
    messageID: "msg_off",
    agent: "dev",
    directory: worktree,
    worktree,
    abort: new AbortController().signal,
    metadata: () => undefined,
  };
  const disabledByConfig = await envOff.execute({ action: "list" } as never, cctx);
  assert(
    typeof disabledByConfig === "object" && disabledByConfig.output.includes("disabled by the kill switch"),
    "the thread tool is disabled by config",
  );

  process.env.TAWASSUL_CONTEXT_HANDOFF = "no";
  const disabledByEnv = await envOff.execute({ action: "list" } as never, cctx);
  assert(
    typeof disabledByEnv === "object" && disabledByEnv.output.includes("disabled by the kill switch"),
    "the thread tool is disabled by env",
  );

  delete process.env.TAWASSUL_CONTEXT_HANDOFF;
  const enabled = buildThreadTool({
    config: { innovations: { contextHandoff: { enabled: true } } },
    handoffs: new Map(),
  } as unknown as TawassulContext);
  const live = await enabled.execute({ action: "list" } as never, cctx);
  assert(
    typeof live === "object" && live.output.includes("No context packs stored"),
    "the thread tool works once the switch is on",
  );

  console.log("PROOF PASS: config and env both disable every pack path, and the tool matches");
}

try {
  await main();
} finally {
  delete process.env.TAWASSUL_CONTEXT_HANDOFF;
  setContextHandoffConfig(null);
  rmSync(work, { recursive: true, force: true });
}
