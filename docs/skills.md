# Skills

A skill is a procedure the model loads when the task matches it. Tawassul ships
sixteen skills, registered in-process. Nothing is copied into `.opencode/skills/`
or into a user skills directory, and an uninstall leaves no skill files behind.

## The shipped skills

| Skill | Use it when | What it walks through |
| --- | --- | --- |
| `tawassul-adversarial-review` | A diff is about to be accepted | Read the board, timeline and goals; write the coverage contract; record findings; open the repair; record the verdict |
| `tawassul-code-explorer` | An unfamiliar area is about to change | Read the board and timeline; record the feature map; hand the traced area to dev |
| `tawassul-codebase-design` | A module boundary is designed or reviewed | Read the board; record the module decision; create the depth goal; hand the boundary to dev |
| `tawassul-context-continue` | A session is too long to continue in place | List packs, read the newest, pack the current session, continue it in a successor, and record the transfer |
| `tawassul-diagnosing-bugs` | A failure resists the obvious fix | Read the timeline; record the red loop; rank the causes; open the regression handoff; record the root cause |
| `tawassul-enrich-task` | A request arrives as a sentence or a screenshot | Read the goals and board; create the enriched goal; record the scope and open questions; open the design review |
| `tawassul-goal-review` | Open goals need honest closure | Read the board, open one goal, attach evidence, mark items done, mark criteria met, close |
| `tawassul-handoff-triage` | Handoffs are stale or misrouted | Read the board and timeline, match rows to records, complete delivered work, undo wrong accepts, rescue stalled work |
| `tawassul-incident-response` | A severe regression or host failure lands | Read the board; open the incident; contain; preserve the timeline; close with the watch result |
| `tawassul-integration-engineer` | A change must land inside a running system | Map dependencies, trace execution, verify integration, and check for regressions |
| `tawassul-interface-design` | A user-facing surface is designed or judged | Read the board; record the direction; record the critique; hand the spec to dev |
| `tawassul-retro` | A session went badly | Read the day and board; record the candidates; create the improvement goal; hand the document changes to doc |
| `tawassul-step-back` | Fixes keep stacking on one path | Read the repair history and board; record the reassessment; hand the direction decision to tawa |
| `tawassul-to-tickets` | A goal is too large for one handoff | Read the goals; create the slice goal; record the blocking edges; open the first slice |
| `tawassul-verification-planning` | A non-trivial change is planned | Read the goals; record the claim, failure modes, evidence path and budget; hand off; record the verdict; attach evidence |
| `tawassul-writing-for-agents` | An agent-facing document is written or edited | Read the board; audit the pointer; record the shape; create the rewrite goal; hand off to doc |

Each skill is a short, ordered procedure. It names the tool calls it uses, so the
model can follow it without guessing an argument shape.

## Which skill for which agent

| Agent | Skills |
| --- | --- |
| `tawa` | `tawassul-enrich-task`, `tawassul-to-tickets`, `tawassul-incident-response`, `tawassul-writing-for-agents` |
| `analyst` | `tawassul-enrich-task`, `tawassul-step-back`, `tawassul-incident-response`, `tawassul-to-tickets`, `tawassul-retro` |
| `dev` | `tawassul-diagnosing-bugs`, `tawassul-code-explorer`, `tawassul-codebase-design` |
| `tester` | `tawassul-diagnosing-bugs`, `tawassul-verification-planning` |
| `reviewer` | `tawassul-adversarial-review` |
| `architect` | `tawassul-code-explorer`, `tawassul-codebase-design` |
| `designer` | `tawassul-interface-design` |
| `doc` | `tawassul-retro`, `tawassul-writing-for-agents` |

The four earlier skills stay available to every agent that already used them.

## How skills are delivered

- Skills live in the versioned `skills/` tree and ship inside the bundle.
- Registration happens through the host's in-process transform. A user skill
  with the same name wins.
- A failure while registering one skill is contained: it cannot disable the
  plugin or the other skills.
- Skill descriptions are context. They are measured as a budget line and
  reviewed for clarity, never truncated to a byte target.

## How a skill is evaluated

Every skill is measured by one eval entry: a fixture transcript replayed against
the shipped procedure body, plus a live load rate measured on an isolated host.
The proof stage replays the fixture calls and compares the measured rate with the
threshold the manifest declares.

| Manifest field | Meaning |
| --- | --- |
| `evalId` | The eval entry the skill is measured by |
| `loadRateThreshold` | The share of relevant sessions that must load the skill; `0.5` means at least half |
| `killCriterion` | The rule below the threshold: the skill retires to inline prose |

The numbers live in `skills/manifest.json`, so lowering a threshold is a visible
edit with a proof behind it, never a silent drift.

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

---

[Documentation index](README.md)
