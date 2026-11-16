# Continuity detection

The plugin can tell the difference between a handoff that is still owned by a
live process and one whose owner vanished. Detection is off by default; enable
it with `TAWASSUL_CONTINUITY=1` or `continuity.enabled` in the config file. An
explicit `TAWASSUL_CONTINUITY=0` wins over a config that enables it.

## How a run is classified

A non-terminal handoff carries an owner record: pid, process start time, boot
id, heartbeat, and the owning session. The liveness probe compares that record
with the running processes.

| Observation | State |
| --- | --- |
| The owner pid is alive and the heartbeat is fresh | `live` |
| The owner pid is alive but the heartbeat is older than 30 minutes | `stale` |
| The owner pid is gone, the process start time changed, or the boot id changed | `interrupted` with reason `gone` |
| The backend is missing, unreadable, times out, or returns an unparsable value | `unknown`; neither flag is set |

A stale handoff has a live owner, so it is not resumed automatically. A
terminal transition removes the owner record and stops the heartbeat. The probe
runs after initialization and on session idle, debounced to once per minute for
the same owner.

## Action precedence

Several tools can move work forward. Use the action that matches the state of
the work, not the one with the shortest name.

| Action | Scope |
| --- | --- |
| `handoff(resumeInterrupted)` | Reopens an interrupted handoff after its owner is gone; requires continuity to be enabled |
| `handoff(rescue)` | Force-reassigns a stalled handoff to another agent |
| `thread.continue` | Moves a session to a successor with a context pack |
| `task_control.revive` | Resumes a child subagent |
| `resume` | Resumes the workflow pause state |

`handoff(resumeInterrupted)` is not a general retry. It refuses a handoff that
is not interrupted, a terminal handoff, and a stale handoff. The caller must be
the sender or `analyst`. `handoff(rescue)` is the verb for a live owner that
stopped making progress; it closes the original without a completion credit and
creates a new pending handoff for the new agent.

`resume` controls the workflow pause state. It does not reopen a handoff;
`handoff(resumeInterrupted)` does. `thread.continue` and
`task_control.revive` act on a session and a subagent respectively, so they do
not change a handoff ledger entry.

---

[Documentation index](README.md)
