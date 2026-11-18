# Release notes: 0.1.4-experimental

**Status:** fifth public release, experimental. It corrects the release-note
links that `0.1.3-experimental` shipped, adds the gate check that would have
caught them, and applies the code-scanning fixes from the same review. Read
[limitations](limitations.md) before running it on work you cannot restore.

**Version:** `0.1.4-experimental`.

## What changed

### The front page links the release it describes

`0.1.3-experimental` shipped with the status line on `0.1.3-experimental` and the
release-note links on `0.1.2-experimental`, in the header, the documentation
table, and the docs index. All three now point at this release.

### The release gate checks the link

`scripts/release/check-release.ts` now rejects a release whose README does not
link `docs/release-notes-<version>.md`. The next cut cannot repeat the mismatch
between the status line and the notes it names.

## Security

The code-scanning review of this release fixed two findings and hardened three
repository scripts.

### The lock name uses SHA-256

`opencodeConfigLockName` derived the lock directory name for the OpenCode config
file with SHA-1. The name is a coordination token, not a secret, but the
algorithm has no collision resistance left. It now uses SHA-256, truncated to
the same sixteen hex characters, so the lock directory keeps its length and
state is unaffected. A process on an older release computes a different name;
two releases are not meant to run against one workspace at the same time.

### The database path is an argument, not a command line

`resolveDbPath` in `scripts/install-global.ts` interpolated a computed path into
a `bash -c` command string. The path is now passed as `$1` and read inside the
script, so no path can be parsed as shell syntax.

### Gate scripts parse instead of sanitize

`check-release.ts` strips HTML comments with an index walk instead of a
multi-character regular expression, reads the CHANGELOG link line without
building a regular expression from the version, and `check-shared-parity.ts`
escapes table cells with a split and join instead of a replacement pattern.
These scripts read committed documents, but none of them relies on a single-pass
replacement any more.

### Dependabot

One alert remains on `minimatch` inside the `@opencode/plugin` development tree,
with no patched parent release. It is dismissed as tolerable risk on the alert
itself: the dependency is development-only, the SDK is external in the bundle,
and nothing in this package ships it.

## Install

From the release assets, with no Node or Bun:

```sh
sh install.sh --global --dry-run
sh install.sh --global
```

Project scope:

```sh
sh install.sh --project /path/to/workspace
```

| Asset | Use |
| --- | --- |
| `tawassul-0.1.4-experimental.global.js` | The bundle the installer verifies and installs |
| `tawassul-runtime-0.1.4-experimental.tar.gz` | The staging runtime: four wasm grammars |
| `tawassul-db-maintenance-0.1.4-experimental.tar.gz` | The five database scripts, installed only by `install.sh --db-maintenance` |
| `tawassul-0.1.4-experimental.index.js` | The plugin entry for a project build |
| `tawassul-0.1.4-experimental.tgz` | The package as npm would see it, for inspection |
| `SHA256SUMS`, `VERSION`, `NOTICE.md`, `.cdx.json` | Checksums, version stamp, third-party notices, SBOM |

The installer verifies the staged artifacts — the bundle, the runtime archive,
and, for `--db-maintenance`, the maintenance archive — against `SHA256SUMS` and
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
| OpenCode `2.2.1` – `2.2.7` | Refused (floor raised to `2.3.0`; the 2.2.x line is out of scope) |
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
| Public docs | 49 files, 44 tools, 8 agents, 16 skills |
| Native Windows | Native receipts for the bundle and wasm lane; database lane unavailable |

The counts are generated from `scripts/gate-manifest.json`. See
[validation](validation.md) for what each stage proves and what it does not.

## State and upgrade

No durable format changed in this release. State written by `0.1.0-experimental`
through `0.1.3-experimental` loads unchanged.

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
