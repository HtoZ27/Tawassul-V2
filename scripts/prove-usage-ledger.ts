import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_USAGE_WEIGHTS,
  UsageLedger,
  computeBillable,
  contextSizeOf,
  diffCounters,
  parseUsageEvent,
  percentile,
  percentileSet,
  type UsageSessionListInput,
  type UsageSessionSnapshot,
} from "../src/services/usage-ledger.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
  console.log(`ok ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) fail(`${message} (expected ${String(expected)}, got ${String(actual)})`);
  console.log(`ok ${message}`);
}

function usage(
  sessionID: string,
  tokens: { input: number; output: number; reasoning?: number; read?: number; write?: number },
  cost = 0,
): Record<string, unknown> {
  return {
    type: "session.usage.updated",
    data: {
      sessionID,
      cost,
      tokens: {
        input: tokens.input,
        output: tokens.output,
        reasoning: tokens.reasoning ?? 0,
        cache: { read: tokens.read ?? 0, write: tokens.write ?? 0 },
      },
    },
  };
}

function lastRow(file: string): Record<string, unknown> {
  const lines = readFileSync(file, "utf8").split("\n").filter((line) => line.trim().length > 0);
  const raw = lines[lines.length - 1];
  if (!raw) fail(`no rows in ${file}`);
  return JSON.parse(raw) as Record<string, unknown>;
}

const work = mkdtempSync(join(tmpdir(), "tawassul-usage-ledger-"));
const clock = { value: 1_700_000_000_000 };
const now = (): number => clock.value;

try {
  const parsed = parseUsageEvent(
    usage("ses-root", { input: 10, output: 2, reasoning: 1, read: 100, write: 4 }),
  );
  assert(parsed !== undefined, "a session.usage.updated event parses");
  equal(parsed?.sessionID, "ses-root", "the parser keeps the session id");
  equal(parsed?.tokens.input, 10, "the parser keeps input");
  equal(parsed?.tokens.cacheRead, 100, "the parser flattens cache.read");
  equal(parsed?.tokens.cacheWrite, 4, "the parser flattens cache.write");

  assert(
    parseUsageEvent({ type: "session.text.ended", data: { sessionID: "x" } }) === undefined,
    "an unrelated event is ignored",
  );
  assert(
    parseUsageEvent({ type: "session.usage.updated", data: { sessionID: "x", tokens: null } }) === undefined,
    "an event without tokens is ignored",
  );
  assert(
    parseUsageEvent({ type: "session.usage.updated", data: { sessionID: "", tokens: {} } }) === undefined,
    "an event without a session id is ignored",
  );
  assert(parseUsageEvent(null) === undefined, "a non-object event is ignored");
  const normalized = parseUsageEvent({
    data: {
      sessionID: "ses-normalized",
      cost: -5,
      tokens: { input: Number.NaN, output: -1, reasoning: Number.POSITIVE_INFINITY, cache: { read: 3, write: "4" } },
    },
  });
  equal(normalized?.tokens.input, 0, "NaN input becomes zero");
  equal(normalized?.tokens.output, 0, "negative output becomes zero");
  equal(normalized?.tokens.reasoning, 0, "infinite reasoning becomes zero");
  equal(normalized?.tokens.cacheWrite, 0, "a non-numeric cache write becomes zero");
  equal(normalized?.cost, 0, "a negative cost becomes zero");

  const counters = { input: 10, output: 2, reasoning: 1, cacheRead: 100, cacheWrite: 4 };
  equal(computeBillable(counters), 27, "default weights price fresh input, output, and cache");
  equal(computeBillable(counters, { read: 0.5, write: 2, source: "catalog" }), 10 + 2 + 50 + 8, "custom weights apply");
  equal(computeBillable({ ...counters, reasoning: 1000 }), 27, "reasoning stays inside output by default");
  equal(computeBillable({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }), 0, "zero usage is zero");
  equal(contextSizeOf(counters), 110, "context size is fresh input plus cache read");

  const grown = diffCounters(
    { input: 10, output: 2, reasoning: 1, cacheRead: 100, cacheWrite: 4 },
    { input: 30, output: 5, reasoning: 2, cacheRead: 300, cacheWrite: 4 },
  );
  equal(grown.delta.input, 20, "a growing cumulative snapshot yields the input delta");
  equal(grown.delta.cacheRead, 200, "a growing cumulative snapshot yields the cache delta");
  assert(!grown.resync, "a growing snapshot is not a resync");
  const shrunk = diffCounters(
    { input: 30, output: 5, reasoning: 2, cacheRead: 300, cacheWrite: 4 },
    { input: 5, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  );
  assert(shrunk.resync, "a shrinking snapshot is a resync");
  equal(shrunk.delta.input, 5, "a resync uses the full snapshot, not a negative delta");

  assert(percentile([], 50) === null, "an empty distribution has no percentile");
  equal(percentile([10], 99), 10, "a single value is every percentile");
  equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5, "p50 uses nearest rank");
  equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9, "p90 uses nearest rank");
  equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 99), 10, "p99 uses nearest rank");
  equal(percentileSet([]).p50, null, "an empty percentile set is null");

  const lineage: Record<string, UsageSessionSnapshot> = {
    "ses-root": { id: "ses-root", agent: "tawa" },
    "ses-child": { id: "ses-child", parentID: "ses-root", agent: "tawa-pickle" },
    "ses-grandchild": { id: "ses-grandchild", parentID: "ses-child" },
    "ses-priced": { id: "ses-priced" },
  };
  const lookups: string[] = [];
  const file = join(work, "usage-ledger.jsonl");
  const ledger = installLedger(file, lineage, lookups);
  await ledger.start();
  assert(existsSync(file) === false, "start without sessions writes no file");

  equal(await ledger.handleEvent({ type: "session.text.ended" }), false, "a non-usage event does not ingest");
  equal(await ledger.handleEvent(usage("ses-root", { input: 10, output: 2, reasoning: 1, read: 100, write: 4 })), true, "a usage event ingests");
  equal(lookups[0], "ses-root", "the first sight of a session resolves lineage");
  let root = ledger.sessionSnapshot("ses-root");
  equal(root?.depth, 0, "a session without a parent is depth 0");
  equal(root?.billable, 27, "the first row is priced from the full snapshot");
  equal(root?.turn, 1, "the first event is turn 1");
  assert(root?.costUnpriced === true, "a zero-cost session is labelled cost_unpriced");

  await ledger.handleEvent(usage("ses-root", { input: 30, output: 5, reasoning: 2, read: 300, write: 4 }));
  await ledger.flush();
  root = ledger.sessionSnapshot("ses-root");
  equal(root?.turn, 2, "the second event advances the turn");
  equal(root?.billable, 70, "the cumulative snapshot is priced once, not summed");
  const second = lastRow(file) as { delta: { input: number }; billable: number; resync: boolean };
  equal(second.delta.input, 20, "the persisted row carries the delta");
  equal(second.billable, 43, "the persisted row prices the delta");

  await ledger.handleEvent(usage("ses-child", { input: 5, output: 1 }));
  const child = ledger.sessionSnapshot("ses-child");
  equal(child?.depth, 1, "a child of the root is depth 1");
  equal(child?.parentID, "ses-root", "the child keeps its parent id");
  assert(lookups.includes("ses-root"), "the child lineage walk resolves the parent");

  await ledger.handleEvent(usage("ses-grandchild", { input: 7, output: 0 }));
  equal(ledger.sessionSnapshot("ses-grandchild")?.depth, 2, "a grandchild is depth 2");

  await ledger.handleEvent(usage("ses-priced", { input: 1, output: 0 }, 0.02));
  const priced = ledger.sessionSnapshot("ses-priced");
  equal(priced?.cost, 0.02, "a priced session keeps its cost");
  assert(priced?.costUnpriced === false, "a priced session is not labelled cost_unpriced");

  const resyncPath = join(work, "resync.jsonl");
  const shrinking = new UsageLedger({ path: resyncPath, now });
  await shrinking.start();
  await shrinking.handleEvent(usage("ses-resync", { input: 10, output: 2 }));
  await shrinking.handleEvent(usage("ses-resync", { input: 5, output: 1 }));
  await shrinking.flush();
  const resyncRow = lastRow(resyncPath) as { resync: boolean; delta: { input: number }; billable: number };
  assert(resyncRow.resync, "a shrinking snapshot is persisted as a resync");
  equal(resyncRow.delta.input, 5, "a resync row uses the full snapshot");
  equal(resyncRow.billable, 6, "a resync row prices the full snapshot");
  await shrinking.dispose();

  equal(ledger.recordInjection({ sessionID: "ses-root", source: "digest", bytes: 120 })?.bytes, 120, "an injection row is recorded");
  equal(ledger.recordInjection({ sessionID: "ses-root", source: "session_index", bytes: 300 })?.bytes, 300, "a second injection source is recorded");
  equal(ledger.recordInjection({ sessionID: "ses-root", source: "bad", bytes: Number.NaN }), undefined, "a non-finite injection is ignored");
  equal(ledger.recordInjection({ sessionID: "ses-root", source: "bad", bytes: -1 }), undefined, "a negative injection is ignored");
  equal(ledger.recordInjection({ sessionID: "ses-root", source: "round", bytes: 1.6 })?.bytes, 2, "injection bytes round");
  equal(ledger.recordNoAgent({ sessionID: "ses-root", tool: "bash" })?.tool, "bash", "a no-agent call is recorded");
  equal(ledger.recordNoAgent({ sessionID: "", tool: "bash" }), undefined, "a no-agent call without a session is ignored");
  equal(ledger.recordNoAgent({ sessionID: "ses-root", tool: "" }), undefined, "a no-agent call without a tool is ignored");

  await ledger.flush();
  const mode = statSync(file).mode & 0o777;
  equal(mode, 0o600, "the ledger file is private");
  const summary = ledger.summary();
  equal(summary.sessions, 4, "four sessions are tracked");
  equal(summary.roots, 2, "the two parentless sessions are roots");
  equal(summary.children, 2, "the child and grandchild are children");
  equal(summary.unit, "mixed", "priced and unpriced sessions produce a mixed unit");
  equal(summary.pricedSessions, 1, "one session is priced");
  equal(summary.unpricedSessions, 3, "three sessions are unpriced");
  equal(summary.injectionRows, 3, "three injection rows are counted");
  equal(summary.injectionBytes, 422, "injection bytes are summed");
  equal(summary.noAgentRows, 1, "one no-agent row is counted");
  equal(summary.unobservedRows, 0, "live events are not unobserved");
  equal(summary.backfilledSessions, 0, "live events are not backfilled");
  equal(summary.lineageUnknown, 0, "resolved roots are not lineage-unknown");

  await ledger.dispose();
  assert(ledger.summary().enabled === false, "a disposed ledger reports disabled");

  const reloaded = installLedger(file, lineage, []);
  await reloaded.start();
  equal(reloaded.sessionCount(), 4, "reload restores every session from JSONL");
  equal(reloaded.sessionSnapshot("ses-root")?.turn, 2, "reload restores the turn counter");
  equal(reloaded.summary().injectionBytes, 422, "reload restores injection bytes");
  equal(reloaded.summary().noAgentRows, 1, "reload restores the no-agent count");
  const afterRestart = await reloaded.handleEvent(usage("ses-root", { input: 40, output: 6, reasoning: 2, read: 300, write: 4 }));
  await reloaded.flush();
  const restartRow = lastRow(file) as { delta: { input: number }; turn: number };
  equal(afterRestart, true, "a post-restart usage event ingests");
  equal(restartRow.delta.input, 10, "the first post-restart delta reconciles against the persisted snapshot");
  equal(restartRow.turn, 3, "the first post-restart turn continues the persisted count");
  await reloaded.dispose();

  const listCalls: Array<UsageSessionListInput | undefined> = [];
  const pages: UsageSessionSnapshot[][] = [
    [
      { id: "r1", tokens: { input: 1000, output: 50, reasoning: 0, cache: { read: 4000, write: 10 } }, cost: 0 },
      { id: "c1", parentID: "r1", agent: "dev", tokens: { input: 100, output: 5 } },
      { id: "c2", parentID: "c1", tokens: { input: 200, output: 10 } },
    ],
    [
      { id: "r2", tokens: { input: 300, output: 20 } },
      { id: "c3", parentID: "ghost", tokens: { input: 50, output: 1 } },
      { id: "z1", tokens: { input: 0, output: 0 } },
    ],
  ];
  const backfillPath = join(work, "backfill.jsonl");
  const backfill = new UsageLedger({
    path: backfillPath,
    now,
    listSessions: async (input) => {
      listCalls.push(input);
      const page = input?.cursor === "page-2" ? pages[1]! : pages[0]!;
      return { data: page, cursor: { next: input?.cursor === "page-2" ? null : "page-2" } };
    },
  });
  await backfill.start();
  equal(listCalls.length, 2, "the backfill follows the cursor across two pages");
  equal(listCalls[0]?.limit, 500, "the backfill bounds each page");
  equal(listCalls[0]?.order, "desc", "the backfill reads newest first");
  equal(backfill.summary().backfilledSessions, 5, "five sessions are backfilled");
  equal(backfill.summary().sessions, 5, "an all-zero session is skipped");
  equal(backfill.summary().roots, 2, "backfill separates roots from children");
  equal(backfill.summary().children, 3, "backfill counts children");
  equal(backfill.summary().orphanChildren, 1, "a child with an unknown parent is an orphan");
  equal(backfill.sessionSnapshot("c1")?.depth, 1, "backfill derives child depth from the page");
  equal(backfill.sessionSnapshot("c2")?.depth, 2, "backfill derives grandchild depth from the page");
  equal(backfill.sessionSnapshot("c3")?.depth, null, "an unknown parent leaves the depth unresolved");
  equal(backfill.sessionSnapshot("r1")?.billable, 1462.5, "backfill prices the cumulative snapshot");
  equal(backfill.summary().root.p99, 1462.5, "the root p99 comes from the cumulative snapshot");
  equal(backfill.summary().child.p99, 210, "the child p99 comes from the cumulative snapshot");
  assert(backfill.sessionSnapshot("r1")?.backfilled === true, "a backfilled session is labelled");
  await backfill.dispose();
  const backfillReload = new UsageLedger({
    path: backfillPath,
    now,
    listSessions: async () => ({ data: [], cursor: { next: null } }),
  });
  await backfillReload.start();
  equal(backfillReload.summary().backfilledSessions, 5, "reload restores the backfilled count");
  await backfillReload.dispose();

  const gapPath = join(work, "gap.jsonl");
  const before = new UsageLedger({ path: gapPath, now });
  await before.start();
  await before.handleEvent(usage("r1", { input: 1000, output: 50, reasoning: 0, read: 4000, write: 10 }));
  await before.dispose();
  const gap = new UsageLedger({
    path: gapPath,
    now,
    listSessions: async () => ({
      data: [
        { id: "r1", tokens: { input: 1200, output: 60, reasoning: 0, cache: { read: 4000, write: 10 } }, cost: 0 },
      ],
    }),
  });
  await gap.start();
  equal(gap.summary().unobservedRows, 1, "a boot gap is recorded as unobserved");
  equal(gap.summary().backfilledSessions, 0, "a known session is reconciled, not backfilled");
  equal(gap.sessionSnapshot("r1")?.billable, 1200 + 60 + 400 + 12.5, "the gap updates the cumulative snapshot");
  await gap.flush();
  const gapRow = lastRow(gapPath) as { unobserved: boolean; source: string; delta: { input: number } };
  assert(gapRow.unobserved, "the gap row is labelled unobserved");
  equal(gapRow.source, "session.list", "the gap row comes from the session list");
  equal(gapRow.delta.input, 200, "the gap row carries only the missing input");
  await gap.dispose();

  const emptyGap = new UsageLedger({ path: join(work, "gap-empty.jsonl"), now });
  const emptyGapEvent = await emptyGap.handleEvent(usage("only", { input: 1, output: 1 }));
  equal(emptyGapEvent, true, "a ledger without a list source still ingests");
  equal(emptyGap.summary().unobservedRows, 0, "a ledger without a list source reports no gap");
  await emptyGap.dispose();

  const broken = new UsageLedger({
    path: join(work, "broken.jsonl"),
    now,
    getSession: async () => {
      throw new Error("host unavailable");
    },
  });
  await broken.start();
  equal(await broken.handleEvent(usage("unresolved", { input: 3, output: 1 })), true, "a lineage failure fails open");
  equal(broken.sessionSnapshot("unresolved")?.depth, null, "a lineage failure leaves the depth unknown");
  equal(broken.sessionSnapshot("unresolved")?.billable, 4, "a lineage failure still prices the event");
  equal(broken.summary().lineageUnknown, 1, "a lineage failure is counted as lineage-unknown");
  equal(broken.recordInjection({ sessionID: "", source: "digest", bytes: 1 }), undefined, "an injection without a session is ignored");
  await broken.dispose();

  const rotationPath = join(work, "rotation.jsonl");
  const rotating = new UsageLedger({ path: rotationPath, now, maxBytes: 1 });
  await rotating.start();
  await rotating.handleEvent(usage("rot-a", { input: 1, output: 1 }));
  await rotating.flush();
  await rotating.handleEvent(usage("rot-b", { input: 2, output: 2 }));
  await rotating.flush();
  assert(existsSync(`${rotationPath}.1`), "an oversized ledger rotates to .1");
  await rotating.dispose();
  const backupRotation = new UsageLedger({ path: rotationPath, now, maxBytes: 1 });
  await backupRotation.start();
  await backupRotation.handleEvent(usage("rot-c", { input: 3, output: 3 }));
  await backupRotation.flush();
  await backupRotation.dispose();
  assert(
    readdirSync(work).some((name) => name.startsWith("rotation.jsonl.1.")),
    "an existing .1 is moved to a unique backup before rotation",
  );
  const rotationReload = new UsageLedger({ path: rotationPath, now });
  await rotationReload.start();
  equal(rotationReload.sessionCount(), 2, "reload reads the rotated file and the active file");
  await rotationReload.dispose();

  const repo = dirname(dirname(fileURLToPath(import.meta.url)));
  const setup = readFileSync(join(repo, "src", "v2", "setup.ts"), "utf8");
  assert(setup.includes("installUsageLedger"), "the v2 setup installs the ledger");
  assert(setup.includes("usageLedger.handleEvent(raw)"), "the v2 event relay feeds the ledger");
  assert(setup.includes("clearUsageLedger"), "the v2 cleanup disposes the ledger");
  const bridge = readFileSync(join(repo, "src", "v2", "session-bridge.ts"), "utf8");
  assert(bridge.includes("get: (input) => ctx.session.get(input)"), "the bridge exposes session.get");
  assert(bridge.includes("list: (input) => ctx.session.list(input)"), "the bridge exposes session.list");
  const health = readFileSync(join(repo, "src", "tools", "tawa", "health.ts"), "utf8");
  assert(health.includes("## Usage ledger"), "health reports the ledger");
  assert(health.includes("No-agent calls"), "health reports the no-agent count");
  const toolHook = readFileSync(join(repo, "src", "hooks", "tool-execute.ts"), "utf8");
  assert(toolHook.includes("recordNoAgent"), "the tool hook records no-agent calls");
  const sessionHook = readFileSync(join(repo, "src", "hooks", "session.ts"), "utf8");
  assert(sessionHook.includes("source: \"digest\""), "the session hook audits digest bytes");
  assert(sessionHook.includes("source: \"session_index\""), "the session hook audits session index bytes");
  equal(DEFAULT_USAGE_WEIGHTS.read, 0.1, "the default read weight is the documented fallback");
  equal(DEFAULT_USAGE_WEIGHTS.write, 1.25, "the default write weight is the documented fallback");

  console.log("PROOF PASS: usage ledger covers parsing, pricing, lineage, backfill, reload, gaps, injection, no-agent rows, and rotation");
} finally {
  rmSync(work, { recursive: true, force: true });
}

function installLedger(
  path: string,
  lineage: Record<string, UsageSessionSnapshot>,
  lookups: string[],
): UsageLedger {
  return new UsageLedger({
    path,
    now,
    getSession: async (sessionID) => {
      lookups.push(sessionID);
      return lineage[sessionID];
    },
  });
}
