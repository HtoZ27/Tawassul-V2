# Commands

Tawassul registers one slash command. Everything else is a tool call or a
skill, chosen by the model from a natural-language request.

## `/tawassul-goals`

Runs the goal review procedure.

| Aspect | Behaviour |
| --- | --- |
| Registration | Through the host command transform; skipped when the host has no command domain |
| With text | Your text is sent, followed by an instruction to follow the goal review skill |
| Without text | Sends the default goal-review prompt |
| Delivery | Queued into the current session |
| Result | The goal review skill runs and the board is reported |

The command exists because a review is a recurring ritual, not because the
plugin needs a command layer. If the host does not expose command registration,
the same work is one sentence:

```
Review the open goals and close the ones whose items and evidence are complete.
```

## There is no wider command surface

Tawassul deliberately does not register a command for every tool. A command is a
shortcut with no arguments of its own; a tool carries a schema, validation, and
a result the model can act on. Duplicating the tool surface as commands would
create two ways to do the same thing and two places to keep in sync.

| You want | Use |
| --- | --- |
| A specific operation with arguments | The tool, directly or by asking for the outcome |
| A repeatable procedure | A skill |
| A recurring ritual | The one command, or a sentence that names the outcome |
| A host operation (install, verify) | The scripts under `scripts/`, not a plugin command |

## Asking for work in the session

The model picks the tool. These phrasings map to a known route:

| Request | Route |
| --- | --- |
| "Distribute this across the team" | `tawa`, then a handoff |
| "Review this change" | `reviewer`, or `review` for a user decision |
| "Where does this project stand?" | `status`, `dashboard`, `show_board`, or `timeline` |
| "What are we still committed to?" | `goal(board: true)` |
| "Save this decision" | `record` |
| "Pack this session and continue it" | `thread`, or the context-continue skill |
| "Clean up the stale handoffs" | The handoff-triage skill |
| "Check the database" | `bash scripts/opencode-db-scheduled.sh --check` |
| "Is the install healthy?" | `health`, or `bun scripts/install-global.ts --verify` |

## Host commands used with the plugin

These belong to the host or to the project scripts. They are listed here because
they are the commands an operator actually runs.

| Command | Purpose |
| --- | --- |
| `opencode debug agents --standalone` | Confirm the eight agents are registered |
| `opencode plugin list` | Lists package plugins, not this file plugin; not the right check |
| `bun scripts/install-global.ts --dry-run` | Show every path the installer would write |
| `bun scripts/install-global.ts --verify` | Check hash, version, host pin, and wasm inventory |
| `bun scripts/install-global.ts --uninstall` | Remove exactly what the installer recorded |
| `npm run verify` | Fast gate plus build |
| `npm run ci` | Fast gate, every proof, and the release smoke |
| `npm run gate:proofs:bg` | Run the four proof shards detached, one after another |
| `npm run gate:proofs:bg:status` | Show the latest detached proof run |
| `npm run gate:proofs:bg:wait` | Wait for the detached run and return its result |

A foreground `npm run gate:proofs` prints one line per step and is the CI path.
When the session must stay responsive, run `gate:proofs:bg`: it executes the
balanced shards detached and keeps the logs under `/tmp/opencode/gate-proofs`
unless `TAWASSUL_GATE_BG_DIR` points elsewhere. Shards 1, 2, and 4 run at
niceness 10; shard 3 runs at normal priority because `boot-budget` measures
wall-clock boot time against its pinned 2000 ms contract, and a lowered
priority makes that measurement fail on an otherwise idle machine.

## Argument shapes

A tool rejects an argument that does not match its schema, and the error names
the field. Two conventions are worth knowing:

- Identifiers are prefixed: `G-001` for a goal, `H-001` for a handoff, `R-001`
  for a record, `D-001` for a discussion. A bare number is not accepted.
- `@` names an agent in prose (`@dev`), while a tool argument takes the bare name
  (`dev`). The tools normalise the two forms, but the schema documents the bare
  form.

The full argument reference for each tool is its built-in description, available
with the `help` tool and summarised in [tools](tools.md).

---

[Documentation index](README.md)
