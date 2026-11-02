# Tools

Tawassul registers 44 tools. They are grouped below by what they are for. Every
tool is subject to the permission guard: a denied call returns an error and
performs no partial work.

## Routing and delegation

| Tool | Purpose |
| --- | --- |
| `handoff` | Create, complete, undo, or rescue a handoff between agents |
| `fasttrack` | Create a handoff directly, skipping the normal pipeline |
| `task_orchestrate` | Decompose a task and dispatch it across agents |
| `directresponse` | Let a router answer a simple question without delegating |
| `override` | Redirect, cancel, force-complete, or reroute a handoff |
| `moa` | Run a task through several agents and combine their results |
| `divide` | Split agreed tasks after a discussion reaches consensus |
| `task_control` | Inspect, cancel, or revive background child work |

## Team management

| Tool | Purpose |
| --- | --- |
| `addagent` | Add a specialist agent, or patch a role's model in place |
| `kick` | Remove a specialist agent |
| `check` | Diagnose the team configuration: models, capabilities, conflicts |
| `self_heal` | Trigger self-healing for a failed or degraded agent |

## Governance

| Tool | Purpose |
| --- | --- |
| `pause` | Stop dispatching new tasks; running work continues |
| `resume` | Resume after a pause and reactivate paused handoffs |
| `panic` | Reset all Tawassul state, with a backup, after confirmation |
| `status` | Summarise records, handoffs, errors, and current state |
| `dashboard` | System status, agent performance, discussions, training stats |
| `timeline` | Activity by time, agent, range, or milestones |
| `health` | Event-loop lag, RSS, timers, database isolation, install scope |

## Goals, memory, and state

| Tool | Purpose |
| --- | --- |
| `goal` | Create, update, evidence, and close goals with a definition of done |
| `record` | Record a decision, fix, incident, or note for the project |
| `thread` | Pack a session into a portable context and continue it elsewhere |
| `show_board` | Mission board: task status, agent health, system status |
| `checkpoint` | Create, list, restore, or diff code-state checkpoints |

## Collaboration

| Tool | Purpose |
| --- | --- |
| `discussion` | Open a discussion where agents propose, vote, and divide work |
| `propose` | Propose a solution for an error inside a discussion |
| `vote` | Vote on a proposal, with a weight and a reason |
| `evidence` | Submit receipts, make claims, verify them, and challenge them |
| `review` | Request a user review of multi-agent work before implementation |

## Quality

| Tool | Purpose |
| --- | --- |
| `evaluationreport` | Structured evaluation of a feature: issues, coverage, summary |
| `qualityreport` | Lint, typecheck, and tests in one pass |

## Reporting

| Tool | Purpose |
| --- | --- |
| `report` | Agent performance: health scores, flags, completion ratio |

## Code intelligence

| Tool | Purpose |
| --- | --- |
| `astquery` | Symbols and imports from a file, precisely |
| `readsymbol` | Read one symbol instead of a whole file |
| `batchread` | Read several files in one call |
| `smartgrep` | Regex search with context lines |
| `projectmap` | Project tree with file classification and stats |
| `depmap` | Import graph, circular dependencies, change impact |
| `gitdiff` | Unstaged, staged, or commit diff with stats |

## Workspace state

| Tool | Purpose |
| --- | --- |
| `codestate` | Code undo and redo through git snapshots, without touching `.git` |

## Web and media

| Tool | Purpose |
| --- | --- |
| `web` | Fetch, search, map, and crawl through a configured fetch service |
| `imagegen` | Generate or edit an image through the configured image provider |
| `image_route` | Suggest the agent best suited to an image or a screenshot |

## Meta

| Tool | Purpose |
| --- | --- |
| `help` | Show the tool surface with each tool's built-in description |

## Notes on behaviour

- `help`, `review`, and `panic` are declared stateless in the registry.
- Tools that write state use the same durable write path as the installer: temp
  file, fsync on a writable handle, rename.
- The web tool performs a local SSRF preflight and re-checks the final URL after
  the remote fetch service responds.
- `panic` creates a backup before it resets anything and requires confirmation.
