# Handoff triage

1. Open the mission board with `show_board()` and read the pending and blocked rows.
2. Read the recent activity with `timeline(view: "recent")` and note the stalled handoff id.
3. Read the record ledger with `record(list: true)` and match the board row to its record.
4. Complete a delivered handoff with `handoff(completeHandoff: "H-001", result: "the delivered result")`.
5. Revert an accepted handoff with `handoff(undo: "H-002")` and put it back in the queue.
6. Reassign a stalled handoff with `handoff(rescue: "H-003", to: "@tester", context: "continue from the checkpoint")`.
7. Record the triage outcome with `record(type: "note", title: "handoff triage", detail: "H-001 completed, H-003 reassigned")`.
