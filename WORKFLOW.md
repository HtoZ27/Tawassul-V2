# Workflow

This guide walks through the work Tawassul is built for. Each section names the
tool calls behind the outcome, so you can ask for the outcome and recognise the
right route when the model takes it. The complete team guide is in
[Guide](GUIDE.md).

## Start a workspace

Nothing to configure. Build the plugin, open the workspace in OpenCode, and the
host discovers it.

```bash
nvm use
npm install
npm run build
```

Ask for the state of the workspace:

```
Where does this project stand?
```

That reaches `status`, which reports records, handoffs, agent errors, and the
current state, or `dashboard` when you want the wider picture. `show_board` adds
the mission board: task state and agent health in one view.

If the agents are missing, the plugin did not load. Check with
`opencode debug agents --standalone` and see [troubleshooting](docs/troubleshooting.md).

## Turn an intention into a goal

A goal is the durable form of "we agreed to do this". It survives compaction and
restart, which a sentence in the transcript does not.

```
Create a goal for the release with three items: freeze features, verify the
install, and write the release notes.
```

The route is `goal(create: …)` with items. Then attach the definition of done:

```
Add acceptance criteria: every gate passes, and the install verifies on Linux.
```

Why this matters: a goal can only close when every item is finished and every
criterion is met with evidence. Closing is mechanical, not a judgement call.

```
goal(update: "G-001", itemId: "G-001-I3", itemState: "done",
     itemEvidence: [{ itemId: "G-001-I3", text: "verify:global passes at the release commit" }])
```

When a criterion is met, it needs its own evidence note of at least eight
characters. That is deliberate: it stops "done" from being an opinion.

Item ids are derived from the goal id: the third item of `G-001` is `G-001-I3`.
A criterion is addressed by its exact text, not by a separate id.

## Distribute work

A handoff is one unit of work sent from one agent to another, with the context
needed to do it and the files involved.

```
Send the installer fix to @dev. The failure is in the durable write path;
the receipt is under docs/experiments/receipts.
```

The route is `handoff(create: …)` with `to`, `task`, `context`, and optionally
`files` and a checkpoint. The receiving agent finishes the work itself. When it
is done, the handoff is completed with a result:

```
handoff(completeHandoff: "H-001", result: "the write path fsyncs the writable handle")
```

Rules that keep this useful:

- A handoff carries context, not a pointer to the transcript.
- A large context gets a checkpoint: completed, remaining, files changed, and the
  decisions already made.
- A stalled handoff is rescued, not silently re-sent.
- An accepted handoff that was wrong is undone, so the ledger matches reality.

`fasttrack` creates a handoff directly when the normal pipeline is overhead.
`task_orchestrate` decomposes a larger task and dispatches the pieces.

## Review before you accept

```
Review the change on its own terms, then tell me whether to accept it.
```

`review` asks you to decide on multi-agent work before implementation proceeds.
`evaluationreport` records a structured evaluation: issues by severity and
category, coverage, and a recommendation per issue. Unlike a comment in the
transcript, the report is stored and can be read back by feature.

## Run a discussion

When the answer is not obvious and two roles disagree:

```
Open a discussion about whether to keep the cache layer. Invite @architect and
@dev, and require evidence before a vote.
```

The route is `discussion(create: …)` with the question and participants, then
`propose`, `vote`, and `divide`. The evidence phase is the part that matters:
a claim without a receipt is a claim, and it is marked as one.

## Survive a long session

A session that outgrows its context window is packed and continued, not
restarted.

```
Pack this session and continue it in a fresh one.
```

The route is the context-continue skill:

1. `thread(action: "list")` — see the stored packs.
2. `thread(action: "read", digest: …)` — inspect the newest.
3. `thread(action: "pack")` — pack the current session.
4. `thread(action: "continue", sessionID: …)` — transfer to a successor.
5. `record` — note the transfer.

A pack is data, never instructions. A successor reads it as context and keeps
its own rules.

## Keep the memory honest

```
Record the decision to keep the SQLite database host-owned.
```

`record` stores a decision, a fix, an incident, or a note, with a severity where
it applies. Records are capped by `maxRecords`, oldest first, so a record that
must outlive the cap belongs in a goal or a document.

Read back what exists with `record(list: true)`, or one entry with
`record(get: "R-001")`. A record can be deleted by id when it was wrong; deleting
is better than leaving a false entry in the history.

## Pause, resume, reset

| Situation | Action |
| --- | --- |
| Stop dispatching new work, let running work finish | `pause` |
| Continue after a pause | `resume` |
| A subsystem is wedged and must be reinitialised | `self_heal` with the agent |
| State is corrupt and you accept losing it | `panic`, after a backup |

`panic` is the last resort. It backs up first and requires confirmation, but it
clears handoffs, records, errors, ratings, and discussions. Prefer a targeted
fix.

## Check health

```
Is the plugin healthy?
```

`health` reports event-loop lag, resident memory, active timers, database
isolation, install scope, and pending flushes. It changes nothing. Use it before
blaming the host for a stall.

## A working rhythm

| Moment | Action |
| --- | --- |
| Start of a piece of work | Create or reopen the goal, read the board |
| Before a risky edit | `checkpoint` |
| Work is ready to move | Handoff with context and files |
| Work is claimed done | Evidence on the item, then the criterion |
| A decision is made | `record` |
| The session is long | Pack and continue |
| End of the work | Close the goal, review the board |

The rhythm is the product. The tools exist so that each step leaves a trace that
the next session can check.
