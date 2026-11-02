# Review a change

A review is a decision with evidence, not a reading of the diff. This recipe
produces a stored evaluation, a user decision, and a handoff for anything that
must change.

## The situation

A branch adds a model fallback to the agent roster. The diff is small, the
behaviour is not: a wrong fallback can pin an agent to a model the project does
not budget for.

## Step 1: see the shape before the lines

```
What does this branch change, and how large is it?
```

```
gitdiff(summary: true)
gitdiff(commit: "HEAD~1")
```

The summary gives files and line counts. The full diff gives context. Read the
diff before reading the files; it tells you which files deserve a full read.

## Step 2: read the files that matter

```
Read the changed files and the tests beside them.
```

```
batchread(paths: ["src/services/model-failover.ts",
                  "src/services/model-failover.test.ts",
                  "docs/agents.md"])
```

`batchread` returns the files in one call. `readsymbol` is better when one
function is the subject and the file is large.

## Step 3: check what the project already proves

```
Run the type check, then the fast gate.
```

```
qualityreport(checks: ["typecheck"])
bash(command: "npm run gate:fast")
```

`qualityreport` runs the project's own commands. The gate is the project's
contract: rules, docs, types, configuration, facts, and the proof catalog.

## Step 4: write the evaluation

```
Evaluate the fallback change: every issue, with a recommendation.
```

```
evaluationreport(featureId: "model-fallback",
  summary: "the fallback works for the default roster; two gaps remain",
  issues: [
    { severity: "major", category: "correctness",
      dedupKey: "fallback-no-timeout",
      file: "src/services/model-failover.ts", line: 88,
      description: "the fallback probe has no timeout, so a hung provider delays every agent",
      recommendation: "bound the probe with the same timeout used by the health check" },
    { severity: "minor", category: "completeness",
      dedupKey: "docs-missing-fallback",
      file: "docs/agents.md", line: 40,
      description: "the page describes a fixed model but not the fallback order",
      recommendation: "document the order and the failure behaviour" }
  ],
  recommendations: ["add a proof for the timeout boundary"],
  uncoveredAreas: ["behaviour when every model in the list fails"])
```

The report is stored by `featureId`. It can be read back later, which a comment
in the transcript cannot. Report every issue you find, including the small ones;
a review that lists only the headline defect is a summary, not a review.

## Step 5: ask for the decision

```
Ask me whether to accept the change with these two issues.
```

```
review(agents: ["@reviewer", "@dev"],
       summary: "fallback works; the probe is unbounded and the docs are stale")
```

`review` is the point where a human decides. The plugin does not accept its own
multi-agent work; that would make the review decorative.

## Step 6: route the fixes

If the decision is "fix first", send each issue to the role that owns it:

```
handoff(to: "@dev",
        task: "Bound the fallback probe with the health-check timeout",
        context: "review found an unbounded probe; the evaluation is model-fallback, issue fallback-no-timeout",
        files: ["src/services/model-failover.ts"])
```

Documentation goes to `@doc`; a test gap goes to `@tester`. One handoff per
issue keeps the result verifiable.

## Step 7: record the decision

```
record(type: "decision", title: "Fallback accepted after the timeout fix",
       detail: "the probe is bounded; the docs page names the order; the remaining risk is a total provider outage")
```

The record is what a future reader finds. The commit says what changed; the
record says why it was allowed.

## What can go wrong

| Symptom | Meaning | Action |
| --- | --- | --- |
| `gitdiff` shows nothing | The change is unstaged or in another worktree | Check the branch and the working tree |
| The type check passes, the gate fails | Docs, facts, or a proof drifted | Read the failing step, not the whole log |
| Evaluation has no issues | Suspicious for a behavioural change | Check the tests, the failure path, and the docs |
| Review accepted, then a regression | The evidence was incomplete | Undo the handoff and reopen the evaluation |

## The point

A review that ends in "looks good" leaves nothing behind. A review that ends in
a stored evaluation, a recorded decision, and a bounded fix leaves a trail the
next change can follow.
