# Guide

This guide is for the person using Tawassul, not the person changing its code.
It covers the team, adding and removing agents, the normal and distributed ways
of working, parallel comparison, planning, shared memory, write locks, every
tool, and every skill.

The short working rhythm is in [Workflow](WORKFLOW.md). The exact tool list
is in [Tools](docs/tools.md). The roster reference is in [Agents](docs/agents.md), and the
skill reference is in [Skills](docs/skills.md).

## What you are running

Tawassul is an OpenCode plugin that turns a workspace into a small team runtime.
It gives the host eight base agents, a durable plan, a handoff ledger, shared
memory, write locks, and a set of tools and skills. You speak naturally; the
model chooses the tool.

Three layers carry the work:

| Layer | Question it answers | Surface |
| --- | --- | --- |
| Plan | What did we agree to finish? | `goal`, `show_board` |
| Execution | Who is doing which piece now? | `handoff`, `task_orchestrate`, `timeline` |
| Evidence | Why do we believe it is done? | `record`, `evidence`, `evaluationreport` |

It is not an autopilot. There is no background daemon, no automatic merge, and no
automatic call to an external service; `web` and `imagegen` reach outside only
when an agent calls them. The only automatic request is a probe of the local
OpenCode host to discover its models. Every result is produced by an agent turn
that you or another agent started.

## Before you start

Tawassul runs inside OpenCode. Project scope needs no installer: build the
plugin in the workspace and the host discovers `.opencode/plugins/tawassul.js`.
Global scope installs one file for every workspace and has its own verification
pass. The exact commands, prerequisites, and platform notes are in
[Installation](docs/installation.md).

After the plugin loads, run `health()` and `check()`. If either one reports a
problem, fix it before you add agents or dispatch work.

Write your requests in Arabic or English. Tool names and arguments (`handoff`,
`parallelCopies`, `@addagent`) stay in English; the prose around them does not.

## The base roster

The plugin ships eight agents. Seven are specialists; `tawa` is a router that
activates only when you ask for it.

| Agent | Role | Starts work when | Writes files |
| --- | --- | --- | --- |
| `tawa` | Experts' intermediary | You mention `@tawa` or ask for distribution | No; read-only |
| `dev` | Developer | Implementation, bug fixing, performance work | Yes |
| `analyst` | Strategic advisor | Analysis, risk, model choice, supervision | No |
| `tester` | Tester | Testing and verification | Yes |
| `reviewer` | Reviewer | Code review and security review | No |
| `architect` | Architect | Structure, technology choice, design review | No |
| `designer` | UI/UX designer | Interfaces, mockups, prototypes, wireframes | No |
| `doc` | Documentation writer | Guides, references, release notes | Scoped |

Every specialist is told to finish the task itself. A specialist does not bounce
work back to `tawa`, and does not dispatch implementation work to another agent.

The base roster is the product. Any agent whose name is `<base>-<suffix>` is a
variant that someone added. For example, a workspace that added a Gemini
reviewer and a Mimo developer will show `reviewer-gemini` and `dev-mimo` beside
the base names. Those are real additions, not shipped defaults. Read the live
roster with `check()` instead of assuming a count.

Each specialist selects a model by task complexity. A role can be pinned to one
model, or given an ordered list with fallbacks. `check()` shows the model each
agent is running now.

## Roles in detail

Each role has a concept, a capability, and a set of skills. The capability is the
default for the role: a variant such as `dev-mimo` carries the capability of its
base role, and `reviewer-gemini` stays read-only like `reviewer`.

### `tawa` — the intermediary

`tawa` is the router. It activates only when you mention it, or when you ask for
the work to be distributed. Its job is to turn an intention into a plan, send
each slice to the right specialist, and read the results back.

What it does:

- Confirms the plan in plain words before dispatching.
- Uses its `enrich-task` procedure to turn a sentence into a goal with items
  and acceptance criteria.
- Uses its `to-tickets` procedure to slice a goal that is too large for one
  handoff.
- Dispatches with `handoff`, `task_orchestrate`, or `moa`.
- Collects the completed handoffs, summarises them, and reports in your
  language.

What it will not do: edit a file, run a write command, add or remove an agent,
pause or reset the system, or hand work to itself. It is read-only by design.
If you want the work done rather than routed, address the specialist directly.

Skills: `tawassul-enrich-task`, `tawassul-to-tickets`,
`tawassul-incident-response`, `tawassul-writing-for-agents`.

### `dev` — the implementer

`dev` is the only role whose primary output is a changed workspace. It reads
before it writes, implements, fixes defects, and works on performance.

What it does:

- Traces the feature before changing it, so the edit lands in the right place.
- Implements the change and runs the checks that cover it.
- Fixes a bug from a reproduction, not from a guess.
- Reports what it changed and what it did not.

What it will not do: accept its own change as reviewed. A verdict belongs to
`reviewer`, and a release verdict belongs to `tester`.

Skills: `tawassul-diagnosing-bugs`, `tawassul-code-explorer`,
`tawassul-codebase-design`. Capability: edits and shell allowed.

### `analyst` — the strategic advisor

`analyst` answers "should we, and in what order" rather than "how do we type
it". It is the role you use when the cost of the wrong direction is higher than
the cost of a pause.

What it does:

- Compares options and names the risk of each.
- Supervises quality: what is missing, what is unverified, what is assumed.
- Chooses a model for a task, or explains why the current one is wrong.
- Runs a retro or a step-back when a path keeps failing.

What it will not do: write code or documentation. It has a read-only shell
allow-list for diagnostics. Capability: no edits.

Skills: `tawassul-enrich-task`, `tawassul-step-back`,
`tawassul-incident-response`, `tawassul-to-tickets`, `tawassul-retro`.

### `tester` — the verifier

`tester` owns the question "does it actually work, including at the edges". It
turns a claim into a test and a test into evidence.

What it does:

- Writes the test plan and the edge cases before running anything.
- Reproduces a failure, then confirms the fix against the reproduction.
- Writes regression tests so the defect cannot return silently.
- Attaches the evidence a goal needs to close.

What it will not do: judge style or architecture. It verifies behaviour.
Capability: edits and shell allowed, normally scoped to tests.

Skills: `tawassul-diagnosing-bugs`, `tawassul-verification-planning`.

### `reviewer` — the adversarial reader

`reviewer` reads a change as if it were about to break production. It is the
cheapest place to catch a defect, because it runs before the merge.

What it does:

- Reads the diff line by line, with the surrounding code.
- Looks for the security and correctness failures the author is blind to.
- Writes a coverage contract and records findings with file and line.
- Ends with a verdict: safe, or not safe, with the reason.

What it will not do: rewrite the change. A review that edits the code is no
longer an independent review. Capability: read-only.

Skill: `tawassul-adversarial-review`.

### `architect` — the boundary designer

`architect` decides where a seam belongs and what crosses it. It is the role for
"this is getting tangled" and "which of these two structures survives growth".

What it does:

- Explores the current structure before proposing a new one.
- Chooses the seam, and states what each side may know about the other.
- Tests the design for depth: is the interface small and the behaviour hidden.
- Records the decision so the next change does not re-litigate it.

What it will not do: implement the design. It produces the decision and the
seam; `dev` produces the code. Capability: read-only.

Skills: `tawassul-code-explorer`, `tawassul-codebase-design`.

### `designer` — the interface designer

`designer` owns the user-facing surface: what it says, how it is arranged, and
whether a person can use it without being taught.

What it does:

- Sets the direction before any markup is written.
- Produces mockups, wireframes, and prototypes.
- Scores the result against a rubric instead of a taste.
- Hands a concrete spec to `dev`.

What it will not do: implement the interface by default. Capability: read-only.

Skill: `tawassul-interface-design`.

### `doc` — the writer

`doc` turns a decision, a fix, or a release into text another person can follow.
It is the role that keeps the repository honest after the code lands.

What it does:

- Writes guides, references, release notes, and agent-facing documents.
- Audits a document for stale claims and broken pointers.
- Runs the retro document and the agent-facing rewrite.
- Keeps the canonical language consistent.

What it will not do: edit code. Its write scope is documentation. Capability:
scoped edits.

Skills: `tawassul-retro`, `tawassul-writing-for-agents`.

## Read the team before you change it

```
Check the team configuration before I add anything.
```

The route is `check()`. It reports every agent, its capability, its current
model, recent errors, and dropped handoffs. Run it before and after every roster
change.

Four more surfaces answer different questions:

| Question | Tool |
| --- | --- |
| Are the agents healthy, and is any task on a board? | `show_board` |
| Is the plugin itself healthy (event loop, memory, database, install scope)? | `health` |
| What happened, and when? | `timeline` |
| What does the session ledger say? | `status` |

A variant can be reported as `has no model configured`. That means the agent
exists in the roster but has no pinned model, so it inherits the caller's model —
the agent that dispatched the work. It is not an error, but it is a reason to pin
the model with `agentModels` before relying on it.

## Add an agent

Typing `@` in the message box opens the agent picker. Choose `addagent` from the
list, then write the command after it:

```
@addagent reviewer with model gemini from google
```

The shape is `<spec> [<spec> ...] with model <model> from <provider>`. One spec
adds one agent; several specs add a group on the same model.

Four forms cover almost every case:

| You want | Say | Result |
| --- | --- | --- |
| A second reviewer on another model | `@addagent reviewer with model gemini from google` | `reviewer-gemini`; base `reviewer` untouched |
| An explicit variant name | `@addagent reviewer-ling with model ling from opencode` | `reviewer-ling` |
| A group on one model | `@addagent reviewer tester with model gemini from google` | `reviewer-gemini` and `tester-gemini` |
| The whole team on one model | `@addagent all with model gemini from google` | Seven variants, one per specialist; `tawa` excluded |

The suffix is not free text. It must be a known model suffix: a catalog alias
such as `gemini`, `ling`, `mimo`, or a token the named provider lists. An
invented name such as `reviewer-fast` is rejected, and the error lists the
suffixes that are allowed.

A bare base name plus a model always derives a variant. The base role is never
modified. This is deliberate: a variant is an addition, and removing it returns
the roster to its previous state.

`tawa` is the exception. `@addagent tawa with model gemini from google` re-points
the router itself; `tawa-<anything>` is blocked.

The model can be an alias (`gemini`, `ling`, `mimo`, `big-pickle`, `deep`,
`minimax`, `ox`, and others) or a full `provider/model`. An unknown alias or an
unknown `provider/model` is rejected with the alias list. A model that resolves
but is missing from the named provider's list is rejected too; if the provider
list cannot be read, it is allowed with a warning. The roster is capped by
`maxDynamicAgents` (default 50); past the cap, the oldest dynamic agents are
dropped.

`@addagent` writes the agent definition and the roster entry in one step, so the
two cannot drift. Generated variants may be config-only. After the change, run
`check()` and confirm the agent, its model, and its capability.

A specialist cannot do this. The roster is a main-session surface: `@dev` and
the other specialists are refused, with a hint that shows the correct line.

Common mistakes:

- Omitting `with model` and `from`; the line needs both parts.
- Inventing a suffix such as `reviewer-fast`; only a known model suffix is
  accepted.
- Adding `tawa-...`; it is rejected by design.
- Re-adding the exact same spec and model; nothing is written.
- Re-adding the same tag with a different model; the entry is updated.

## Remove an agent

Removal runs through the same picker: type `@`, choose `addagent`, then put
`remove` in front of the same shape:

```
@addagent remove reviewer-gemini with model gemini from google
```

Several names remove a group in one line:

```
@addagent remove dev-ling tester-mimo with model gemini from google
```

The name identifies the entry: `remove reviewer-gemini ...` removes that
variant, whatever model the line names. `with model … from …` is still required
by the syntax; for a bare base name or `all`, it supplies the suffix that is
appended to each base role. A specialist that tries it is refused, and the
refusal shows the exact line to run instead.

Rules that protect the team:

- The eight base roles are protected. A bare base cannot be removed.
- `tawa` is never removed.
- Removing two or more agents in one line, including `remove all ...`, shows a
  confirmation card in the main session. Without that confirmation the bulk
  removal fails closed.
- `remove all with model gemini from google` expands to the seven base roles
  tagged with that model (`dev-gemini`, `analyst-gemini`, ...), not to variants
  on other suffixes such as `dev-ling`. `remove all-gemini with model gemini
  from google` is the same expansion for one suffix.
- Removing an agent does not rewrite the handoff ledger. Finish or reassign its
  open handoffs first, then remove it.

After removal, run `check()` and confirm that the base role is still present and
that the variant is gone.

## Two ways to work

| Aspect | Normal mode | Distributed mode (`@tawa`) |
| --- | --- | --- |
| Who receives your message | One specialist, or the main agent | The router |
| Who plans | You, with the specialist | `tawa` decomposes and assigns |
| Who executes | The specialist you addressed | Specialists, through handoffs |
| Who consolidates | You | `tawa`, from the handoff results |
| Writes files | The specialist | The specialists, never `tawa` |
| Best for | One clear task | Several roles, or an unclear task |

In normal mode, `tawa` stays out of the way. You address `@dev`, `@reviewer`, or
another specialist directly, and that specialist finishes the work itself.

In distributed mode, `tawa` follows its own work sequence: understand the
request, confirm the plan in plain words, check that the right agent is
available, dispatch, collect the results, summarise them, and ask what to
change. Goal enrichment and slicing come from its `tawassul-enrich-task` and
`tawassul-to-tickets` procedures, not from an automatic loop.

`tawa` is read-only. It cannot edit files, run write commands, add or remove
agents, or pause the system. It routes, reads, and reports.

Results do not disappear into the router. Each handoff keeps its own result,
and `show_board`, `timeline`, and `handoff` show where it stands.

## Where teamwork saves time

Parallel work saves wall-clock time only when the slices are independent. It
never saves correctness; review does that, and rework is what consumes the time
a team was meant to protect.

| Your situation | What the team buys you | What it costs |
| --- | --- | --- |
| One small edit with a clear target | Nothing; do it in normal mode | Coordination you did not need |
| One change, three perspectives | Three independent reads in one window; the disagreements are the value | Three model runs |
| A request whose shape is unknown | `tawa` enriches it into a goal, then slices it; you stop re-explaining the context | One planning round before any code |
| Work that will outlive the session | The goal, the items, and the evidence survive compaction | Discipline on every item |
| A board full of stale handoffs | A triage pass closes the delivered and rescues the stalled | One systematic pass |

The arithmetic is honest: N parallel copies are N model runs. The saving is in
wall-clock time and in the defects caught before a merge, not in tokens. A
comparison that nobody reads is pure cost, which is why the reading steps in the
comparison chapter below matter more than the dispatch call.

What actually saves time, in order of effect:

1. **A goal with criteria.** Most lost time is renegotiating what "done" means.
   A criterion with evidence ends that.
2. **Review before merge.** A defect found by `reviewer` costs one turn; the same
   defect found after release costs a session.
3. **Independent slices in parallel.** Different files, different questions, one
   window.
4. **Recorded decisions.** `record` and shared memory stop the next agent from
   rediscovering the same constraint.
5. **A checkpoint before a risky edit.** Rolling back is faster than repairing.

Where the team does not save time: a strict sequence (`design`, then implement,
then test) gains nothing from parallelism; two writers on one file serialize and
add conflict handling; and a dispatch with no consolidation step leaves you with
several answers and no decision. In those cases, normal mode with one specialist
is faster and cheaper.

A simple rule: if one specialist can finish it in one turn, stay in normal mode.
If the work needs three or more independent perspectives, or the request is
still a sentence rather than a task, use the team.

## The durable plan

A goal is the durable form of "we agreed to do this". It survives compaction and
restart, which a sentence in the transcript does not.

```
Create a goal for the release with three items: freeze features, verify the
install, and write the release notes.
```

Then attach the definition of done:

```
Add acceptance criteria: every gate passes, and the install verifies on Linux.
```

A goal closes mechanically. Every item must be finished, and every criterion
must be met with an evidence note of at least eight characters. That is what
stops "done" from being an opinion.

```
goal(update: "G-001", itemId: "G-001-I3", itemState: "done",
     itemEvidence: [{ itemId: "G-001-I3", text: "verify:global passes at the release commit" }])
```

Item ids are derived from the goal id: the third item of `G-001` is `G-001-I3`.
A criterion is addressed by its exact text. `goal(board: true)` shows progress;
`goal(close: "G-001")` refuses while anything is open.

Use a goal for anything that must outlive the session. Use `record` for a
decision, a fix, an incident, or a note. Use `checkpoint` before a risky edit.

## Compare several agents on one question

This is the feature that makes a team worth the cost. One call can send the same
task to several agents and return their results side by side.

```
Ask @dev to review this diff. Compare three answers: @dev as the primary, plus
two copies to other specialists. Then compare the results.
```

The route is `handoff(create: …)` with `parallelCopies`.

| Argument | Meaning |
| --- | --- |
| `to` | The primary agent; its handoff is the main entry |
| `task`, `context`, `files` | The same work sent to every copy |
| `parallelCopies: N` | N total results: the primary plus N-1 copies to different agents |

`parallelCopies` accepts 2 or more. Without it, the call creates only the primary
handoff. When you ask for a comparison and leave the count open, the assistant is
expected to pass 5. The copies go to different agents, excluding `tawa`, the
caller, and the primary target; you do not name the copies, the router selects
them from the rest of the roster. The practical ceiling is the number of other
agents in the roster, so a small team produces fewer copies than a large one.

What you get:

- Each copy completes independently and stores its own result.
- The aggregated report lists the completed copies side by side, with the count
  and a summary.
- `bestResult` and `bestAgent` are chosen by centroid similarity: the answer
  most similar to the other answers. That is a consensus signal, not a quality
  judgment. Read the differences; do not treat `bestAgent` as the winner.
- The primary handoff is separate from the copies. Its result arrives on its own,
  not inside the aggregated report.

How to read a comparison:

1. Look for the points all agents agree on; those are the stable findings.
2. Look for one agent that found something the others missed; that is the value
   of the extra copies.
3. Look for contradictions; those need a reviewer or a discussion, not a vote by
   similarity.
4. Decide, or hand the comparison to `@reviewer` for a verdict.

Cost and safety: N results are N model runs. Every copy is a real agent turn.
If the copies touch the same files, the file locks serialize the writes; pass
`files` so the ledger knows what is in play. Parallelism helps independent work,
not two writers on one file.

## Automated dispatch

Two tools dispatch without you naming every agent:

| Tool | What it does | What it does not do |
| --- | --- | --- |
| `task_orchestrate` | Splits the task and creates handoffs in a chosen mode | It does not merge the answers |
| `moa` | Sends the task to several agents as a mixture | It does not synthesize a final answer |

Both split the task text on commas, semicolons, and newlines, create the
handoffs, and return a dispatch summary. The actual results live in the
handoffs, which you read with `show_board`, `timeline`, or `handoff`.

`task_orchestrate` with `mode: "auto"` chooses:

| Condition | Mode |
| --- | --- |
| More than five success criteria | `moa` |
| More than three dependencies, or more than five files | `swarm` |
| Everything else | `parallel` |

`swarm` and `moa` default to `dev`, `tester`, and `analyst`. You can pass a
different agent list to `moa`.

Neither tool is a synthesizer. If you need one plan out of several answers, add
a consolidator: ask `@analyst` to merge the results, or open a goal and attach
the chosen plan. Do not expect the dispatcher to decide for you.

## Discuss, propose, vote, divide

A discussion is for a decision with competing fixes, not for open-ended
brainstorming. It requires concrete issues:

| Field | Meaning |
| --- | --- |
| `id` | Issue id |
| `file`, `line` | Where the problem is |
| `type` | The kind of problem |
| `severity` | `critical`, `moderate`, or `low` |
| `message` | What is wrong |

Then `propose` attaches a solution to an issue, `vote` scores it with a weight
and a reason, and `divide` assigns the agreed tasks. Quorum is half the
participants; voting times out after ten minutes; one agent receives at most
three divided tasks.

Evidence is a separate phase: submit a receipt, make a claim, verify it, and
challenge it. A claim without at least one receipt is refused and not recorded.

For general planning, the goal ledger is the better route: create the goal,
attach criteria, dispatch parallel handoffs for the perspectives you need, then
have one agent consolidate. If you must use a discussion, frame each decision
point as an issue so the phases have something concrete to work on.

## Shared memory

Every agent can read a shared memory that the runtime fills as work moves.

| Kind | Written when | Use |
| --- | --- | --- |
| Decisions | A handoff is created, or a decision is recorded | What was chosen |
| Learnings | A task teaches something reusable | What to repeat |
| Warnings | A failure or hazard is detected | What to avoid |
| File context | A file is touched | What changed there |
| Agent context | An agent acts | Last task, expertise, recent errors |
| Handoff history | A handoff completes | Who delivered what |

The memory is bounded: 100 decisions, 100 learnings, 50 warnings, 1000 file
contexts, 1000 agent contexts, and 100 handoff records. Content is truncated at
5000 characters. Entries decay by tag, compaction runs hourly, and the base TTL
is 30 days. These are caps, not an archive.

Visibility is `public`, `private`, or `shared`. The memory is local to the
workspace; two workspaces do not see each other's memory.

One important default: the "Decision memory" and "Learned lessons" blocks are
injected into a new handoff only when `handoffAccumulatedContext` is enabled.
It is off by default. If you want the receiving agent to inherit that
background, turn it on, or put the relevant decision in the handoff context
yourself.

## Write locks

There are two lock layers, and they solve different problems.

| Layer | Protects | Behaviour |
| --- | --- | --- |
| Per-file handoff lock | A file claimed by a handoff | Advisory in `normal`, blocking in `strict` |
| Config write lock | The roster and configuration files | Serializes writers; fails closed for `addagent` and `kick` |

A per-file lock is taken only when the handoff lists `files`. If you omit
`files`, no lock is taken and two agents can write the same file. This is the
most common cause of a "the lock did not work" report.

Locks are released when the handoff is completed, undone, or rescued. A lock
whose owner disappears expires, so a crashed turn does not block the workspace
forever.

When a conflict is detected, the resolver chooses one of: allow, block,
reroute, warn, or queue. In `normal` the decision is advisory; in `strict` a
block stops the handoff.

Practical rules:

- Always pass `files` for work that writes.
- Split parallel work by file, not by agent.
- Do not run two writers on one file and expect the lock to make them correct;
  it serializes access, it does not merge edits.
- Roster changes are serialized; two `addagent` calls cannot interleave.

## Tools

Tawassul declares 44 tools, and a full boot registers all of them. Four depend on
an optional service (`goal`, `timeline`, `checkpoint`, `evidence`), so a degraded
boot exposes fewer. The host may also present the surface through grouped
endpoints. `help` returns a short static overview of the families, not a live
list; the authoritative list is the host's tool list, and every tool carries its
own description.

### Routing and delegation

| Tool | Purpose |
| --- | --- |
| `handoff` | Create, complete, undo, or rescue a handoff |
| `fasttrack` | Create a handoff directly, skipping the normal pipeline |
| `task_orchestrate` | Decompose a task and dispatch it across agents |
| `directresponse` | Let a router answer a simple question without delegating |
| `override` | Redirect, cancel, force-complete, or reroute a handoff |
| `moa` | Send a task to several agents as a mixture |
| `divide` | Split agreed tasks after a discussion reaches consensus |
| `task_control` | Inspect, cancel, or revive background child work |

### Team management

| Tool | Purpose |
| --- | --- |
| `addagent` | Add a specialist, or patch a role's model in place |
| `kick` | Remove a specialist |
| `check` | Diagnose models, capabilities, and conflicts |
| `self_heal` | Trigger self-healing for a failed or degraded agent |

Roster changes reach these two tools through `@addagent`; the tools are what the
dispatcher calls, not a second user interface.

### Governance

| Tool | Purpose |
| --- | --- |
| `pause` | Stop dispatching new tasks; pending and accepted handoffs pause |
| `resume` | Resume and restore paused handoffs |
| `panic` | Reset all state, with a backup, after confirmation (`@analyst` only) |
| `status` | Summarise records, handoffs, errors, and state |
| `dashboard` | System status, agent performance, discussions, training |
| `timeline` | Activity by time, agent, range, or milestone |
| `health` | Event-loop lag, memory, timers, database, install scope |

### Goals, memory, and state

| Tool | Purpose |
| --- | --- |
| `goal` | Create, update, evidence, and close goals with a definition of done |
| `record` | Record a decision, fix, incident, or note |
| `thread` | Pack a session into a portable context and continue it |
| `show_board` | Mission board: task status and agent health |
| `checkpoint` | Create, list, restore, or diff code-state checkpoints |

### Collaboration

| Tool | Purpose |
| --- | --- |
| `discussion` | Open a discussion where agents propose, vote, and divide |
| `propose` | Propose a solution for an error inside a discussion |
| `vote` | Vote on a proposal with a weight and a reason |
| `evidence` | Submit receipts, make claims, verify, and challenge |
| `review` | Ask the user to review multi-agent work before implementation |

### Quality

| Tool | Purpose |
| --- | --- |
| `evaluationreport` | Structured evaluation: issues, coverage, summary |
| `qualityreport` | Lint, typecheck, and tests in one pass |

### Reporting

| Tool | Purpose |
| --- | --- |
| `report` | Agent performance: health scores, flags, completion ratio |

### Code intelligence

| Tool | Purpose |
| --- | --- |
| `astquery` | Symbols and imports from a file, precisely |
| `readsymbol` | Read one symbol instead of a whole file |
| `batchread` | Read several files in one call |
| `smartgrep` | Regex search with context lines |
| `projectmap` | Project tree with file classification and stats |
| `depmap` | Import graph, circular dependencies, change impact |
| `gitdiff` | Unstaged, staged, or commit diff with stats |

### Workspace state

| Tool | Purpose |
| --- | --- |
| `codestate` | Code undo and redo through git snapshots, without touching `.git` |

### Web and media

| Tool | Purpose |
| --- | --- |
| `web` | Fetch, search, map, and crawl through a Firecrawl service |
| `imagegen` | Generate or edit an image through the Codex image API |
| `image_route` | Suggest the agent best suited to an image |

### Meta

| Tool | Purpose |
| --- | --- |
| `help` | Print the plugin map: identity, ledgers, state, and the roster rule |

Two tools need an environment before they can work: `web` needs
`FIRECRAWL_BASE_URL` and `FIRECRAWL_API_KEY`, and `imagegen` needs
`OPENAI_CODEX_ACCESS_TOKEN` (or its `PI_`-prefixed alias). Without them the tool
is still registered, and a call fails with the missing name. `web` blocks
private, loopback, link-local, and unique-local targets before any request
leaves the machine. `thread` reads a pack up to 8192 bytes and points to the full
pack when it is longer.

One slash command is registered: `/tawassul-goals`. It runs the goal review
procedure. Everything else is a tool call or a skill.

## Skills

A skill is a procedure the model loads when the task matches it. Tawassul ships
sixteen, registered in-process. They are not copied into a user skill directory,
and an uninstall leaves no skill files behind.

| Skill | Use it when |
| --- | --- |
| `tawassul-adversarial-review` | A diff is about to be accepted |
| `tawassul-code-explorer` | An unfamiliar area is about to change |
| `tawassul-codebase-design` | A module boundary is designed or reviewed |
| `tawassul-context-continue` | A session is too long to continue in place |
| `tawassul-diagnosing-bugs` | A failure resists the obvious fix |
| `tawassul-enrich-task` | A request arrives as a sentence or a screenshot |
| `tawassul-goal-review` | Open goals need honest closure |
| `tawassul-handoff-triage` | Handoffs are stale or misrouted |
| `tawassul-incident-response` | A severe regression or host failure lands |
| `tawassul-integration-engineer` | A change must land inside a running system |
| `tawassul-interface-design` | A user-facing surface is designed or judged |
| `tawassul-retro` | A session went badly |
| `tawassul-step-back` | Fixes keep stacking on one path |
| `tawassul-to-tickets` | A goal is too large for one handoff |
| `tawassul-verification-planning` | A non-trivial change is planned |
| `tawassul-writing-for-agents` | An agent-facing document is written or edited |

Which agent carries which skill:

| Agent | Skills |
| --- | --- |
| `tawa` | enrich-task, to-tickets, incident-response, writing-for-agents |
| `analyst` | enrich-task, step-back, incident-response, to-tickets, retro |
| `dev` | diagnosing-bugs, code-explorer, codebase-design |
| `tester` | diagnosing-bugs, verification-planning |
| `reviewer` | adversarial-review |
| `architect` | code-explorer, codebase-design |
| `designer` | interface-design |
| `doc` | retro, writing-for-agents |

The mapping is a recommendation, not an access boundary. Every shipped skill is
registered for the workspace with auto-invocation, so any agent can load any
skill when the task matches; the table shows which role is expected to reach for
which procedure. The `tawassul-` prefix is part of each name.

Invoke a skill by naming it, or by asking for the outcome:

```
Use tawassul-handoff-triage and close the stale handoffs.
```

User skills and commands are unconditional. The plugin does not read, gate,
prefix, or override them, and a user skill with the same name as a shipped
skill wins at the host.

## Settings that matter

Tawassul reads two optional files: `~/.config/opencode/tawassul.jsonc` for every
workspace, then `<workspace>/.opencode/tawassul.json`. Project values win, and a
model list in `agentModels` is concatenated global-first. A file that fails
validation is ignored as a whole with a warning; a missing file is fine.
Configuration is read at plugin init, so restart the host after an edit.

You can use the whole guide without touching a file. These keys matter once the
defaults stop fitting:

| Key | Default | Effect |
| --- | --- | --- |
| `language` | `"en"` | Tool descriptions and runtime strings: `"en"` or `"ar"` |
| `strictness` | `"normal"` | How strictly a delegation is validated: `relaxed`, `normal`, `strict` |
| `maxCallDepth` | `3` | Nested `task()` depth; values above 3 are bounded by the host ceiling of 3 |
| `maxTotalTasks` | `25` | Total `task()` calls allowed in one session |
| `maxDynamicAgents` | `50` | Added agents kept before the oldest are dropped |
| `maxRecords` / `maxHandoffs` | `5000` / `2000` | Ledger retention; oldest entries drop first |
| `handoffAccumulatedContext` | `false` | Append recent same-session history to a handoff's context |
| `agentModels` | `{}` | Pin a role to a model, or give it an ordered list |
| `projectScale` | `"medium"` | Multiply every iteration budget by `0.7`, `1`, or `1.6` |
| `iterationBudgets` | `{}` | Per-agent turn budget, keyed without `@` |
| `privacyGuardParanoid` | `false` | Apply the strictest outbound privacy guard |
| `continuity.enabled` | `false` | Run the continuity probe and allow `resumeInterrupted` |

```jsonc
{
  "language": "ar",
  "strictness": "strict",
  "maxTotalTasks": 40,
  "agentModels": {
    "reviewer": { "models": [{ "model": "provider/strong-model" }] }
  }
}
```

With `handoffAccumulatedContext` on, the added background is capped at 4 KiB and
carries at most three recent handoffs from the same session or chain. The
caller's own text always comes first.

## Cost, permissions, and safety

Tawassul does not meter or bill model usage, and it never reads or stores a
provider key. Every dispatch is a normal model call that your provider bills. The
controls that bound the spend are structural:

- `maxTotalTasks` bounds the number of dispatches in one session, and
  `maxCallDepth` bounds nesting.
- `parallelCopies: N` produces N results in total, not N extra; `moa` dispatches
  to three agents by default; `task_orchestrate` can fan a task into several
  handoffs.
- Iteration budgets cap the turns one dispatch may spend; `projectScale` moves
  every tier at once.
- A comparison, a discussion, or `moa` multiplies calls. Use it when the decision
  is worth more than one answer.

Two permission layers apply. OpenCode decides which tools an agent may call at
all, and the plugin guard decides whether this call, by this agent, with these
arguments, may proceed. A call must pass both; the plugin cannot widen the host's
decision. The guard checks the role matrix, the router limits, the dispatch
limits, the path, and consent, and a denied call performs no partial work.

`tawa` is blocked from `edit`, `write`, `bash`, `addagent`, `kick`, `pause`, and
`resume`, including their aliases. `analyst` and `reviewer` are read-only for
shell work: inspection commands such as `rg`, `ls`, `cat`, `git diff`, and
`git log` are allowed, while writes, redirects, and interpreters are not. An
allow-list reduces the blast radius of a mistake; it is not a sandbox.

A destructive call asks for confirmation. Built-in accept words include `yes`,
`y`, `sure`, `ok`, `go ahead`, `fine`, `true`, and `1`; reject words include
`no`, `stop`, `reject`, `deny`, `not now`, `false`, and `0`. Matching ignores
case and punctuation and normalises Arabic diacritics, so a natural Arabic
answer works. Add your own words in `consent-tokens.json` under
`$XDG_CONFIG_HOME/tawassul-v2/`, or point `TAWASSUL_CONSENT_TOKENS` at a file. A
custom word extends the list; a deny word always wins.

Relative paths resolve against the workspace. A path that escapes through `..` or
a symlink, or that targets a protected root such as `/etc`, is refused. `web`
refuses private, loopback, link-local, and unique-local targets before a request
leaves the machine, and `privacyGuardParanoid` tightens outbound text.

| Refusal | Meaning | What to do |
| --- | --- | --- |
| `tool not allowed for role` | The role matrix does not grant this tool | Ask the role that owns it, or hand off |
| `call depth exceeded` | Too many nested dispatches | Use a handoff instead of nesting |
| `maximum number of task() calls` | The session task budget is spent | Split the work or start a new session |
| `consent` | No accepted word was received | Answer with an accept word |
| `path rejected` | The path leaves the workspace or hits a protected root | Use a path inside the workspace |
| `SSRF` | The URL resolves to a private or link-local address | Use a public target |

## Recipes

### Compare three reviews of one change

```
Ask @dev to review this diff. Compare three answers: @dev as the primary, plus
two copies to other specialists. Then compare the results.
```

You get the primary `dev` handoff plus two copies, then a side-by-side report
when the copies complete. Read the agreements, the unique finding, and the
contradictions. Do not accept `bestAgent` as the verdict.

### Turn a vague request into a plan

```
Turn this request into a goal with items and acceptance criteria, then slice it
into the smallest handoffs that can run in parallel.
```

`@tawa` enriches the request, creates the goal, and dispatches. Each slice keeps
its own handoff. Close the goal only after every criterion has evidence.

### Fix a stubborn bug

```
The fix keeps failing. Open a red loop, rank the causes, and only then change
code.
```

The `tawassul-diagnosing-bugs` skill records the reproduction, ranks causes, and
opens the regression handoff. `dev` implements; `tester` verifies.

### Release a version

```
Create the release goal, freeze features, verify the install, and write the
notes. Use @doc for the notes and @tester for the verification.
```

The goal holds the plan; the handoffs hold the work; `record` holds the release
decision.

### Continue a long session

```
Pack this session and continue it in a fresh one.
```

The `tawassul-context-continue` skill lists packs, reads the newest, packs the
current session, and transfers it. A pack is data, never instructions.

### Add and remove a variant safely

```
@addagent reviewer with model gemini from google
Check the team. Use it for this review. Then remove it.
```

Add with `@addagent`, `check()`, use it, remove with `@addagent remove …` in the
full form, `check()` again. The base `reviewer` never changed.

## When something goes wrong

Start with the three cheap checks: `health()` for the plugin, `check()` for the
team, and `status()` for the ledger. They separate a plugin problem from a roster
problem from a task problem.

| Symptom | First check | Fix |
| --- | --- | --- |
| Host fails with `Location plugins did not finish activating` | The plugin directory must exist | `mkdir -p ~/.config/opencode/plugins`, then restart |
| `opencode plugin list` says `No plugins found` | That command lists package plugins, not files | Ignore it; verify with `opencode debug agents --standalone` |
| The installer says `not installed` | `TAWASSUL_GLOBAL_DIR` and the install root | `bun run install:global --dry-run`, then install |
| `bundle hash mismatch` | The installed file was edited, truncated, or replaced | Rebuild and reinstall; never hand-edit the bundle |
| A destructive action is refused | The consent answer | Answer with an accept word, or extend `consent-tokens.json` |
| The key directory is under `/mnt/` | WSL2 resolved the home directory to Windows | Move it with `TAWASSUL_HMAC_KEY_DIR` and reinstall |
| The host feels slow, or memory keeps growing | `health()` event-loop lag, RSS, timers | Restart the host, then collect diagnostics |
| A task is stuck | `show_board()`, `status()` | Undo or rescue the handoff, then retry |

Collect diagnostics before opening an issue:

```bash
TAWASSUL_DEBUG=1 TAWASSUL_LOG_FILE=/tmp/tawassul.log opencode
bash scripts/doctor-v2.sh --redact
```

The redacted report replaces your home directory, the XDG roots, and the
temporary directory with their names. Redaction covers paths only; review a log
for keys and transcript content before sharing it, and never paste a key.

## Limits and pitfalls

| Symptom | What is actually happening |
| --- | --- |
| `bestAgent` is not the answer I would pick | It is a centroid, not a quality score |
| `moa` returned no merged plan | It dispatches; consolidation is a separate step |
| The receiving agent did not see an earlier decision | Handoff memory injection is off by default |
| Two agents wrote the same file | The handoff did not list `files`, so no lock was taken |
| A discussion will not start | It needs concrete issues with file, line, and severity |
| `@tawa` cannot fix the file | The router is read-only by design |
| The roster count looks wrong | Base agents plus the variants you added; run `check()` |
| State is local and finite | No sync; caps drop the oldest entries first |

What the plugin will not do: store a provider key, widen a host permission,
delete a session row or a goal to make a number look better, or claim a platform
is supported without a receipt.

## Quick reference

| Need | Say or call |
| --- | --- |
| See the team | `check()` |
| See health | `health()`, `show_board()` |
| Add a variant | `@addagent reviewer with model gemini from google` |
| Remove a variant | `@addagent remove reviewer-gemini with model gemini from google` |
| Compare agents | `handoff(create, parallelCopies: 3)` |
| Plan durable work | `goal(create: …)` with items and criteria |
| Change settings | Edit `.opencode/tawassul.json`, then restart the host |
| Record a decision | `record(type: "decision", …)` |
| Inspect history | `timeline()`, `record(search: "release")` |
| Continue a session | `thread(action: "pack")`, then `continue` |
| Check the plugin | `health()` |

`handoff` actions in one table:

| Action | Required arguments | Use it for |
| --- | --- | --- |
| `create` | `to`, `task`, `context` | Send work; optional `files`, `checkpoint`, `parallelCopies`, `helpRequest` |
| `completeHandoff` | `completeHandoff` (ID) | Accept the result |
| `undo` | `undo` (ID) | Return accepted work to pending |
| `rescue` | `rescue` (ID), `to`, `context` | Reassign a stalled handoff (`@analyst`) |
| `resumeInterrupted` | `resumeInterrupted` (ID) | Reopen an interrupted handoff; needs `continuity.enabled` |
| `helpRequest` | `to`, `task`, `context`, `helpRequest: true` | Ask another agent to call a tool |
