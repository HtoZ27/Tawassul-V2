import {
  dispatchLedgerCount,
  earlyDispatchCount,
  finalizeDispatchFailure,
  finalizeDispatchOnIdle,
  MAX_DISPATCH_SESSIONS,
  noteDispatchLifecycleEvent,
  pendingDispatchCount,
  recordDispatch,
  resetDispatchLedger,
  type DispatchOutcome,
} from "../src/services/dispatch-ledger.ts";

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

type Terminal = { child: string; outcome: DispatchOutcome };

function register(child: string, terminals: Terminal[], parent = "ses_parent", startedAt = Date.now()): void {
  recordDispatch({
    childSessionID: child,
    parentSessionID: parent,
    callID: `call-${child}`,
    targets: ["@dev"],
    startedAt,
    onTerminal: (outcome) => terminals.push({ child, outcome }),
  });
}

function main(): void {
  resetDispatchLedger();
  const success: Terminal[] = [];
  register("ses_child_1", success);
  assert(pendingDispatchCount() === 1, "a registered dispatch is pending");
  finalizeDispatchOnIdle("ses_child_1");
  assert(success.length === 1 && success[0]!.outcome === "completed", "one child idle produces one completion");
  finalizeDispatchOnIdle("ses_child_1");
  assert(success.length === 1, "a duplicate child idle stays one terminal");
  assert(pendingDispatchCount() === 0, "the finalized dispatch is no longer pending");

  resetDispatchLedger();
  const earlyAt = Date.now();
  finalizeDispatchOnIdle("ses_child_2");
  assert(earlyDispatchCount() === 1, "a child idle that beats the ledger write is buffered");
  const early: Terminal[] = [];
  register("ses_child_2", early, "ses_parent", earlyAt - 1000);
  assert(early.length === 1 && early[0]!.outcome === "completed", "the buffered idle finalizes when the entry appears");
  assert(earlyDispatchCount() === 0, "the buffered idle is consumed once");

  resetDispatchLedger();
  const failed: Terminal[] = [];
  register("ses_child_3", failed);
  noteDispatchLifecycleEvent({ type: "session.execution.failed", data: { sessionID: "ses_child_3" } });
  assert(failed.length === 1 && failed[0]!.outcome === "failed", "a failed execution finalizes the dispatch as failed");

  resetDispatchLedger();
  const interrupted: Terminal[] = [];
  register("ses_child_4", interrupted);
  noteDispatchLifecycleEvent({ type: "session.execution.interrupted", properties: { sessionID: "ses_child_4" } });
  assert(
    interrupted.length === 1 && interrupted[0]!.outcome === "interrupted",
    "an interrupted execution finalizes the dispatch as interrupted",
  );

  resetDispatchLedger();
  const succeeded: Terminal[] = [];
  register("ses_child_5", succeeded);
  noteDispatchLifecycleEvent({ type: "session.execution.succeeded", data: { sessionID: "ses_child_5" } });
  assert(succeeded.length === 0, "session.execution.succeeded is not a success carrier");
  finalizeDispatchOnIdle("ses_child_5");
  assert(succeeded.length === 1, "the child idle remains the success carrier");

  resetDispatchLedger();
  const revived: Terminal[] = [];
  register("ses_child_6", revived);
  register("ses_child_6", revived);
  assert(pendingDispatchCount() === 1, "a second dispatch onto a pending child reuses the entry");
  finalizeDispatchOnIdle("ses_child_6");
  assert(revived.length === 1, "the reused entry emits one terminal");

  resetDispatchLedger();
  const replaced: Terminal[] = [];
  register("ses_child_7", replaced);
  finalizeDispatchOnIdle("ses_child_7");
  register("ses_child_7", replaced);
  finalizeDispatchOnIdle("ses_child_7");
  assert(replaced.length === 2, "a later run of the same child emits its own terminal");

  resetDispatchLedger();
  const restarted: Terminal[] = [];
  register("ses_child_8", restarted);
  resetDispatchLedger();
  assert(pendingDispatchCount() === 0 && dispatchLedgerCount() === 0, "a restart drops pending entries");
  assert(restarted.length === 0, "a restart fabricates nothing");

  resetDispatchLedger();
  const deferred: Terminal[] = [];
  register("ses_child_13", deferred);
  finalizeDispatchOnIdle("ses_child_13", [
    {
      kind: "subagent",
      sessionID: "ses_child_13",
      childSessionID: "ses_grandchild",
      agent: "@dev",
      description: "nested work",
    },
  ]);
  assert(deferred.length === 0, "an idle whose child still owns background work is not terminal");
  assert(pendingDispatchCount() === 1, "the deferred dispatch stays pending");
  finalizeDispatchOnIdle("ses_child_13", [{ kind: "shell", sessionID: "ses_parent" }]);
  assert(
    deferred.length === 1 && deferred[0]!.outcome === "completed",
    "the next idle whose background belongs to the parent finalizes the dispatch",
  );

  resetDispatchLedger();
  const earlyDeferred: Terminal[] = [];
  finalizeDispatchOnIdle("ses_child_14", [{ kind: "image", sessionID: "ses_child_14" }]);
  assert(earlyDispatchCount() === 0, "a non-terminal idle is not buffered as an early completion");
  register("ses_child_14", earlyDeferred);
  assert(earlyDeferred.length === 0, "a dispatch recorded after a non-terminal idle stays pending");

  resetDispatchLedger();
  const prefailed: Terminal[] = [];
  const prefailedAt = Date.now();
  noteDispatchLifecycleEvent({ type: "session.execution.failed", data: { sessionID: "ses_child_9" } });
  register("ses_child_9", prefailed, "ses_parent", prefailedAt - 1000);
  assert(
    prefailed.length === 1 && prefailed[0]!.outcome === "failed",
    "a failure that beats the ledger write is buffered and applied once",
  );
  assert(earlyDispatchCount() === 0, "the early failure is consumed once");

  resetDispatchLedger();
  for (let i = 0; i < MAX_DISPATCH_SESSIONS; i++) register(`ses_cap_${i}`, []);
  assert(pendingDispatchCount() === MAX_DISPATCH_SESSIONS, "the ledger holds its full pending capacity");
  register("ses_cap_overflow", []);
  assert(pendingDispatchCount() === MAX_DISPATCH_SESSIONS, "a dispatch at the all-pending cap is refused");

  resetDispatchLedger();
  const evicted: Terminal[] = [];
  register("ses_child_10", evicted);
  finalizeDispatchOnIdle("ses_child_10");
  for (let i = 0; i < MAX_DISPATCH_SESSIONS - 1; i++) register(`ses_fill_${i}`, []);
  assert(dispatchLedgerCount() === MAX_DISPATCH_SESSIONS, "one finalized entry plus pending entries fill the cap");
  register("ses_child_11", evicted);
  assert(pendingDispatchCount() === MAX_DISPATCH_SESSIONS, "a finalized entry is evicted before a pending one");

  resetDispatchLedger();
  const before = pendingDispatchCount();
  finalizeDispatchFailure("ses_child_12", "failed");
  assert(before === 0 && pendingDispatchCount() === 0, "a failure for an unknown child stays buffered, not invented");
  assert(earlyDispatchCount() === 1, "the unknown failure is buffered for a later dispatch");

  resetDispatchLedger();
  const stale: Terminal[] = [];
  finalizeDispatchOnIdle("ses_child_stale", undefined, 1_000);
  assert(earlyDispatchCount() === 1, "an idle for an unregistered child carries its timestamp");
  recordDispatch(
    {
      childSessionID: "ses_child_stale",
      parentSessionID: "ses_parent",
      callID: "call-stale",
      targets: ["@dev"],
      startedAt: 2_000,
      onTerminal: (outcome) => stale.push({ child: "ses_child_stale", outcome }),
    },
    2_500,
  );
  assert(stale.length === 0, "an early terminal older than the dispatch start never completes it");
  finalizeDispatchOnIdle("ses_child_stale", undefined, 3_000);
  assert(stale.length === 1, "the reused child completes exactly once from its own idle");
  finalizeDispatchOnIdle("ses_child_stale", undefined, 4_000);
  assert(stale.length === 1, "the dropped early entry is not replayed");

  resetDispatchLedger();
  const starvedAt = Date.now();
  for (let i = 0; i < MAX_DISPATCH_SESSIONS; i++) {
    finalizeDispatchOnIdle(`ses_foreign_${i}`, undefined, starvedAt);
  }
  assert(earlyDispatchCount() === MAX_DISPATCH_SESSIONS, "the early buffer fills on its own budget");
  finalizeDispatchOnIdle("ses_foreign_overflow", undefined, starvedAt);
  assert(earlyDispatchCount() === MAX_DISPATCH_SESSIONS, "the early buffer stays capped on its own budget");
  const real: Terminal[] = [];
  const realAt = starvedAt + 1;
  recordDispatch(
    {
      childSessionID: "ses_real",
      parentSessionID: "ses_parent",
      callID: "call-real",
      targets: ["@dev"],
      startedAt: realAt,
      onTerminal: (outcome) => real.push({ child: "ses_real", outcome }),
    },
    realAt,
  );
  assert(pendingDispatchCount() === 1, "a full early buffer never starves a real dispatch");
  finalizeDispatchOnIdle("ses_real", undefined, realAt + 1);
  assert(real.length === 1 && real[0]!.outcome === "completed", "the dispatch admitted past a full buffer completes once");

  resetDispatchLedger();
  const survivors: Terminal[] = [];
  const survivorAt = Date.now();
  finalizeDispatchOnIdle("ses_early_keep", undefined, survivorAt);
  for (let i = 0; i < MAX_DISPATCH_SESSIONS; i++) register(`ses_keep_${i}`, []);
  assert(
    pendingDispatchCount() === MAX_DISPATCH_SESSIONS && earlyDispatchCount() === 1,
    "the pending cap fills while the buffered completion survives",
  );
  register("ses_cap_extra", []);
  assert(
    pendingDispatchCount() === MAX_DISPATCH_SESSIONS && earlyDispatchCount() === 1,
    "a dispatch at the pending cap is refused instead of evicting the buffered completion",
  );
  finalizeDispatchOnIdle("ses_keep_0");
  register("ses_cap_extra", []);
  finalizeDispatchOnIdle("ses_keep_1");
  register("ses_early_keep", survivors, "ses_parent", survivorAt - 1);
  assert(survivors.length === 1, "the buffered completion still finalizes once room returns");
  finalizeDispatchOnIdle("ses_early_keep");
  assert(survivors.length === 1, "the completion stays one terminal after the late idle");
}

try {
  main();
  console.log(`PROOF PASS: the dispatch ledger emits exactly one terminal per child and fabricates none (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
