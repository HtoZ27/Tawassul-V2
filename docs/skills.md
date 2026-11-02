# Skills

A skill is a procedure the model loads when the task matches it. Tawassul ships
four skills, registered in-process. Nothing is copied into `.opencode/skills/` or
into a user skills directory, and an uninstall leaves no skill files behind.

## The shipped skills

| Skill | Use it when | What it walks through |
| --- | --- | --- |
| `tawassul-context-continue` | A session is too long to continue in place | List packs, read the newest, pack the current session, continue it in a successor, and record the transfer |
| `tawassul-goal-review` | You want the open goals closed honestly | Read the board, open one goal, attach evidence, mark items done, mark criteria met, close |
| `tawassul-handoff-triage` | Handoffs are stale or misrouted | Read the board and timeline, match rows to records, complete delivered work, undo wrong accepts, rescue stalled work |
| `tawassul-integration-engineer` | A change must land inside a running system | Map dependencies, trace execution, verify integration, and check for regressions |

Each skill is a short, ordered procedure. It names the tool calls it uses, so the
model can follow it without guessing an argument shape.

## How skills are delivered

- Skills live in the versioned `skills/` tree and ship inside the bundle.
- Registration happens through the host's in-process transform. A user skill
  with the same name wins.
- A failure while registering one skill is contained: it cannot disable the
  plugin or the other skills.
- Skill descriptions are context. They are measured as a budget line and
  reviewed for clarity, never truncated to a byte target.

## Invoking a skill

Ask for the outcome, or name the skill:

```
Use tawassul-handoff-triage and close the stale handoffs.
```

The host exposes the skill list to the model; the full procedure is loaded only
when the model chooses it. That keeps the standing cost to the description.

## Writing your own

A skill is a Markdown procedure plus an entry in `skills/manifest.json`. The
manifest carries the name, description, scope, and the tools the procedure
uses; the registered description is checked against that manifest. Keep the
description specific: it is the only text the model sees before deciding to
load the body. State the trigger conditions, not the implementation.

Do not use a skill to hide a permission change. Skills carry procedure; tool
access is declared where permissions are declared.
