# Release notes: 0.1.6-experimental

**Status:** seventh public release, experimental. It hardens the database path
handling in the repository installer, corrects the cleanup command that `doctor`
prints for an unstamped cron line, and fixes a historical packaging row. Read
[limitations](limitations.md) before running it on work you cannot restore.

**Version:** `0.1.6-experimental`.

## What changed

### The repository installer refuses an unsafe database path

`install-global` resolved `OPENCODE_DB` verbatim and wrote the value into a
systemd unit and a cron line. A control character could break the unit
structure, and the schedule-significant characters `"`, `'`, a backtick, `$`,
`%`, and a backslash had no defined meaning there.

The resolved path is now checked before any write. A value that carries a
control character or one of those characters fails closed with
`unsupported character in the database path`, and the refusal happens before
the bundle, the marker, the unit pair, or the cron line is written. The rule
matches the one `install.sh` already applied to its database lane.

### `doctor` prints a cleanup command that matches the line

For an unstamped cron line left by an earlier installer, `doctor` printed
`grep -vF '# tawassul-db-maintenance owner=unknown'`, which matched no line and
removed nothing. It now prints the tag-only pattern,
`grep -vF '# tawassul-db-maintenance'`, for that legacy shape. A stamped line
keeps its exact owner-matched command, and `doctor` still never edits a
schedule it does not own.

### The 0.1.4 notes describe the artifact that was published

The `tawassul-runtime-0.1.4-experimental.tar.gz` row said the archive held wasm
grammars and database scripts. The published archive held the four wasm
grammars; the database scripts were never part of it. The row now says so.

## Install

From the release assets, with no Node or Bun:

```sh
sh install.sh --global --dry-run
sh install.sh --global
sh install.sh --db-maintenance
```

Project scope:

```sh
sh install.sh --project /path/to/workspace
```

| Asset | Use |
| --- | --- |
| `tawassul-0.1.6-experimental.global.js` | The bundle the installer verifies and installs |
| `tawassul-runtime-0.1.6-experimental.tar.gz` | The staging runtime: four wasm grammars |
| `tawassul-db-maintenance-0.1.6-experimental.tar.gz` | The five database scripts, installed only by `install.sh --db-maintenance` |
| `tawassul-0.1.6-experimental.index.js` | The plugin entry for a project build |
| `tawassul-0.1.6-experimental.tgz` | The package as npm would see it, for inspection |
| `SHA256SUMS`, `VERSION`, `NOTICE.md`, `.cdx.json` | Checksums, version stamp, third-party notices, SBOM |

The installer verifies the staged artifacts, the bundle, the runtime archive,
and, for `--db-maintenance`, the maintenance archive, against `SHA256SUMS`, and
refuses an unverified or offline asset. See
[installation](installation.md#release-installer) for `--prefix`, `--from`,
`--release`, and the uninstall.

From a source checkout:

```bash
npm ci
npm run build
```

Global scope:

```bash
bun scripts/install-global.ts
bun scripts/install-global.ts --verify
```

Neither installer edits `opencode.json(c)`. A manual entry, if you use one, must
point at a directory.

## Compatibility

| Area | Status |
| --- | --- |
| OpenCode `2.3.0` | Supported, audited (built dependency) |
| OpenCode `2.2.1` - `2.2.7` | Refused (floor raised to `2.3.0`; the 2.2.x line is out of scope) |
| OpenCode `3.x` | Untested mode behind a capability probe |
| Linux x64 | Ready, including maintenance and triggers |
| Linux arm64, macOS | Experimental |
| WSL2 | Experimental; keep the key off `/mnt/` |
| Native Windows x64 | Supported for the bundle and wasm lane (native receipts 2026-11-02 and 2026-11-03) |

Native Windows loads the bundle and runs the in-process features. It has no
database maintenance and no scheduled trigger. The full matrix is in
[compatibility](compatibility.md).

## Verification

| Check | Result at this release |
| --- | --- |
| Fast gate | 16 steps |
| Proofs | 186 steps, one child process each |
| Smoke | 6 steps, including the release artifacts, global boot, and independence boot |
| Proof files | 189, all catalogued across the stages |
| Public docs | 51 files, 44 tools, 8 agents, 16 skills |
| Native Windows | Native receipts for the bundle and wasm lane; database lane unavailable |

The counts are generated from `scripts/gate-manifest.json`. See
[validation](validation.md) for what each stage proves and what it does not.

## State and upgrade

No durable format changed in this release. State written by
`0.1.0-experimental` through `0.1.5-experimental` loads unchanged.

- State is local, namespaced by workspace, and signed with an HMAC.
- State is **signed, not encrypted**. Use full-disk encryption if it must be
  confidential at rest.
- A patch upgrade keeps state. A downgrade across a schema change is not
  supported; restore the backup instead.

## Known limits

The limits recorded in the `0.1.0-experimental` notes still hold: no native
Windows database maintenance lane, no macOS scheduler, no hosted documentation
site, no npm package, a pilot evals stage, prompt-injection mitigation rather
than elimination, and a prompt cache that is invalidated when compression
rewrites the prefix.
