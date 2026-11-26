import "./proof-log-isolate.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  V2Context,
  V2Permission,
  V2Session,
  V2ToolContext,
  V2ToolHookName,
} from "../src/v2/types.ts";

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

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

type SignalIsRequired = undefined extends V2ToolContext["signal"] ? false : true;
const signalRequired: SignalIsRequired = true;

type PermissionIsRequired = undefined extends V2Context["permission"] ? false : true;
const permissionRequired: PermissionIsRequired = true;

type AssertIsVoid = ReturnType<V2Permission["assert"]> extends Promise<void> ? true : false;
const assertIsVoid: AssertIsVoid = true;

type ExactToolHookNames = V2ToolHookName extends "execute.before" | "execute.after"
  ? "execute.before" | "execute.after" extends V2ToolHookName
    ? true
    : false
  : false;
const exactToolHookNames: ExactToolHookNames = true;

function assertHookTypes(session: V2Session): void {
  const scoped = session.hook("context", () => undefined, { providerID: "opencode" });
  const unscoped = session.hook("context", () => undefined);
  const idle = session.hook("experimental.idle", () => undefined);
  // @ts-expect-error a hook without a model cannot be provider-scoped
  const promptScoped = session.hook("prompt", () => undefined, { providerID: "opencode" });
  // @ts-expect-error an unknown session hook name is rejected
  const unknownHook = session.hook("session.middle", () => undefined);
  void scoped;
  void unscoped;
  void idle;
  void promptScoped;
  void unknownHook;
}

if (false) assertHookTypes(null as unknown as V2Session);

const toolDts = readFileSync(
  join(repo, "node_modules", "@opencode", "plugin", "dist", "promise", "tool.d.ts"),
  "utf8",
);
const sessionDts = readFileSync(
  join(repo, "node_modules", "@opencode", "plugin", "dist", "promise", "session.d.ts"),
  "utf8",
);
const pluginDts = readFileSync(
  join(repo, "node_modules", "@opencode", "plugin", "dist", "promise", "plugin.d.ts"),
  "utf8",
);
const registrationDts = readFileSync(
  join(repo, "node_modules", "@opencode", "plugin", "dist", "promise", "registration.d.ts"),
  "utf8",
);
const shim = readFileSync(join(repo, "src", "v2", "types.ts"), "utf8");

assert(signalRequired, "V2ToolContext.signal is required, not optional");
assert(permissionRequired, "V2Context.permission is required, not optional");
assert(assertIsVoid, "V2Permission.assert resolves to void");
assert(exactToolHookNames, "V2ToolHookName is exactly execute.before and execute.after");
assert(toolDts.includes("readonly signal: AbortSignal;"), "the host tool context declares a required signal");
assert((toolDts.match(/readonly "execute\./g) ?? []).length === 2, "the host defines exactly two tool hooks");
assert(sessionDts.includes("readonly hook: ModelHooks<SessionHooks>;"), "the host session hook is model-scoped");
assert(registrationDts.includes("readonly providerID?: string;"), "the host model hook options carry providerID");
assert(pluginDts.includes("readonly permission: PermissionDomain;"), "the host context requires the permission domain");
assert(shim.includes("export type V2ToolContext = HostToolContext;"), "the shim aliases the host tool context");
assert(
  shim.includes('export type V2Permission = Pick<PermissionDomain, "assert" | "hook">;'),
  "the shim derives permission from the host domain",
);
assert(shim.includes("hook: ModelHooks<SessionHooks>;"), "the shim derives the session hook signature");
assert(shim.includes('hook: ToolDomain["hook"];'), "the shim derives the tool hook signature");
assert(!shim.includes("signal?: AbortSignal"), "the shim no longer restates an optional signal");
assert(/permission: V2Permission;/.test(shim), "the context keeps permission as a required domain");

console.log(`PROOF PASS: v2 type shim derived from the host contract (${passed} assertions)`);
