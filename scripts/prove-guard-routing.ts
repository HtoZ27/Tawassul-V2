import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PipelineState } from "../src/hooks/PipelineState.ts";
import {
  callDepthGuard,
  tawaRedirectGuard,
  taskToolAuthorizationGuard,
} from "../src/hooks/guards/dispatch-guards.ts";
import { firstResponseGuard, tawaRoutingEnforcementGuard } from "../src/hooks/guards/resource-guards.ts";
import { MAX_CALL_DEPTH } from "../src/hooks/guards/shared/limits.ts";
import { DEFAULT_CAP } from "../src/services/iteration-budget.ts";
import { TASK_PERMISSIONS } from "../src/security-policy.ts";
import { normalizeToolName } from "../src/utils/name-utils.ts";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

let passed = 0;

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
  passed++;
  console.log(`ok ${message}`);
}

type Out = { args: Record<string, unknown>; error?: string };

function ctxOf(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { pipelineState: new PipelineState(), ...extra };
}

async function allows(
  stage: { check: (ctx: never, input: never, output: never) => Promise<boolean> },
  ctx: Record<string, unknown>,
  input: Record<string, unknown>,
  out: Out,
): Promise<boolean> {
  return stage.check(ctx as never, input as never, out as never);
}

assert(MAX_CALL_DEPTH === 3, "the plugin depth ceiling is 3");
assert(DEFAULT_CAP.maxDepth === 3, "the default per-agent cap matches the ceiling");
assert(normalizeToolName("subagent") === "task", "the host spawn alias normalizes to the task tool");

const livePath = join(repo, "opencode.json");
if (existsSync(livePath)) {
  const liveDoc = JSON.parse(readFileSync(livePath, "utf8")) as Record<string, unknown>;
  assert(!("subagent_depth" in liveDoc), "the live config carries no top-level subagent_depth key");
  const experimental = liveDoc["experimental"] as Record<string, unknown> | undefined;
  assert(experimental?.["subagent_depth"] === 3, "the live config pins experimental.subagent_depth to 3");
} else {
  console.log("skip live config checks: the checkout has no opencode.json (gitignored by design)");
}

for (const depth of [0, 1, 2]) {
  const ctx = ctxOf();
  (ctx["pipelineState"] as PipelineState).callDepth.set("s1", depth);
  const out: Out = { args: { subagent: ["dev"] } };
  const ok = await allows(callDepthGuard, ctx, { tool: "task", agent: "analyst", sessionID: "s1" }, out);
  assert(ok, `dispatch ${depth + 1} from one session is allowed`);
}

const fourth = ctxOf();
(fourth["pipelineState"] as PipelineState).callDepth.set("s1", 3);
const fourthOut: Out = { args: { subagent: ["dev"] } };
const fourthBlocked = !(await allows(
  callDepthGuard,
  fourth,
  { tool: "task", agent: "analyst", sessionID: "s1" },
  fourthOut,
));
assert(fourthBlocked, "the fourth dispatch from one session is blocked");
assert((fourthOut.error ?? "").includes("Call depth exceeded"), "the fourth dispatch reports the depth ceiling");

const recon = ctxOf();
(recon["pipelineState"] as PipelineState).callDepth.set("s1", 3);
assert(
  await allows(callDepthGuard, recon, { tool: "task", agent: "analyst", sessionID: "s1" }, { args: { subagent: ["explore"] } }),
  "reconnaissance stays available at the depth ceiling",
);

const capped = ctxOf();
const cappedState = capped["pipelineState"] as PipelineState;
cappedState.callDepth.set("s1", 3);
for (let call = 0; call < 20; call++) cappedState.incrementExemptCalls("s1");
assert(
  !(await allows(callDepthGuard, capped, { tool: "task", agent: "analyst", sessionID: "s1" }, { args: { subagent: ["explore"] } })),
  "the reconnaissance exemption stops after twenty calls",
);

const routedCtx = ctxOf();
(routedCtx["pipelineState"] as PipelineState).recordUserMessage("s1", "Please handle this @tawa");
const routedOut: Out = { args: {} };
const routedBlocked = !(await allows(tawaRoutingEnforcementGuard, routedCtx, { tool: "bash", agent: "analyst", sessionID: "s1" }, routedOut));
assert(routedBlocked, "a routed turn blocks shell for an analyst");
const routedMessage = routedOut.error ?? "";
assert(routedMessage.includes("@explore") && routedMessage.includes("@general"), "the message offers both allowed targets");
assert(!routedMessage.includes("task("), "the message names no blocked call form");
assert(!routedMessage.includes("@tawa"), "the message never points at the blocked target");

const designerCtx = ctxOf();
(designerCtx["pipelineState"] as PipelineState).recordUserMessage("s1", "Please dispatch this to agents");
const designerOut: Out = { args: {} };
await allows(tawaRoutingEnforcementGuard, designerCtx, { tool: "edit", agent: "designer", sessionID: "s1" }, designerOut);
const designerMessage = designerOut.error ?? "";
assert(designerMessage.includes("@explore") && !designerMessage.includes("@general"), "the message never offers a target the role cannot call");

const redirectOut: Out = { args: { subagent: ["tawa"] } };
const redirectBlocked = !(await allows(tawaRedirectGuard, ctxOf(), { tool: "task", agent: "analyst", sessionID: "s1" }, redirectOut));
assert(redirectBlocked, "a redirect to the router is rejected");
assert((redirectOut.error ?? "").includes("@explore"), "the redirect message names a reachable target");
assert(!/handoff for (any )?other agents/i.test(redirectOut.error ?? ""), "the redirect message opens no generic transfer path");
assert((redirectOut.error ?? "").includes("caller"), "the redirect message names the return path");
assert(!(redirectOut.error ?? "").includes("Distribution is via"), "the redirect message drops the retired instruction");

const modelOut: Out = { args: { subagent: ["explore"], model: "tawa" } };
assert(
  !(await allows(tawaRedirectGuard, ctxOf(), { tool: "task", agent: "analyst", sessionID: "s1" }, modelOut)),
  "the router is rejected in the model field as well",
);

const peerOut: Out = { args: { subagent: ["dev"] } };
const peerBlocked = !(await allows(taskToolAuthorizationGuard, ctxOf(), { tool: "task", agent: "analyst", sessionID: "s1" }, peerOut));
assert(peerBlocked, "an analyst cannot dispatch to a peer role");
assert((peerOut.error ?? "").includes("@explore"), "the peer message names the allowed targets");
assert(!/handoff/i.test(peerOut.error ?? ""), "the peer message opens no generic transfer path");
assert((peerOut.error ?? "").includes("caller"), "the peer message names the return path");

assert(
  await allows(taskToolAuthorizationGuard, ctxOf(), { tool: "task", agent: "analyst", sessionID: "s1" }, { args: { subagent: ["explore"] } }),
  "an analyst can dispatch to reconnaissance",
);

assert(
  await allows(taskToolAuthorizationGuard, ctxOf(), { tool: "task", agent: "tawa", sessionID: "s1" }, { args: { subagent: ["dev"] } }),
  "the router itself may dispatch to any role",
);

const firstOut: Out = { args: { subagent: ["explore"] } };
const firstBlocked = !(await allows(firstResponseGuard, ctxOf(), { tool: "task", agent: "analyst", sessionID: "s1" }, firstOut));
assert(firstBlocked, "an agent cannot dispatch before producing analysis");
assert((firstOut.error ?? "").includes("Produce your analysis first"), "the first-response message states the order");

const exemptTargets = new Set(["explore", "general"]);
for (const [role, targets] of Object.entries(TASK_PERMISSIONS)) {
  for (const target of targets) {
    assert(exemptTargets.has(target), `${role} allowlist target ${target} stays inside the exempt set`);
  }
}

console.log(`PROOF PASS: guard routing and truthful failure messages (${passed} assertions)`);
