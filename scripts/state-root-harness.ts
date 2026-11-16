import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

export type BootedPlugin = {
  plugin: Record<string, unknown> & {
    tool: Record<string, { execute: (input: Record<string, unknown>, context: unknown) => Promise<unknown> }>;
    dispose: () => Promise<void>;
  };
  ctx: {
    persistDir: string;
    stateDir: string;
    projectRoot?: string;
    records: Array<{ id: string; title: string }>;
    saveState: () => Promise<void>;
    toolRunLog?: unknown;
  };
  persistDir?: string;
  identity?: { key: string; source: string };
};

export type BootOptions = {
  workspace: string;
  projectID?: string;
  canonical?: string;
  stateRootMode?: "auto" | "legacy" | "project";
  worktreeRoot?: string;
};

export function prepareHarnessEnv(work: string, keyDir: string): void {
  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
  process.env.TAWASSUL_SCOPE = "project";
  process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
  process.env.TAWASSUL_ASK_CHANNEL = "0";
  process.env.TAWASSUL_LOG_FILE = join(work, "tawassul.log");
  process.env.OPENCODE_DB = join(work, "opencode.db");
  process.env.HOME = join(work, "home");
  process.env.XDG_CONFIG_HOME = join(work, "xdg-config");
  process.env.XDG_DATA_HOME = join(work, "xdg-data");
  process.env.XDG_CACHE_HOME = join(work, "xdg-cache");
  process.env.XDG_STATE_HOME = join(work, "xdg-state");
  delete process.env.TAWASSUL_STATE_DIR;
  delete process.env.TAWASSUL_V2_STATE_DIR;
  delete process.env.TAWASSUL_ISOLATED;
  mkdirSync(join(work, "home"), { recursive: true });
}

export function prepareWorkspace(workspace: string): void {
  mkdirSync(join(workspace, ".opencode", "agents"), { recursive: true });
  copyFileSync(join(REPO, ".opencode", "agents", "dev.md"), join(workspace, ".opencode", "agents", "dev.md"));
  writeFileSync(
    join(workspace, "opencode.json"),
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
}

function fakeContext(workspace: string, projectID?: string, canonical?: string): unknown {
  const project = projectID
    ? { id: projectID, directory: workspace, canonical: canonical ?? workspace }
    : undefined;
  return {
    location: { directory: workspace, workspaceID: "w1", project },
    sessionId: "ses_state_root_probe",
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
    permission: { assert: async () => undefined, hook: async () => ({ dispose: async () => undefined }) },
  };
}

export async function bootPlugin(options: BootOptions): Promise<BootedPlugin> {
  if (options.stateRootMode === undefined || options.stateRootMode === "auto") delete process.env.TAWASSUL_STATE_ROOT;
  else process.env.TAWASSUL_STATE_ROOT = options.stateRootMode;
  if (options.worktreeRoot) process.env.TAWASSUL_WORKTREE_ROOT = options.worktreeRoot;
  else delete process.env.TAWASSUL_WORKTREE_ROOT;

  const { initPlugin, getInitReady } = await import(`${REPO}/src/bootstrap/plugin-init.ts`);
  const { buildPluginInput } = await import(`${REPO}/src/v2/client-shim.ts`);
  const input = buildPluginInput(
    fakeContext(options.workspace, options.projectID, options.canonical) as never,
  ) as unknown as {
    persistDir?: string;
    projectIdentity?: { key: string; source: string };
  } & Parameters<typeof initPlugin>[0];
  const plugin = initPlugin(input) as unknown as BootedPlugin["plugin"] & {
    tawaCtx: BootedPlugin["ctx"];
  };
  const probe = getInitReady(plugin as never);
  const status = await probe!();
  if (!status.ready) throw new Error(`plugin boot failed: ${status.error?.message ?? "unknown"}`);
  return {
    plugin,
    ctx: plugin.tawaCtx,
    persistDir: input.persistDir,
    identity: input.projectIdentity,
  };
}

function toolContext(workspace: string): unknown {
  return {
    sessionID: "ses_state_root_probe",
    messageID: "msg_state_root_probe",
    agent: "tawa",
    directory: workspace,
    worktree: workspace,
    abort: new AbortController().signal,
    metadata: () => undefined,
  };
}

export async function writeRecord(booted: BootedPlugin, workspace: string, title: string): Promise<void> {
  const record = booted.plugin.tool.record;
  if (!record) throw new Error("record tool is missing from the boot");
  await record.execute(
    { type: "decision", title, detail: "state root probe record" },
    toolContext(workspace),
  );
  await booted.ctx.saveState();
}

export async function writeGoal(booted: BootedPlugin, workspace: string, title: string): Promise<void> {
  const goal = booted.plugin.tool.goal;
  if (!goal) throw new Error("goal tool is missing from the boot");
  await goal.execute({ create: title }, toolContext(workspace));
}

export async function readGoals(booted: BootedPlugin, workspace: string): Promise<string> {
  const goal = booted.plugin.tool.goal;
  if (!goal) throw new Error("goal tool is missing from the boot");
  const result = (await goal.execute({ list: true, filter: "all" }, toolContext(workspace))) as {
    output?: unknown;
  };
  return typeof result?.output === "string" ? result.output : String(result);
}

export async function disposePlugin(booted: BootedPlugin): Promise<void> {
  await booted.plugin.dispose();
}

export function recordTitles(booted: BootedPlugin): string[] {
  return booted.ctx.records.map((record) => record.title);
}
