# Goal to merge

A change is easy to start and hard to finish. This recipe keeps one objective
alive across a handoff, a review, and a restart, then closes it only when the
evidence exists.

## The situation

`bun scripts/install-global.ts --verify` fails on a fresh build. The install is
otherwise working, so the change is small but the release is blocked. You want a
record that survives the session.

## Step 1: make the objective durable

Ask for a goal with items and a definition of done.

```
Create a goal for the installer verify failure. Items: reproduce it, fix the
hash check, verify the install. Acceptance: the verify passes on a clean build,
and the fast gate stays green.
```

The route is:

```
goal(create: "Installer verify fails on a fresh build",
     items: ["Reproduce the failure", "Fix the hash check", "Verify the install"],
     acceptance: ["verify:global passes on a clean build",
                  "gate:fast stays green"])
```

The tool returns a goal id. Call it `G-001` here.

## Step 2: reproduce before changing anything

```
Show me the failure, then snapshot the tree.
```

Two things happen:

```
bash(command: "bun scripts/install-global.ts --verify")
checkpoint(action: "create", label: "before-installer-fix")
```

The failed output is the reproduction. The checkpoint is the way back if the fix
makes it worse. A fix without a reproduction is a guess.

## Step 3: hand the work over

```
Send the hash check to @dev. The failure is in the verify path; the reproduction
is above, and the checkpoint is before-installer-fix.
```

The route is:

```
handoff(to: "@dev",
        task: "Repair the installer hash check so verify passes on a clean build",
        context: "verify fails after a fresh build; the marker hash and the bundle hash disagree",
        files: ["scripts/install-global.ts"],
        checkpoint: { completed: ["reproduced the failure"],
                      remaining: ["fix the hash comparison", "verify on a clean build"],
                      filesChanged: [],
                      decisions: [{ title: "no installer rewrite",
                                    detail: "repair the check, keep the write path" }] })
```

The handoff carries the reproduction and the decision already made. It does not
carry a pointer to the transcript.

## Step 4: get the result

When the work is done, the handoff is completed with a result:

```
handoff(completeHandoff: "H-001",
        result: "the marker is compared to the bundle hash before the rebuild; verify passes")
```

If the result is wrong, `handoff(undo: "H-001")` puts it back in the ledger
instead of pretending it never happened. If the agent stalls, rescue it with a
new context; do not silently create a duplicate.

## Step 5: attach evidence

A done item needs evidence. A met criterion needs its own evidence.

```
goal(update: "G-001", itemId: "G-001-I2", itemState: "done",
     itemEvidence: [{ itemId: "G-001-I2", text: "verify passes at commit 1b702d7" }])
goal(update: "G-001", acceptId: "verify:global passes on a clean build", acceptState: "met",
     acceptEvidence: "verify:global prints a hash match on a clean build")
```

Evidence is at least eight characters and is deduplicated. "done" alone is not
evidence.

## Step 6: record the decision

```
Record that the installer compares the marker to the bundle before rebuilding.
```

```
record(type: "fix", severity: "moderate",
       title: "Installer verifies before rebuilding",
       detail: "the verify path compares the marker hash to the built bundle hash; it does not trust a stale marker")
```

A record is for the next person, including you after a restart. It is not a
substitute for the commit message.

## Step 7: close

```
Close G-001.
```

The close is mechanical. If an item is unfinished or a criterion is unmet, it
refuses. With every item done and every criterion met:

```
goal(close: "G-001")
```

Then check the board and the timeline:

```
show_board()
timeline(view: "agent", agent: "@dev")
```

## What can go wrong

| Symptom | Meaning | Action |
| --- | --- | --- |
| Close refused: item pending | Work is not finished | Finish it, or drop the item with evidence |
| Close refused: criterion unmet | No evidence note | Add the evidence, then the state |
| Handoff stuck | The agent never started | Rescue it with a narrower context |
| Verify still fails | The fix missed the path | Restore the checkpoint and reproduce again |

## The point

The commit is the change. The goal, the handoff, and the record are why the next
session can trust it without replaying the transcript.
