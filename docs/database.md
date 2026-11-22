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
| 3b. Read payloads | Replaces old `read` tool results inside surviving messages with a short placeholder | Runs also while the host holds the database (batched, 2500 ms timeout); only the VACUUM needs quiescence; message rows, text, and non-read tools stay |
| 3c. Reasoning | Replaces old `reasoning` blocks with a short placeholder | Runs also while the host holds the database (batched, 2500 ms timeout); only the VACUUM needs quiescence; the answer text and tool results stay |
| 4. Vacuum | Rebuilds the file and reclaims pages | Only when no process holds the database; a live `VACUUM` is refused under every flag; a quiet run reclaims a freelist of at least 64 MiB even when there is nothing to prune |
| 5. Report | Prints before and after sizes | Non-zero exit on any safety refusal |

Defaults: prune window 90 days, read-payload retention 1 day, reasoning
retention 1 day, keep the last 2 backups, backup directory
`~/.local/share/tawassul-v2/backups`. Pruning is a fixed wall-clock window; when `--target-bytes` is used instead, the script
solves for the window that reaches the target, and the two options are mutually
exclusive. Message pruning is skipped when the projected post-vacuum size
already meets the target, so retention is never paid for with deleted
conversation. The scheduled lane defaults the target to the cap (4 GiB), skips the
backup when the database is already at or below it, and makes no copy when even
the 3d floor has nothing to prune — unless the freelist holds at least 64 MiB
(`TAWASSUL_RECLAIM_MIN_FREE`), where it vacuums the freed pages away.

```bash
# Read-only: report sizes and what a run would delete
bash scripts/opencode-db-maintenance.sh --db "$OPENCODE_DB" --check

# Backup, prune messages older than 90 days, then vacuum if quiescent
bash scripts/opencode-db-maintenance.sh --db "$OPENCODE_DB"

# Keep the last day of read results instead of the default
bash scripts/opencode-db-maintenance.sh --db "$OPENCODE_DB" --tool-retention-days 7

# Reach the 4 GiB cap instead of a fixed window
bash scripts/opencode-db-maintenance.sh --db "$OPENCODE_DB" --target-bytes 4294967296
```

Exit codes: `2` usage or refusal, `3` probe failure, `4` backup failure, `5`
mutation failure, `6` vacuum failure, `7` disk space, `8` lock contention, `9`
the cap remains or a protected table changed. When the VACUUM is skipped because
quiescence cannot be proven (the database is in use, or the probe is
unavailable), the run exits 0 with a note instead of 9: the cap cannot be
reclaimed until the file is quiet.

### Read payload retention

A `read` tool result embeds the file bytes inside the assistant message. On
agent-heavy databases these snapshots dominate the file: one measured database
held 3.2 GiB of read payloads in a 4.7 GiB file. The maintenance pass rewrites
read results older than `--tool-retention-days` (default 1) into
`[read output pruned: PATH]`, keeping the message, its text, and every other
tool. The rewrite runs in quiescent and in-use passes alike (batched, 2500 ms busy
timeout); only the VACUUM needs quiescence. `0` disables it.
This is what brings such a database back to a few hundred megabytes without
deleting conversations.

### Reasoning retention

Reasoning blocks are the model's internal trace. They are rewritten to
`[reasoning pruned]` after `--reasoning-retention-days` (default 1), while the
answer text and every tool result stay. `0` disables the rewrite. On the same
measured database this removed a further 213 MB, taking the file from ~600 MB to
~390 MB without a model call or a deleted message.

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
| No process holds the database | Read/reasoning retention, then vacuum when there is work (including a freelist of at least 64 MiB) |
| Held and database plus WAL at or above the soft limit (2 GiB) | Bounded retention while the database is held (no vacuum) |
| Quiet and database plus WAL at or above the cap (4 GiB) | Full maintenance: backup, solver prune, checkpoint, vacuum |
| Quiet, below the soft limit, no retention work, WAL within the trigger | Nothing |

```bash
bash scripts/opencode-db-scheduled.sh --check   # print the decision, change nothing
bash scripts/opencode-db-scheduled.sh --run     # apply the rung
```

The soft limit, target, cap, backup directory, and database path are overridable
with `TAWASSUL_SOFT_BYTES`, `TAWASSUL_TARGET_BYTES`, `TAWASSUL_CAP_BYTES`,
`TAWASSUL_BACKUP_DIR`, and `OPENCODE_DB`. Non-numeric values, and a zero cap
or target, fall back to their defaults; a target or soft limit above the cap is
clamped to the cap, so the cap always remains the hard ceiling.

## The standalone maintenance lane

`sh install.sh --db-maintenance` installs the same five scripts as one global
lane, without the plugin: the scripts and a `MAINTENANCE` marker under
`<config>/opencode/tawassul-runtime/db/`. It targets the desktop sidecar
database, `<data>/opencode/tawassul-v2/opencode.db`, which must exist already —
the host creates it on first launch. Pass `--db` to name a different sidecar
database.

The daily run is registered with a systemd user timer when available and a cron
line otherwise; `TAWASSUL_REGISTER_TRIGGERS` chooses `auto` (the default),
`systemd`, `cron`, `manual`, or `off`. A schedule owned by another installer is
never overwritten silently. Under `auto` the lane stays `manual` and names the
schedule's owner; a forced `systemd` or `cron` fails loudly. `--force` takes
the schedule over and re-stamps it.

`TAWASSUL_DB_GAP_SECONDS` sets the minimum interval between runs, the marker's
`gapSeconds` is the fallback, and 86400 seconds is the default.
`TAWASSUL_DB_MAINTENANCE=off` installs the scripts without a schedule, removes a
schedule this lane owns, and records `"trigger": "off"`.

The lane coexists with the plugin in either order; when the plugin installed
the scripts first, pass `--force` so the lane takes them and the schedule over.
When a repository `VERSION` marker records the database lane,
`--db-maintenance --uninstall` removes only `MAINTENANCE`, keeps the shared
scripts, and prints the cleanup command for the schedule it leaves;
`install-global` skips the database lane and preserves it on uninstall
while `MAINTENANCE` exists.

### Removing it by hand

The lane is global and standalone. Deleting the plugin file, ending a project,
or deleting a project directory does not remove its scripts, `MAINTENANCE`,
timer, or cron line, and the daily run continues. Remove it with:

```bash
sh install.sh --db-maintenance --uninstall
```

A project install is removed with `sh install.sh --project <dir> --uninstall`.
If the runtime directory was deleted by hand, `doctor` reports
`stale maintenance schedule: <mechanism> -> <path> (missing)` and prints the
exact, owner-matched cleanup command; it never edits a schedule it does not own.

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

---

[Documentation index](README.md)
