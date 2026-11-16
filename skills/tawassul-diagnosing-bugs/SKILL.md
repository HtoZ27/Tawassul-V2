# Diagnosing bugs

A failure that survives the obvious fix is a missing observation, not a hard problem. Build the loop that shows the failure, rank the causes that could explain it, and probe them in order.

## Red loop

One command, run from a clean state, that breaks for the intended reason in seconds. A loop that breaks for a different reason sends the investigation somewhere else. Save the command in the record ledger.

## Minimise

Cut the input, the call path and the setup until the loop is as small as it goes while still breaking. The smallest loop names the module that owns the defect.

## Ranked hypotheses

List three to five falsifiable causes, each with the observation that would rule it out. Order them by the evidence already in hand: the stack, the diff, the recent change, the environment.

## Probes

Tag every temporary probe with a marker so cleanup is mechanical. Read the value rather than inferring it. Remove the probes after the fix; a probe left behind is future confusion.

## The fix and the seam

Repair the cause at a real seam rather than at the symptom. The regression test lands beside the fix and breaks on the old code. State which layer the seam sits in and why the test belongs there.

## Evidence

Record the cause, the fix, the command that used to break and now passes, and the regression test. A fix without the loop is a guess that happened to work.

## Procedure

1. Read recent activity with `timeline(view: "recent", limit: 20)` and note the change that touched the failing path.
2. Record the red loop with `record(type: "note", title: "red loop", detail: "the exact command and the observed failure")`.
3. Record the ranked causes with `record(type: "note", title: "ranked hypotheses", detail: "falsifiable causes ordered by the evidence")`.
4. Open the regression handoff with `handoff(to: "@tester", task: "add the regression test at the seam", context: "the reproduction command and the ranked causes are in the record ledger")`.
5. Record the repair with `record(type: "fix", title: "root cause", detail: "the cause, the fix and the regression evidence", severity: "moderate")`.

## When to skip

A failure with a known cause and a one-line repair.
