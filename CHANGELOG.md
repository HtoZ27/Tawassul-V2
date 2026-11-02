# Changelog

All notable changes to Tawassul are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
semantic versioning with an explicit experimental suffix while the project is
pre-stable.

## [Unreleased]

### Added

- A native Windows receipt for the bundle and wasm lane: install, verify,
  in-place upgrade, uninstall, purge, `icacls` ACL, a profile path with a space,
  a 275-character path, `C:`/`D:`/`F:` drives, host discovery, a live host load,
  and file locking.
- `scripts/windows-install.ps1` and `scripts/windows-install.cmd`: an unattended,
  time-bounded Windows ladder for install, verify, uninstall, purge, and the full
  cycle. It finds Bun, resolves the repository relative to itself, and works from
  any drive.
- `scripts/windows-security-check.ps1`: an unattended Defender and SmartScreen
  receipt. It tags the kit with Mark-of-the-Web, runs the ladder, compares the
  detection count, and removes every tag; `-ProbeShellLaunch` adds the opt-in
  SmartScreen probe, which waits for a person by design.
- `scripts/windows-bounded.ps1`: one bounded process runner shared by both Windows
  scripts. It always returns the exit code, stdout, stderr, and elapsed seconds,
  and a timeout kills the child instead of waiting forever.
- `-StateRoot` on the Windows ladder, with automatic isolation for
  `-Action cycle`: the whole cycle runs against a temporary home, so a test never
  reads or archives the operator's state. `-KeepState` keeps that directory for
  inspection.
- `scripts/windows-ci.ps1`: a four-mode Windows gate (`cycle`, `pwsh7`,
  `longpath`, `ast`) that plants guard files in the real state, runs the ladder,
  and asserts exit codes, isolation, purge, the three-ACE key ACL, and a
  278-character install path. The `ast` mode runs `AstService` against the wasm
  assets the installer staged and parses TypeScript, TSX, and JavaScript, then
  imports the installed bundle and runs the real `astquery` queries. All four
  modes pass natively, `pwsh7` under portable PowerShell 7.4.13 Core; each prints
  `verdict=PASS` or exits 1.
- `scripts/check-ast-runtime.ts`: loads `AstService` against a staged runtime,
  parses TypeScript, TSX, and JavaScript, and asserts the symbols and imports. It
  runs on any platform and is what the `ast` gate mode calls.
- `scripts/check-ast-bundle.ts`: imports the installed `plugins/tawassul.js` with
  an isolated home, waits for `initReady`, and runs the real `astquery`
  structure, symbol, and kind queries. The `ast` gate mode calls it after the
  engine check, so tool registration is proven from the artifact.
- `scripts/prove-no-git-init.ts`: boots the plugin with an empty `PATH` and
  asserts init succeeds, the tool registry and `astquery` register, and
  `codestate` degrades with a clear message instead of aborting the registry.
- `.github/workflows/windows.yml`: a `windows-latest` matrix that installs Bun,
  builds the bundle, and runs all four gate modes on every push and pull
  request, uploading each receipt as an artifact.

### Fixed

- The native Windows build failed with a zod locale cycle because the locale
  guard split `args.path` on `/` only; it now accepts `\` as well.
- Host discovery missed
  `%LOCALAPPDATA%\Programs\ai.opencode.desktop\resources\opencode-cli.exe` and the
  machine-wide `%ProgramFiles%` sidecar, so the installer fell back to `2.2.1`
  instead of recording the real host.
- A key directory beyond `MAX_PATH` skipped the `icacls` restriction; long paths
  now use the `\\?\` (and `\\?\UNC\`) form.
- `--uninstall --purge --yes` archived nothing when the plugin was already gone;
  it now purges the remaining state namespaces.
- Uninstall and purge on a locked file printed a raw `EBUSY`/`EPERM` stack; they
  now exit 2 with an instruction to stop the host and retry.
- `install` and `--verify` reported success while `TAWASSUL_HMAC_KEY_DIR` pointed
  at a directory without a key, which the runtime rejects at first signature;
  both now exit 2 before writing anything.
- `-Action cycle` archived the operator's real `~/.config/tawassul-v2` and
  `~/.local/share/tawassul-v2`, because `-GlobalDir` moved only the install root;
  a cycle now runs in an isolated home, leaves the real state untouched, and
  removes its own directory at the end.
- A Windows child process had no upper bound and reported nothing until it
  finished, which made the slow first run look frozen. Every installer step now
  prints its exit code and duration, and a step that exceeds the bound fails by
  name while its child is killed.
- A machine without `git` failed plugin init: `buildCodeStateTool` constructed
  `CodeStateService` during registry assembly, the constructor ran `git init`,
  and the resulting `Executable not found in $PATH` aborted the whole registry,
  leaving `astquery` and every other tool unregistered. The tool now builds the
  service lazily and returns a clear message while the remaining tools load.

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
- A validation suite: an 11-step fast gate, 153 isolated proofs, and a 4-step
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

- Native Windows has no database maintenance lane; the bundle and wasm lane has
  a native receipt.
- macOS has no automatic maintenance scheduler.
- No hosted documentation site, no npm package, no stable API promise.
- The evals stage is a pilot, not a benchmark.

[0.1.0-experimental]: docs/release-notes-0.1.0.md
