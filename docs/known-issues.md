# Known issues

Each item states the symptom, the workaround, and what would close it. An issue
stays here until a release can point at a receipt or a proof.

## `health` reports `maintenance: unavailable`

**Platform:** native Windows.

**Cause:** the database lane is POSIX-only and the in-process trigger is not
armed on `win32`.

**Workaround:** none needed for plugin use. Database maintenance must run on a
POSIX host that can reach the same file, or not at all.

**Closes when:** a Windows maintenance lane exists and a native host produces a
receipt.

## `health` reports `maintenance: manual`

**Platform:** macOS.

**Cause:** the plugin does not install a `launchd` job.

**Workaround:** run the scheduled script yourself, for example from a `launchd`
agent or a daily shell job:

```bash
bash scripts/opencode-db-scheduled.sh --check
bash scripts/opencode-db-scheduled.sh --run
```

**Closes when:** an installer-managed `launchd` job is shipped and verified.

## AST tools warn `AST degraded`

**Symptom:** the log shows one `AST degraded` warning that
`tawassul-runtime/wasm` is missing. `astquery` returns a misleading
`not supported` or `not found` message; `readsymbol` silently falls back to a
regex read.

**Cause:** the wasm files are not beside the bundle. A project-scope install
needs the runtime staged; a manual copy of the bundle alone is not enough. The
set is one runtime and three grammars.

**Workaround:** run the global installer, which stages the wasm files, then
restart the host.

```bash
bun scripts/install-global.ts
bun scripts/install-global.ts --verify
```

**Closes when:** nothing to close; this is the documented degradation path.
`depmap` keeps working with `ast: false` (the default); `ast: true` returns no
imports while the wasm is missing.

## `opencode plugin list` prints `No plugins found`

**Cause:** that command lists package plugins, not files discovered in the
plugin directory.

**Workaround:** verify the roster instead.

```bash
opencode debug agents --standalone
```

**Closes when:** the host changes the command. The documentation already treats
it as the wrong check.

## A manual plugin entry is skipped

**Cause:** the host accepts a configured path only when it is a directory. A
path to a single `.js` file is ignored.

**Workaround:** rely on discovery under `.opencode/plugins/`, or point the entry
at a directory that contains the bundle.

**Closes when:** the host accepts file paths. The installer avoids the problem by
never editing host configuration.

## The key directory is under `/mnt/` on WSL2

**Cause:** the home directory resolves to the Windows filesystem, which does not
carry Linux permission semantics.

**Workaround:** move the key to the Linux filesystem before the first run.

```bash
export TAWASSUL_HMAC_KEY_DIR="$HOME/.config/tawassul"
```

**Closes when:** the key path check detects the mount and refuses with a clear
message instead of relying on documentation.

## An unwritable workspace cannot persist state

**Cause:** the state file lives beside the workspace, and a read-only checkout
cannot be written.

**Workaround:** make `<project>/.opencode/` writable, or point `TAWASSUL_STATE_DIR`
at a writable directory. State-backed features that need a write fail and log the
failure; reads keep working.

**Closes when:** a documented read-only mode covers every state-backed feature
with a clear status, not only the write path.

## Prompt cache misses after a long session

**Cause:** context compression rewrites the prompt prefix, so the provider's
cached prefix no longer matches.

**Workaround:** none. This is the cost of fitting a long session into the window.
A pack-and-continue handoff starts a fresh prefix deliberately.

**Closes when:** nothing to close; it is a trade-off, documented so it is not
mistaken for a regression.

## `--purge` archives more than state

**Cause:** the purge list includes the global configuration files
(`tawassul.jsonc`, `tawassul.json`, `tawassul-pins.json`) as well as the state
and data namespaces.

**Workaround:** read the dry run before confirming.

```bash
bun scripts/install-global.ts --uninstall --purge --dry-run
```

**Closes when:** the purge is split into flags that select state, data, and
configuration separately.

## A restored state file is read-only

**Cause:** the file is signed with a key this device does not have.

**Workaround:** restore the key with the state, or accept a fresh state. Do not
delete the HMAC to force a read; that removes the check, not the problem.

**Closes when:** nothing to close; the refusal is the control.
