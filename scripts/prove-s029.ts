import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { computePinEntries, formatAddResult } from "../src/tools/agent-management.ts";
import { defaultAgentModelForRole } from "../src/services/proxy-fallback-chains.ts";
import { sameRoleDistributionGuard, deletedAgentGuard } from "../src/hooks/guards/dispatch-guards.ts";
import { isKnownDynamicAgent } from "../src/scripts/gen-opencode-config.ts";
import type { Ctx, Input, StageOutput } from "../src/hooks/guards/shared/types.ts";

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`PROOF FAIL: ${msg}`);
    process.exit(1);
  }
  passed++;
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const out1 = computePinEntries(
  ["analyst-fledge", "analyst-longcat", "analyst-ling-3.1-flash-free"],
  new Set(),
  "opencode/anything",
);
assert(
  eq(out1, [
    { name: "analyst-fledge", pinned: true },
    { name: "analyst-longcat", pinned: true },
    { name: "analyst-ling-3.1-flash-free", pinned: true },
  ]),
  "variants pin always as the explicit model choice",
);
const head = defaultAgentModelForRole("analyst");
assert(eq(computePinEntries(["analyst"], new Set(), head), [{ name: "analyst", pinned: false }]), "base role on-head unpins");
assert(
  eq(computePinEntries(["analyst"], new Set(), "someone/else-1"), [{ name: "analyst", pinned: true }]),
  "base role off-head pins",
);
const out2 = computePinEntries(["analyst-fledge", "dev"], new Set(["@dev"]), "opencode/x");
assert(eq(out2, [{ name: "analyst-fledge", pinned: true }]), "errored specs excluded");
assert(eq(computePinEntries(["xyzzy"], new Set(), "opencode/x"), []), "non-agent names excluded");
const skipped = formatAddResult({ added: [], skipped: ["analyst"], errors: [], warnings: ["pins exploded"] });
assert(skipped.includes("pins exploded"), "all-skipped still surfaces warnings");

const ctx = {} as unknown as Ctx;
function handoffTo(to: string): { input: Input; output: StageOutput } {
  return {
    input: { tool: "handoff", agent: "dev" } as unknown as Input,
    output: { args: { to } } as unknown as StageOutput,
  };
}
{
  const { input, output } = handoffTo("dev-ling");
  assert(await sameRoleDistributionGuard.check(ctx, input, output), "deleted target skipped by distribution guard");
  const d = handoffTo("dev-ling");
  assert(!(await deletedAgentGuard.check(ctx, d.input, d.output)), "deleted target refused by deleted-agent guard");
  assert(String((d.output as { error?: unknown }).error ?? "").includes("deleted"), "refusal names deletion, not specialty");
}
{
  const { input, output } = handoffTo("dev-mimo");
  assert(!(await sameRoleDistributionGuard.check(ctx, input, output)), "live same-specialty target still refused");
  assert(
    String((output as { error?: unknown }).error ?? "").includes("same specialty"),
    "live refusal keeps the specialty message",
  );
}

assert(isKnownDynamicAgent("analyst-ling-3.1-flash-free"), "dotted provider suffix accepted");
assert(isKnownDynamicAgent("analyst-ling"), "plain suffix accepted");
assert(!isKnownDynamicAgent("analyst-evil!"), "invalid characters rejected");
assert(!isKnownDynamicAgent("analyst"), "base name without suffix rejected");

const root = mkdtempSync(join(tmpdir(), "s029-"));
function runLoggerChild(extraEnv: Record<string, string>, dropKeys: string[] = []): number {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !dropKeys.includes(k)) env[k] = v;
  }
  Object.assign(env, extraEnv);
  const script = `import { logger } from "./src/utils/logger.ts"; logger.warn("s029-probe"); await new Promise((r) => setTimeout(r, 600));`;
  const res = spawnSync("bun", ["-e", script], { env, stdio: "ignore" });
  return res.status ?? 1;
}
{
  const custom = join(root, "custom.log");
  assert(runLoggerChild({ TAWASSUL_LOG_FILE: custom }) === 0, "logger child exits clean with custom path");
  assert(existsSync(custom) && readFileSync(custom, "utf8").includes("s029-probe"), "custom log path receives the probe");
}
{
  const home = join(root, "fakehome");
  assert(runLoggerChild({ HOME: home }, ["TAWASSUL_LOG_FILE"]) === 0, "logger child exits clean with default path");
  const def = join(home, ".local", "share", "tawassul", "tawassul.log");
  assert(existsSync(def) && readFileSync(def, "utf8").includes("s029-probe"), "default-on safe path receives the probe");
}
{
  const home = join(root, "fakehome2");
  assert(runLoggerChild({ TAWASSUL_LOG_FILE: "", HOME: home }) === 0, "logger child exits clean when opted out");
  assert(!existsSync(join(home, ".local", "share", "tawassul", "tawassul.log")), "empty variable opts the sink out");
}

console.log(`PROOF PASS: s029 pins, dispatch precedence, dynamic suffix, log default (${passed} assertions)`);