import "./proof-log-isolate.ts";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_USAGE_WEIGHTS,
  UsageLedger,
  clearUsageLedger,
  computeBillable,
  contextSizeOf,
  diffCounters,
  getUsageLedger,
  installUsageLedger,
  parseUsageEvent,
  percentile,
  percentileSet,
  type UsageSessionListInput,
  type UsageSessionSnapshot,
} from "../src/services/usage-ledger.ts";
import { fanoutGuardApplies } from "../src/services/usage-shadow.ts";
import { sessionBudgetGuard } from "../src/hooks/guards/dispatch-guards.ts";

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

function deadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" "));
  };
  return {
    lines,
    restore: () => {
      console.error = original;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise.then(() => true, () => true), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function ledgerRow(sessionID: string): string {
  return JSON.stringify({
    v: 1,
    kind: "usage",
    ts: new Date(now()).toISOString(),
    source: "event",
    sessionID,
    parentID: null,
    depth: 0,
    agent: null,
    raw: { input: 1, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    delta: { input: 1, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    turn: 1,
  });
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
  const secondPageGate = deferred<void>();
  const backfillPath = join(work, "backfill.jsonl");
  const backfill = new UsageLedger({
    path: backfillPath,
    now,
    listSessions: async (input) => {
      listCalls.push(input);
      if (input?.cursor === "page-2") await secondPageGate.promise;
      const page = input?.cursor === "page-2" ? pages[1]! : pages[0]!;
      return { data: page, cursor: { next: input?.cursor === "page-2" ? null : "page-2" } };
    },
  });
  await deadline(backfill.start(), 1000, "backfill start");
  const backfillPass = backfill.reconcile();
  equal(await settledWithin(backfillPass, 100), false, "start returns while the second page is parked");
  equal(backfill.reconcile(), backfillPass, "reconcile returns the in-flight pass while the second page is parked");
  equal(listCalls.length, 2, "the backfill requests the parked second page once");
  secondPageGate.resolve();
  await deadline(backfillPass, 2000, "backfill pass");
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
  assert(backfill.sessionSnapshot("z1") === undefined, "a zero-counter session waits for its next event");
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
    listSessions: async () => {
      await sleep(100);
      return {
        data: [
          { id: "r1", tokens: { input: 1200, output: 60, reasoning: 0, cache: { read: 4000, write: 10 } }, cost: 0 },
        ],
      };
    },
  });
  await deadline(gap.start(), 1000, "gap start");
  const gapPass = gap.reconcile();
  await deadline(gapPass, 2000, "gap pass");
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

  const sharedPath = join(work, "shared-ledger.jsonl");
  const sharedA = new UsageLedger({ path: sharedPath, now });
  const sharedB = new UsageLedger({ path: sharedPath, now });
  await sharedA.start();
  await sharedB.start();
  await sharedA.handleEvent(usage("ses-shared-a", { input: 1, output: 1 }));
  await sharedB.handleEvent(usage("ses-shared-b", { input: 2, output: 2 }));
  await Promise.all([sharedA.flush(), sharedB.flush()]);
  await sharedA.dispose();
  await sharedB.dispose();
  const sharedReload = new UsageLedger({ path: sharedPath, now });
  await sharedReload.start();
  equal(sharedReload.sessionCount(), 2, "two ledger instances on one path keep both batches");
  assert(sharedReload.sessionSnapshot("ses-shared-a") !== undefined, "the first instance batch survives");
  assert(sharedReload.sessionSnapshot("ses-shared-b") !== undefined, "the second instance batch survives");
  await sharedReload.dispose();

  const rejectLogs = captureLogs();
  try {
    const rejecting = new UsageLedger({
      path: join(work, "reject.jsonl"),
      now,
      listSessions: async () => {
        throw new Error("session.list unavailable");
      },
    });
    await deadline(rejecting.start(), 1000, "rejecting start");
    let rejected = false;
    try {
      await rejecting.reconcile();
    } catch {
      rejected = true;
    }
    assert(rejected, "a rejecting page rejects the pass");
    await sleep(0);
    assert(
      rejectLogs.lines.some((line) => line.includes("backfill skipped")),
      "a rejecting page logs the fail-open warn",
    );
    await rejecting.dispose();
  } finally {
    rejectLogs.restore();
  }

  const parkedPath = join(work, "parked.jsonl");
  let parkedListCalls = 0;
  const parked = new UsageLedger({
    path: parkedPath,
    now,
    listSessions: () => {
      parkedListCalls += 1;
      return new Promise(() => {});
    },
  });
  const parkedStartedAt = Date.now();
  await deadline(parked.start(), 1000, "parked start");
  assert(Date.now() - parkedStartedAt < 1000, "a never-settling page does not delay start");
  equal(parkedListCalls, 1, "the parked page was requested once");
  const parkedPass = parked.reconcile();
  equal(await settledWithin(parkedPass, 300), false, "the parked pass stays in flight without dispose");
  await deadline(parked.dispose(), 1000, "parked dispose");
  await deadline(parkedPass, 1000, "parked pass ends on dispose");
  assert(!existsSync(parkedPath), "a parked pass writes no row");

  const timeoutLogs = captureLogs();
  try {
    const timed = new UsageLedger({
      path: join(work, "timed.jsonl"),
      now,
      pageTimeoutMs: 20,
      listSessions: () => new Promise(() => {}),
    });
    await timed.start();
    const timedPass = timed.reconcile();
    await deadline(timedPass, 1000, "timed pass");
    assert(!existsSync(join(work, "timed.jsonl")), "a page that never settles emits no row");
    assert(
      timeoutLogs.lines.some((line) => line.includes("did not settle within 20ms")),
      "the page timeout warn names the bound",
    );
    assert(
      timeoutLogs.lines.some((line) => line.includes("reconcile: pages=1") && line.includes("aborted=true")),
      "the timed pass summary reports the pass as aborted",
    );
    await timed.dispose();
  } finally {
    timeoutLogs.restore();
  }

  const windowGate = deferred<void>();
  const windowLedger = installUsageLedger({
    path: join(work, "window.jsonl"),
    now,
    listSessions: async (input) => {
      if (!input?.cursor) {
        return { data: [{ id: "window-root", tokens: { input: 10, output: 1 } }], cursor: { next: "window-2" } };
      }
      await windowGate.promise;
      return {
        data: [
          {
            id: "window-late",
            parentID: "window-root",
            tokens: { input: 1_000_000_000_000, output: 1_000_000_000_000 },
          },
        ],
        cursor: { next: null },
      };
    },
  });
  await windowLedger.start();
  const windowPass = windowLedger.reconcile();
  equal(
    windowLedger.sessionSnapshot("window-late"),
    undefined,
    "a later-page session is undefined while the pass is parked",
  );
  assert(
    !fanoutGuardApplies(windowLedger.sessionSnapshot("window-late")?.parentID),
    "the fan-out block is off while the later-page session is unknown",
  );
  const guardContext = {} as never;
  const guardInput = { tool: "task", agent: "dev", sessionID: "window-late" } as never;
  const parkedGuard = { args: {}, error: "" };
  equal(
    await sessionBudgetGuard.check(guardContext, guardInput, parkedGuard),
    true,
    "the budget guard is inert while the later-page session is unknown",
  );
  windowGate.resolve();
  await deadline(windowPass, 2000, "window pass");
  assert(windowLedger.sessionSnapshot("window-late") !== undefined, "the later-page session is defined after reconcile");
  assert(
    fanoutGuardApplies(windowLedger.sessionSnapshot("window-late")?.parentID),
    "the fan-out block applies after reconcile",
  );
  const seenGuard = { args: {}, error: "" };
  equal(
    await sessionBudgetGuard.check(guardContext, guardInput, seenGuard),
    false,
    "the budget guard sees the later-page session after reconcile",
  );
  assert(seenGuard.error.includes("Session budget"), "the budget verdict is a budget block, not a guard throw");
  equal(
    windowLedger.sessionSnapshot("window-created-after-fetch"),
    undefined,
    "a session created after its page was fetched stays undefined until its next event",
  );
  await windowLedger.handleEvent(usage("window-created-after-fetch", { input: 1, output: 1 }));
  assert(
    windowLedger.sessionSnapshot("window-created-after-fetch") !== undefined,
    "the next usage event defines the session",
  );
  await clearUsageLedger(windowLedger);

  const disposeGateCalls: Array<string | undefined> = [];
  const disposeGateLedger = new UsageLedger({
    path: join(work, "abort.jsonl"),
    now,
    listSessions: async (input) => {
      disposeGateCalls.push(input?.cursor);
      if (!input?.cursor) {
        return { data: [{ id: "abort-a", tokens: { input: 10, output: 1 } }], cursor: { next: "abort-2" } };
      }
      return new Promise(() => {});
    },
  });
  await disposeGateLedger.start();
  const disposeGatePass = disposeGateLedger.reconcile();
  await sleep(10);
  await deadline(disposeGateLedger.dispose(), 1000, "aborted dispose");
  await deadline(disposeGatePass.catch(() => undefined), 1000, "aborted pass");
  equal(disposeGateCalls.length, 2, "a page that never settles ends the pass without reaching later pages");
  equal(
    disposeGateLedger.sessionSnapshot("abort-a"),
    undefined,
    "a page collected before dispose is not emitted after dispose",
  );

  const midPath = join(work, "dispose-mid.jsonl");
  const pageRejector: { reject: ((reason?: unknown) => void) | null } = { reject: null };
  const mid = new UsageLedger({
    path: midPath,
    now,
    listSessions: () =>
      new Promise((_resolve, reject) => {
        pageRejector.reject = reject;
      }),
  });
  await mid.start();
  await mid.handleEvent(usage("mid-row", { input: 5, output: 1 }));
  const midPass = mid.reconcile();
  assert(pageRejector.reject !== null, "the mid-pass page is parked");
  pageRejector.reject?.(new Error("page aborted"));
  const midDispose = mid.dispose();
  await deadline(midPass.catch(() => undefined), 1000, "mid pass settles");
  await deadline(midDispose, 1000, "mid dispose flushes");
  const midRows = readFileSync(midPath, "utf8").split("\n").filter((line) => line.trim().length > 0);
  equal(midRows.length, 1, "a row queued before dispose is on disk after the pass rejects");
  await mid.handleEvent(usage("mid-after", { input: 1, output: 1 }));
  equal(mid.sessionSnapshot("mid-after"), undefined, "no row is recorded after dispose");
  await deadline(mid.dispose(), 1000, "a second dispose resolves");

  const closingPath = join(work, "start-after-dispose.jsonl");
  let closingCalls = 0;
  const closing = new UsageLedger({
    path: closingPath,
    now,
    listSessions: async () => {
      closingCalls += 1;
      return { data: [] };
    },
  });
  await closing.start();
  await deadline(closing.dispose(), 1000, "closing dispose");
  await deadline(closing.start(), 1000, "start after dispose");
  equal(closingCalls, 1, "start after dispose does not reconcile again");
  await deadline(closing.reconcile(), 1000, "reconcile after dispose resolves");
  equal(
    await closing.handleEvent(usage("post-dispose", { input: 5, output: 1 })),
    true,
    "handleEvent after dispose still reports handled",
  );
  equal(closing.sessionCount(), 0, "a post-dispose event records no session");
  assert(!existsSync(closingPath), "a post-dispose event writes no row");

  const secondPath = join(work, "second-start.jsonl");
  let secondCalls = 0;
  const secondStart = new UsageLedger({
    path: secondPath,
    now,
    listSessions: async () => {
      secondCalls += 1;
      return { data: [] };
    },
  });
  await secondStart.start();
  await deadline(secondStart.reconcile(), 1000, "second start first pass");
  const callsAfterFirst = secondCalls;
  appendFileSync(secondPath, `${ledgerRow("late-row")}\n`);
  await secondStart.start();
  equal(secondCalls, callsAfterFirst, "a second start does not reconcile again");
  equal(
    secondStart.sessionSnapshot("late-row"),
    undefined,
    "a second start does not absorb a row appended after the first start",
  );
  await secondStart.dispose();

  const resumeGate = deferred<void>();
  const resumePath = join(work, "resume.jsonl");
  const resume = new UsageLedger({
    path: resumePath,
    now,
    getSession: async () => {
      await resumeGate.promise;
      return { id: "resume", parentID: "resume-parent" };
    },
  });
  await resume.start();
  const resumeEvent = resume.handleEvent(usage("resume", { input: 3, output: 1 }));
  await deadline(resume.dispose(), 1000, "resume dispose");
  resumeGate.resolve();
  equal(await deadline(resumeEvent, 1000, "resume event"), true, "an event that resumes after dispose still reports handled");
  equal(resume.sessionSnapshot("resume"), undefined, "an event that resumes after dispose records no session");
  assert(!existsSync(resumePath), "an event that resumes after dispose writes no row");

  const identityPath = join(work, "identity.jsonl");
  const ledgerA = installUsageLedger({ path: identityPath, now });
  const ledgerB = installUsageLedger({ path: identityPath, now });
  assert(getUsageLedger() === ledgerB, "install replaces the active ledger");
  await clearUsageLedger(ledgerA);
  assert(getUsageLedger() === ledgerB, "clearing the old ledger by handle leaves the new one active");
  await ledgerB.handleEvent(usage("identity-b", { input: 1, output: 1 }));
  equal(ledgerB.sessionCount(), 1, "the newer ledger still records after the old handle is cleared");
  await clearUsageLedger();
  assert(getUsageLedger() === null, "the no-arg clear still clears the active ledger");

  const repo = dirname(dirname(fileURLToPath(import.meta.url)));
  const setup = readFileSync(join(repo, "src", "v2", "setup.ts"), "utf8");
  assert(setup.includes("installUsageLedger"), "the v2 setup installs the ledger");
  assert(setup.includes("usageLedger.handleEvent(raw)"), "the v2 event relay feeds the ledger");
  assert(
    setup.includes("listSessions: (input) => ctx.session.list(input)"),
    "the v2 setup forwards the host-shaped page request",
  );
  assert(setup.includes("clearUsageLedger(usageLedger)"), "the v2 cleanup disposes its own ledger");
  assert(setup.includes("clearUsageShadow(usageShadow)"), "the v2 cleanup clears its own shadow");
  assert(setup.includes("clearSessionBridge(sessionBridge)"), "the v2 cleanup clears its own bridge");
  const bridge = readFileSync(join(repo, "src", "v2", "session-bridge.ts"), "utf8");
  assert(bridge.includes("get: (input) => ctx.session.get(input)"), "the bridge exposes session.get");
  assert(bridge.includes("list: (input) => ctx.session.list(input)"), "the bridge exposes session.list");
  assert(bridge.includes("clearSessionBridge(instance?: SessionBridge)"), "the bridge clear is identity scoped");
  const shadowSource = readFileSync(join(repo, "src", "services", "usage-shadow.ts"), "utf8");
  assert(shadowSource.includes("clearUsageShadow(instance?: UsageShadow)"), "the shadow clear is identity scoped");
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
