import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  UsageLedger,
  clearUsageLedger,
  computeBillable,
  contextSizeOf,
  installUsageLedger,
  parseUsageEvent,
  type UsageSessionSnapshot,
} from "../../../src/services/usage-ledger.ts";
import { UsageShadow } from "../../../src/services/usage-shadow.ts";
import { createToolExecuteBeforeHook } from "../../../src/hooks/tool-execute.ts";
import { PipelineState } from "../../../src/hooks/PipelineState.ts";
import { buildHealthTool } from "../../../src/tools/tawa/health.ts";

let failures = 0;
function check(cond: unknown, name: string): void {
  if (cond) console.log(`ok ${name}`);
  else {
    failures += 1;
    console.error(`FAIL ${name}`);
  }
}
function eq(actual: unknown, expected: unknown, name: string): void {
  check(actual === expected, `${name} (${String(actual)} === ${String(expected)})`);
}

const here = dirname(fileURLToPath(import.meta.url));
const probe = JSON.parse(readFileSync(join(here, "2026-11-06-token-usage-probe.json"), "utf8"));
const payloads = probe.q1_q2_q3_q8_usage as Array<{
  sessionID: string;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  cost: number;
}>;
const gets = probe.q2_q5_q6_gets as Array<{ id: string; tokens: unknown; cost: number; parentID?: string }>;
const rootID = probe.sessions.root as string;
const childID = probe.sessions.child as string;
const work = mkdtempSync(join(tmpdir(), "tawassul-p2-exp-"));
const WORKSPACE = join(work, "workspace");

try {
  console.log("### Experiment A: replay the ten real Probe 0 usage payloads");
  const snapshots: Record<string, UsageSessionSnapshot> = {};
  for (const g of gets) snapshots[g.id] = { id: g.id, parentID: g.parentID ?? null, tokens: g.tokens as never, cost: g.cost };
  const ledgerPath = join(work, "real.jsonl");
  const ledger = new UsageLedger({
    path: ledgerPath,
    now: () => 1_760_000_000_000,
    getSession: async (sessionID) => snapshots[sessionID],
  });
  await ledger.start();
  let accepted = 0;
  for (const payload of payloads) {
    const event = { type: "session.usage.updated", data: payload };
    eq(parseUsageEvent(event)?.sessionID, payload.sessionID, `payload ${payloads.indexOf(payload)} parses to its session`);
    if (await ledger.handleEvent(event)) accepted += 1;
  }
  eq(accepted, 10, "all ten real payloads are accepted");
  await ledger.flush();
  const rootSum = 70484 + 402 + 238080 * 0.1;
  const childSum = 39363 + 56;
  eq(ledger.sessionSnapshot(rootID)?.billable, rootSum, "the root cumulative billable matches the formula");
  eq(ledger.sessionSnapshot(childID)?.billable, childSum, "the child cumulative billable matches the formula");
  eq(ledger.sessionSnapshot(childID)?.depth, 1, "the child depth is 1 from the real parentID");
  eq(ledger.sessionSnapshot(childID)?.parentID, rootID, "the child parent is the real root session");
  eq(ledger.sessionSnapshot(rootID)?.depth, 0, "the root depth is 0");
  eq(contextSizeOf({ input: 70484, output: 402, reasoning: 828, cacheRead: 238080, cacheWrite: 0 }), 308564, "context size is input plus cache read");
  const lines = readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.trim());
  eq(lines.length, 10, "the JSONL holds one row per real event");
  const rows = lines.map((l) => JSON.parse(l));
  const lastRootRow = rows.filter((r) => r.sessionID === rootID).at(-1);
  eq(lastRootRow.raw.input, 70484, "the last root row stores the cumulative input");
  eq(lastRootRow.delta.input, 138, "the last root delta is 70484-70346");
  eq(lastRootRow.delta.cacheRead, 51072, "the last root cache delta is 238080-187008");
  eq(lastRootRow.billable, 138 + 15 + 51072 * 0.1, "the last root row prices the delta, not the cumulative");
  eq(lastRootRow.costUnpriced, true, "a zero-cost row is labelled cost_unpriced");
  eq(lastRootRow.weights.source, "default", "the weights carry the default source");
  const summary = ledger.summary();
  eq(summary.sessions, 2, "two real sessions are tracked");
  eq(summary.roots, 1, "one real root");
  eq(summary.children, 1, "one real child");
  eq(summary.unit, "weighted_tokens", "the unit is weighted tokens at zero cost");
  eq(summary.root.p50, rootSum, "root p50 is the real root snapshot");
  eq(summary.child.p50, childSum, "child p50 is the real child snapshot");
  await ledger.dispose();

  console.log("### Experiment A2: reload plus real session.list backfill adds no gap row");
  const reload = new UsageLedger({
    path: ledgerPath,
    now: () => 1_760_000_000_000,
    listSessions: async () => ({ data: [snapshots[rootID]!, snapshots[childID]!] }),
  });
  await reload.start();
  eq(reload.summary().rows, 10, "reload keeps the ten rows");
  eq(reload.summary().unobservedRows, 0, "a matching list snapshot produces no unobserved row");
  eq(reload.summary().backfilledSessions, 0, "known sessions are reconciled, not backfilled");
  await reload.dispose();

  console.log("### Experiment B: shadow detectors sink four rows into JSONL");
  const shadowPath = join(work, "shadow.jsonl");
  const shadowLedger = new UsageLedger({ path: shadowPath, now: () => 1_760_000_000_000 });
  await shadowLedger.start();
  const observations: unknown[] = [];
  const shadow = new UsageShadow({ emit: (o) => { observations.push(o); shadowLedger.recordShadow(o); }, now: () => 1_760_000_000_000 });
  for (let count = 1; count <= 5; count += 1) {
    shadow.observeRepeat({ sessionID: rootID, agent: "tawa", tool: "shell", count, success: true });
  }
  const text = "the build is green and the next step is to read the ledger file before the window closes";
  for (let turn = 1; turn <= 12; turn += 1) {
    shadow.handleEvent({ type: "session.text.ended", data: { sessionID: rootID, assistantMessageID: `m${turn}`, text } });
    shadow.handleEvent({ type: "session.usage.updated", data: { sessionID: rootID } });
  }
  for (let call = 1; call <= 6; call += 1) {
    shadow.observeDispatch({ sessionID: rootID, tool: "task", args: { task: text } });
  }
  eq(observations.length, 4, "one warning, one repeat trip, one echo trip, one fan-out trip");
  await shadowLedger.flush();
  const shadowRows = readFileSync(shadowPath, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  eq(shadowRows.length, 4, "four shadow rows are persisted");
  eq(new Set(shadowRows.map((r) => r.detector)).size, 3, "all three detectors appear");
  eq(shadowRows.find((r) => r.detector === "echo")?.count, 12, "the echo row carries the twelve-turn streak");
  eq(shadowRows.find((r) => r.detector === "fanout")?.count, 6, "the fan-out row carries the six-dispatch cluster");
  eq(shadowLedger.summary().repeatSessions, 1, "the ledger counts the repeat session");
  eq(shadowLedger.summary().echoSessions, 1, "the ledger counts the echo session");
  eq(shadowLedger.summary().fanoutSessions, 1, "the ledger counts the fan-out session");
  await shadowLedger.dispose();

  console.log("### Experiment C: the real before hook records a no-agent row");
  const hookPath = join(work, "hook.jsonl");
  const hookLedger = installUsageLedger({ path: hookPath, now: () => 1_760_000_000_000 });
  await hookLedger.start();
  const before = createToolExecuteBeforeHook({ pipelineState: new PipelineState() } as never);
  await before({ tool: "bash", sessionID: rootID }, { args: { command: "printf p2" } });
  await hookLedger.flush();
  let hookRows = readFileSync(hookPath, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  eq(hookRows.length, 1, "the no-agent call writes one row before the pipeline");
  eq(hookRows[0].kind, "noagent", "the row kind is noagent");
  eq(hookRows[0].tool, "bash", "the row names the tool");
  eq(hookRows[0].sessionID, rootID, "the row names the session");
  eq(hookLedger.summary().noAgentRows, 1, "the ledger counts the no-agent row");
  await before({ tool: "bash", agent: "dev", sessionID: rootID }, { args: { command: "printf p2" } });
  await hookLedger.flush();
  hookRows = readFileSync(hookPath, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  eq(hookRows.filter((r) => r.kind === "noagent").length, 1, "an agent-bearing call adds no no-agent row");
  eq(hookLedger.summary().noAgentRows, 1, "the no-agent count stays at one");
  eq(statSync(hookPath).mode & 0o777, 0o600, "the hook ledger file is private");
  await clearUsageLedger();

  console.log("### Experiment D: the health tool renders the ledger block from a live ledger");
  const healthPath = join(work, "health.jsonl");
  const healthLedger = installUsageLedger({ path: healthPath, now: () => 1_760_000_000_000 });
  await healthLedger.start();
  await healthLedger.handleEvent({ type: "session.usage.updated", data: payloads[0] });
  await healthLedger.handleEvent({ type: "session.usage.updated", data: payloads[1] });
  healthLedger.recordNoAgent({ sessionID: rootID, tool: "shell" });
  healthLedger.recordShadow({ detector: "repeat", sessionID: rootID, tripped: true, count: 5, detail: { tool: "shell" } });
  healthLedger.recordShadow({ detector: "echo", sessionID: rootID, tripped: true, count: 12, detail: { similarity: 0.91 } });
  healthLedger.recordShadow({ detector: "fanout", sessionID: rootID, tripped: true, count: 6, detail: {} });
  const health = buildHealthTool(
    {
      timerManager: null,
      persistDir: join(work, "persist"),
      scope: "project",
      stateReadOnly: false,
      stateDir: WORKSPACE,
      statePath: () => join(work, "state.json"),
      intelligence: null,
    } as never,
    { measureLag: async () => 1, rssMb: () => 128, pendingFlushes: () => 0 },
  );
  const result = await health.execute({}, {} as never);
  const output = typeof result === "string" ? result : result.output;
  const block = output.split("\n").filter((line) => line.includes("Usage ledger") || line.startsWith("- Sessions:") || line.startsWith("- Weighted tokens") || line.startsWith("- Rows:") || line.startsWith("- No-agent") || line.startsWith("- Shadow:") || line.startsWith("- Unit:") || line.startsWith("- Ledger:")).join("\n");
  console.log(block);
  check(output.includes("## Usage ledger"), "health prints the Usage ledger section");
  check(output.includes("- No-agent calls: 1"), "health prints the no-agent count");
  check(output.includes("- Shadow: repeat 1 / echo 1 / fan-out 1 session(s), 3 row(s)"), "health prints the three shadow readings");
  check(output.includes("cost_unpriced"), "health labels the unpriced unit");
  await clearUsageLedger();

  console.log(failures === 0 ? "EXPERIMENT PASS" : `EXPERIMENT FAIL (${failures})`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
