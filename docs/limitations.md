# Limitations

These are design boundaries, not bugs waiting for a patch. Knowing them is part
of running the plugin honestly.

## Platform

| Limit | Consequence |
| --- | --- |
| Native Windows has no database maintenance or scheduled trigger | The plugin loads and all in-process features work; `health` reports `maintenance: unavailable` |
| macOS has no automatic database scheduler | Run `scripts/opencode-db-scheduled.sh --run` manually, or wire it to `launchd` yourself |
| The database lane is POSIX-only | Pruning, backup, and `VACUUM` need a POSIX shell and `sqlite3` |
| Native Windows x64 has a native receipt for install, verify, upgrade, uninstall, and purge | The receipt covers NTFS ACLs, long paths, file locking, Defender, and SmartScreen; ARM64 remains unmeasured, while Windows 11 shares the path and Defender baseline, so only version-level differences remain; the host watcher is unmeasured |
| SmartScreen blocks a downloaded unsigned executable | Windows shows "Windows protected your PC" and waits for a person; the kit ships no executable, so the install lane never triggers it |

## State

| Limit | Consequence |
| --- | --- |
| State is local to one machine | There is no sync, no remote store, and no merge between two hosts |
| A workspace's state is namespaced, not shared | Two workspaces do not see each other's records, goals, or packs |
| A foreign-key state file is read-only | Restoring state without its key is a refusal, not a migration |
| Retention is a cap, not an archive | Records and handoffs past the cap are dropped oldest-first |
| Pruning is irreversible beyond the kept backups | The default keeps two backups; a third run rotates the oldest away |

## Session behaviour

| Limit | Consequence |
| --- | --- |
| The plugin runs inside the host process | A compromised host or dependency is outside its control |
| There is no sandbox | Permissions bound what a tool may do; they do not contain a hostile process |
| Prompt injection is mitigated, not eliminated | The guard limits effects; it does not make the model immune to text it reads |
| Model providers see the text sent to them | That is the provider's data policy, not a plugin control |
| Context compression can invalidate a prompt cache | A compressed prompt is a different prefix; the cache rebuilds |
| One plugin copy per workspace | A second copy yields at init instead of registering twice |

## Distribution

| Limit | Consequence |
| --- | --- |
| The bundle is plain JavaScript, not a native addon | No compiler is needed, but the host must load an ES module |
| Wasm grammars are staged beside the bundle | Without them, AST tools degrade; other tools keep working |
| A downgrade across a state schema change is unsupported | The older build may refuse the newer state; restore a backup |
| The installer does not edit `opencode.json` | Discovery must find the bundle; a manual entry must point at a directory, not a file |
| There is no hosted documentation site yet | The documents in this repository are the reference |

## What the plugin will not do

- It will not store or proxy a provider key.
- It will not widen a host permission.
- It will not delete a session row, a goal, or a record to make a number look
  better.
- It will not claim a platform is supported without a receipt.
- It will not retry a failed proof until it passes.

---

[Documentation index](README.md)
