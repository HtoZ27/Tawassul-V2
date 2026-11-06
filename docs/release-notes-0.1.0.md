# Release notes: 0.1.0-experimental

**Status:** first public release, experimental. This is a working system with a
verified Linux lane, not a production support statement. Read
[limitations](limitations.md) before running it on work you cannot restore.

**Version:** `0.1.0-experimental`.

## What this release is

Tawassul adds a small team runtime to an OpenCode workspace: specialist agents,
durable goals, handoffs, records, boards, discussions, checkpoints, and context
packs. It runs inside the host process, ships as a JavaScript bundle, and keeps
its state on the local machine.

The design goal is continuity. A session that is compacted or restarted should
not lose what was agreed, who was doing it, or what counts as done. Every
durable object has an identifier and a place on disk, and the tools that write
it are the tools that read it back.

## Highlights

### A team with a router

Eight agents ship: `tawa` routes, and `dev`, `analyst`, `tester`, `reviewer`,
`architect`, `designer`, and `doc` do the work. Each has a default model policy,
a tool allowance, and a role that bounds what it may call. The roster is a file,
so a project can change it without forking the plugin.

### Goals that close mechanically

A goal carries items and definition-of-done criteria. An item needs evidence
before it is done; a criterion needs its own evidence before it is met. A goal
cannot close with an unfinished item or an unmet criterion. Evidence has a
minimum length and is deduplicated, so "done" is a record, not an opinion.

### Handoffs, boards, and a timeline

Work moves by handoff (`H-###`), not by a sentence in the transcript. A handoff
carries context, files, a checkpoint, and a result. The board shows task state
and agent health; the timeline shows what happened, by time or by agent;
records (`R-###`) keep decisions, fixes, incidents, and notes. New handoffs store
the caller's context verbatim by default; the opt-in scoped background
(`TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT=1` or `handoffAccumulatedContext`) adds at
most 4 KiB of decisions, changed files, and lessons from the same session or
chain.

### Long sessions survive

`thread` packs a session into a portable summary, lists stored packs, and
continues one in a successor session. `checkpoint` snapshots code state through
git without touching the project's own `.git`. Context packs are keyed by
workspace, so one workspace does not discover another's.

### An installer that can be verified

The release script `install.sh` verifies the bundle and the runtime archive
against `SHA256SUMS` before writing, then stages the entry and the four wasm
grammars. The repository installer writes the bundle through a durable write,
stages the same grammars, and records the version, hashes, owner, and host pin in
a marker. `--verify` checks the artifact without touching it, and an uninstall
removes exactly the files the marker lists.

### Database isolation

Each project can run against its own SQLite database, keyed by an HMAC of the
workspace path. The maintenance lane prunes, backs up, and vacuums under a
size ladder, with a generation guard and rotation. Maintenance is automatic on
Linux, manual on macOS, and unavailable on native Windows.

### A public documentation set

A complete public documentation set covers installation, compatibility,
configuration, state, permissions, privacy, the database lane, operations,
troubleshooting, and the architecture. `npm run check:docs` enforces the set:
links resolve, text is English, no internal document is referenced, and every
registered tool, shipped agent, and bundled skill is covered.

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
| OpenCode `2.2.1` | Supported, audited (floor) |
| OpenCode `3.x` | Untested mode behind a capability probe |
| Linux x64 | Ready, including maintenance and triggers |
| Linux arm64, macOS | Experimental |
| WSL2 | Experimental; keep the key off `/mnt/` |
| Native Windows x64 | Supported for the bundle and wasm lane (native receipts 2026-11-02 and 2026-11-03) |

Native Windows loads the bundle and runs the in-process features. It has no
database maintenance and no scheduled trigger. The native receipts cover NTFS
ACLs, Defender, long paths, and file locking.

## Verification

| Check | Result at this release |
| --- | --- |
| Fast gate | 16 steps |
| Proofs | 177 steps, one child process each |
| Smoke | 6 steps, including the release artifacts, global boot, and independence boot |
| Proof files | 180, all catalogued across the stages |
| Public docs | 45 files, 44 tools, 8 agents, 4 skills |
| Native Windows | Native receipts for the bundle and wasm lane; database lane unavailable |

The counts are generated from `scripts/gate-manifest.json`. See
[validation](validation.md) for what each stage proves and what it does not.

## State and upgrade

- State is local, namespaced by workspace, and signed with an HMAC.
- State is **signed, not encrypted**. Use full-disk encryption if it must be
  confidential at rest.
- A state file signed by a different key is read-only on this device. That is a
  refusal, not a migration path.
- A patch upgrade keeps state. A downgrade across a schema change is not
  supported; restore the backup instead.
- `--purge` archives state, data, and the global configuration files with a
  `.purged-<timestamp>` suffix. It does not delete them.

## Known limits

- No native Windows database maintenance lane or scheduled trigger; the bundle
  and wasm lane has native receipts.
- No macOS scheduler; run the scheduled script yourself.
- No hosted documentation site; the repository is the reference.
- No npm package yet. Distribution is the bundle and the installer.
- The evals stage is a pilot, not a benchmark of model quality.
- The plugin mitigates prompt injection; it does not eliminate it.
- A prompt cache is invalidated when compression rewrites the prefix.

## Thanks

The project learned from the prior art listed in
[ACKNOWLEDGEMENTS](../ACKNOWLEDGEMENTS.md). Those projects are not dependencies
and are not endorsed by this release.

## Reporting

Bugs: open an issue with the version, host, platform, and a minimal
reproduction. Vulnerabilities: use the private channel in
[SECURITY](../SECURITY.md). Conduct: see [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md).
