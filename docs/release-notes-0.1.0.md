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
records (`R-###`) keep decisions, fixes, incidents, and notes.

### Long sessions survive

`thread` packs a session into a portable summary, lists stored packs, and
continues one in a successor session. `checkpoint` snapshots code state through
git without touching the project's own `.git`. Context packs are keyed by
workspace, so one workspace does not discover another's.

### An installer that can be verified

The global installer writes the bundle through a durable write, stages the four
wasm grammars, and records the version, hashes, owner, and host pin in a marker.
`--verify` checks the artifact without touching it, and an uninstall removes
exactly the files the marker lists.

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

Project scope:

```bash
npm ci
npm run build
```

Global scope:

```bash
npm ci
npm run build
bun scripts/install-global.ts
bun scripts/install-global.ts --verify
```

The installer relies on host discovery and never edits `opencode.json(c)`. A
manual entry, if you use one, must point at a directory. See
[installation](installation.md).

## Compatibility

| Area | Status |
| --- | --- |
| OpenCode `2.2.0` | Supported (floor) |
| OpenCode `2.2.1` | Supported, audited |
| OpenCode `3.x` | Untested mode behind a capability probe |
| Linux x64 | Ready, including maintenance and triggers |
| Linux arm64, macOS | Experimental |
| WSL2 | Experimental; keep the key off `/mnt/` |
| Native Windows x64 | **Pending a native receipt** |

Native Windows loads the bundle and runs the in-process features. It has no
database maintenance, no scheduled trigger, and no native receipt for NTFS ACLs,
Defender, or long paths. The emulator receipt is published and labelled.

## Verification

| Check | Result at this release |
| --- | --- |
| Fast gate | 11 steps |
| Proofs | 153 steps, one child process each |
| Smoke | 4 steps, including global boot and independence boot |
| Proof files | 156, all catalogued across the stages |
| Public docs | 41 files, 44 tools, 8 agents, 4 skills |
| Native Windows | Not verified; emulator evidence only |

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

- No native Windows maintenance lane and no native Windows receipt.
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
