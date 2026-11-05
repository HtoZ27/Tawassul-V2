import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TawassulContext } from "../src/context-class.ts";
import { HandoffService } from "../src/services/handoff-service.ts";
import { HealthTracker } from "../src/services/agent-health.ts";
import { CircuitBreaker } from "../src/services/circuit-breaker.ts";
import { buildHandoffTool } from "../src/tools/handoff.ts";
import { t } from "../src/translations.ts";
import type { ToolContext } from "../src/tool.ts";
import type { HandoffEntry } from "../src/context/types.ts";

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
const work = mkdtempSync(join(tmpdir(), "tawassul-handoff-rescue-"));

function outputText(result: unknown): string {
  return typeof result === "string" ? result : String((result as { output?: unknown })?.output ?? "");
}

function makeHandoff(id: string, from: string, to: string, status: HandoffEntry["status"]): HandoffEntry {
  return {
    id,
    from,
    to,
    task: `probe ${id} stalled task`,
    context: `the analyst rescues ${id} after the recipient stalled`,
    files: [],
    timestamp: new Date().toISOString(),
    status,
  };
}

async function main(): Promise<void> {
  process.env.TAWASSUL_CONTEXT_HANDOFF = "0";
  delete process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT;
  const dir = join(work, "project");
  mkdirSync(join(dir, ".opencode", "agents"), { recursive: true });
  copyFileSync(join(repo, ".opencode", "agents", "dev.md"), join(dir, ".opencode", "agents", "dev.md"));
  const ctx = new TawassulContext(dir);
  ctx.ensureConfig();
  const healthTracker = new HealthTracker();
  const circuitBreaker = new CircuitBreaker();
  ctx.handoffService = new HandoffService(ctx, healthTracker, circuitBreaker);
  const tool = buildHandoffTool(ctx);
  const analyst = {
    sessionID: "sess-rescue",
    messageID: "msg-rescue",
    agent: "@analyst",
    directory: dir,
    worktree: dir,
    abort: new AbortController().signal,
    metadata() {},
  } as ToolContext;
  try {
    const original = makeHandoff("H-201", "@tawa", "dev", "accepted");
    ctx.handoffs.set(original.id, original);
    ctx.hoffSeq = 201;
    ctx.agentErrors["tawa"] = 1;
    healthTracker.onHandoffCreated("dev", original.id);
    const ratingBefore = ctx.ratingManager.agentRatings["dev"]?.handoffsCompletedAsRecipient ?? 0;
    const completedHealthBefore = healthTracker.getStatus("dev")?.completedCount ?? 0;
    const failedHealthBefore = healthTracker.getStatus("dev")?.failedCount ?? 0;
    const memoryBefore = ctx.sharedMemory.get().handoffHistory.length;

    const result = outputText(
      await tool.execute(
        { rescue: original.id, to: "@reviewer", context: "dev stalled on the probe build for two cycles" },
        analyst,
      ),
    );

    assert(result.includes("Rescue"), "the rescue tool reports the rescue handoff");
    assert(original.status === "closed", "the stalled original is force-closed, not completed");
    assert(original.rescue === true, "the stalled original is marked as rescued");
    assert(
      (ctx.ratingManager.agentRatings["dev"]?.handoffsCompletedAsRecipient ?? 0) === ratingBefore,
      "rescue does not credit the stalled recipient with a completion",
    );
    assert(
      (ctx.ratingManager.agentRatings["dev"]?.handoffsDropped ?? 0) === 0,
      "rescue does not charge the stalled recipient with a dropped handoff",
    );
    assert(
      (healthTracker.getStatus("dev")?.completedCount ?? 0) === completedHealthBefore,
      "rescue does not credit the stalled recipient with a completed health count",
    );
    assert(
      (healthTracker.getStatus("dev")?.failedCount ?? 0) === failedHealthBefore + 1,
      "rescue records the stall as a recipient failure",
    );
    assert(
      ctx.agentErrors["tawa"] === 1,
      "rescue does not clear the sender error that only a completion clears",
    );
    assert(
      ctx.sharedMemory.get().handoffHistory.length === memoryBefore,
      "rescue adds no completion record to shared memory",
    );

    const rescueEntry = [...ctx.handoffs.values()].find((h) => h.id !== original.id && h.rescue);
    assert(rescueEntry !== undefined, "a rescue handoff is created");
    assert(rescueEntry?.status === "pending", "the rescue handoff starts pending");
    assert(rescueEntry?.to === "reviewer", "the rescue handoff targets the requested agent");
    assert(
      rescueEntry?.task === `🚑 RESCUE: ${original.task}`,
      "the rescue prefix is the only task change",
    );
    assert(rescueEntry?.checkpoint === undefined, "a missing checkpoint is not invented");

    const plainContext = "a plain caller context for the prefix probe";
    const plain = (await tool.execute(
      { to: "@dev", task: "a plain task without a prefix", context: plainContext },
      analyst,
    )) as { metadata?: { handoff?: HandoffEntry } };
    const plainEntry = plain.metadata?.handoff;
    assert(plainEntry !== undefined, "a normal create returns its handoff");
    assert(plainEntry?.task === "a plain task without a prefix", "a normal create leaves the task unchanged");
    assert(plainEntry?.context === plainContext, "a normal create leaves the context unchanged");

    const helpContext = "the help caller context stays exact";
    const help = (await tool.execute(
      { to: "@dev", task: "probe the help prefix", context: helpContext, helpRequest: true },
      analyst,
    )) as { metadata?: { handoff?: HandoffEntry } };
    const helpEntry = help.metadata?.handoff;
    assert(helpEntry !== undefined, "a help request returns its handoff");
    assert(
      helpEntry?.task === t("helpRequestPrefix", { task: "probe the help prefix" }),
      "the help prefix is the only task change",
    );
    assert(helpEntry?.context === helpContext, "a help request leaves the context unchanged");

    const again = outputText(
      await tool.execute({ rescue: original.id, to: "@reviewer", context: "trying to rescue the closed handoff again" }, analyst),
    );
    assert(again.includes("closed"), "a closed original cannot be rescued twice");
    assert(
      [...ctx.handoffs.values()].filter((h) => h.rescue && h.id !== original.id).length === 1,
      "the second attempt creates no extra rescue handoff",
    );

    const pending = makeHandoff("H-202", "@tawa", "dev", "pending");
    ctx.handoffs.set(pending.id, pending);
    const pendingResult = outputText(
      await tool.execute({ rescue: pending.id, to: "@reviewer", context: "trying to rescue a handoff that was never accepted" }, analyst),
    );
    assert(pendingResult.includes("not yet accepted"), "a pending handoff cannot be rescued");
    assert(pending.status === "pending", "the pending handoff is untouched");

    const guarded = makeHandoff("H-203", "@tawa", "dev", "accepted");
    ctx.handoffs.set(guarded.id, guarded);
    const notAnalyst = {
      ...analyst,
      agent: "@dev",
    } as ToolContext;
    const refused = outputText(
      await tool.execute({ rescue: guarded.id, to: "@reviewer", context: "a non-analyst tries to rescue a stalled handoff" }, notAnalyst),
    );
    assert(refused.includes("Only @analyst"), "a non-analyst cannot rescue a stalled handoff");
    assert(guarded.status === "accepted", "the refused rescue leaves the original accepted");

    const paused = makeHandoff("H-204", "@tawa", "dev", "paused");
    ctx.handoffs.set(paused.id, paused);
    const pausedResult = outputText(
      await tool.execute({ rescue: paused.id, to: "@reviewer", context: "a paused handoff still needs a rescue path" }, analyst),
    );
    assert(pausedResult.includes("Rescue"), "a paused handoff can be rescued");
    assert(paused.status === "closed", "the paused original is closed by the rescue");

    console.log(`PROOF PASS: rescue closes the stalled original without a completion credit (${passed} assertions)`);
  } finally {
    delete process.env.TAWASSUL_CONTEXT_HANDOFF;
    delete process.env.TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT;
    await ctx.lifecycleManager.destroy();
  }
}

try {
  await main();
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
