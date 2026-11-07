# Runtime npm-free plan

Status: revised after sibling-project evaluation, 2026-11-07. Owner: Tawassul V2.
This revision supersedes the first draft written earlier the same day.

## Goal

No Tawassul runtime feature may require Node.js, npm, npx, pnpm, or yarn to be
installed on the user's machine. Installation and the developer/release
toolchain are out of scope.

## Problem

| Location | Current behaviour | Effect without npm |
| --- | --- | --- |
| `src/tools/quality-report.ts:51-72` | `detectPackageManager` defaults to `"npm"`; runs `npm run lint`, `npm run typecheck`, `npm test` | Three `ENOENT` failures |
| `src/utils/secure-exec.ts:6,54-61` | Allowlist is `rg`, `git`, `npm`, `pnpm`, `yarn`, `npx` | Bun cannot be used at all |
| `src/permissions.ts:64-85` | Agent bash allows npm/pnpm/yarn scripts only | Agents cannot run project checks under Bun |
| `src/services/spec-driven/types.ts:328` | `runCommand` default is `"npm test"` | Generated task specs instruct npm |
| `src/services/ast-service.ts:28` | Message says `npm run install:global` | Wrong instruction on an npm-less host |
| `src/bootstrap/plugin-init.ts:98` | Same instruction | Same |

An additional defect: `execFile("npm")` cannot launch the `.cmd` shim that npm
installs on Windows, so the current quality-report lane is already broken on
Windows even when npm is present.

## Evidence

The OpenCode host is a Bun-compiled binary. Verified locally on OpenCode 2.2.6:

```
opencode-cli --version                      -> opencode v2.2.6
BUN_BE_BUN=1 opencode-cli --version         -> 1.4.4
BUN_BE_BUN=1 opencode-cli run hello         -> executes the package.json script
execFile(host, ["run","hello"], {env:{BUN_BE_BUN:"1"}}) -> exit 0 in 30ms
```

`BUN_BE_BUN=1` is Bun's supported way to make a compiled executable behave as
the Bun CLI. Therefore every OpenCode install already ships a usable Bun.

## Hard requirements

These are normative. Every design item below cites them by ID, and the proof
stage must cover each one.

| ID | Requirement | Source |
| --- | --- | --- |
| R1 | A project's declared manager wins; Bun is a fallback, never the first choice for project scripts. | Analyst consensus; `oh-my-opencode-slim` is Bun-first because it installs into a cache, not because it runs project scripts |
| R2 | Never dispatch bare `bun test`; the test check maps to `bun run test`. | Bun runs its own runner for `bun test`, so Vitest/Jest projects would report wrong or empty results |
| R3 | Verify the script exists in `package.json` before any manager executes `run <name>`. | Closes `bun run <file>`, where Bun falls back to executing a file in the working directory |
| R4 | `bun` gets its own validator; the npm-shaped branch cannot be reused. | Bun's flag surface overlaps but is not identical (`-e`, `-p`, `x`, `--preload`, `--cwd`) |
| R5 | The child environment is `{ ...process.env, BUN_BE_BUN: "1" }`, built inside `secure-exec`; no caller-supplied map. | `opencode-power-pack` `buildChildEnvironment`; replacing `process.env` drops `SystemRoot`/`PATH` on Windows |
| R6 | Probe `process.execPath` once with `BUN_BE_BUN=1 --version`, cache verdict and path, fail closed. | `oh-my-opencode-slim` host-binary lane; `process.execPath` can be a wrapper |
| R7 | Windows: PATH/PATHEXT resolution, quoted-PATH splitting, absolute entries only, `ComSpec /d /s /c`, `windowsVerbatimArguments`, `windowsHide`, reject `%` and embedded quotes. | `oh-my-opencode-slim` `src/utils/compat.ts`; `opencode-mem` trusted resolver |
| R8 | Resolve executables to absolute paths outside the project root. | `opencode-mem` `resolveTrustedGitCommand`; the project directory is untrusted |
| R9 | Lockfile-first detection with a `.pnp.cjs` guard; probes use `path.join`. | Yarn PnP and Windows separators; analyst review |
| R10 | Never inject `--bun`, `--shell`, or an interpreter override; scripts keep the runtime their shebang or command line names. | `--bun` changes shebang semantics silently |
| R11 | State the limit: Tawassul stops requiring npm, but a project whose own scripts call `node` still needs Node. | `package.json` dev scripts use `node` directly |

## Design

### 1. Runner resolution (`src/utils/package-manager.ts`, new)

Exports:

- `type PackageManager = "bun" | "pnpm" | "yarn" | "npm"`.
- `resolveProjectRunner(dir, options)` in this order:
  1. `TAWASSUL_PACKAGE_MANAGER` when it names an allowed manager.
  2. The `packageManager` field in `package.json` (strip `@version`).
  3. The lockfile manager, only when its executable exists:
     `bun.lock`/`bun.lockb`, `pnpm-lock.yaml`, `yarn.lock`,
     `package-lock.json`/`npm-shrinkwrap.json`, with a `.pnp.cjs` guard that
     keeps Yarn PnP on yarn (R1, R9).
  4. Bun: a `bun` executable on `PATH`, else the probed host binary
     (`process.execPath` with `BUN_BE_BUN=1`).
  5. `undefined`.
- `readPackageScripts(dir)` and `hasScript(dir, name)`.
- `findExecutable(name, env, platform)` resolves only absolute `PATH` entries,
  through `PATHEXT` on Windows and the executable bit on POSIX, and rejects a
  candidate that lives inside the project directory (R7, R8).
- Lockfile probes use `path.join`, never string concatenation.
- The resolver performs no spawning; every probe lives in `secure-exec`, so the
  module stays unit-testable without a child process.

Running project scripts keeps the project's declared manager first, so npm,
pnpm, and yarn semantics are preserved. Bun is the fallback that makes an
npm-less machine work (R1).

### 2. Execution guard (`src/utils/secure-exec.ts`)

- Add `bun` to the allowlist with a dedicated validator (R4):
  - allow `--version`/`-v` and `run <lint|typecheck|test|build>` with
    display-only flags;
  - reject bare `test`, because it starts Bun's own runner (R2);
  - deny `-e`, `--eval`, `-p`, `--print`, `x`, `install`, `add`, `remove`,
    `link`, `update`, `create`, `publish`, `pm`, `repl`, `--preload`,
    `--env-file`, `--cwd`, `--filter`, `--bun`, `--shell`, and direct file
    paths.
- Reject `run <name>` when `package.json` has no such script, for every manager
  (R3). This closes the `bun run <file>` fallback where Bun executes a file in
  the working directory.
- Reject `--require`, `-r`, `--import`, `--loader`, `--preload`, and `--exec`
  in test arguments for every manager.
- Resolve `bun` to a `PATH` binary, else to `process.execPath` with an internal
  `BUN_BE_BUN=1`. Probe `process.execPath --version` once under that variable,
  cache both the verdict and the resolved path, and fall back to `PATH` and
  then to a clear error (R5, R6).
- Build the child environment as `{ ...process.env, BUN_BE_BUN: "1" }` inside
  this module. No caller-supplied map exists, so `NODE_OPTIONS` and `LD_PRELOAD`
  cannot be injected through this API (R5).
- On Windows resolve bare names through PATH/PATHEXT and run `.cmd`/`.bat`
  through `ComSpec /d /s /c` with a pre-quoted command line,
  `windowsVerbatimArguments: true`, and `windowsHide: true`. Reject arguments
  containing `%` or an embedded quote, and ignore relative `PATH` entries
  (R7). On win32 the `process.execPath` `.exe` lane is tried before a `.cmd`
  shim, because `execFile` cannot start shims at all.
- Never pass `--bun`, `--shell`, or a script interpreter override; project
  scripts keep the runtime their shebang or command line names (R10).
- `npx` behaviour is unchanged; this plan does not widen it.

### 3. Quality report (`src/tools/quality-report.ts`)

- Delete `detectPackageManager`; use `resolveProjectRunner` and the shared
  command table.
- Map the test check to `bun run test`, never `bun test` (R2).
- Skip checks whose script is absent from `package.json` and report
  `not defined` instead of a false failure (R3).
- When no runner exists, return one message:
  `qualityReportNoPackageManager` in `src/i18n/en.json` and `src/i18n/ar.json`
  with identical placeholders.
- Keep the resolved manager in the report header, and print it only after
  resolution succeeds.

### 4. Permissions (`src/permissions.ts`)

Add bun rules after the npm block:

```
bun --version, bun -v
bun run lint, bun run typecheck, bun test*
bun lint, bun typecheck
bun run lint && bun run typecheck   (and the ; form)
bun lint && bun typecheck           (and the ; form)
bun install*, bun add*, bun remove*, bun x*, bunx *, bun *-e*, bun *--eval*
```

Regenerate `opencode.json` with `bun src/scripts/gen-opencode-config.ts` and
`src/FACTS.md` with `bun src/scripts/facts.ts write`. Permission counts feed
the capability manifest, so both files must be current.

### 5. Template and messages

- `src/services/spec-driven/types.ts:328`: make `runCommand` required and remove
  the `"npm test"` default; describe it as the project's test command. The
  template has no callers today, so this has no runtime side effect.
- `src/services/ast-service.ts:28`: keep the phrase
  `tawassul-runtime/wasm is missing`, replace the fix line with
  `reinstall the plugin (see docs/installation.md)`.
- `src/bootstrap/plugin-init.ts:98`: same replacement.
- Update the assertions in `scripts/prove-partial-install.ts:102,147`.
  The installer assertion in `scripts/prove-global-install.ts:766` stays
  unchanged because the installer is out of scope and its warning remains
  correct for the dependency-install lane.

### 6. Proofs and documentation

- Extend `scripts/prove-s017.ts`:
  - deny `bun install`, `bun -e`, `bunx`, and bare `bun test`;
  - deny `bun run` for a script absent from `package.json`;
  - deny `--cwd`, `--filter`, `--preload`, `--env-file` for bun;
  - run `secureExec("bun", ["--version"])` to prove the resolved Bun lane;
  - pure resolver tests with temp lockfiles and injected `PATH`/platform.
- No new proof file, so `PINNED_PROOF_STEPS`, `scripts/proof-shards.json`, and
  the generated count stay untouched. Regenerate with
  `bun scripts/generate-proof-count.ts` only if a proof is added.
- `docs/tools.md`: describe the package-manager behaviour.
- `docs/environment.md`: document `TAWASSUL_PACKAGE_MANAGER`.
- Restate R11 in both docs.

## Work packages

| WP | Files | Requirements | Exit check |
| --- | --- | --- | --- |
| WP1 | `src/utils/package-manager.ts` (new) | R1, R6, R7, R8, R9 | Unit tests and typecheck; no spawn in the module |
| WP2 | `src/utils/secure-exec.ts` | R2-R8, R10 | Existing `prove-s017` still passes; new denial cases fail closed |
| WP3 | `src/tools/quality-report.ts`, `src/i18n/en.json`, `src/i18n/ar.json` | R2, R3, R9 | Resolver is the only detection path; one no-runner message; key parity |
| WP4 | `src/permissions.ts`, `opencode.json`, `src/FACTS.md` | Permissions only | Regenerated files are byte-stable on a second run |
| WP5 | `src/services/spec-driven/types.ts`, `src/services/ast-service.ts`, `src/bootstrap/plugin-init.ts`, `scripts/prove-partial-install.ts` | R11 | No runtime `npm test` default left; assertions updated |
| WP6 | `scripts/prove-s017.ts`, `docs/tools.md`, `docs/environment.md` | All | `bun scripts/gate.ts fast`, build, proofs |

Order is WP1, WP2, WP3, WP5, WP4, WP6. WP1 and WP2 are pure and land before
any consumer changes, so a failure cannot be masked by the tool layer.

## Prior art in sibling projects

| Project | Approach | Verdict |
| --- | --- | --- |
| `oh-my-opencode-slim-3.0.6` | `resolvePackageInstallCommand`: host runtime with `BUN_BE_BUN=1` first, then PATH bun, then PATH npm; merged env; mature Windows PATH/PATHEXT resolver, `cmd.exe` quoting, `windowsVerbatimArguments`, `windowsHide`; ignores relative PATH entries | **Adopt the mechanics** (R5-R8); invert the order (R1) because it installs rather than runs project scripts. Reimplemented, MIT reference |
| `opencode-agent-orchestration-kit-1.2.0` | Node-first (`engines.node`), uses `npx` at runtime; `BUN_BE_BUN=1` only in a compatibility smoke | Does not solve no-Node; the smoke confirms the host-binary trick |
| `opencode-power-pack-0.6.0` | Node-first; sandbox with environment allowlist, deny-by-default filesystem/network | Adopt the env-allowlist principle (R5); no Bun runner |
| `opencode-mem-2.39.0` | Bun for dev/test; runtime spawns git with a trusted-path resolver on Windows | Adopt absolute paths, canonicalisation, and the untrusted-root check (R8) |
| `opencode-cursor-2.5.17` | Ships a Go binary; installer prefers npm, falls back to Go or bun | Not applicable; native binary is heavier than needed |
| `opencode-morph-fast-apply-1.12.0` | No subprocess; declares `packageManager: bun@1.3.14` | Nothing to reuse |
| `opencode-senses-0.3.0` | Spawns a Python runtime with per-platform venv paths | Not applicable; confirms cross-platform spawn needs explicit paths |

## Review record

Six independent analyst reviews of the first draft: five REVISE, one APPROVE
with mandatory corrections. The corrections that changed this document are R2
(no `bun test`), R3 (script-existence check), R4 (dedicated validator), R5
(internal env), R6 (probe and cache), R7 (Windows `cmd.exe` lane), and R9
(lockfile-first). The remaining findings were already covered or are recorded
as risks.

## Acceptance criteria

- `qualityreport` succeeds in a project with `package-lock.json` on a machine
  with no npm and no Bun on `PATH`, using the host's embedded Bun.
- `qualityreport` succeeds in a project with `bun.lock` and no npm.
- With no runner at all (non-Bun host, empty `PATH`), one clear message.
- `bun install`, `bun -e`, `bun run <undefined>`, `bunx`, bare `bun test`, and
  `bun test --preload` are rejected by `secureExec`.
- `npm test -- --require=...` is rejected.
- `opencode.json`, `src/FACTS.md`, and the i18n tables are current.
- `bun scripts/gate.ts fast` and the proof stage pass.
- No installation, release, or developer-script behaviour changes.

Verification matrix:

| Scenario | Available runner | Expected |
| --- | --- | --- |
| Linux, npm project, no npm, host is Bun | `process.execPath` + `BUN_BE_BUN` | All defined checks run through Bun |
| Linux, bun lockfile, no npm | `PATH` bun or host binary | `bun run <script>` |
| Linux, pnpm lockfile, pnpm on `PATH` | pnpm | `pnpm run <script>` |
| Linux, no lockfile, no manager, host is Bun | host binary | `bun run <script>` |
| Non-Bun host, empty `PATH` | none | `qualityReportNoPackageManager`, one message |
| Windows, npm project, no npm | host `.exe` + `BUN_BE_BUN` | Bun lane, no `.cmd` shim |
| Windows, npm on `PATH` only | `ComSpec /d /s /c` | npm runs through `cmd.exe` |
| Any platform, undefined script | any runner | Reported `not defined`, never executed |

## Risks

- `BUN_BE_BUN` is verified on Linux; a Windows run must confirm
  `opencode-cli.exe` honours it.
- `process.execPath` may be a wrapper on some installs; the probe must fail
  closed and fall back (R6).
- Running package scripts executes project-authored code under the same trust as
  npm; the guard limits which scripts can be reached, not what a script does.
- Project scripts that call `node` directly still need Node (R11).
- The `cmd.exe` wrapper widens the quoting surface; arguments containing `%` or
  embedded quotes are rejected rather than escaped.

## Out of scope

- `install.sh`, `scripts/install-global.ts`, and the installer lane.
- `package.json` dev scripts, `scripts/gate-manifest.json`, `pack.sh`,
  `release-smoke.sh`, CI workflows, and release artifacts.
