# Troubleshooting

Each entry states the symptom, the cause, and the fix. If a symptom is not here,
open an issue with the host version, the Tawassul version, the platform, and the
smallest reproduction.

## The host refuses to start

**Symptom:** `ServiceUnavailableError: Location plugins did not finish activating`

**Cause:** the plugin directory does not exist. The host resolves the directory
before it resolves the files inside it, so an empty or missing directory is a
startup failure, not a "no plugins" result.

**Fix:** create the directory the host expects and restart:

```bash
mkdir -p ~/.config/opencode/plugins
```

The global installer creates it; a manual install must create it too.

## `opencode plugin list` prints `No plugins found`

**Cause:** that subcommand lists package plugins declared in configuration, not
files discovered in the plugin directory.

**Fix:** none needed. Verify the roster instead:

```bash
opencode debug agents --standalone
```

## The installer reports `not installed`

**Cause:** nothing was installed for this user, or the install went to a
different root.

**Fix:** check `TAWASSUL_GLOBAL_DIR`, then install:

```bash
bun run install:global --dry-run
bun run install:global
```

## `bundle hash mismatch`

**Cause:** the installed file was edited, truncated, or replaced after install.

**Fix:** reinstall. Do not hand-edit an installed bundle; edit the source and
rebuild.

## `target exists without a Tawassul marker`

**Cause:** a file already occupies the target path and carries no Tawassul
marker.

**Fix:** move the file away and install again. `--force` keeps the previous file
as `tawassul.js.pre-force-<timestamp>`, but only use it when you know the file is
an old Tawassul bundle.

## `cannot create the runtime layout`

**Cause:** a plain file occupies a path the installer needs as a directory, or
the path is read-only.

**Fix:** remove the file, or point the installer elsewhere with
`TAWASSUL_GLOBAL_DIR`.

## `EPERM: operation not permitted, fsync` on Windows

**Cause:** a pre-release build fsynced a read-only handle. Windows requires a
writable handle for `FlushFileBuffers`.

**Fix:** upgrade. The current bundle fsyncs the writable descriptor it created.

## `SQLiteError: unable to open database file`

**Cause:** an inherited `OPENCODE_DB` points at a path the current process cannot
open, commonly when a Linux session launches a Windows host or a sandboxed
process.

**Fix:** unset `OPENCODE_DB` for the child process, or point it at a path that
exists for that process. Isolated runs should set `XDG_*`, `OPENCODE_DB`, and the
state directory together.

## `host v… is newer than the audited v…`

**Cause:** the host is newer than the audited pin.

**Fix:** none. It is a warning, not a failure. Re-audit with
`npm run check:upstream` when you want the pin to move.

## The key directory is under `/mnt/`

**Cause:** WSL2 resolves the home directory to the Windows filesystem.

**Fix:** move the key to the Linux filesystem and reinstall:

```bash
export TAWASSUL_HMAC_KEY_DIR="$HOME/.config/tawassul"
```

`doctor` warns about this because the Windows mount does not carry the same
permission semantics.

## `could not resolve the current user SID` on Windows

**Cause:** the installer could not resolve the account SID, so it refused to
guess an ACL.

**Fix:** apply the ACL yourself, then verify:

```bat
icacls "%USERPROFILE%\.config\tawassul" /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F"
```

## A destructive action is refused

**Cause:** the consent gate did not receive an accepted word.

**Fix:** answer with an accepted word, or extend the list in
`consent-tokens.json`. Point at a different file with
`TAWASSUL_CONSENT_TOKENS`.

## Collecting diagnostics

```bash
TAWASSUL_DEBUG=1 TAWASSUL_LOG_FILE=/tmp/tawassul.log opencode
npm run doctor
```

Attach the log with secrets redacted. Never paste a key, a token, or a full
transcript that contains one.
