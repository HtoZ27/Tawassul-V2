# Step back

Stop adding fixes and reassess the direction. The signal is a repair that makes the next repair more likely: a shim beside an old path, a second special case in the same branch, a diff that grows with every review round.

## Drift signals

- The same function is repaired three times in one session.
- A compatibility layer appears beside the path it protects.
- A parallel new path starts while the old one stays live.
- The diff grows faster than the findings shrink.
- Every fix needs a follow-up fix to stay green.

## Three questions

1. Is the goal still the goal the work started from.
2. Would a fresh start build this the same way.
3. What does the cleaner path cost now, against what the current path costs over the next change.

## Escalation

Present the reassessment in four lines: where the work is heading, why it drifted, the cleaner alternative, and the recommendation with its cost. A reassessment that names no alternative is a complaint.

## Decide without stalling

One reassessment per drift episode. The user decides between the current direction and the cleaner one. Record the decision so the next session inherits it rather than rediscovering the drift.

## Procedure

1. Read the repair history with `timeline(view: "recent", limit: 30)` and count the fixes on the same path.
2. Read the mission board with `show_board()` and note what the current direction is holding open.
3. Record the reassessment with `record(type: "decision", title: "direction reassessment", detail: "the drift, the cleaner alternative and the recommendation with its cost")`.
4. Open the decision handoff with `handoff(to: "@tawa", task: "decide the direction", context: "the reassessment and its grounds are in the record ledger")`.

## When to skip

A single fix with no repair history.
