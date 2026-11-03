import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type ToolOutput = string | { output?: string };
type Tool = {
  execute(args: Record<string, unknown>, context: Record<string, unknown>): Promise<ToolOutput>;
};
type Hooks = Record<string | symbol, unknown> & {
  tool?: Record<string, Tool>;
  dispose?: () => unknown;
};
type Server = (input: Record<string, unknown>) => Hooks;
type Bundle = { createHooks?: Server };

function fail(message: string): never {
  console.error(`ast-bundle: FAIL ${message}`);
  process.exit(1);
}

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function outputOf(result: ToolOutput): string {
  return typeof result === "string" ? result : (result?.output ?? "");
}

function toolContext(project: string): Record<string, unknown> {
  return {
    sessionID: "ses_ast_bundle",
    messageID: "msg_ast_bundle",
    agent: "dev",
    directory: project,
    worktree: project,
    abort: new AbortController().signal,
    metadata() {},
  };
}

const pluginArg = flagValue("--plugin");
if (!pluginArg) fail("--plugin is required");
const plugin = resolve(pluginArg);
if (!existsSync(plugin)) fail(`the plugin bundle does not exist: ${plugin}`);

const work = mkdtempSync(join(tmpdir(), "tawassul-ast-bundle-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));

const home = join(work, "home");
const project = join(work, "project");
const globalDir = join(work, "global");
mkdirSync(home, { recursive: true });
mkdirSync(project, { recursive: true });
mkdirSync(globalDir, { recursive: true });

process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, ".config");
process.env.XDG_DATA_HOME = join(home, ".local", "share");
process.env.TAWASSUL_GLOBAL_DIR = globalDir;
process.env.TAWASSUL_REGISTER_TRIGGERS = "off";

writeFileSync(
  join(project, "sample.ts"),
  [
    'import { readFile } from "node:fs";',
    "export interface Shape { area(): number }",
    "export class Square implements Shape {",
    "  constructor(private side: number) {}",
    "  area() { return this.side * this.side; }",
    "}",
    "export function total(shapes: Shape[]): number {",
    "  return shapes.reduce((sum, shape) => sum + shape.area(), 0);",
    "}",
    "",
  ].join("\n"),
);

const bundle = (await import(pathToFileURL(plugin).href)) as Bundle;
const entry = bundle.createHooks;
if (typeof entry !== "function") fail("the bundle does not export the plugin hooks factory");
const hooks = entry({ client: {}, directory: project, worktree: project, hostVersion: "2.2.5" });

const ready = hooks[Symbol.for("tawassul.v2.initReady")];
if (typeof ready !== "function") fail("the plugin did not expose an init-ready probe");
const status = (await (ready as () => Promise<{ ready: boolean; error?: Error }>)()) ?? { ready: false };
if (!status.ready) fail(`plugin init failed: ${status.error?.message ?? "unknown error"}`);

const tools = hooks.tool;
if (!tools) fail("the plugin registered no tools");
const astquery = tools.astquery;
if (!astquery) fail("astquery is missing from the registered tools");
if (!tools.codestate) fail("codestate is missing from the registered tools");

const context = toolContext(project);

const structure = outputOf(await astquery.execute({ file: "sample.ts" }, context));
for (const expected of ["Square", "total", "node:fs"]) {
  if (!structure.includes(expected)) fail(`the structure output is missing ${expected}`);
}

const symbol = outputOf(await astquery.execute({ file: "sample.ts", symbol: "Square" }, context));
if (!symbol.includes("Square")) fail("the symbol query did not return Square");

const kind = outputOf(await astquery.execute({ file: "sample.ts", kind: "function" }, context));
if (!kind.includes("total")) fail("the kind filter lost the function");

try {
  await hooks.dispose?.();
} catch {}

console.log(`ast-bundle: PASS tools=${Object.keys(tools).length}`);
