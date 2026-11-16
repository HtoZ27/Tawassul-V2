# State

Tawassul is local-first. Every durable thing it knows lives in a file on this
machine, under one of the paths below. This page states the topology, what is
retained, how to back it up, and what deleting it means.

## Topology

Scope decides where the plugin file, the roster and the signing key live. It
does not decide where runtime state lives: every install scope keeps state in
the project.

| Data | Path |
| --- | --- |
| Main state | `<project>/.opencode/tawassul-state.json` |
| Goals, ratings, service state | `<project>/.opencode/` |
| Goal ledger | `<project>/goals/goals.jsonl` and `goals-meta.json` |
| Context packs | `$XDG_DATA_HOME/tawassul/context-packs/<workspace-hash>/` |
| Maintenance stamps | `$XDG_DATA_HOME/tawassul-v2/db-maintenance/` |
| Database backups | `$XDG_DATA_HOME/tawassul-v2/backups/` |
| Isolated database | `$XDG_DATA_HOME/opencode-projects/<hash>/opencode.db` |
| HMAC key | `$TAWASSUL_HMAC_KEY_DIR` or `~/.config/tawassul/.tawassul-hmac-key` |

`$XDG_DATA_HOME` falls back to `~/.local/share`.

Two workspaces do not share a state file, in project or global scope. A
context pack is keyed by a hash of the workspace path, so a pack written in one
workspace is not discovered by another.

## Files and modes

- The state file is written atomically: a temporary file in the same directory is
  written, fsynced, renamed over the target, and the previous mode is restored.
- A new state file is created `0600` on POSIX.
- The key directory is created `0700` and the key file `0600`.
- On native Windows the key directory is protected with an `icacls` ACL; POSIX
  modes are never claimed there.
- The goal ledger is append-only. A torn tail from an interrupted write is
  detected, skipped on read, and the next append separates itself from the
  fragment.

## Retention

| Data | Cap | Behaviour |
| --- | --- | --- |
| Records | `maxRecords`, default 5000 | Oldest dropped on write |
| Handoffs | `maxHandoffs`, default 2000 | Oldest dropped on write |
| Compacted items | `maxCompactItems`, default 20 | Items kept per compaction |
| Goals | 5000 | Oldest closed goals are dropped first |
| Evidence per goal | 100 entries | Further evidence is refused with `cap` |
| Model map entries | 100 | Oldest keys dropped |

Trimming is logged at debug level. The cap protects the file and the host's read
path; it is not an archive policy. Anything that must outlive the cap belongs in
a goal, a record that is still within it, or a document.

## Read-only states

The plugin refuses to persist rather than guess:

- A state file signed by a key this device does not have is treated as foreign.
  Writes are blocked with a `foreign-key` message, the session stays read-only,
  and no key is created to "repair" the file.
- An isolated session is read-only for persistence by design; its writes are
  blocked with a `read-only fail-safe` message.
- A project whose state directory cannot be written boots normally. State-backed
  writes are skipped, one warning is logged, and `health` reports
  `state: read-only`.

A read-only session still answers reads. The refusal is the point: creating a
key for a file you did not sign would convert a denial into silent trust. Fix
the directory permission or move the workspace instead of forcing a write.

## Backup

Stop the host, then copy the state roots you care about. Use `cp -a` or `tar`;
do not move a live file.

```bash
tar -czf tawassul-state-$(date +%Y%m%d).tar.gz \
  "<project>/.opencode" "<project>/goals" "<project>/sagas" \
  "<project>/timeline" "<project>/mission-board" \
  "$HOME/.local/share/tawassul"
```

The key is separate on purpose: back it up only if you intend to restore state
signed with it. A key is a secret; store the archive accordingly.

## Restore

Stop the host, then extract the archive at the same root it was created from,
with the matching key in place:

```bash
tar -xzf tawassul-state-YYYYMMDD.tar.gz -C "<same root>"
```

Restart and run `health()`. A state file signed by a key this device does not
have comes back read-only, which is the intended refusal, not a bug; restoring
on the same machine with the same key is the path that keeps writes enabled.

## Deletion

| Action | Effect |
| --- | --- |
| `uninstall-global` | Removes the bundle and staged runtime; keeps state and data |
| `uninstall-global --purge --yes` | Renames the state, data, and config namespaces with a `.purged-<timestamp>` suffix |
| Deleting `<project>/.opencode/` | Deletes that workspace's plugin state; the workspace itself is untouched |
| Deleting the context-pack directory | Deletes packs only; goals and records stay |
| Deleting the key | Makes previously signed state foreign and read-only |

There is no automatic migration from a deleted state file. A missing file starts
empty. A file signed by an unknown key is refused rather than migrated.

Stop the host before deleting anything under a state root. A running host may
hold the state file and its lock.

A purge is a rename, not an erase: moving `tawassul-v2.purged-<timestamp>` back to
`tawassul-v2` restores the namespace, with any files written after the purge left
in place. The installer's purge runs against the configured state roots, so
point `HOME`, `XDG_CONFIG_HOME` and `TAWASSUL_GLOBAL_DIR` at a temporary
directory when you test a cycle; a test then never archives your profile.

## Isolated mode

`TAWASSUL_ISOLATED` sends state to a temporary root and marks the session
read-only for persistence. It exists for tests and experiments: an isolated run
cannot read or write a real workspace's state.

## Environment overrides

| Variable | Affects |
| --- | --- |
| `TAWASSUL_STATE_DIR` | The state directory for this process |
| `TAWASSUL_GLOBAL_DIR` | The global config root |
| `TAWASSUL_HMAC_KEY_DIR` | The key directory; read-only, must already contain a key |
| `XDG_CONFIG_HOME` | Default config base |
| `XDG_DATA_HOME` | Context packs, backups, maintenance stamps, isolated databases |
| `OPENCODE_DB` | The host database, never redirected by the plugin on its own |

`TAWASSUL_HMAC_KEY_DIR` is read-only by contract: if it is set and the key file
is absent, the plugin refuses instead of creating one at that path. The global
installer applies the same contract to `install` and `--verify`: an explicit key
directory must already hold a 32-byte key, or the command exits 2 before writing
anything.
