import "./proof-log-isolate.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRunLog, type ToolRunEntry } from "../src/services/tool-run-log.ts";
import { createHandoffEntry } from "../src/services/handoff-entry.ts";
import { compareAgentModels, reviewerIndependenceFails } from "../src/services/model-refs.ts";
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

type Ref = { providerID: string; modelID: string };

type Sample = {
  handoffId: string;
  verdict: "different" | "same" | "unknown" | "unjoinable";
  runTurn?: number;
};

function modelOf(entry: ToolRunEntry): Ref | undefined {
  return entry.model ? parseModelTarget(entry.model) ?? undefined : undefined;
}

function probe(
  handoffs: ReadonlyArray<ReturnType<typeof createHandoffEntry>>,
  runs: readonly ToolRunEntry[],
): Sample[] {
  return handoffs.map((handoff) => {
    if (!handoff.sessionId || handoff.turn === undefined) {
      return { handoffId: handoff.id, verdict: "unjoinable" as const };
    }
    const after = runs
      .filter(
        (run) =>
          run.sessionId === handoff.sessionId &&
          run.turn >= (handoff.turn as number) &&
          run.agent === handoff.to &&
          run.model !== undefined,
      )
      .sort((a, b) => a.turn - b.turn);
    const run = after[0];
    if (!run) return { handoffId: handoff.id, verdict: "unknown" as const };
    const runRef = modelOf(run);
    if (!runRef) return { handoffId: handoff.id, verdict: "unknown" as const };
    const comparison = compareAgentModels(handoff.implementer, runRef);
    return {
      handoffId: handoff.id,
      verdict: comparison === "different" ? "different" : comparison === "same" ? "same" : "unknown",
      runTurn: run.turn,
    };
  });
}

const work = mkdtempSync(join(tmpdir(), "tawassul-retro-"));
try {
  const log = new ToolRunLog(work);
  const devModel: Ref = { providerID: "opencode", modelID: "deepseek-v4.1-flash-free" };
  const reviewerModel: Ref = { providerID: "nvidia", modelID: "stepfun-ai/step-5-preview" };
  const modelText = (ref: Ref): string => `${ref.providerID}/${ref.modelID}`;

  log.record({ tool: "edit", agent: "dev", sessionId: "s1", argsHash: "a1", status: "success", model: modelText(devModel), turn: 1 });
  log.record({ tool: "goal", agent: "reviewer", sessionId: "s1", argsHash: "a2", status: "success", model: modelText(reviewerModel), turn: 2 });
  log.record({ tool: "edit", agent: "dev", sessionId: "s1", argsHash: "a3", status: "success", model: modelText(devModel), turn: 3 });
  log.record({ tool: "record", agent: "reviewer", sessionId: "s1", argsHash: "a4", status: "success", model: modelText(devModel), turn: 4 });
  log.record({ tool: "timeline", agent: "reviewer", sessionId: "s1", argsHash: "a5", status: "success", turn: 5 });

  assert(log.currentTurn("s1") === 5, "the tool-run log reports the last recorded turn for a session");
  assert(log.currentTurn("nope") === 0, "the tool-run log reports turn zero for an unseen session");

  const runs = (log as unknown as { runs: ToolRunEntry[] }).runs;
  assert(runs.length === 5, "the probe holds five recorded turns");
  assert(runs[4]?.model === undefined, "a run without a model reads as unmodelled");

  const different = createHandoffEntry({
    id: "H-1",
    from: "dev",
    to: "reviewer",
    task: "review the change",
    context: "a review request",
    implementer: devModel,
    reviewer: reviewerModel,
    sessionId: "s1",
    turn: 1,
  });
  const same = createHandoffEntry({
    id: "H-2",
    from: "dev",
    to: "reviewer",
    task: "review the change",
    context: "a review request",
    implementer: devModel,
    reviewer: devModel,
    sessionId: "s1",
    turn: 3,
  });
  const unknown = createHandoffEntry({
    id: "H-3",
    from: "dev",
    to: "reviewer",
    task: "review the change",
    context: "a review request",
    implementer: devModel,
    reviewer: reviewerModel,
    sessionId: "s1",
    turn: 99,
  });
  const unjoinable = createHandoffEntry({
    id: "H-4",
    from: "dev",
    to: "reviewer",
    task: "review the change",
    context: "a review request",
    implementer: devModel,
    reviewer: reviewerModel,
  });

  assert(different.sessionId === "s1" && different.turn === 1, "the dispatch payload carries sessionId and turn");
  assert(unjoinable.sessionId === undefined && unjoinable.turn === undefined, "a payload without a join key stays joinable-optional");
  assert(JSON.stringify(different.reviewer) === JSON.stringify(reviewerModel), "the payload carries the reviewer provider and model");
  assert(JSON.stringify(different.implementer) === JSON.stringify(devModel), "the payload carries the implementer provider and model");

  const samples = probe([different, same, unknown, unjoinable], runs);
  const byId = new Map(samples.map((sample) => [sample.handoffId, sample]));
  assert(samples.length === 4, "the probe samples every dispatch payload");
  assert(byId.get("H-1")?.verdict === "different", "a reviewer run on its own model differs from the implementer");
  assert(byId.get("H-1")?.runTurn === 2, "the probe joins the first reviewer run at or after the dispatch turn");
  assert(byId.get("H-2")?.verdict === "same", "a reviewer run on the implementer model is flagged");
  assert(reviewerIndependenceFails({ implementer: same.implementer, reviewer: same.reviewer }) === true, "the same-model flag agrees with the shared check");
  assert(byId.get("H-3")?.verdict === "unknown", "a dispatch with no later reviewer run reads as unknown");
  assert(byId.get("H-4")?.verdict === "unjoinable", "a payload without a join key is never counted as a violation");
  assert(samples.filter((sample) => sample.verdict === "same").length === 1, "the sample reports exactly one violation");
  assert(samples.filter((sample) => sample.verdict === "different").length === 1, "the sample reports exactly one passing turn");

  const staleMap: Record<string, string> = { dev: modelText(devModel), reviewer: modelText(devModel) };
  const mapComparison = compareAgentModels(
    parseModelTarget(staleMap.dev) ?? undefined,
    parseModelTarget(staleMap.reviewer) ?? undefined,
  );
  assert(mapComparison === "same", "the last-writer-wins map would report a false violation");
  assert(
    compareAgentModels(different.implementer, different.reviewer) === "different",
    "the probe ignores the map and keeps the payload comparison",
  );

  console.log(`PROOF PASS: the retro-probe joins dispatch payloads to per-turn runs (${passed} assertions)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
