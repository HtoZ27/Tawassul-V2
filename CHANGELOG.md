# Changelog

All notable changes to Tawassul are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
semantic versioning with an explicit experimental suffix while the project is
pre-stable.

## [Unreleased]

### Added

- The roster rule in the `help` description and output: a foreign-project model
  now learns that `addagent` and `kick` change the roster and that the generated
  agent files are not hand-edited. Funded by description trims; the steady-state
  description total falls from 16,145 to 15,857 bytes. The provisional
  `tawassul-orientation` skill was retired by its probe: it loaded in one of eight
  foreign-project sessions, below its 0.5 kill threshold.
- A seeded `@addagent` agent description that presents the agent as the roster
  dispatcher: main sessions delegate with `subagent(agent: "addagent")` and pass
  the request unchanged. Only new projects receive it; existing `opencode.json`
  descriptions are preserved.
- A native Windows receipt for the bundle and wasm lane: install, verify,
  in-place upgrade, uninstall, purge, `icacls` ACL, a profile path with a space,
  a 275-character path, `C:`/`D:`/`F:` drives, host discovery, a live host load,
  and file locking. A current-lane receipt re-ran the flat layout on 2026-11-03:
  rebuild, install, in-place upgrade, 278-character path, and the security check.
- `scripts/windows-security-check.ps1`: an unattended Defender and SmartScreen
  receipt. It tags the bundle and `scripts/install-global.ts` with
  Mark-of-the-Web, runs install and verify, compares the detection count, and
  removes every tag; `-ProbeShellLaunch` adds the opt-in SmartScreen probe, which
  waits for a person by design.
- `scripts/windows-bounded.ps1`: one bounded process runner shared by both Windows
  scripts. It always returns the exit code, stdout, stderr, and elapsed seconds,
  and a timeout kills the child instead of waiting forever.
- `scripts/windows-ci.ps1`: a four-mode Windows gate (`cycle`, `pwsh7`,
  `longpath`, `ast`) that plants guard files in the real state, drives
  `scripts/install-global.ts` directly in an isolated home, and asserts exit
  codes, idempotence, in-place upgrade, purge, the three-ACE key ACL, and a
  278-character install path. `cycle` rebuilds the bundle and lowers the marker
  version to exercise the upgrade path; `-Log` writes the transcript. The `ast`
  mode runs `AstService` against the wasm assets the installer staged and parses
  TypeScript, TSX, and JavaScript, then imports the installed bundle and runs
  the real `astquery` queries. Each mode prints `verdict=PASS` or exits 1.
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

- An explicit `@addagent` request now reaches the model as delegation guidance:
  the main session calls the `subagent` tool with `agent: "addagent"` and passes
  the request unchanged instead of calling `addagent` or `kick` itself. The
  guidance is limited to a leading `@addagent` mention and is not sent to the
  addagent agent, so a quoted mention or the child session cannot trigger a
  self-delegation loop.
- Consent-gate messages now tell the model to wait for the user's reply before
  retrying; the gate itself is unchanged and still blocks high-impact tools.
- The release smoke and the global-boot proof now recognize the rewritten `help`
  overview, which no longer contains the old "Available tools" phrase. The smoke
  canary asserts the overview's identity line instead; the help bytes are
  unchanged.
- `install-global` no longer refuses on a retired v1 tree. The v1 folder is a
  reference archive, not a conflict: the installer proceeds beside it.
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
- `scripts/windows-security-check.ps1` reported PASS on install and verify alone
  even when purge failed; the verdict now requires a zero purge exit.
- `git grep -O` and `git grep --open-files-in-pager` are denied after the
  `git grep*` allow rule, so the pager cannot execute an arbitrary command.
- The local build staged the database scripts but not the four wasm files, so a
  project install ran the AST tools in the degraded mode; `build-v2.mjs` now
  stages them under `.opencode/tawassul-runtime/wasm`.
- `scripts/release-smoke.sh` failed on native Windows before it reached the host:
  it used a bash here-string, symlinked `node_modules` and `auth.json`, and
  looked only for POSIX host paths. It now uses a portable field split, copies on
  MSYS, finds the Desktop sidecar, and falls back to a Bun timeout when
  `timeout` is absent.
- `scripts/gate.ts` looked for `bash` on Windows, where Git ships only `sh`, and
  passed a Windows PATH to the shell. It now resolves `sh.exe`, converts PATH to
  the POSIX form, and exports `TAWASSUL_BUN` so smoke steps find Bun.

### Changed

- The host floor is `2.2.1`; the audited version is `2.3.0`. The installer, the
  isolated launcher, the release smoke, and the doctor refuse `2.2.0`, and the
  plugin refuses a reported version below `2.2.1` at both entry paths.

### Removed

- `scripts/windows-install.ps1` and `scripts/windows-install.cmd` and their
  `-StateRoot`/`-KeepState` knobs. `scripts/install-global.ts` is the only
  installer; `scripts/windows-ci.ps1` and `scripts/windows-security-check.ps1`
  drive it directly.

## [0.1.0-experimental]

The first public release. Experimental: the Linux lane is verified, and a
platform or host row without a receipt is not a support claim.

### Added

- A plugin runtime that adds eight agents, 44 tools, four skills, and
  one slash command to an OpenCode workspace.
- A goal ledger with items, definition-of-done criteria, evidence rules, and a
  mechanical close.
- Handoffs, mission boards, activity timelines, records, checkpoints,
  discussions with proposals and votes, and structured evaluation reports.
- Context packs that summarise a session and continue it in a successor,
  keyed per workspace.
- A global installer that writes the bundle durably, stages four wasm grammars,
  records a marker, verifies the artifact, and removes exactly what it wrote.
- A release pipeline: `pack.sh` writes a package tarball, a runtime archive, the
  self-contained bundle, an SBOM, notices, and `SHA256SUMS`; `install.sh`
  verifies the hashes and installs without Node or Bun.
- Per-project SQLite isolation keyed by an HMAC of the workspace path, with a
  maintenance ladder, verified backups, pruning, and a generation guard.
- A full public documentation set, enforced by `npm run check:docs` for links,
  language, allow-list, and tool/agent/skill coverage.
- A validation suite: a 14-step fast gate, 151 isolated proofs, and a 6-step
  smoke stage, with the counts generated from one manifest.

### Changed

- State lives under a v2 namespace with explicit precedence for
  `TAWASSUL_STATE_DIR`, `TAWASSUL_GLOBAL_DIR`, and the XDG bases.
- The installer refuses a target that carries no Tawassul marker instead of
  overwriting it, and reports the file it kept.
- A host newer than the audited `2.3.0` runs in untested mode behind a capability
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
