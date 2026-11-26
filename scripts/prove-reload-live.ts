import "./proof-log-isolate.ts";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getInitReady, initPlugin } from "../src/bootstrap/plugin-init.ts";
import { TOOL_COUNT, TOOL_NAME_SET_HASH } from "../src/generated/tool-tripwire.ts";
import { toolNameSetHash } from "../src/services/tool-tripwire.ts";
import type { ToolDefinition } from "../src/tool.ts";
import { collectToolSchemas, schemaFingerprint, ToolDisposedError } from "../src/v2/adapters.ts";
import { createV2Setup } from "../src/v2/setup.ts";
import type { V2Context, V2ToolContext, V2ToolDefinition } from "../src/v2/types.ts";

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

function resultText(result: unknown): string {
  const rec = result as { content?: Array<{ text?: string }> };
  if (Array.isArray(rec?.content)) return rec.content.map((part) => part.text ?? "").join("");
  return typeof result === "string" ? result : JSON.stringify(result);
}

async function expectDisposed(run: () => Promise<unknown>, name: string): Promise<void> {
  try {
    await run();
  } catch (e) {
    assert(e instanceof ToolDisposedError, `${name} throws ToolDisposedError`);
    assert((e as ToolDisposedError).code === "TOOL_DISPOSED", `${name} carries the TOOL_DISPOSED code`);
    return;
  }
  fail(`${name} did not throw`);
}

type Editor = { add: (tool: V2ToolDefinition) => void };

const SYNTHETIC_NAME = "reloadprobe";
const SYNTHETIC_INPUT = {
  type: "object",
  properties: { probe: { type: "string" } },
  required: ["probe"],
  additionalProperties: false,
};
const SYNTHETIC: V2ToolDefinition = {
  name: SYNTHETIC_NAME,
  description: "Synthetic reload probe.",
  input: SYNTHETIC_INPUT,
  execute: async () => ({ content: [{ type: "text", text: "reload-probe" }] }),
};

const work = mkdtempSync(join(tmpdir(), "tawassul-reload-live-"));
const keyDir = join(work, "keys");
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
process.env.XDG_CONFIG_HOME = join(work, "config");
process.env.XDG_DATA_HOME = join(work, "data");
process.env.XDG_STATE_HOME = join(work, "state");
process.env.XDG_CACHE_HOME = join(work, "cache");
process.env.OPENCODE_DB = join(work, "opencode.db");
delete process.env.TAWASSUL_ISOLATED;
delete process.env.TAWASSUL_CONTEXT_HANDOFF;

const transforms: Array<(editor: Editor) => void> = [];
let registry = new Map<string, V2ToolDefinition>();
let duplicates: string[] = [];
let reloads = 0;

function build(): void {
  const next = new Map<string, V2ToolDefinition>();
  const seen: string[] = [];
  for (const transform of transforms) {
    transform({
      add: (tool) => {
        if (next.has(tool.name)) seen.push(tool.name);
        next.set(tool.name, tool);
      },
    });
  }
  registry = next;
  duplicates = seen;
}

try {
  mkdirSync(join(work, ".opencode"), { recursive: true });
  const hooks = await initPlugin({ client: {}, directory: work, worktree: work } as never);
  const probe = getInitReady(hooks as never);
  assert(probe !== undefined, "the isolated boot exposes the init readiness probe");
  const status = await probe!();
  assert(status.ready, `the isolated boot completes init (${status.error?.message ?? "ready"})`);
  const tools = (hooks.tool ?? {}) as Record<string, ToolDefinition>;
  assert(Object.keys(tools).length === TOOL_COUNT, `the plugin builds the generated tool count (${Object.keys(tools).length})`);

  const host = {
    app: { version: "2.3.0" },
    location: { directory: work },
    session: {
      hook: async () => ({ dispose: async () => undefined }),
      prompt: async () => undefined,
      context: async () => [],
      wait: async () => undefined,
      synthetic: async () => undefined,
      interrupt: async () => undefined,
    },
    tool: {
      transform: async (callback: (editor: Editor) => void) => {
        transforms.push(callback);
        build();
        return {
          dispose: async () => {
            const index = transforms.indexOf(callback);
            if (index >= 0) transforms.splice(index, 1);
            build();
          },
        };
      },
      reload: async () => {
        reloads += 1;
        build();
      },
      list: async () => [...registry.values()],
      hook: async () => ({ dispose: async () => undefined }),
    },
    event: {
      subscribe: async function* () {
        yield* [];
      },
    },
  } as unknown as V2Context;

  const cleanup = await createV2Setup({
    init: () => hooks,
    refresh: { initialWaitMs: 5_000, attempts: 2, delayMs: 10 },
  })(host);

  try {
    const before = registry.size;
    const namesBefore = [...registry.keys()].sort();
    assert(before === TOOL_COUNT, `the boot registers every tool exactly once (${before}/${TOOL_COUNT})`);
    assert(namesBefore.length === new Set(namesBefore).size, "the boot registry has no duplicate names");
    assert(duplicates.length === 0, "no registration callback adds the same name twice");
    assert(toolNameSetHash(namesBefore) === TOOL_NAME_SET_HASH, "the boot registry keeps the name-set tripwire");
    const schemas = await collectToolSchemas(tools);
    const fingerprintBefore = schemaFingerprint(
      new Map([...registry].map(([name, entry]) => [name, entry.input as Record<string, unknown>])),
    );
    assert(
      fingerprintBefore === schemaFingerprint(schemas),
      "every registered tool carries its generated schema, never a placeholder",
    );

    const reloadsBefore = reloads;
    await host.tool.reload();
    assert(reloads === reloadsBefore + 1, "a host reload rebuilds the registry once");
    assert(registry.size === before, `the tool count after reload is unchanged (${registry.size}/${before})`);
    assert([...registry.keys()].sort().join(",") === namesBefore.join(","), "the reload keeps the same tool names");
    assert(duplicates.length === 0, "the reload registers no duplicate tool");
    const fingerprintAfter = schemaFingerprint(
      new Map([...registry].map(([name, entry]) => [name, entry.input as Record<string, unknown>])),
    );
    assert(fingerprintAfter === fingerprintBefore, "the reload keeps the schema fingerprint stable");

    const help = registry.get("help");
    assert(help !== undefined, "a plugin tool survives the reload");
    const helpText = help ? resultText(await help.execute({}, {
      sessionID: "ses-reload",
      messageID: "msg-reload",
      agent: "",
      id: "call-reload",
      signal: new AbortController().signal,
      progress: async () => undefined,
    } as unknown as V2ToolContext)) : "";
    assert(helpText.trim().length > 0, "a plugin tool stays callable through the rebuilt registry");

    for (let index = 0; index < 3; index += 1) await host.tool.reload();
    assert(registry.size === before, `three further reloads keep the count stable (${registry.size})`);
    assert(duplicates.length === 0, "three further reloads register no duplicate tool");

    const syntheticRegistration = await host.tool.transform((editor) => editor.add(SYNTHETIC));
    assert(registry.size === before + 1, `a new tool appears in the registry (${registry.size}/${before + 1})`);
    assert(duplicates.length === 0, "adding a new tool introduces no duplicate");
    await host.tool.reload();
    assert(registry.size === before + 1, "the new tool survives a reload without duplicating");
    assert(duplicates.length === 0, "the reload after the new tool registers no duplicate");
    const added = registry.get(SYNTHETIC_NAME);
    assert(added !== undefined, "the new tool is registered");
    const addedText = added ? resultText(await added.execute({ probe: "value" }, {
      sessionID: "ses-reload",
      messageID: "msg-reload",
      agent: "",
      id: "call-reload",
      signal: new AbortController().signal,
      progress: async () => undefined,
    } as unknown as V2ToolContext)) : "";
    assert(addedText === "reload-probe", "the new tool is callable after the reload");
    const injected = (await host.tool.list()).find((entry) => entry.name === SYNTHETIC_NAME);
    const injectedInput = (injected?.input ?? {}) as { properties?: Record<string, unknown>; required?: string[] };
    assert(
      injectedInput.properties !== undefined && "probe" in injectedInput.properties,
      "the following injection carries the new tool schema",
    );
    assert(
      Array.isArray(injectedInput.required) && injectedInput.required.includes("probe"),
      "the injected schema keeps the new tool requirement",
    );

    await syntheticRegistration.dispose();
    assert(registry.size === before, `disposing the new tool restores the count (${registry.size}/${before})`);
    assert([...registry.keys()].sort().join(",") === namesBefore.join(","), "disposing the new tool restores the name set");
    assert(duplicates.length === 0, "the final registry has no duplicate tool");

    const retained = registry.get("help");
    assert(retained !== undefined, "the host retains a live tool definition before cleanup");
    let settled = false;
    const cleanupPromise = cleanup().then(() => {
      settled = true;
    });
    assert(settled === false, "cleanup is still pending when the host-retained tool is called");
    const staleRun = retained
      ? retained.execute({}, {
          sessionID: "ses-reload",
          messageID: "msg-reload",
          agent: "",
          id: "call-stale",
          signal: new AbortController().signal,
          progress: async () => undefined,
        } as unknown as V2ToolContext)
      : Promise.resolve();
    await expectDisposed(() => staleRun, "a host-retained tool after synchronous close");
    await cleanupPromise;
    assert(transforms.length === 0, "cleanup disposes every registration");
    assert(registry.size === 0, "cleanup empties the rebuilt registry");
    console.log(
      `PROOF PASS: the live reload keeps ${before} tools, adds one callable tool, fails stale calls closed, and duplicates nothing (${passed} assertions)`,
    );
  } finally {
    await cleanup();
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
