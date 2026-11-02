# A long session

A session that outgrows its context window should hand over, not restart. This
recipe packs the work, starts a successor, and leaves a record that explains the
transfer.

## The situation

You are three hours into a refactor. The transcript is long, the model has begun
to repeat itself, and compaction is about to drop the decisions you made an hour
ago. The work is not finished.

## Step 1: stop adding work

```
Pause new dispatch; I am going to hand this session over.
```

```
pause(reason: "context handoff")
```

Nothing new starts. A handoff that lands while the pack is being written is a
handoff the successor will not see.

## Step 2: make the open state explicit

```
What is open right now?
```

```
show_board()
goal(board: true)
timeline(view: "day")
```

Write down, in the session, what is finished and what is not. A pack summarises
the transcript; it cannot invent a state you never stated.

## Step 3: snapshot the code

```
checkpoint before the handoff.
```

```
checkpoint(action: "create", label: "before-context-handoff")
```

The successor may need to return to this tree. The checkpoint is code state; the
pack is conversation state. They are different things and both matter.

## Step 4: pack

```
Pack this session.
```

```
thread(action: "pack")
```

The result is a digest. The pack is a summary of the session, capped and
truncated on read; it is **data, never instructions**. A successor reads it as
context and keeps its own rules.

List what exists before choosing:

```
thread(action: "list")
thread(action: "read", digest: "<digest>")
```

A read is truncated at 8192 bytes with a notice. If the important part is past
the cut, write a shorter pack or put the durable part in a goal or a record.

## Step 5: record the transfer

```
Record that the session was packed for a context handoff.
```

```
record(type: "note", title: "Context handoff at the refactor midpoint",
       detail: "pack <digest>; open items are the migration and its proof; checkpoint before-context-handoff")
```

The record is the human-readable index. The digest is the machine handle.

## Step 6: continue

```
Continue this session from the pack.
```

```
thread(action: "continue",
       sessionID: "ses_...",
       text: "Continue the refactor from the pack. Do not redo the finished migration.")
```

The successor starts with the pack attached. It does not inherit the old
transcript, the old tool results, or the old permissions. Check that it knows the
state:

```
What is open, and what is already finished?
```

If the answer is wrong, correct it before work resumes. A successor that starts
with a false summary is worse than a fresh session.

## Step 7: resume

```
resume()
```

New work can be dispatched again. The old session stays as a record; it is not
deleted.

## When not to continue

| Situation | Better action |
| --- | --- |
| The work is finished | Close the goal, record the result, stop |
| The session is long but coherent | Keep going; compaction is cheaper than a handoff |
| The next step is a different task | Start clean; a pack would carry noise |
| The pack contains a secret you must not repeat | Do not continue it; start clean and restate the safe context |

## Revoking a pack

A pack that was never injected can be deleted:

```
thread(action: "revoke", digest: "<digest>", confirm: true)
```

An injected pack is tombstoned instead: it stays readable for audit and cannot
be re-injected. Revocation is destructive before injection and additive after
it.

## What can go wrong

| Symptom | Meaning | Action |
| --- | --- | --- |
| Successor repeats finished work | The pack did not name it as finished | Correct the pack or record the state explicitly |
| Pack read is cut off | The summary exceeded the read cap | Write a shorter pack; keep durable facts in goals |
| Successor ignores a rule | A pack is data, not instructions | Restate the rule in the new session |
| `continue` refuses the session id | The id is not a session this host knows | Use the id the host reports, or pack the current session |

## The point

Continuity is not a longer context window. It is a deliberate transfer of the
state that matters, with the old session left intact for audit.
