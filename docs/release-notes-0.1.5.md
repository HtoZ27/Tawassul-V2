# Release notes: 0.1.5-experimental

**Status:** sixth public release, experimental. It adds the standalone database
maintenance lane, the coexistence rules that let it share a runtime with the
plugin, and the review fixes for both. Read
[limitations](limitations.md) before running it on work you cannot restore.

**Version:** `0.1.5-experimental`.

## What changed

### A database maintenance lane without the plugin

`install.sh --db-maintenance` installs the five maintenance scripts and a
`MAINTENANCE` marker under `<config>/opencode/tawassul-runtime/db/`. It writes
no plugin bundle, no `VERSION` marker, and no project configuration, so a host
that never installs the plugin can still keep its database bounded.

The target is the desktop sidecar database,
`<data>/opencode/tawassul-v2/opencode.db`, which the host creates on first
launch. The lane refuses a symlinked or foreign path and refuses a home that has
never started the host once. `--db` names a different database.

The daily run is a systemd user timer when available and a tagged cron line
otherwise. `TAWASSUL_REGISTER_TRIGGERS` selects `auto` (the default),
`systemd`, `cron`, `manual`, or `off`. A schedule owned by another installer is
never overwritten silently: under `auto` the lane records `manual` and names the
owner, while a forced `systemd` or `cron` fails loudly. `--force` takes the
schedule over and re-stamps it.

`TAWASSUL_DB_GAP_SECONDS` sets the minimum interval between runs; the marker's
`gapSeconds` is the fallback, then 86400 seconds.
`TAWASSUL_DB_MAINTENANCE=off` installs the scripts without a schedule, removes a
schedule the lane owns, and records `"trigger": "off"`. Under a `--prefix` that
is not the real config root, registration is `manual`; forcing `systemd` or
`cron` there is refused with the command that runs the lane by hand.

### The plugin and the lane share one runtime

`install-global` and `--db-maintenance` coexist in either order. While
`MAINTENANCE` exists, `install-global` installs the bundle and the grammars,
skips the database scripts, timer, and cron line, and preserves them on
uninstall. A repository `VERSION` marker that records the database payload has
the mirror rule: `--db-maintenance --uninstall` removes only `MAINTENANCE`,
keeps the shared scripts, and prints the owner-matched cleanup command for the
schedule it leaves.

`doctor` reads both markers from one config root, reports the package, version,
lane, trigger, gap, and schedule owner, names a standalone lane that needs no
plugin, warns on an incomplete lane, and prints the exact cleanup command for a
schedule whose script was deleted. The command is matched to the owner it
finds, and doctor never edits a schedule it does not own.

### Agent variants are derived, then governed

`addagent` accepts a model-derived variant suffix when the provider cache is
absent, while an explicitly typed unknown suffix is still rejected with
guidance to use the derived form. Provider cache slugs also gain a joined form
so a nested model id derives a governed suffix. A variant added this way
registers its base role so routing and fallback keep working, and `kick`
derives the same tag for the same `with model` request, including multi-spec
and `all` removals. A bare base can no longer smuggle an explicitly typed
unknown suffix for the same model past the governance gate.

## Security

`resolveDbPath` in `scripts/install-global.ts` resolves the database path with
the same environment rules as `db-env.sh`, without starting a shell.

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
| `tawassul-0.1.5-experimental.global.js` | The bundle the installer verifies and installs |
| `tawassul-runtime-0.1.5-experimental.tar.gz` | The staging runtime: four wasm grammars |
| `tawassul-db-maintenance-0.1.5-experimental.tar.gz` | The five database scripts, installed only by `install.sh --db-maintenance` |
| `tawassul-0.1.5-experimental.index.js` | The plugin entry for a project build |
| `tawassul-0.1.5-experimental.tgz` | The package as npm would see it, for inspection |
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
| Public docs | 50 files, 44 tools, 8 agents, 16 skills |
| Native Windows | Native receipts for the bundle and wasm lane; database lane unavailable |

The counts are generated from `scripts/gate-manifest.json`. See
[validation](validation.md) for what each stage proves and what it does not.

## State and upgrade

No durable format changed in this release. State written by
`0.1.0-experimental` through `0.1.4-experimental` loads unchanged.

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
