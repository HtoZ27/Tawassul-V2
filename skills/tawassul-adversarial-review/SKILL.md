# Adversarial review

Assume the change is broken and set out to show where. A review that reads the diff and nods is worse than no review, because it turns an unexamined change into an approved one.

## Stance

- Hunt for the defect rather than confirm the intent.
- A finding names a file, a line, and a concrete input or state that misbehaves.
- A finding with no reproduction path is a question, not a finding.
- The author's explanation is context, not evidence.

## Coverage contract

Every changed file is reviewed or named as skipped with a reason. The coverage note separates a partial review from a complete one. A file left out silently turns the verdict into a guess.

## The eight attack dimensions

1. Assumptions: which input, caller or ordering the change takes for granted.
2. Input handling: empty, oversized, malformed, encoded and hostile values.
3. Error paths: a thrown error, a rejected promise, a timeout, a partial write.
4. State and concurrency: two callers, a retry, a reordered event, a stale cache.
5. Boundaries and permissions: a caller outside the intended role, a path outside the intended root.
6. Data integrity: a half-applied migration, a lost update, a duplicated side effect.
7. The weakened bar: a silenced check, a loosened threshold, a skipped case, an easier test, a deleted assertion.
8. Tests that prove nothing: a test that passes against the old code, or asserts the mock.

## Fact-check gate

Drop a finding on a named ground: the line was misread, an upstream guard already blocks the input, the path is unreachable, or the behaviour is intended and documented. A hunch is not a ground. Keep the rest.

## Rounds

Three rounds of findings, then stop. A fourth round needs a new fact rather than another reading of the same diff. Diminishing gains are the signal to write the verdict.

## Verdict

Close with one of two words and the grounds. Safe means the change survives the dimensions above at its current scope. Not safe means a finding stands and the repair is named. The verdict goes in the record ledger so the acceptance decision stays auditable.

## Procedure

1. Read the mission board with `show_board()` and note the work in flight around the same files.
2. Read recent activity with `timeline(view: "recent", limit: 20)` to see what the change was meant to repair.
3. Read the open objectives with `goal(list: true)` and match each changed file to the criterion it serves.
4. Record the coverage contract with `record(type: "note", title: "review coverage", detail: "every changed file reviewed or listed as skipped with a reason")`.
5. Record the findings with `record(type: "fix", title: "review findings", detail: "file, line, failing input and severity for each finding", severity: "moderate")`.
6. Open the repair handoff with `handoff(to: "@dev", task: "repair the review findings", context: "the coverage note and the findings record carry the repair brief", files: ["src/index.ts"])`.
7. Record the verdict with `record(type: "note", title: "review verdict", detail: "safe or not safe, with the grounds for the verdict")`.

## When to skip

A one-line change with no behavioural surface: a comment, a version bump, a formatting pass.
