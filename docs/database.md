# Database and maintenance

Tawassul does not own a database. OpenCode owns its SQLite database, and the
plugin never opens a write transaction against it. What the plugin provides is
the lane around that database: it names the database a workspace may use,
refuses a database from another generation, and runs bounded maintenance when
the file grows past a limit.

## Why the lane exists

The host queries SQLite synchronously on its event loop. A database that grows
into tens of gigabytes turns every query into a stall, and the server appears
frozen. The maintenance lane keeps the file bounded without deleting sessions
and without running `VACUUM` against a database that a live process is holding.

## Which database a workspace uses

The plugin classifies a database path into one of five lanes:

| Lane | Path shape | Meaning |
| --- | --- | --- |
| `host-default` | `…/opencode/opencode.db` or `…/opencode-desktop.db` | The shared host database |
| `desktop-sidecar` | `…/opencode/tawassul-v2/` | The sidecar database for this plugin |
| `isolated` | `…/opencode-projects/<hash>/opencode.db` | A test or experiment database |
| `custom` | anything else | An explicit path, trusted as given |
| `unset` | empty | The host chooses |

An isolated path is derived from the workspace root with an HMAC over the
canonical path, so two workspaces cannot collide and the hash does not reveal
the path. The key must exist; without it no isolated path is produced.

## Generation guard

`scripts/guard-db-generation.sh` answers one question before a host starts: does
this database belong to the generation we are about to run?

```bash
bash scripts/guard-db-generation.sh --db "$OPENCODE_DB" --expect v2
```

| Exit | Meaning | Correct reaction |
| --- | --- | --- |
| `0` | Allowed | Start |
| `2` | Refused: the database carries the other generation's markers | Do not start; point at the right database |
| `3` | Probe failed | Do not start; never read a probe failure as "no markers" |

The guard is read-only. It prefers a direct read-only probe; when that fails and
a WAL companion exists, it copies the database and its companions to a temporary
directory and probes the copy, so a live file is never locked. `--json` prints
one machine-readable line. `--path-rule warn` downgrades the path rule while
keeping the generation refusal.

A missing file is fresh and is always allowed.

## Maintenance script

`scripts/opencode-db-maintenance.sh` performs one bounded pass. Each step is safe
to stop, and the script refuses before touching a database it cannot handle
safely.

| Step | What it does | Safety rule |
| --- | --- | --- |
| 1. Preflight | Checks free RAM and whether a process holds the database | Refuses a live database unless `--allow-in-use`; refuses under 1.5 GiB free RAM unless `--ignore-low-ram` |
| 2. Backup | SQLite online backup to the backup directory | The backup must pass `quick_check` and a session-count probe, or the run aborts |
| 3. Prune | Deletes messages older than the window; never deletes sessions | Messages touching a fresh session are kept |
| 4. Vacuum | Rebuilds the file and reclaims pages | Only when no process holds the database; a live `VACUUM` is refused under every flag |
| 5. Report | Prints before and after sizes | Non-zero exit on any safety refusal |

Defaults: prune window 90 days, keep the last 5 backups, backup directory
`~/.local/share/tawassul-v2/backups`. Pruning is a fixed wall-clock window; when
`--target-bytes` is used instead, the script solves for the window that reaches
the target, and the two options are mutually exclusive.

```bash
# Read-only: report sizes and what a run would delete
bash scripts/opencode-db-maintenance.sh --db "$OPENCODE_DB" --check

# Backup, prune messages older than 90 days, then vacuum if quiescent
bash scripts/opencode-db-maintenance.sh --db "$OPENCODE_DB"

# Reach a 1.5 GiB target instead of a fixed window
bash scripts/opencode-db-maintenance.sh --db "$OPENCODE_DB" --target-bytes 1610612736
```

Exit codes: `2` usage or refusal, `3` probe failure, `4` backup failure, `5`
mutation failure, `6` vacuum failure, `7` disk space, `8` lock contention, `9`
the cap remains or a protected table changed.

### Event retention

The host's `event` table is append-only and has no retention of its own. A plain
run reports how many rows retention would remove and deletes nothing. Passing
`--event-delete` applies bounded retention: the newest `--event-keep` rows per
aggregate survive, and `--event-retention off` keeps everything. A run against a
live database never deletes events, because a delete mid-run can starve the
host. `--event-only` performs retention and exits without backup, prune, or
vacuum.

### The archive

The legacy archive database is never an implicit target. Selecting it requires
`--allow-archive` and an interactive confirmation.

## Scheduled ladder

`scripts/opencode-db-scheduled.sh` is the entry point a schedule calls. One
invocation decides one rung:

| Condition | Rung |
| --- | --- |
| WAL above 64 MiB | `wal_checkpoint(TRUNCATE)`, falling back to `PASSIVE` when busy |
| Database plus WAL at or above the soft limit (2 GiB) | Bounded backup and prune while the database is held |
| Database plus WAL at or above the cap (4 GiB) and the database is quiet | Full maintenance: backup, prune, checkpoint, vacuum |
| Below the soft limit and WAL within the trigger | Nothing |

```bash
bash scripts/opencode-db-scheduled.sh --check   # print the decision, change nothing
bash scripts/opencode-db-scheduled.sh --run     # apply the rung
```

The soft limit, target, cap, backup directory, and database path are overridable
with `TAWASSUL_SOFT_BYTES`, `TAWASSUL_TARGET_BYTES`, `TAWASSUL_CAP_BYTES`,
`TAWASSUL_BACKUP_DIR`, and `OPENCODE_DB`.

## The in-process trigger

On a POSIX host the plugin arms a trigger at init. It checks every six hours,
runs at most once per 24 hours, and considers itself stale after three hours
(the lock is released and the next run may proceed). It does nothing when the
database file is absent or when the lane script cannot be found.

Resolution order for the script:

1. `TAWASSUL_DB_SCRIPT`, when it points at an existing file;
2. `<plugin>/tawassul-runtime/db/opencode-db-scheduled.sh`, staged by the global
   installer;
3. `<workspace>/scripts/opencode-db-scheduled.sh`, only when the workspace
   `package.json` names this project.

The trigger is unavailable on native Windows. It reports `unavailable` rather
than pretending to have run.

The first enabled run logs one notice per bundle, naming the opt-out. Set
`TAWASSUL_DB_MAINTENANCE=off` to skip the trigger entirely; `health` then
reports `DB maintenance: disabled`. The maintenance script still runs on
demand.

## What is never touched

- Host session rows are never deleted by pruning.
- A live database is never vacuumed.
- A database from the other generation is never opened.
- The plugin never creates a database; it only names a path and guards it.
