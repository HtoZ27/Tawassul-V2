import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_AGENTS } from "../src/core/agent-data.ts";
import { generateAgentMd } from "../src/core/render-agent.ts";
import { AgentManager } from "../src/context/managers/AgentManager.ts";
import { SecurityPolicy, setDynamicDeletedAgents } from "../src/security-policy.ts";
import { buildCheckTool } from "../src/tools/diagnostics.ts";
import { normalizeName } from "../src/utils/name-utils.ts";
import { resolveActiveConfigPath, resolveAgentsDir, resolveTawassulConfigPath } from "../src/utils/path-resolver.ts";
import { logger } from "../src/utils/logger.ts";
import { seedAgents } from "./seed-agents.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

function tempDir(tag: string): string {
  return mkdtempSync(join(tmpdir(), `tawassul-seed-agents-${tag}-`));
}

function proveFreshSeed(): void {
  const root = tempDir("fresh");
  const dir = join(root, "agents");
  try {
    const dry = seedAgents({ dir });
    assert(dry.missing.length === ALL_AGENTS.length, "dry run reports every missing base");
    assert(dry.written.length === 0, "dry run writes nothing");
    assert(!existsSync(dir), "dry run creates no directory");

    const first = seedAgents({ dir, write: true });
    assert(first.written.length === ALL_AGENTS.length, "write creates every base");
    assert(first.missing.length === ALL_AGENTS.length, "write reports the originally missing bases");
    for (const agent of ALL_AGENTS) {
      const content = readFileSync(join(dir, `${agent.name}.md`), "utf-8");
      assert(content === generateAgentMd(agent), `${agent.name} content matches the generator`);
    }
    console.log("fresh-seed ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function proveManualPreservation(): void {
  const root = tempDir("manual");
  const dir = join(root, "agents");
  try {
    seedAgents({ dir, write: true });
    const variant = join(dir, "dev-custom.md");
    const variantBody = "---\nname: \"dev-custom\"\n---\nmanual variant\n";
    writeFileSync(variant, variantBody, "utf-8");
    const dev = join(dir, "dev.md");
    const edited = `${readFileSync(dev, "utf-8")}\nmanual note\n`;
    writeFileSync(dev, edited, "utf-8");

    const second = seedAgents({ dir, write: true });
    assert(second.written.length === 0, "existing bases are not rewritten");
    assert(second.kept.length === ALL_AGENTS.length, "existing bases are kept");
    assert(readFileSync(dev, "utf-8") === edited, "a manual base edit survives the seed");
    assert(readFileSync(variant, "utf-8") === variantBody, "a manually added variant survives the seed");
    assert(second.drifted.includes(dev), "drift is reported for the edited base");
    assert(!second.drifted.includes(variant), "manual variants are outside the base inventory");

    const forced = seedAgents({ dir, write: true, force: true });
    assert(forced.written.includes(dev), "force regenerates an edited base");
    assert(readFileSync(dev, "utf-8") === generateAgentMd(ALL_AGENTS.find((a) => a.name === "dev")!), "force restores the generator content");
    assert(readFileSync(variant, "utf-8") === variantBody, "force never touches a manual variant");
    console.log("manual-preservation ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function proveInventory(): void {
  assert(ALL_AGENTS.length === 8, "the seed inventory carries exactly the 8 base agents");
  const names = new Set(ALL_AGENTS.map((agent) => agent.name));
  for (const expected of ["tawa", "dev", "analyst", "tester", "reviewer", "architect", "designer", "doc"]) {
    assert(names.has(expected), `inventory includes ${expected}`);
  }
  console.log("inventory ok");
}

const BASE_NAMES = ALL_AGENTS.filter((agent) => agent.name !== "tawa").map((agent) => agent.name);

function writeRoster(dir: string, agent: Record<string, unknown>): void {
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ agent }, null, 2), "utf-8");
}

function completeRoster(): Record<string, unknown> {
  const agent: Record<string, unknown> = {};
  for (const name of BASE_NAMES) agent[name] = { model: "opencode/big-pickle" };
  agent["analyst-mimo"] = { model: "opencode/mimo-v2.6-flash-free" };
  agent["my-helper"] = { model: "acme/custom" };
  return agent;
}

async function proveColdRosterPrewarm(): Promise<void> {
  const root = tempDir("roster-cold");
  try {
    writeRoster(root, completeRoster());
    const manager = new AgentManager(root, undefined, "project");
    manager.stopRefresh();
    const before = manager.rosterReadCount();
    const prewarm = await manager.prewarmRoster(1000);
    assert(manager.rosterReadCount() === before, "prewarm reuses the constructor warm without a second read");
    assert(prewarm.populated, "prewarm reports a populated roster");
    assert(prewarm.complete, "prewarm reports a complete roster");
    const internal = manager as unknown as {
      _refreshOpencodeJsonAgents: (generation: number, sequence: number) => Promise<void>;
    };
    const originalRefresh = internal._refreshOpencodeJsonAgents.bind(manager);
    internal._refreshOpencodeJsonAgents = async (generation, sequence) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await originalRefresh(generation, sequence);
    };
    manager.clearReadCache();
    let timerFired = false;
    const timer = setImmediate(() => {
      timerFired = true;
    });
    const delayed = await manager.prewarmRoster(1000);
    clearImmediate(timer);
    assert(delayed.populated, "a delayed warm still reports a populated roster");
    assert(timerFired, "the prewarm barrier yields the event loop while the warm is in flight");
    const first = manager.getAgents();
    assert(first.includes("@analyst-mimo"), "the first list carries a config-only generated variant");
    assert(first.includes("@my-helper"), "the first list carries a manual config key");
    setDynamicDeletedAgents(["my-helper"]);
    assert(
      !SecurityPolicy.checkDeletedAgent("my-helper"),
      "a manual config key stays user-preserved after the cold read",
    );
    setDynamicDeletedAgents([]);
    assert(first.includes("@dev"), "the first list carries a base agent");
    const second = manager.getAgents();
    assert(
      first.length === second.length && first.every((name) => second.includes(name)),
      "the first list equals the post-warm list",
    );
    assert(
      manager.getRosterModel("analyst-mimo") === "opencode/mimo-v2.6-flash-free",
      "the roster retains the model of a config-only variant",
    );
    manager.stopRefresh();
    console.log("roster-cold ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function proveTruncationGuard(): Promise<void> {
  const root = tempDir("roster-truncated");
  try {
    const full = completeRoster();
    writeRoster(root, full);
    const manager = new AgentManager(root, undefined, "project");
    manager.stopRefresh();
    await manager.prewarmRoster(1000);
    const before = manager.getAgents();
    const truncated: Record<string, unknown> = {};
    for (const name of BASE_NAMES) truncated[name] = full[name];
    writeRoster(root, truncated);
    manager.clearReadCache();
    const prewarm = await manager.prewarmRoster(1000);
    assert(!prewarm.complete, "a bases-only snapshot is not complete");
    const after = manager.getAgents();
    assert(after.includes("@analyst-mimo"), "a truncation does not drop the config-only variant");
    assert(after.includes("@my-helper"), "a truncation does not drop the manual key");
    assert(
      before.length === after.length && before.every((name) => after.includes(name)),
      "the list stays stable across a truncation",
    );
    manager.stopRefresh();
    console.log("roster-truncated ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function proveDeletionTrustGuard(): Promise<void> {
  const root = tempDir("roster-guard");
  try {
    writeRoster(root, completeRoster());
    const manager = new AgentManager(root, undefined, "project");
    manager.stopRefresh();
    await manager.prewarmRoster(1000);
    setDynamicDeletedAgents(["analyst-mimo"]);
    writeRoster(root, {});
    manager.clearReadCache();
    await manager.prewarmRoster(1000);
    assert(SecurityPolicy.checkDeletedAgent("analyst-mimo"), "a wiped config keeps the remembered deletion");
    manager.getAgents();
    assert(
      SecurityPolicy.checkDeletedAgent("analyst-mimo"),
      "the list path does not resurrect a kicked agent after a wipe",
    );
    manager.stopRefresh();
    console.log("roster-guard ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function proveCrossPathIsolation(): Promise<void> {
  const first = tempDir("roster-guard-a");
  const second = tempDir("roster-guard-b");
  try {
    writeRoster(first, completeRoster());
    const managerA = new AgentManager(first, undefined, "project");
    managerA.stopRefresh();
    await managerA.prewarmRoster(1000);
    setDynamicDeletedAgents(["analyst-mimo"]);
    writeRoster(first, {});
    managerA.clearReadCache();
    await managerA.prewarmRoster(1000);
    assert(SecurityPolicy.checkDeletedAgent("analyst-mimo"), "path A keeps its deletion guard");
    writeRoster(second, {});
    const managerB = new AgentManager(second, undefined, "project");
    managerB.stopRefresh();
    await managerB.prewarmRoster(1000);
    managerB.getAgents();
    assert(
      !SecurityPolicy.checkDeletedAgent("analyst-mimo"),
      "path B does not inherit path A's deletion guard",
    );
    managerA.stopRefresh();
    managerB.stopRefresh();
    console.log("roster-guard-isolation ok");
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
}

async function proveSiblingIsolation(): Promise<void> {
  const projectA = tempDir("sibling-a");
  const projectB = tempDir("sibling-b");
  try {
    writeRoster(projectA, completeRoster());
    const sibling = completeRoster();
    sibling["sibling-agent"] = { model: "acme/sibling" };
    writeRoster(projectB, sibling);
    const manager = new AgentManager(projectA, undefined, "project");
    manager.stopRefresh();
    const prewarm = await manager.prewarmRoster(1000);
    assert(prewarm.complete, "the current project roster is complete");
    assert(manager.rosterReadCount() === 1, "a cold prewarm reads exactly one roster");
    const agents = manager.getAgents();
    assert(agents.includes("@my-helper"), "the current project roster is listed");
    assert(!agents.includes("@sibling-agent"), "a sibling project's roster is never listed");
    assert(manager.getRosterModel("sibling-agent") === undefined, "a sibling project's model is never attributed");
    const report = manager.getRosterTrustReport();
    assert(
      report.length === 1 && report[0]!.path === join(projectA, "opencode.json"),
      "the trust report names only the current project",
    );
    assert(
      resolveActiveConfigPath(projectA, "project") === join(projectA, "opencode.json"),
      "the project roster path is anchored at the workspace",
    );
    assert(
      resolveAgentsDir(projectA, "project") === join(projectA, ".opencode", "agents"),
      "the project agents dir is anchored at the workspace",
    );
    manager.stopRefresh();
    console.log("sibling-isolation ok");
  } finally {
    rmSync(projectA, { recursive: true, force: true });
    rmSync(projectB, { recursive: true, force: true });
  }
}

async function proveReadFailureKeepsLastGood(): Promise<void> {
  const root = tempDir("roster-read-failure");
  try {
    writeRoster(root, completeRoster());
    const manager = new AgentManager(root, undefined, "project");
    manager.stopRefresh();
    await manager.prewarmRoster(1000);
    const before = manager.getAgents();
    writeFileSync(join(root, "opencode.json"), "{ malformed", "utf-8");
    manager.clearReadCache();
    const prewarm = await manager.prewarmRoster(1000);
    assert(!prewarm.complete, "a malformed read is reported as incomplete");
    const after = manager.getAgents();
    assert(after.includes("@analyst-mimo"), "a malformed read keeps the last known list");
    assert(
      before.length === after.length && before.every((name) => after.includes(name)),
      "a malformed read does not empty the list",
    );
    manager.stopRefresh();
    console.log("roster-read-failure ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function proveAuthoritativeEmptyCache(): Promise<void> {
  const root = tempDir("roster-empty");
  try {
    writeRoster(root, {});
    const manager = new AgentManager(root, undefined, "project");
    manager.stopRefresh();
    const prewarm = await manager.prewarmRoster(1000);
    assert(!prewarm.complete && !prewarm.populated, "an empty container is not a complete roster");
    const reads = manager.rosterReadCount();
    manager.getAgents();
    manager.getAgents();
    assert(manager.rosterReadCount() === reads, "an authoritative empty roster does not re-read on every list call");
    manager.stopRefresh();
    console.log("roster-empty ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function proveSlowReadBound(): Promise<void> {
  const root = tempDir("roster-slow");
  const warnings: string[] = [];
  const originalWarn = logger.warn;
  try {
    writeRoster(root, completeRoster());
    const manager = new AgentManager(root, undefined, "project");
    manager.stopRefresh();
    await manager.prewarmRoster(1000);
    const internal = manager as unknown as {
      _refreshOpencodeJsonAgents: (generation: number, sequence: number) => Promise<void>;
    };
    const originalRefresh = internal._refreshOpencodeJsonAgents.bind(manager);
    internal._refreshOpencodeJsonAgents = async (generation, sequence) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await originalRefresh(generation, sequence);
    };
    logger.warn = (message: string) => {
      warnings.push(message);
    };
    manager.clearReadCache();
    const first = await manager.prewarmRoster(20);
    const second = await manager.prewarmRoster(20);
    assert(first.timedOut && second.timedOut, "a slow roster read is bounded by the prewarm deadline");
    assert(
      warnings.filter((line) => line.includes("exceeded the 20ms bound")).length === 1,
      "the slow-read warning is emitted once per roster path",
    );
    assert(
      !warnings.some((line) => line.includes("landed late")),
      "the late landing is not logged before the read finishes",
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert(
      warnings.filter((line) => line.includes("landed late")).length === 2,
      "each bounded prewarm logs the late landing once",
    );
    manager.stopRefresh();
    console.log("roster-slow ok");
  } finally {
    logger.warn = originalWarn;
    rmSync(root, { recursive: true, force: true });
  }
}

async function proveWarmKick(): Promise<void> {
  const root = tempDir("roster-warm-kick");
  try {
    writeRoster(root, completeRoster());
    const manager = new AgentManager(root, undefined, "project");
    manager.stopRefresh();
    await manager.prewarmRoster(1000);
    const internal = manager as unknown as {
      _refreshOpencodeJsonAgents: (generation: number, sequence: number) => Promise<void>;
    };
    const originalRefresh = internal._refreshOpencodeJsonAgents.bind(manager);
    let delayMs = 150;
    internal._refreshOpencodeJsonAgents = async (generation, sequence) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      await originalRefresh(generation, sequence);
    };
    manager.clearReadCache();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const afterKick = completeRoster();
    delete afterKick["my-helper"];
    afterKick["fresh-agent"] = { model: "acme/fresh" };
    writeRoster(root, afterKick);
    delayMs = 10;
    manager.clearReadCache();
    const prewarm = await manager.prewarmRoster(1000);
    const agents = manager.getAgents();
    assert(prewarm.complete, "the post-write roster is complete");
    assert(agents.includes("@fresh-agent"), "a config write during a warm lands in the post-write list");
    assert(agents.includes("@analyst-mimo"), "the post-write list keeps the untouched variant");
    assert(!agents.includes("@my-helper"), "a stale warm never resurrects a removed config key");
    assert(manager.getRosterModel("fresh-agent") === "acme/fresh", "the post-write model map is attributed");
    assert(manager.getRosterModel("my-helper") === undefined, "the removed key keeps no model attribution");
    manager.stopRefresh();
    console.log("roster-warm-kick ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function proveGlobalMalformedRoster(): Promise<void> {
  const root = tempDir("global-roster-malformed");
  const savedGlobalDir = process.env.TAWASSUL_GLOBAL_DIR;
  try {
    process.env.TAWASSUL_GLOBAL_DIR = root;
    const rosterPath = resolveTawassulConfigPath(root, "global");
    writeFileSync(
      rosterPath,
      JSON.stringify(
        {
          agents: { dev: { model: "opencode/big-pickle" }, "my-helper": { model: "acme/custom" } },
          deleted: [],
        },
        null,
        2,
      ),
      "utf-8",
    );
    const manager = new AgentManager(root, undefined, "global");
    manager.stopRefresh();
    const prewarm = await manager.prewarmRoster(1000);
    assert(prewarm.populated, "the global roster is populated before the malformed read");
    const before = manager.getAgents();
    assert(before.includes("@my-helper"), "the global roster lists a manual key");
    setDynamicDeletedAgents(["my-helper"]);
    writeFileSync(rosterPath, "{ malformed", "utf-8");
    manager.clearReadCache();
    await manager.prewarmRoster(1000);
    const after = manager.getAgents();
    assert(after.includes("@my-helper"), "a malformed global roster keeps the last known list");
    assert(
      before.length === after.length && before.every((name) => after.includes(name)),
      "a malformed global roster does not empty the list",
    );
    assert(
      !SecurityPolicy.checkDeletedAgent("my-helper"),
      "a malformed global roster does not reset user-preserved keys",
    );

    const syncRoot = tempDir("global-roster-malformed-sync");
    process.env.TAWASSUL_GLOBAL_DIR = syncRoot;
    const syncPath = resolveTawassulConfigPath(syncRoot, "global");
    try {
      writeFileSync(syncPath, "{ malformed", "utf-8");
      const syncWarnings: string[] = [];
      const originalWarn = logger.warn;
      let syncManager: AgentManager | undefined;
      logger.warn = (message: string) => {
        syncWarnings.push(message);
      };
      try {
        syncManager = new AgentManager(syncRoot, undefined, "global");
        syncManager.stopRefresh();
        const firstRead = syncManager.getAgents();
        const afterFirst = syncWarnings.filter((line) => line.includes("global roster")).length;
        const secondRead = syncManager.getAgents();
        const afterSecond = syncWarnings.filter((line) => line.includes("global roster")).length;
        assert(
          firstRead.length === secondRead.length,
          "a cold malformed global roster keeps a stable list across sync reads",
        );
        assert(
          afterFirst === 1 && afterSecond === 1,
          `a cold malformed global roster logs once across repeated sync reads (${afterFirst} then ${afterSecond})`,
        );
      } finally {
        logger.warn = originalWarn;
        syncManager?.stopRefresh();
      }
    } finally {
      rmSync(syncRoot, { recursive: true, force: true });
    }
    manager.stopRefresh();
    console.log("global-roster-malformed ok");
  } finally {
    setDynamicDeletedAgents([]);
    if (savedGlobalDir === undefined) delete process.env.TAWASSUL_GLOBAL_DIR;
    else process.env.TAWASSUL_GLOBAL_DIR = savedGlobalDir;
    rmSync(root, { recursive: true, force: true });
  }
}

async function proveDiagnosticsRows(): Promise<void> {
  const root = tempDir("diagnostics-rows");
  const savedEnv = process.env.TAWASSUL_MODELS_JSON;
  const absentPath = join(root, "models-absent.json");
  const unknownPath = join(root, "models-unknown.json");
  writeFileSync(
    absentPath,
    JSON.stringify({
      opencode: { models: { "big-pickle": {}, "mimo-v2.6-flash-free": {} } },
      acme: { models: {} },
    }),
    "utf-8",
  );
  writeFileSync(unknownPath, JSON.stringify({ "cloudflare-workers-ai": { models: {} } }), "utf-8");
  try {
    const rosterModels: Record<string, string> = {
      dev: "opencode/big-pickle",
      "analyst-mimo": "opencode/mimo-v2.6-flash-free",
    };
    const ctx = {
      config: { agentModels: { analyst: { models: [{ model: "opencode/mimo-v2.6-flash-free" }] } } },
      dynamicAgents: ["dev-mimo", "analyst-mimo"],
      agentRatings: {},
      agentErrors: { "dev-mimo": 2, reviewer: 3 },
      agentModelMap: {
        tester: "acme/stale",
        reviewer: "opencode/big-pickle",
        "ghost-agent": "acme/ghost",
      },
      getAgents: () => [
        "@dev",
        "dev",
        "@analyst",
        "@analyst-mimo",
        "analyst-mimo",
        "dev-mimo",
        "@tester",
        "@reviewer",
        "doc",
      ],
      readAgentMd: () => null,
      agentManager: {
        getConfiguredAgentNames: () => ["dev", "analyst-mimo"],
        getRosterModel: (tag: string) => rosterModels[normalizeName(tag)],
        getRosterTrustReport: () => [{ path: join(root, "opencode.json"), complete: true, lastTrusted: 0 }],
      },
    } as never;
    process.env.TAWASSUL_MODELS_JSON = absentPath;
    const tool = buildCheckTool(ctx);
    const first = (await tool.execute({}, {} as never)) as { output: string };
    const out = first.output;
    assert(out.includes("configured: opencode/big-pickle (opencode.json)"), "a roster model is reported as configured");
    assert(
      out.includes("configured: opencode/mimo-v2.6-flash-free (tawassul.json)"),
      "a bare agentModels key resolves to a configured model",
    );
    assert(out.includes("last used (stale): acme/stale"), "a proven-absent last model is labeled stale");
    assert(out.includes("last used: opencode/big-pickle"), "a served last model is not labeled stale");
    assert(out.includes("not yet observed"), "an agent with no source is labeled not yet observed");
    assert(out.includes("1 roster path(s) hold a trusted deletion set"), "the trust guard state is reported");
    assert(
      out.includes(`1 roster path(s) hold a trusted deletion set (${join(root, "opencode.json")})`),
      "the trust guard names only the active config path",
    );
    assert(
      out.includes(`restart residual:`) && out.includes(`(${join(root, "opencode.json")})`),
      "the restart residual is reported when a trusted set exists",
    );
    assert(out.includes("outside the current roster (report only)"), "stale tracked models are report-only");
    assert((out.split("**@dev**").length - 1) === 1, "a bare config key and its @ row render once");
    assert((out.split("**@analyst-mimo**").length - 1) === 1, "a config-key variant renders once");
    assert(out.includes("- @reviewer has 3 errors"), "a high-error recommendation names the agent once");
    assert(!out.includes("- @reviewer: @reviewer"), "a recommendation row never repeats the agent");
    assert(out.includes("dynamic (internal, not mentionable)"), "the dynamic-only section is present");
    assert((out.split("**dev-mimo**").length - 1) === 1, "a dynamic-only agent renders once");
    assert(!out.includes("@dev-mimo"), "a dynamic-only agent never gains an @ row");
    process.env.TAWASSUL_MODELS_JSON = unknownPath;
    const second = (await tool.execute({}, {} as never)) as { output: string };
    assert(
      second.output.includes("last used: acme/stale") && !second.output.includes("last used (stale): acme/stale"),
      "unknown availability is never labeled stale",
    );
    console.log("diagnostics-rows ok");
  } finally {
    if (savedEnv === undefined) delete process.env.TAWASSUL_MODELS_JSON;
    else process.env.TAWASSUL_MODELS_JSON = savedEnv;
    rmSync(root, { recursive: true, force: true });
  }
}

async function provePartialRoster(): Promise<void> {
  const root = tempDir("roster-partial");
  try {
    writeRoster(root, { dev: { model: "opencode/big-pickle" } });
    const manager = new AgentManager(root, undefined, "project");
    manager.stopRefresh();
    const prewarm = await manager.prewarmRoster(1000);
    assert(!prewarm.complete, "a partial roster is not complete");
    assert(prewarm.populated, "a partial roster still reports its populated rows");
    manager.stopRefresh();
    console.log("roster-partial ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

proveFreshSeed();
proveManualPreservation();
proveInventory();
await proveColdRosterPrewarm();
await proveTruncationGuard();
await proveDeletionTrustGuard();
await proveCrossPathIsolation();
await proveSiblingIsolation();
await proveReadFailureKeepsLastGood();
await proveAuthoritativeEmptyCache();
await provePartialRoster();
await proveSlowReadBound();
await proveWarmKick();
await proveGlobalMalformedRoster();
await proveDiagnosticsRows();
console.log("PROOF PASS: agent seed, roster visibility, and diagnostics rows");
