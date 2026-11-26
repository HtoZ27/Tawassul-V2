import "./proof-log-isolate.ts";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TawassulContext } from "../src/context-class.ts";
import type { Checkpoint, HandoffEntry } from "../src/context/types.ts";
import type { ToolContext } from "../src/tool.ts";
import { HandoffService } from "../src/services/handoff-service.ts";
import { HealthTracker } from "../src/services/agent-health.ts";
import { CircuitBreaker } from "../src/services/circuit-breaker.ts";
import {
  HANDOFF_BACKGROUND_HEADER,
  HANDOFF_BACKGROUND_MAX_BYTES,
  HANDOFF_BACKGROUND_MAX_HANDOFFS,
  HANDOFF_BACKGROUND_MIN_SCORE,
  buildAccumulatedContext,
  capHandoffBackground,
  handoffAccumulatedContextEnabled,
  type HandoffContextRuntime,
} from "../src/tools/handoff.ts";
import { buildHandoffTool } from "../src/tools/handoff.ts";
import { t } from "../src/translations.ts";

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

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "tawassul-handoff-context-shape-"));
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

function checkpoint(decisionTitle: string, decisionDetail: string, files: string[]): Checkpoint {
  return {
    completed: [],
    remaining: [],
    filesChanged: files,
    decisions: [{ title: decisionTitle, detail: decisionDetail }],
  };
}

function entry(
  id: string,
  from: string,
  to: string,
  sessionId: string | undefined,
  status: HandoffEntry["status"],
  detail: string,
  files: string[] = ["src/a.ts"],
  task = "probe the shared provenance artifact",
): HandoffEntry {
  return {
    id,
    from,
    to,
    task,
    context: `shared provenance artifact context for ${id}`,
    files: [],
    timestamp: new Date().toISOString(),
    status,
    checkpoint: checkpoint(`decision ${id}`, detail, files),
    ...(sessionId ? { sessionId } : {}),
  };
}

function runtime(handoffs: HandoffEntry[], memory?: { decisions: string[]; learnings: string[] }): HandoffContextRuntime {
  return {
    handoffs: { values: () => handoffs.values() },
    config: {},
    getMemoryForAgent: memory
      ? () => ({
          decisions: memory.decisions.map((content) => ({ content })),
          learnings: memory.learnings.map((content) => ({ content })),
        })
      : undefined,
  };
}

async function created(
  tool: ReturnType<typeof buildHandoffTool>,
  context: ToolContext,
  args: Record<string, unknown>,
): Promise<HandoffEntry> {
  const result = (await tool.execute(args, context)) as { metadata?: { handoff?: HandoffEntry } };
  const handoff = result.metadata?.handoff;
  if (!handoff) fail(`the tool created no handoff for ${JSON.stringify(args.to)}`);
  return handoff;
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

    delete process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT;
    process.env.TAWASSUL_CONTEXT_HANDOFF = "0";

    assert(!handoffAccumulatedContextEnabled({}), "the accumulated-context flag defaults off");
    assert(!handoffAccumulatedContextEnabled({ handoffAccumulatedContext: false }), "an explicit config false stays off");
    process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT = "1";
    assert(handoffAccumulatedContextEnabled({}), "the environment enables the accumulated context");
    assert(handoffAccumulatedContextEnabled({ handoffAccumulatedContext: false }), "the environment wins over config false");
    process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT = "true";
    assert(handoffAccumulatedContextEnabled({}), "the long environment form enables the accumulated context");
    process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT = "0";
    assert(!handoffAccumulatedContextEnabled({ handoffAccumulatedContext: true }), "the environment kill switch wins over config true");
    delete process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT;
    assert(handoffAccumulatedContextEnabled({ handoffAccumulatedContext: true }), "the config key enables the accumulated context");
    assert(handoffAccumulatedContextEnabled({ handoffAccumulatedContext: true }), "the config override is stable");
    assert(HANDOFF_BACKGROUND_MAX_BYTES === 4096, "the background cap is 4 KiB");
    assert(HANDOFF_BACKGROUND_MAX_HANDOFFS === 3, "the background takes at most three handoffs");
    assert(HANDOFF_BACKGROUND_MIN_SCORE === 0.25, "the background keeps a minimum relevance score");

    const caller = "align shared provenance artifact checks";
    const sameSession = entry("H-1", "@dev", "@tester", "ses_a", "completed", "SESSION_DECISION shared provenance artifact");
    const foreign = entry("H-2", "@writer", "@designer", "ses_b", "completed", "FOREIGN_DECISION shared provenance artifact");
    const scope = buildAccumulatedContext(runtime([sameSession, foreign]), "@tawa", "dev", caller, "ses_a");
    eq(scope.handoffs, 1, "a single in-session handoff feeds the background");
    assert(scope.context.includes("SESSION_DECISION"), "the in-session decision is included");
    assert(!scope.context.includes("FOREIGN_DECISION"), "a different session and chain is excluded");
    assert(scope.context.startsWith(`${caller}\n\n${HANDOFF_BACKGROUND_HEADER}`), "the caller text comes first, then one background section");
    eq(scope.context.split(HANDOFF_BACKGROUND_HEADER).length - 1, 1, "the background header appears exactly once");
    assert(!scope.context.includes("Goals (live)"), "the static Goals block is gone");
    assert(!scope.context.includes("Chain Context"), "the old chain summary is gone");
    assert(!scope.context.includes("Previous deliveries"), "old delivery summaries are gone");
    assert(!scope.context.includes("Evaluations"), "evaluation summaries are dropped from the background");

    const noSessionChain = entry("H-3", "@dev", "@tester", undefined, "completed", "CHAIN_FALLBACK_DECISION shared provenance artifact");
    const foreignChain = entry("H-4", "@dev", "@tester", "ses_b", "completed", "CHAIN_SESSION_DECISION shared provenance artifact");
    const chain = buildAccumulatedContext(runtime([noSessionChain, foreignChain]), "@tawa", "dev", caller, "ses_a");
    eq(chain.handoffs, 2, "chain handoffs join the background");
    assert(chain.context.includes("CHAIN_FALLBACK_DECISION"), "a pre-A0 handoff with no sessionId falls back to the chain");
    assert(chain.context.includes("CHAIN_SESSION_DECISION"), "a chain match joins even from another session");

    const many = Array.from({ length: 5 }, (_, index) =>
      entry(
        `H-1${index}`,
        "@dev",
        "@tester",
        "ses_a",
        "completed",
        `MANY_DECISION_${index} shared provenance artifact`,
      ),
    );
    const cappedSelection = buildAccumulatedContext(runtime(many), "@tawa", "dev", caller, "ses_a");
    eq(cappedSelection.handoffs, HANDOFF_BACKGROUND_MAX_HANDOFFS, "five eligible handoffs are capped at three");
    eq(cappedSelection.context.split("- **decision H-1").length - 1, 3, "the background renders exactly three decisions");
    assert(!cappedSelection.context.includes("MANY_DECISION_0"), "the oldest ranked decision is dropped by the cap");

    const unrelated: HandoffEntry = {
      ...entry("H-9", "@dev", "@tester", "ses_a", "completed", "unrelated wording entirely", ["src/x.ts"]),
      task: "unrelated wording entirely",
      context: "nothing in common here",
    };
    const belowFloor = buildAccumulatedContext(runtime([unrelated]), "@tawa", "dev", caller, "ses_a");
    eq(belowFloor.source, "caller", "a below-floor handoff produces no background");
    eq(belowFloor.context, caller, "a below-floor handoff leaves the caller text verbatim");
    eq(belowFloor.handoffs, 0, "a below-floor handoff is not counted");

    const longDecisions = Array.from({ length: 3 }, (_, index) =>
      entry(
        `H-2${index}`,
        "@dev",
        "@tester",
        "ses_a",
        "completed",
        `OVERFLOW_DECISION shared provenance artifact ${"x".repeat(1500)}`,
        Array.from({ length: 8 }, (_, file) => `src/overflow-${index}-${file}.ts`),
      ),
    );
    const overflow = buildAccumulatedContext(runtime(longDecisions), "@tawa", "dev", caller, "ses_a");
    assert(overflow.truncated, "a background above 4 KiB reports truncation");
    assert(overflow.backgroundBytes <= HANDOFF_BACKGROUND_MAX_BYTES, "the truncated background stays at or below 4 KiB");
    assert(overflow.context.startsWith(caller), "the truncated context still starts with the caller text");
    assert(overflow.context.includes("truncated: true"), "the truncated context carries the marker");
    eq(overflow.context.split("truncated: true").length - 1, 1, "the truncation marker appears once");

    const fitted = buildAccumulatedContext(runtime([sameSession]), "@tawa", "dev", caller, "ses_a");
    assert(!fitted.truncated, "a small background reports no truncation");
    assert(!fitted.context.includes("truncated: true"), "a small background carries no truncation marker");
    assert(fitted.backgroundBytes <= HANDOFF_BACKGROUND_MAX_BYTES, "a small background is under the cap");

    eq(capHandoffBackground("x".repeat(HANDOFF_BACKGROUND_MAX_BYTES)).truncated, false, "a body exactly at 4 KiB is not truncated");
    const justOver = capHandoffBackground("x".repeat(HANDOFF_BACKGROUND_MAX_BYTES + 1));
    assert(justOver.truncated, "a body one byte over 4 KiB is truncated");
    assert(Buffer.byteLength(justOver.text, "utf8") <= HANDOFF_BACKGROUND_MAX_BYTES, "the capped body stays within 4 KiB");

    const memoryOnly = buildAccumulatedContext(
      runtime([], { decisions: ["keep the small repair path"], learnings: ["verify after every edit"] }),
      "@tawa",
      "dev",
      caller,
      "ses_a",
    );
    eq(memoryOnly.handoffs, 0, "memory alone includes no handoff");
    assert(memoryOnly.context.includes("### Decision memory"), "agent decision memory stays in the background");
    assert(memoryOnly.context.includes("### Learned lessons"), "agent lessons stay in the background");

    const dir = project("project");
    const ctx = new TawassulContext(dir);
    running.push(ctx);
    ctx.ensureConfig();
    ctx.handoffService = new HandoffService(ctx, new HealthTracker(), new CircuitBreaker());
    const tool = buildHandoffTool(ctx);
    const context = toolContext(dir, "ses_shape");

    const shortContext = "short probe context";
    const shortEntry = await created(tool, context, {
      to: "@dev",
      task: "verify the short context",
      context: shortContext,
    });
    eq(shortEntry.context, shortContext, "flag off stores a short caller context verbatim");
    eq(shortEntry.task, "verify the short context", "flag off leaves the task unchanged");

    const longContext = "the caller supplies the exact long context body for this handoff";
    const longEntry = await created(tool, context, {
      to: "@dev",
      task: "verify the long context",
      context: longContext,
    });
    eq(longEntry.context, longContext, "flag off stores a long caller context verbatim");
    eq(longEntry.task, "verify the long context", "flag off leaves the long task unchanged");

    delete process.env.TAWASSUL_CONTEXT_HANDOFF;
    const packContext = "the caller context survives one labeled pack suffix";
    const packEntry = await created(tool, context, {
      to: "@dev",
      task: "verify the pack suffix",
      context: packContext,
    });
    assert(packEntry.context.startsWith(`${packContext}\n\n## Portable Context Pack `), "the pack adds one labeled suffix after the caller text");
    eq(packEntry.context.split("## Portable Context Pack ").length - 1, 1, "the pack suffix appears exactly once");
    assert(typeof packEntry.contextPackDigest === "string", "the pack records its digest");
    process.env.TAWASSUL_CONTEXT_HANDOFF = "0";

    const helpTask = "request help with the probe";
    const helpEntry = await created(tool, context, {
      to: "@dev",
      task: helpTask,
      context: longContext,
      helpRequest: true,
    });
    eq(helpEntry.task, t("helpRequestPrefix", { task: helpTask }), "the help prefix is the only task change");
    eq(helpEntry.context, longContext, "help preserves the caller context with the flag off");

    ctx.handoffs.set(
      "H-100",
      entry(
        "H-100",
        "@dev",
        "@tester",
        "ses_shape",
        "completed",
        "the prior shared provenance artifact decision",
        ["src/prior.ts"],
        "PREVIOUS_TASK_MARKER from the prior delivery",
      ),
    );
    ctx.handoffs.set(
      "H-101",
      entry(
        "H-101",
        "@writer",
        "@designer",
        "ses_other",
        "completed",
        "FOREIGN_DECISION stays out of the shape",
        ["src/foreign.ts"],
      ),
    );

    process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT = "1";
    const accumulatedContext = "align the shared provenance artifact checks in the tool path";
    const accumulated = await created(tool, context, {
      to: "@dev",
      task: "verify the accumulated context",
      context: accumulatedContext,
    });
    assert(accumulated.context.startsWith(accumulatedContext), "flag on starts the stored context with the caller text");
    assert(accumulated.context.includes(HANDOFF_BACKGROUND_HEADER), "flag on adds the background section");
    assert(!accumulated.context.includes("PREVIOUS_TASK_MARKER"), "the background carries no previous task text");
    assert(!accumulated.context.includes("FOREIGN_DECISION"), "the tool drops a different session and chain");
    const background = accumulated.context.slice(accumulatedContext.length);
    assert(Buffer.byteLength(background, "utf8") <= HANDOFF_BACKGROUND_MAX_BYTES, "the tool background stays within 4 KiB");
    assert(!accumulated.context.includes("truncated: true"), "a small tool background is not truncated");
    eq(accumulated.task, "verify the accumulated context", "flag on leaves the task unchanged");

    delete process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT;
    ctx.config.handoffAccumulatedContext = true;
    const configured = await created(tool, context, {
      to: "@dev",
      task: "verify the config override",
      context: accumulatedContext,
    });
    assert(configured.context.includes(HANDOFF_BACKGROUND_HEADER), "the config key enables the background without the environment");
    process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT = "0";
    const overridden = await created(tool, context, {
      to: "@dev",
      task: "verify the env override",
      context: accumulatedContext,
    });
    eq(overridden.context, accumulatedContext, "the environment kill switch overrides the config key");
    delete process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT;
    ctx.config.handoffAccumulatedContext = false;

    const sameSessionOnly = buildAccumulatedContext(
      runtime([entry("H-7", "@dev", "@tester", "ses_a", "completed", "ANOTHER_DECISION shared provenance artifact")]),
      "@tawa",
      "dev",
      caller,
      "ses_a",
    );
    assert(sameSessionOnly.context.includes("ANOTHER_DECISION"), "the direct builder sees the same-session decision");

    console.log(`PROOF PASS: handoff context is caller-first, scoped, capped, and default-off (${passed} assertions)`);
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
