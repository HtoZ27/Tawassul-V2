# Release notes: 0.1.7-experimental

**Status:** eighth public release, experimental. It sends work to a configured
derived specialist before its base role, keeps the candidate list live through
add and remove, records the configured model of a variant in a fresh session,
and publishes the recorded demo site. Read [limitations](limitations.md) before
running it on work you cannot restore.

**Version:** `0.1.7-experimental`.

## What changed

### Work goes to a configured variant before the base role

When a derived variant of a role is in the roster and available, matching now
excludes the base role, so a development assignment goes to `dev-beam` and the
base `dev` is the fallback. A variant that is paused, stuck, or at its pending
ceiling does not hide the base role. An explicit `subagent` or handoff target is
still honoured, and an agent that names itself keeps its exact match.

### The candidate list follows the live roster

`addagent` makes a new variant selectable on the next dispatch, and `kick`
removes it on the next dispatch. Health records for an agent that left the
roster are filtered out, so a deleted agent cannot return from a stale
`HEALTHY` or `STUCK` status.

### A variant records its configured model

A variant defined only in `opencode.json` or `tawassul.jsonc` has no `.md` file.
Model resolution now reads the configured roster model first, on warm and cold
reads, so a tool run and a handoff record carry the variant's own model
(`dev-beam` records `opencode/beam-free`) instead of the base role model. The
MoA result lists the agents that actually ran, not the requested base roles.

### `read` is never deduplicated across sessions

Two specialists that read the same file at the same time both receive it. The
cross-session duplicate guard no longer applies to `read`.

### Variant removal and consent

Every removed variant is recorded in the session's deleted set, so a smaller
roster is not read as a truncated one and the removed agent cannot be
resurrected in the live process. A bare base removal, a bulk removal, and a
multi-target removal stay consent-gated. Approval and rejection words are
accepted across the 21 language tables, and rejection wins. The safety warning
no longer fires on a bare `token` or `api`.

### The demo site

[The GitHub Pages site](https://htoz27.github.io/Tawassul-V2/) publishes three
scenarios recorded in an isolated workspace: `tawa` routing to a derived
specialist, five derived specialists reading in parallel, and a goal ledger that
refuses an early close. Each scenario is labelled `Example demo`; the replay
images are rendered from the committed transcripts, and the deployment runs on
`main` with pinned actions. The site needs no custom domain and no personal
access token.

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
| `tawassul-0.1.7-experimental.global.js` | The bundle the installer verifies and installs |
| `tawassul-runtime-0.1.7-experimental.tar.gz` | The staging runtime: four wasm grammars |
| `tawassul-db-maintenance-0.1.7-experimental.tar.gz` | The five database scripts, installed only by `install.sh --db-maintenance` |
| `tawassul-0.1.7-experimental.index.js` | The plugin entry for a project build |
| `tawassul-0.1.7-experimental.tgz` | The package as npm would see it, for inspection |
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
| Public docs | 52 files, 44 tools, 8 agents, 16 skills |
| Native Windows | Native receipts for the bundle and wasm lane; database lane unavailable |

The counts are generated from `scripts/gate-manifest.json`. See
[validation](validation.md) for what each stage proves and what it does not.

## State and upgrade

No durable format changed in this release. State written by
`0.1.0-experimental` through `0.1.6-experimental` loads unchanged.

- State is local, namespaced by workspace, and signed with an HMAC.
- State is **signed, not encrypted**. Use full-disk encryption if it must be
  confidential at rest.
- A patch upgrade keeps state. A downgrade across a schema change is not
  supported; restore the backup instead.

## Known limits

The limits recorded in the `0.1.0-experimental` notes still hold: no native
Windows database maintenance lane, no macOS scheduler, no npm package, a pilot
evals stage, prompt-injection mitigation rather than elimination, and a prompt
cache that is invalidated when compression rewrites the prefix. The hosted site
is a recorded demo, not a live instance of the runtime.
