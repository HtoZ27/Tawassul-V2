# Release notes: 0.1.1-experimental

**Status:** second public release, experimental. `0.1.0-experimental` carried the
runtime; this release carries the same runtime, a repository front page built for
the repository interface, and fixes that let the release gate run on a fresh
clone. Read [limitations](limitations.md) before running it on work you cannot
restore.

**Version:** `0.1.1-experimental`.

## What changed

### A front page built for the repository

The README now opens with the project banner, a centred title and summary line,
CI, release, licence, and host badges, and quick links to the quick start, both
guides, the documentation index, and these notes. The banner is
`assets/tawassul-social-preview.png`, a 1280×640 image rendered from the project
logo, shipped in the repository and referenced by a relative path.

### Guides at the repository root

`GUIDE.md` and `WORKFLOW.md` moved out of `docs/` to the repository root. They are
complementary: the workflow is the short working rhythm, the guide is the complete
team reference. Links in the README, the documentation index, the feature
catalogue, and the Arabic end-user guide were updated with them.

### A release gate that survives a fresh clone

- Both CI checkouts fetch the full history, so the proofs that read tags and
  ancestry see the repository they expect.
- The proofs seed `.opencode/agents` and the canonical `opencode.json` they read.
- `model-failover-e2e` uses the root `node_modules` when the project lane has no
  install.
- `closure-artifacts` checks `docs/installation.md` instead of an untracked
  `.opencode/package.json`.
- `usage-shadow` asserts the development plan status only when that plan is
  present, because the public tree excludes development plans by design.

### Project scope is the recommended install

The README and `docs/installation.md` now say so directly: a local project keeps
its plugin entry inside the workspace, and global scope is for a user who wants
the plugin in every workspace.

## Install

From the release assets, with no Node or Bun:

```bash
sh install.sh --global --dry-run
sh install.sh --global
```

Project scope:

```bash
sh install.sh --project /path/to/workspace
```

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
| Public docs | 46 files, 44 tools, 8 agents, 16 skills |
| Native Windows | Native receipts for the bundle and wasm lane; database lane unavailable |

The counts are generated from `scripts/gate-manifest.json`. See
[validation](validation.md) for what each stage proves and what it does not.

## State and upgrade

No durable format changed in this release. State written by
`0.1.0-experimental` loads unchanged.

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

## Reporting

Bugs: open an issue with the version, host, platform, and a minimal
reproduction. Vulnerabilities: use the private channel in
[SECURITY](../SECURITY.md). Conduct: see [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md).
