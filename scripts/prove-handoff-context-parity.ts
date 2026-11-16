import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TawassulContext } from "../src/context-class.ts";
import type { HandoffEntry } from "../src/context/types.ts";
import type { ToolContext } from "../src/tool.ts";
import { HandoffService } from "../src/services/handoff-service.ts";
import { HealthTracker } from "../src/services/agent-health.ts";
import { CircuitBreaker } from "../src/services/circuit-breaker.ts";
import { buildHandoffTool, HANDOFF_BACKGROUND_HEADER } from "../src/tools/handoff.ts";
import { createHandoffEntry } from "../src/services/handoff-entry.ts";
import { ParallelDispatcher } from "../src/services/parallel-dispatcher.ts";
import type { DispatchTask } from "../src/services/parallel-dispatcher.ts";
import { readPackRecord, resolvePackRoot } from "../src/services/context-pack/store.ts";

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

function eq<T>(actual: T, expected: T, name: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${name} (${JSON.stringify(actual)} === ${JSON.stringify(expected)})`,
  );
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "tawassul-handoff-context-parity-"));
const running: TawassulContext[] = [];

function project(name: string): string {
  const dir = join(work, name);
  mkdirSync(join(dir, ".opencode", "agents"), { recursive: true });
  for (const agent of ["dev", "tester", "reviewer"]) {
    copyFileSync(join(repo, ".opencode", "agents", "dev.md"), join(dir, ".opencode", "agents", `${agent}.md`));
  }
  return dir;
}

function toolContext(dir: string, sessionID: string): ToolContext {
  return {
    sessionID,
    messageID: `msg-${sessionID}`,
    agent: "@tawa",
    directory: dir,
    worktree: dir,
    abort: new AbortController().signal,
    metadata() {},
  };
}

function copiesOf(ctx: TawassulContext, id: string): HandoffEntry[] {
  return [...ctx.handoffs.values()].filter((handoff) => handoff.parallelId === id);
}

async function main(): Promise<void> {
  try {
    const keyDir = join(work, "keys");
    mkdirSync(keyDir, { recursive: true });
    writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
    process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
    process.env.XDG_CONFIG_HOME = join(work, "config");
    process.env.XDG_DATA_HOME = join(work, "data");
    process.env.XDG_STATE_HOME = join(work, "state");
    process.env.XDG_CACHE_HOME = join(work, "cache");
    process.env.OPENCODE_DB = join(work, "opencode.db");
    process.env.TAWASSUL_CONTEXT_HANDOFF = "0";
    delete process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT;

    const dir = project("project");
    const ctx = new TawassulContext(dir);
    running.push(ctx);
    ctx.ensureConfig();
    ctx.handoffService = new HandoffService(ctx, new HealthTracker(), new CircuitBreaker());
    const tool = buildHandoffTool(ctx);
    const context = toolContext(dir, "ses_parity");

    const caller = "align the shared provenance artifact checks for parity";
    const offResult = (await tool.execute(
      { to: "@dev", task: "verify copy parity", context: caller, parallelCopies: 2 },
      context,
    )) as { metadata?: { handoff?: HandoffEntry } };
    const offEntry = offResult.metadata?.handoff;
    if (!offEntry) fail("the flag-off create returned no handoff");
    const offCopies = copiesOf(ctx, offEntry.id);
    eq(offCopies.length, 1, "parallelCopies creates one copy beside the main entry");
    assert(offEntry.context === caller, "the main entry stores the caller context verbatim with the flag off");
    assert(offCopies[0]?.context === caller, "the copy stores the same caller context verbatim with the flag off");
    eq(offCopies[0]?.parallelId, offEntry.id, "the copy points at the main entry");
    eq(offCopies[0]?.task, offEntry.task, "the copy keeps the main task text");

    ctx.handoffs.set("H-300", {
      id: "H-300",
      from: "@dev",
      to: "@tester",
      task: "PREVIOUS_TASK_MARKER shared provenance artifact",
      context: "shared provenance artifact context for H-300",
      files: [],
      timestamp: new Date().toISOString(),
      status: "completed",
      sessionId: "ses_parity",
      checkpoint: {
        completed: [],
        remaining: [],
        filesChanged: ["src/prior.ts"],
        decisions: [{ title: "prior", detail: "the shared provenance artifact decision" }],
      },
    });

    process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT = "1";
    const onResult = (await tool.execute(
      { to: "@dev", task: "verify accumulated copy parity", context: caller, parallelCopies: 2 },
      context,
    )) as { metadata?: { handoff?: HandoffEntry } };
    const onEntry = onResult.metadata?.handoff;
    if (!onEntry) fail("the flag-on create returned no handoff");
    const onCopies = copiesOf(ctx, onEntry.id);
    eq(onCopies.length, 1, "the flag-on create still makes one copy");
    assert(onEntry.context.startsWith(caller), "the flag-on main entry starts with the caller text");
    assert(onEntry.context.includes(HANDOFF_BACKGROUND_HEADER), "the flag-on main entry carries the background");
    assert(!onEntry.context.includes("PREVIOUS_TASK_MARKER"), "the flag-on background carries no previous task text");
    eq(onCopies[0]?.context, onEntry.context, "the main entry and the copy store the same accumulated context");

    const bundle = [
      "## Task Context",
      "",
      "### Files",
      ...Array.from({ length: 60 }, (_, index) => `- \`src/bundle-${index}.ts\` (stamped at revision 9)`),
      "",
      "### Symbols",
      ...Array.from({ length: 20 }, (_, index) => `- \`symbol${index}\` in \`src/bundle-${index}.ts\``),
      "",
      "### Edges",
      ...Array.from({ length: 12 }, (_, index) => `- \`src/bundle-${index}.ts\` -> \`src/bundle-${index + 1}.ts\``),
    ].join("\n");
    const bundleDigest = digest(bundle);
    const captured: HandoffEntry[] = [];
    const dispatcher = new ParallelDispatcher(
      (params) => {
        const id = `H-P${captured.length + 1}`;
        const entry = createHandoffEntry({
          id,
          from: "@tawa",
          to: params.to,
          task: params.task,
          context: params.context,
          files: params.files,
          parallelId: params.parallelId,
          implementer: { providerID: "opencode", modelID: "big-pickle" },
          reviewer: { providerID: "opencode", modelID: "big-pickle" },
        });
        captured.push(entry);
        return id;
      },
      () => ({
        agent: "dev",
        score: 1,
        breakdown: { roleMatch: 1, specializationMatch: 1, performanceScore: 1, availabilityScore: 1, errorPenalty: 0 },
        reason: "proof matcher",
      }),
    );
    const task: DispatchTask = {
      id: "T-PARITY",
      description: "review the path C bundle",
      context: bundle,
      files: ["src/bundle-0.ts"],
      dependencies: [],
      specializations: [],
      estimatedComplexity: "simple",
    };
    const plan = dispatcher.buildPlan([task]);
    const results = await dispatcher.executePlan(plan);
    assert(results[0]?.success === true, "path C dispatches the task");
    eq(captured.length, 1, "path C creates one handoff");
    assert(captured[0]?.context === bundle, "path C stores the bundle verbatim");
    eq(digest(captured[0]?.context ?? ""), bundleDigest, "the path C bundle digest is unchanged");
    assert(!captured[0]?.context.includes(HANDOFF_BACKGROUND_HEADER), "path C never wraps the bundle with the background");

    const factorySource = readFileSync(join(repo, "src", "bootstrap", "service-factory.ts"), "utf8");
    assert(factorySource.includes("context: params.context"), "the factory passes the bundle context through");
    assert(!factorySource.includes("buildAccumulatedContext"), "the factory never calls the accumulated-context builder");

    delete process.env.TAWASSUL_CONTEXT_HANDOFF;
    const packCaller = "align the shared provenance artifact checks for the pack";
    const packResult = (await tool.execute(
      { to: "@dev", task: "verify the pack context", context: packCaller },
      context,
    )) as { metadata?: { handoff?: HandoffEntry } };
    const packEntry = packResult.metadata?.handoff;
    if (!packEntry) fail("the pack create returned no handoff");
    const suffixIndex = packEntry.context.indexOf("\n\n## Portable Context Pack ");
    assert(suffixIndex > 0, "the pack appends its labeled suffix");
    const prePack = packEntry.context.slice(0, suffixIndex);
    assert(prePack.startsWith(packCaller), "the packed context starts with the caller text");
    assert(prePack.includes(HANDOFF_BACKGROUND_HEADER), "the packed context carries the same background");
    assert(typeof packEntry.contextPackDigest === "string", "the packed entry records its digest");
    const record = await readPackRecord(resolvePackRoot(dir), packEntry.contextPackDigest as string);
    assert(record.payload.includes(prePack), "context-pack embeds the same accumulated context");
    eq(packEntry.contextPackDigest, record.digest, "the recorded digest names the stored pack");
    assert(
      packEntry.context.includes(`## Portable Context Pack ${record.digest.slice(0, 16)}`),
      "the suffix names the stored pack digest",
    );

    console.log(`PROOF PASS: the tool, parallel copies, path C and context-pack agree on one context (${passed} assertions)`);
  } finally {
    for (const ctx of running) {
      try {
        await ctx.lifecycleManager.destroy();
      } catch {
        void 0;
      }
    }
    delete process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT;
    delete process.env.TAWASSUL_CONTEXT_HANDOFF;
    rmSync(work, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
