# Incident response

Stabilise first, explain later. An incident is a failure with a shared blast radius: a broken host, a corrupted state root, a gate that blocks every session, a regression that reaches users.

## Classify

Write three facts: severity, blast radius and owner. Severity follows the blast radius rather than the noise. The owner is one agent, named in the record.

## Contain

Take the smallest action that stops the spread: pause the workflow, cancel pending handoffs, rescue a stalled one, disable the failing path, or stop the host. One action at a time, each verified ahead of the next.

## Preserve evidence

Capture the timeline, the records, the diff, the version and the failing command ahead of cleanup. Evidence lost to a restart is the usual reason a postmortem explains nothing.

## Communicate

One status line with three parts: what is broken, what is contained, and when the next update lands. Silence reads as an uncontrolled incident.

## Mitigate and verify

Repair one cause at a time and verify each against the critical path. A mitigation that moves the failure is a new incident, not progress.

## Recover and watch

Recovery is a state, not an announcement. Check health, the critical path and the gate that broke, then keep a watch window open for the recurrence.

## Close

Close with a blameless summary: the trigger, the contributing conditions, the repair, the watch result, and follow-ups that each carry an owner. Record it as an incident so the history stays searchable.

## Procedure

1. Read the mission board with `show_board()` and note which agents and tasks share the blast radius.
2. Open the incident record with `record(type: "incident", title: "incident opened", detail: "severity, blast radius and owner", severity: "severe")`.
3. Open the containment handoff with `handoff(to: "@tawa", task: "contain the blast radius", context: "the incident record carries the severity and the blast radius")`.
4. Read recent activity with `timeline(view: "recent", limit: 20)` and preserve the evidence ahead of cleanup.
5. Close the incident record with `record(type: "incident", title: "incident closed", detail: "recovery evidence, the watch window and the follow-ups", severity: "moderate")`.

## When to skip

A local failure with no shared blast radius.
