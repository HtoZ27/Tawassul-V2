# Monitoring

Tawassul has no dashboard server and no metrics endpoint. Monitoring happens
inside the session with the `health`, `status`, `dashboard`, `timeline`, and
`report` tools, and outside it with the doctor script and the database check.

## Inside a session

| Question | Tool |
| --- | --- |
| Is the process healthy? | `health` |
| What is the session state? | `status` |
| How is the team performing? | `dashboard` or `report` |
| What happened, and when? | `timeline` |
| Which tasks are open? | `show_board` |

### `health`

```
health()
```

A read-only snapshot:

| Field | Meaning |
| --- | --- |
| Event-loop lag | Milliseconds the loop took to answer an immediate callback; a spike above 500 ms is warned and recorded |
| RSS | Resident memory of the host process |
| Active timers | Timers the plugin owns; a growing count is a leak signal |
| Platform | `linux`, `darwin`, `win32`, or another Node value |
| Maintenance | `automatic` on Linux, `manual` on macOS, `unavailable` on Windows |
| DB path and lane | The database the host opened, and how the plugin classifies it |
| DB isolated | Whether the path is one of the isolated lanes |
| Scope | `project` or `global` |
| State dir, workspace, state file | The resolved paths actually in use |
| HMAC key | Whether the key file exists at the resolved path |
| Pending flushes | Saves queued but not yet written |
| Model failover | Switches, live claims, and tracked sessions |

`health` changes nothing. If it reports a path you did not expect, that is the
first thing to investigate.

### `status` and `dashboard`

`status` is the short form: records, handoffs, errors, and current state.
`dashboard` adds agent performance, discussions, and training statistics.
`report` focuses on one agent's health score, flags, dropped tasks, and
completion ratio.

## Outside a session

```bash
npm run doctor
npm run check:docs
npm run check:rules
npm run gate:fast
```

`doctor` checks the install layout, the key, the database lane, and the host
version. It prints `pass`, `warn`, and `fail` lines; a `fail` is a stop sign.
Add `--redact` before sharing the output: it replaces the home directory, the
XDG roots, and `$TMPDIR` with their names.

```bash
bash scripts/opencode-db-scheduled.sh --check
```

This prints the ladder decision without changing the database: total size, soft
limit, cap, WAL size, and which rung would run.

```bash
bun scripts/install-global.ts --verify
```

This checks the installed bundle hash, the version in the marker, the host pin,
and the wasm inventory.

## Logs

| Variable | Effect |
| --- | --- |
| `TAWASSUL_DEBUG=1` | Debug level |
| `TAWASSUL_LOG_JSON=1` | One JSON object per line |
| `TAWASSUL_LOG_FILE` | Append to a file as well as the console |
| `TAWASSUL_QUIET` | Reduce console output |

A useful diagnostic run:

```bash
TAWASSUL_DEBUG=1 TAWASSUL_LOG_JSON=1 TAWASSUL_LOG_FILE=/tmp/tawassul.log opencode
```

Redact before sharing. Logs never contain a provider key, but they do contain
workspace paths and tool summaries.

## What to watch

| Signal | Threshold | Reaction |
| --- | --- | --- |
| Event-loop lag | Above 500 ms | Check database size and the maintenance lane |
| Pending flushes | Growing, not draining | Check disk space and write permissions |
| Active timers | Growing across sessions | Restart the host; report it with the `health` output |
| Database plus WAL | Above 2 GiB | Run the scheduled check; above 4 GiB the ladder runs full maintenance |
| Handoff stuck | Older than `health.stuckTimeoutMs` | Triage the handoff ledger |
| Agent flagged | Completion ratio below `minCompletionRatio` | Read `report`, then decide whether to reassign |

## What is not exposed

There is no Prometheus endpoint, no OpenTelemetry exporter, and no remote log
sink. Adding one is a design change, not a configuration key: the plugin is
local-first, and an unsolicited network listener would contradict that.
