# Changelog

All notable changes to Tawassul are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
semantic versioning with an explicit experimental suffix while the project is
pre-stable.

## [0.1.0-experimental]

The first public release. Experimental: the Linux lane is verified, and a
platform or host row without a receipt is not a support claim.

### Added

- A plugin runtime that adds eight specialist agents, 44 tools, four skills, and
  one slash command to an OpenCode workspace.
- A goal ledger with items, definition-of-done criteria, evidence rules, and a
  mechanical close.
- Handoffs, mission boards, activity timelines, records, checkpoints,
  discussions with proposals and votes, and structured evaluation reports.
- Context packs that summarise a session and continue it in a successor,
  keyed per workspace.
- A global installer that writes the bundle durably, stages four wasm grammars,
  records a marker, verifies the artifact, and removes exactly what it wrote.
- Per-project SQLite isolation keyed by an HMAC of the workspace path, with a
  maintenance ladder, verified backups, pruning, and a generation guard.
- A full public documentation set, enforced by `npm run check:docs` for links,
  language, allow-list, and tool/agent/skill coverage.
- A validation suite: a 12-step fast gate, 153 isolated proofs, and a 4-step
  smoke stage, with the counts generated from one manifest.

### Changed

- State lives under a v2 namespace with explicit precedence for
  `TAWASSUL_STATE_DIR`, `TAWASSUL_GLOBAL_DIR`, and the XDG bases.
- The installer refuses a target that carries no Tawassul marker instead of
  overwriting it, and reports the file it kept.
- A host newer than the audited `2.2.1` runs in untested mode behind a capability
  probe rather than being refused.

### Fixed

- The durable write now writes and fsyncs a single writable descriptor, because
  a Windows `FlushFileBuffers` call rejects a read-only handle. This was the
  installer defect that blocked the Windows cycle.
- The purge archives the global configuration files as well as the state and
  data namespaces, and the documentation now says so.
- Documentation claims about the WSL key path and the database scheduler match
  what the code does.

### Security

- State is signed with an HMAC to detect tampering. It is **not encrypted**;
  confidentiality at rest is the filesystem's job.
- The HMAC key directory is `0700` and the key file `0600` on POSIX. Native
  Windows uses an `icacls` ACL instead and does not claim POSIX modes.
- `TAWASSUL_HMAC_KEY_DIR` is read-only by contract: if it is set and the key is
  absent, the plugin refuses instead of creating one there.
- The web tool refuses private, loopback, link-local, and unique-local targets
  before a request leaves the machine, and re-checks the final URL.

### Known limitations

- Native Windows has no database maintenance lane and no native receipt. The
  emulator evidence is published and labelled.
- macOS has no automatic maintenance scheduler.
- No hosted documentation site, no npm package, no stable API promise.
- The evals stage is a pilot, not a benchmark.

[0.1.0-experimental]: docs/release-notes-0.1.0.md
