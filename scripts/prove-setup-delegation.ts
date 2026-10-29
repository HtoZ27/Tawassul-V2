import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { V2Context } from "../src/v2/types.ts";

const ROOT = mkdtempSync(join(tmpdir(), "tawassul-setup-delegation-"));

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

function projectModule(): string {
  return [
    "const plugin = {",
    '  id: "tawassul",',
    "  setup: async (ctx) => {",
    "    globalThis.__tawassulDelegated = (globalThis.__tawassulDelegated ?? 0) + 1;",
    '    globalThis.__tawassulDelegatedDirectory = ctx?.location?.directory ?? "";',
    "    return async () => undefined;",
    "  },",
    "};",
    "export default plugin;",
    "",
  ].join("\n");
}

const FOREIGN_ENTRY = 'export default { id: "other-plugin", setup: async () => async () => undefined };\n';
const BROKEN_ENTRY = "const broken = {;\n";

function makeWorkspace(name: string): string {
  const workspace = join(ROOT, name);
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

function fakeContext(workspace: string): V2Context {
  return {
    location: { directory: workspace },
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
    event: {
      subscribe: async function* () {
        yield* [];
      },
    },
  } as unknown as V2Context;
}

type BootResult = {
  cleanup: () => Promise<void>;
  delegated: number;
  directory: string;
};

async function bootSetup(scope: string, workspace: string): Promise<BootResult> {
  const mod = await import("../src/v2/setup.ts");
  process.env.TAWASSUL_SCOPE = scope;
  (globalThis as Record<string, unknown>).__tawassulDelegated = 0;
  (globalThis as Record<string, unknown>).__tawassulDelegatedDirectory = "";
  const setup = mod.createV2Setup({ init: () => ({ tool: {} }) as never });
  const cleanup = (await setup(fakeContext(workspace))) as () => Promise<void>;
  return {
    cleanup,
    delegated: (globalThis as unknown as Record<string, number>).__tawassulDelegated ?? 0,
    directory: (globalThis as unknown as Record<string, string>).__tawassulDelegatedDirectory ?? "",
  };
}

try {
  const flat = makeWorkspace("flat");
  const flatPlugin = join(flat, ".opencode", "plugin");
  mkdirSync(flatPlugin, { recursive: true });
  writeFileSync(join(flatPlugin, "tawassul.js"), projectModule());

  const global = await bootSetup("global", flat);
  assert(global.delegated === 1, "the global copy delegates to the project copy exactly once");
  assert(global.directory === flat, "the delegated setup receives the workspace directory");
  assert(typeof global.cleanup === "function", "the delegated setup returns a cleanup function");
  await global.cleanup();

  const repeat = await bootSetup("global", flat);
  assert(repeat.delegated === 1, "a repeated global setup delegates again");
  await repeat.cleanup();

  const project = await bootSetup("project", flat);
  assert(project.delegated === 0, "a project-scope setup never delegates to itself");
  assert(typeof project.cleanup === "function", "the project setup still returns a cleanup function");
  await project.cleanup();

  const empty = makeWorkspace("empty");
  const none = await bootSetup("global", empty);
  assert(none.delegated === 0, "a global setup with no project entry does not delegate");
  assert(typeof none.cleanup === "function", "the global setup still boots with no project entry");
  await none.cleanup();

  const foreign = makeWorkspace("foreign");
  const foreignPlugin = join(foreign, ".opencode", "plugin");
  mkdirSync(foreignPlugin, { recursive: true });
  writeFileSync(join(foreignPlugin, "foreign.js"), FOREIGN_ENTRY);
  const foreignSetup = await bootSetup("global", foreign);
  assert(foreignSetup.delegated === 0, "a foreign plugin is never delegated to");
  assert(typeof foreignSetup.cleanup === "function", "a foreign entry does not break the global setup");
  await foreignSetup.cleanup();

  const broken = makeWorkspace("broken");
  const brokenPlugin = join(broken, ".opencode", "plugin");
  mkdirSync(brokenPlugin, { recursive: true });
  writeFileSync(join(brokenPlugin, "tawassul.js"), BROKEN_ENTRY);
  const brokenSetup = await bootSetup("global", broken);
  assert(brokenSetup.delegated === 0, "an unloadable project entry does not delegate");
  assert(typeof brokenSetup.cleanup === "function", "an unloadable project entry fails open to the global setup");
  await brokenSetup.cleanup();

  const pkg = makeWorkspace("package");
  const packageDir = join(pkg, ".opencode", "plugins", "tawassul");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "index.ts"), projectModule());
  const retiredEntry = join(packageDir, "index.ts.retired-20260601");
  writeFileSync(retiredEntry, BROKEN_ENTRY);
  const pkgSetup = await bootSetup("global", pkg);
  assert(pkgSetup.delegated === 1, "a package-directory project entry is delegated to");
  assert(existsSync(retiredEntry), "the retired fixture is not imported as a project entry");
  await pkgSetup.cleanup();

  console.log(`PROOF PASS: the global setup delegates to a project copy and fails open without one (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  delete process.env.TAWASSUL_SCOPE;
  rmSync(ROOT, { recursive: true, force: true });
}
