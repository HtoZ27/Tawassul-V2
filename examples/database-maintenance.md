# Database maintenance

The host's SQLite database grows with every session. Tawassul provides a
maintenance lane that checks its size, backs it up, prunes old rows, and
vacuums, in that order, under a size ladder. This recipe runs the lane by hand
and inspects the result.

## The situation

`health` reports a database plus WAL above 2 GiB after a month of heavy sessions.
The host still answers, but the maintenance trigger should have run and did not.
You want to understand the decision before forcing anything.

## Step 1: confirm the lane

```
Is maintenance automatic here, and how large is the database?
```

```
health()
```

Read three fields:

| Field | Good value | Meaning |
| --- | --- | --- |
| Platform | `linux` | Automatic maintenance is Linux only |
| Maintenance | `automatic` | The in-process trigger is armed |
| Database size and WAL | Below the cap | 4 GiB by default |

On macOS the value is `manual`; on native Windows it is `unavailable`. Neither
is a bug, but neither runs the lane for you.

## Step 2: check the install

```bash
npm run doctor
```

The doctor checks the install layout, the key, the database lane, and the host
version. A `fail` is a stop sign: fix it before touching the database.

## Step 3: read the ladder decision

```bash
bash scripts/opencode-db-scheduled.sh --check
```

`--check` is read-only. It prints the sizes, the rung it would choose, and the
would-be deltas. It exits 0 even when the answer is "do nothing", so read the
output rather than the exit code.

The ladder:

| Rung | Condition | Action |
| --- | --- | --- |
| WAL | WAL above 64 MiB | `wal_checkpoint(TRUNCATE)`, passive fallback |
| Retention | No process holds the file | Read/reasoning retention, then vacuum when there is work |
| In use | Held and database plus WAL at or above the soft limit | Bounded retention while the host holds the file (no vacuum) |
| Cap | Quiet and at or above the 4 GiB cap | Solver maintenance: backup, prune messages only if retention did not reach the target, vacuum |

A live vacuum is refused under every flag. If the host holds the database, the
lane does the bounded retention work and stops. The quiet retention rung backs
up only when there is retention work or when the freelist holds at least 64 MiB
(`TAWASSUL_RECLAIM_MIN_FREE`), so an idle day writes no copy. Message pruning is
skipped whenever retention alone brings the projected file under the target.

## Step 4: run it

```bash
bash scripts/opencode-db-scheduled.sh --run
```

The run writes a log beside the backups:

```bash
tail -n 40 "$HOME/.local/share/tawassul-v2/backups/opencode-db-scheduled.log"
```

On success it writes `last-run.stamp` under
`$XDG_DATA_HOME/tawassul-v2/db-maintenance/`. On failure it writes
`last-failure.stamp` and leaves the last-run stamp untouched, so a scheduler can
tell "never ran" from "ran and failed".

## Step 5: verify the backup

Backups use SQLite's online backup API, so the snapshot is consistent even with
a WAL present. Each backup is probed with `quick_check` and a session count
before the lane proceeds; a failed probe aborts the run.

```bash
ls -lt "$HOME/.local/share/tawassul-v2/backups" | head
```

The default keeps two backups (`--keep-backups 2`). A third run rotates the
oldest away. Pruning keeps 90 days by default (`--prune-days 90`), and pruning is
irreversible beyond the backups that remain. Read results older than one day are
replaced by a short placeholder (`--tool-retention-days 1`); the message row and
its text stay, and `0` disables the rewrite. Reasoning blocks older than one day
are replaced the same way (`--reasoning-retention-days 1`), leaving the answer
text and tool results intact.

## Step 6: run the maintenance script directly

Only with the host stopped, and only when you accept the cost:

```bash
OPENCODE_DB="$HOME/.local/share/opencode/opencode.db" \
  bash scripts/opencode-db-maintenance.sh --check
```

`--check` stays read-only. The same command without `--check` performs the work.
`--cap-bytes N` lowers the threshold for one run. `--force` is a deprecated alias
for `--allow-in-use --ignore-low-ram`; it never authorizes a live vacuum.

## Step 7: record what happened

```
Record the manual maintenance run.
```

```
record(type: "note", title: "Manual database maintenance after a missed trigger",
       detail: "db+wal 2.4GiB; ladder chose the in-use rung; backup verified; prune 90d; no vacuum because the host held the file")
```

## What can go wrong

| Symptom | Meaning | Action |
| --- | --- | --- |
| `refusing to pick another DB` | `OPENCODE_DB` is set but missing | Fix the path; the lane will not guess |
| Backup probe fails | The snapshot is not readable | Keep the old backups; investigate disk and SQLite version |
| Vacuum skipped | The host holds the file | Stop the host, then run the maintenance script directly |
| Exit 7 | Not enough disk space | Free space; the lane will not fill the disk |
| Exit 8 | Lock contention | Let the host finish; retry |
| Maintenance `unavailable` | Native Windows | No lane exists there; do not copy POSIX scripts into it |

## The point

The ladder is deliberately boring: measure, back up, prune, vacuum, record. The
danger is not the vacuum; it is running one without a verified backup.
