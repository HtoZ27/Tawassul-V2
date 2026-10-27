import { BLOCKED_TOOLS, SecurityPolicy } from "../src/security-policy.ts";
import { ensureTawaToolPermissions } from "../src/utils/agent-permission-repair.ts";
import { validateAgents } from "../src/scripts/gen-opencode-config.ts";

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

const policy = (await import("../src/security-policy.ts")) as {
  BLOCKED_TOOL_ALIASES?: readonly string[];
  isBlockedToolForTawa?: (tool: string) => boolean;
};
const blocked = new Set(BLOCKED_TOOLS);
const aliases = new Set(policy.BLOCKED_TOOL_ALIASES ?? []);
const isBlockedToolForTawa = policy.isBlockedToolForTawa;

assert(blocked.has("edit"), "edit stays blocked");
assert(blocked.has("write"), "write stays blocked");
assert(blocked.has("bash"), "bash stays blocked");
assert(blocked.has("addagent"), "addagent stays blocked");
assert(blocked.has("kick"), "kick stays blocked");
assert(blocked.has("pause"), "pause stays blocked");
assert(blocked.has("resume"), "resume stays blocked");
assert(!blocked.has("patch"), "patch stays out of the permission-key list");
assert(!blocked.has("apply_patch"), "apply_patch stays out of the permission-key list");
assert(aliases.has("patch"), "patch is named as a blocked host-tool alias");
assert(aliases.has("apply_patch"), "apply_patch is named as a blocked host-tool alias");
assert(typeof isBlockedToolForTawa === "function", "the blocked-tool helper is exported");
if (!isBlockedToolForTawa) fail("the blocked-tool helper is missing");
assert(isBlockedToolForTawa("patch"), "the helper refuses patch for tawa");
assert(isBlockedToolForTawa("apply_patch"), "the helper refuses apply_patch for tawa");
assert(isBlockedToolForTawa("edit"), "the helper still refuses edit");
assert(!isBlockedToolForTawa("bash_runner"), "the helper does not match unrelated tool names");

const patchForTawa = SecurityPolicy.checkBlockedTools("tawa", "patch");
assert(!patchForTawa.allowed, "checkBlockedTools refuses patch for tawa");
if (patchForTawa.allowed) fail("checkBlockedTools refused to report the patch refusal");
assert(
  typeof patchForTawa.error === "string" && patchForTawa.error.length > 0,
  "the patch refusal carries a user-facing error",
);
const applyForTawa = SecurityPolicy.checkBlockedTools("@tawa", "apply_patch");
assert(!applyForTawa.allowed, "checkBlockedTools normalizes @tawa and refuses apply_patch");

const enforcePatch = SecurityPolicy.enforce({ agent: "tawa", tool: "patch", args: {} });
assert(!enforcePatch.allowed, "the security-policy stage refuses patch for tawa");
const enforceApply = SecurityPolicy.enforce({ agent: "tawa", tool: "apply_patch", args: {} });
assert(!enforceApply.allowed, "the security-policy stage refuses apply_patch for tawa");

const devPatch = SecurityPolicy.checkBlockedTools("dev", "patch");
assert(devPatch.allowed, "patch stays available to a normal managed agent");
const devEnforce = SecurityPolicy.enforce({ agent: "dev", tool: "apply_patch", args: {} });
assert(devEnforce.allowed, "apply_patch stays available to a normal managed agent");

const cfg = { agent: { tawa: { permission: {} as Record<string, unknown> } } };
assert(ensureTawaToolPermissions(cfg), "the boot repair reports a change");
assert(cfg.agent.tawa.permission.patch === undefined, "the boot repair writes no unknown patch permission key");
assert(
  cfg.agent.tawa.permission.apply_patch === undefined,
  "the boot repair writes no unknown apply_patch permission key",
);
assert(cfg.agent.tawa.permission.edit === "deny", "the boot repair still denies edit, which covers both tools");
assert(!ensureTawaToolPermissions(cfg), "a second repair pass is a no-op");
validateAgents({ tawa: { permission: cfg.agent.tawa.permission } } as never);
assert(true, "the repaired tawa permission set passes the generator validator");

const scoped = {
  agent: {
    tawa: {
      permission: { patch: { "*": "deny", "src/*": "ask" } } as Record<string, unknown>,
    },
  },
};
assert(ensureTawaToolPermissions(scoped), "the boot repair still reports the untouched scoped config");
assert(
  JSON.stringify(scoped.agent.tawa.permission.patch) === JSON.stringify({ "*": "deny", "src/*": "ask" }),
  "an explicit scoped patch rule is preserved",
);

console.log(
  `PROOF PASS: patch and apply_patch are blocked for tawa by name without invalid permission keys (${passed} assertions)`,
);
