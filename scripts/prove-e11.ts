import "./proof-log-isolate.ts";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CapabilityTracker, seedCapabilitiesFromRoster } from "../src/features/capability-tracker.ts";
import { TawassulContext } from "../src/context-class.ts";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

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

const tracker = new CapabilityTracker();
const seeded = seedCapabilitiesFromRoster(
  tracker,
  ["dev", "@analyst-mimo", "tawa", "dev", "ghost", ""],
  (agent) => {
    if (agent === "dev") return "implementation";
    if (agent === "analyst-mimo") return "strategic-review";
    if (agent === "ghost") return "";
    return undefined;
  },
);
assert(seeded === 2, "seeder counts only agents with a declared capability");
assert(tracker.getCapabilities("dev").join(",") === "implementation", "seeder records the declared capability");
assert(
  tracker.getCapabilities("@analyst-mimo").join(",") === "strategic-review",
  "seeder normalizes an @-prefixed roster tag",
);
assert(tracker.getCapabilities("tawa").length === 0, "seeder never seeds tawa");
assert(tracker.getCapabilities("ghost").length === 0, "seeder skips an empty capability");
const devRecord = tracker.getAll().find((entry) => entry.agent === "dev");
assert(devRecord !== undefined && Object.keys(devRecord.attempts).length === 0, "seeding fabricates no attempts");
assert(tracker.getSuccessRate("dev", "implementation") === 0.5, "seeding keeps the neutral success rate");
assert(tracker.getCapabilities("dev").length === 1, "seeding the same agent twice stays idempotent");

const facade = readFileSync(join(repo, "src", "context", "facades", "lifecycle-facade.ts"), "utf8");
const initAt = facade.indexOf("await ctx.lifecycleManager.init();");
const seedAt = facade.indexOf("ctx.seedCapabilities();");
assert(initAt >= 0 && seedAt > initAt, "bootstrap seeds capabilities after the lifecycle init");
const contextSource = readFileSync(join(repo, "src", "context-class.ts"), "utf8");
assert(contextSource.includes("seedCapabilitiesFromRoster("), "the context seeds from the roster");
assert(contextSource.includes("this.readAgentMd(agent)?.capability"), "the seed reads the declared agent capability");

const work = mkdtempSync(join(tmpdir(), "tawassul-e11-"));
try {
  mkdirSync(join(work, ".opencode", "agents"), { recursive: true });
  copyFileSync(join(repo, ".opencode", "agents", "dev.md"), join(work, ".opencode", "agents", "dev.md"));
  copyFileSync(join(repo, ".opencode", "agents", "analyst.md"), join(work, ".opencode", "agents", "analyst.md"));
  const liveCtx = new TawassulContext(work);
  const liveSeeded = liveCtx.seedCapabilities();
  assert(liveSeeded === 2, `a live context seeds only the agents with an md (seeded ${liveSeeded})`);
  assert(liveCtx.capabilityTracker.getCapabilities("dev").join(",") === "implementation", "live dev seeds implementation");
  assert(
    liveCtx.capabilityTracker.getCapabilities("analyst").join(",") === "strategic-review",
    "live analyst seeds strategic-review",
  );
  assert(liveCtx.capabilityTracker.getCapabilities("tester").length === 0, "an agent without an md stays unseeded");
} finally {
  rmSync(work, { recursive: true, force: true });
}

const persistDir = mkdtempSync(join(tmpdir(), "tawassul-e11-state-"));
try {
  mkdirSync(join(persistDir, ".opencode", "agents"), { recursive: true });
  copyFileSync(join(repo, ".opencode", "agents", "dev.md"), join(persistDir, ".opencode", "agents", "dev.md"));
  const writer = new TawassulContext(persistDir);
  writer.seedCapabilities();
  writer.capabilityTracker.updateCapability("dev", "implementation", true);
  const expectedRate = writer.capabilityTracker.getSuccessRate("dev", "implementation");
  await writer.lifecycleManager.saveState();
  await writer.lifecycleManager.flushSaves();
  const reader = new TawassulContext(persistDir);
  await reader.lifecycleManager.loadStateAsync();
  assert(
    reader.capabilityTracker.getCapabilities("dev").includes("implementation"),
    "capabilities survive a state round-trip",
  );
  assert(
    reader.capabilityTracker.getSuccessRate("dev", "implementation") === expectedRate,
    "the learned success rate survives a state round-trip",
  );
  assert(reader.capabilityTracker.getCapabilities("dev").length === 1, "the round-trip does not duplicate capabilities");
} finally {
  rmSync(persistDir, { recursive: true, force: true });
}

console.log(`PROOF PASS: capabilities seed from the roster and survive a state round-trip (${passed} assertions)`);
