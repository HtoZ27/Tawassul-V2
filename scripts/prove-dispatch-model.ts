import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ToolRunLog } from "../src/services/tool-run-log.ts";
import { createHandoffEntry } from "../src/services/handoff-entry.ts";
import {
  compareAgentModels,
  resolveAgentModelRef,
  reviewerIndependenceFails,
} from "../src/services/model-refs.ts";
import { parseModelTarget } from "../src/services/model-failover.ts";

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

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (relative: string): string => readFileSync(join(repo, relative), "utf8");

const implementer = resolveAgentModelRef("dev", { dev: "nvidia/deepseek-ai/deepseek-v4.1-flash" });
assert(
  implementer.providerID === "nvidia" && implementer.modelID === "deepseek-ai/deepseek-v4.1-flash",
  "a configured implementer resolves to provider and model",
);
const reviewer = resolveAgentModelRef("dev-gemini", { "dev-gemini": "google/gemini-flash-lite-latest" });
assert(
  reviewer.providerID === "google" && reviewer.modelID === "gemini-flash-lite-latest",
  "a configured reviewer resolves to provider and model",
);
assert(
  compareAgentModels(implementer, reviewer) === "different",
  "a different reviewer model passes independence",
);
assert(
  reviewerIndependenceFails({ implementer, reviewer }) === false,
  "a different reviewer model is not flagged",
);
assert(
  compareAgentModels(implementer, { ...implementer }) === "same",
  "an equal reviewer model is detected",
);
assert(
  reviewerIndependenceFails({ implementer, reviewer: { ...implementer } }) === true,
  "an equal reviewer model fails independence",
);
assert(compareAgentModels(undefined, reviewer) === "unknown", "a missing implementer reads as unknown");
assert(compareAgentModels(implementer, undefined) === "unknown", "a missing reviewer reads as unknown");
assert(compareAgentModels(undefined, undefined) === "unknown", "both missing reads as unknown");

const dynamic = resolveAgentModelRef("dev", { dev: "dynamic" });
assert(
  dynamic.providerID === "nvidia" && dynamic.modelID === "deepseek-ai/deepseek-v4.1-flash",
  "the dynamic sentinel resolves to the role head",
);
const retired = resolveAgentModelRef("dev", { dev: "opencode/mimo-v2.5-free" });
assert(retired.providerID === "nvidia", "a retired pin resolves to a live role head");
const unmapped = resolveAgentModelRef("tester", {});
assert(
  unmapped.providerID === "opencode" && unmapped.modelID === "mimo-v2.6-flash-free",
  "an unmapped agent resolves to its role head",
);
const ghost = resolveAgentModelRef("ghost", {});
assert(ghost.providerID === "nvidia", "an unknown role falls back to the dev head");

const withRefs = createHandoffEntry({
  id: "H-001",
  from: "dev",
  to: "reviewer",
  task: "review the fix",
  implementer,
  reviewer,
});
assert(withRefs.implementer?.modelID === implementer.modelID, "the handoff payload carries the implementer model");
assert(withRefs.reviewer?.modelID === reviewer.modelID, "the handoff payload carries the reviewer model");
assert(
  JSON.parse(JSON.stringify(withRefs)).implementer.providerID === "nvidia",
  "the handoff payload round-trips the implementer provider",
);
const legacy = createHandoffEntry({ id: "H-002", from: "dev", to: "reviewer", task: "legacy" });
assert(legacy.implementer === undefined && legacy.reviewer === undefined, "a pre-field handoff reads as unknown");
assert(
  reviewerIndependenceFails(legacy) === false && compareAgentModels(legacy.implementer, legacy.reviewer) === "unknown",
  "a pre-field handoff is never treated as an equal-model violation",
);

const handoffSource = read("src/tools/handoff.ts");
assert(handoffSource.includes("resolveAgentModelRef(cctx.agent, agentModelMap)"), "the handoff records the implementer model");
assert(handoffSource.includes("resolveAgentModelRef(args.to as string, agentModelMap)"), "the handoff records the reviewer model");
assert(handoffSource.includes("implementer,") && handoffSource.includes("reviewer,"), "both model refs enter the handoff payload");
const executeSource = read("src/hooks/tool-execute.ts");
assert(executeSource.includes("model: ctx.getAgentModel(normalizedAgent)"), "the tool run records the invocation model");
const hooksSource = read("src/bootstrap/hooks-registration.ts");
assert(
  hooksSource.includes("tawaCtx.agentManager.getRosterModel(agent)"),
  "a configured roster model is consulted before the role fallback",
);

const dir = mkdtempSync(join(tmpdir(), "tawassul-dispatch-model-"));
try {
  const log = new ToolRunLog(dir);
  const run = log.record({
    tool: "edit",
    agent: "dev",
    sessionId: "s-1",
    argsHash: "h-1",
    status: "success",
    model: "nvidia/deepseek-ai/deepseek-v4.1-flash",
  });
  assert(run.model === "nvidia/deepseek-ai/deepseek-v4.1-flash", "a tool run carries its invocation model");
  assert(
    parseModelTarget(run.model)?.providerID === implementer.providerID,
    "the tool-run model and the handoff ref agree on the provider",
  );
  await log.save();

  const path = join(dir, ".opencode", "tool-run-log.json");
  const persisted = readFileSync(path, "utf8");
  assert(persisted.includes('"model":"nvidia/deepseek-ai/deepseek-v4.1-flash"'), "the model is persisted");
  const preField = {
    id: "tr-bash-legacy",
    tool: "bash",
    agent: "dev",
    sessionId: "s-1",
    argsHash: "h-0",
    status: "success",
    timestamp: 1,
    turn: 1,
  };
  writeFileSync(path, `${JSON.stringify(preField)}\n${persisted}`);
  const reloaded = new ToolRunLog(dir);
  await reloaded.load();
  assert(reloaded.entries.length === 2, "a pre-field entry still loads beside a modelled entry");
  const old = reloaded.entries.find((entry) => entry.id === "tr-bash-legacy");
  assert(old !== undefined && old.model === undefined, "a pre-field tool run reads as unknown");
  const fresh = reloaded.entries.find((entry) => entry.id === run.id);
  assert(fresh?.model === run.model, "the modelled entry reloads its model");
  assert(
    compareAgentModels(parseModelTarget(old?.model), fresh ? parseModelTarget(fresh.model) : undefined) === "unknown",
    "a pre-field tool run never fails the reviewer check by itself",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`PROOF PASS: implementer and reviewer models are carried and compared (${passed} assertions)`);
