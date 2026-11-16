# Verification planning

Name the claim and the evidence that would establish it ahead of the implementation. A plan written after the change tends to describe what the change does rather than what the claim needs.

## The claim

One sentence: the observable that changes for a caller. "The tool reports the new field" is a claim; "the code is cleaner" is not.

## Failure modes

How the claim could be false while the change looks complete. Typical modes: the path is unconnected, the default masks the new value, the error branch swallows the result, the old caller still reads the old shape.

## Evidence paths

Cheapest first: an existing gate, a targeted test, a direct command, a recorded run, a live session. Name the path and what it proves. A path that does not distinguish the claim from its opposite is not evidence.

## Budget

One owner per claim, a time box, and the point where the evidence is enough. Verification expands to fill the time available when the stopping point is left implicit.

## Verdicts

Three words: established, limited, refuted. Limited names what remains unverified and why. Refuted reopens the claim rather than the test.

## Close against the claim

Mark the criterion against the sentence written at the start. A rewritten claim is a new plan, not a passed check.

## Procedure

1. Read the open goals with `goal(list: true)` and note the criterion the change serves.
2. Record the plan with `record(type: "note", title: "verification plan", detail: "claim, failure modes, evidence path, budget and owner")`.
3. Open the implementation handoff with `handoff(to: "@dev", task: "implement the planned change", context: "the verification plan is in the record ledger")`.
4. Record the result with `record(type: "note", title: "verification result", detail: "established, limited or refuted, with the evidence")`.
5. Attach the evidence with `goal(evidence: "G-001", evidenceText: "the claim is established by the recorded run")`.

## When to skip

A change whose evidence is the existing gate and nothing else.
