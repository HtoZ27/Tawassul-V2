import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import defined, { createHooks, tawassul } from "../src/index.ts";
import { initPlugin } from "../src/bootstrap/plugin-init.ts";
import { createV2Setup } from "../src/v2/setup.ts";
import type { PluginInput, TawassulHooks } from "../src/plugin-types.ts";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed += 1;
  console.log(`ok ${name}`);
}

async function entryShape(): Promise<void> {
  assert(tawassul.id === "tawassul", "the entry declares the tawassul id");
  assert(!("server" in tawassul), "the entry carries no v1 server member");
  assert(JSON.stringify(Object.keys(tawassul).sort()) === JSON.stringify(["id", "setup"]), "the entry exposes exactly id and setup");
  assert(typeof tawassul.setup === "function", "the entry carries the v2 setup function");
  assert(createHooks === initPlugin, "the standalone initializer is exported for embedders and proofs");
  assert(defined === tawassul, "Plugin.define returns the same entry object");
  assert(defined.id === "tawassul" && typeof defined.setup === "function", "the defined plugin keeps id and setup");
}

function esmGuard(): void {
  const build = readFileSync(join(repo, "build-v2.mjs"), "utf8");
  assert(build.includes("import.meta.resolve"), "the build probes module resolution before choosing externals");
  assert(build.includes("resolvesModule(\"@opencode/plugin\")"), "the probe targets the host plugin package");
  assert(build.includes("explicitExternal"), "the resolved host package joins the external list");
  const bundle = readFileSync(join(repo, "dist", "index.js"), "utf8");
  assert(
    /from\s+["']@opencode\/plugin(?:\/[^"']*)?["']/.test(bundle),
    "the built bundle keeps the host plugin package external",
  );
  assert(!bundle.includes("createServerPlugin"), "the built bundle does not inline the host plugin implementation");
}

async function capabilityGate(): Promise<void> {
  let calls = 0;
  const stub = (() => {
    calls += 1;
    return {} as TawassulHooks;
  }) as (input: PluginInput) => TawassulHooks;
  const setup = createV2Setup({ init: stub });
  const empty = await setup(undefined);
  assert(calls === 0, "setup never initializes when the host is missing both domains");
  assert(typeof empty === "function", "an aborted setup still returns a cleanup function");
  await empty();
  const sessionOnly = await setup({ session: {} });
  assert(calls === 0, "a session without a tool domain still aborts before init");
  assert(typeof sessionOnly === "function", "the session-only abort returns a cleanup function");
  const toolOnly = await setup({ tool: {} });
  assert(calls === 0, "a tool without a session domain still aborts before init");
  assert(typeof toolOnly === "function", "the tool-only abort returns a cleanup function");
}

try {
  await entryShape();
  esmGuard();
  await capabilityGate();
  console.log(`PROOF PASS: the plugin entry, ESM guard, and domain gate hold (${passed} assertions)`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
