# Release notes: 0.1.3-experimental

**Status:** fourth public release, experimental. The runtime is unchanged from
`0.1.2-experimental`; this release corrects claims that no longer matched the
shipped build and tidies the surfaces a reader meets first. Read
[limitations](limitations.md) before running it on work you cannot restore.

**Version:** `0.1.3-experimental`.

## What changed

### Windows is reported as tested

`docs/features.md` said the installer had an emulator receipt only and that a
native host was still pending. The native receipt from 2026-11-02 covers install,
verify, in-place upgrade, uninstall, and purge on a real Windows 10 host, with an
`icacls` ACL on the key. The page now reports that lane as ready, and the
platform matrix agrees with [compatibility](compatibility.md).

### The counts match the tree

`docs/features.md` quoted 151 proofs; the proof stage runs 186.
`docs/validation.md` said fourteen fast steps and listed neither `notices` nor
`schema`. `docs/dependencies.md` named the host floor `2.2.1`; it is `2.3.0`.

### The limit a wide roster hits is documented

[configuration](configuration.md) gains "Cost and burn limits": the weighted
token unit (a read costs `0.1`, a write `1.25`), the root and child caps, the
yellow, orange, and red zones, and the fact that only `task` dispatch is refused
when the budget is spent.

### Two shipped capabilities are named on the front page

The shared memory every agent reads, and the role matrix that decides which
tools each specialist may call, were shipped but unnamed. Both are now rows in
the README capability table.

### Navigation

Every documentation page ends with a link back to the index. The README table
now lists the agent, tool, skill, monitoring, known-issues, and limitations
pages, and the release-note links point at this release.

### Release pages keep their links

Release bodies used repository-relative links, which GitHub resolves against the
tag, so `[limitations](limitations.md)` became a 404. The body is now published
with its links rewritten to `docs/`. This release also carries an asset table, is
marked as a pre-release, and drops the duplicated "(experimental)" from its
title.

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
| `tawassul-0.1.3-experimental.global.js` | The bundle the installer verifies and installs |
| `tawassul-runtime-0.1.3-experimental.tar.gz` | The staging runtime: wasm grammars and database scripts |
| `tawassul-0.1.3-experimental.index.js` | The plugin entry for a project build |
| `tawassul-0.1.3-experimental.tgz` | The package as npm would see it, for inspection |
| `SHA256SUMS`, `VERSION`, `NOTICE.md`, `.cdx.json` | Checksums, version stamp, third-party notices, SBOM |

The installer verifies both artifacts against `SHA256SUMS` and refuses an
unverified or offline asset. See
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
| Public docs | 48 files, 44 tools, 8 agents, 16 skills |
| Native Windows | Native receipts for the bundle and wasm lane; database lane unavailable |

The counts are generated from `scripts/gate-manifest.json`. See
[validation](validation.md) for what each stage proves and what it does not.

## State and upgrade

No durable format changed in this release. State written by `0.1.0-experimental`
through `0.1.2-experimental` loads unchanged.

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
