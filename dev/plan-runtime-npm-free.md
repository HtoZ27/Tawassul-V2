# Runtime npm-free plan

Status: v4, revised after the implementation review, 2026-11-07. Owner: Tawassul V2.
Supersedes v1 (first draft), v2 (post-sibling evaluation), and v3 (eight-agent
review).

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
| `src/bootstrap/plugin-init.ts:98` | Install message, no wasm phrase on that line | Same |

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
| R1 | A project's declared manager wins, but only while its executable is available; otherwise resolution falls through. Bun is never the first choice for project scripts. | Analyst consensus; `oh-my-opencode-slim` is Bun-first because it installs into a cache, not because it runs project scripts |
| R2 | Never dispatch bare `bun test`; the test check maps to `bun run test`, and no permission rule may allow bare `bun test`. | Bun runs its own runner for `bun test`, so Vitest/Jest projects would report wrong or empty results |
| R3 | Verify the script exists in `package.json` before any manager executes `run <name>`, with an explicit `cwd`; if `cwd` is absent, fail closed. | Closes `bun run <file>`, where Bun falls back to executing a file in the working directory |
| R4 | `bun` gets its own validator; the npm-shaped branch cannot be reused. | Bun's flag surface overlaps but is not identical (`-e`, `-p`, `x`, `--preload`, `--cwd`) |
| R5 | `BUN_BE_BUN=1` is set only for the `process.execPath` lane and never for npm, pnpm, yarn, or `ComSpec` children. The map is built inside `secure-exec`; no caller-supplied environment exists. | `opencode-power-pack` `buildChildEnvironment`; a leaked variable changes unrelated child behaviour |
| R6 | Probe `process.execPath` once with `BUN_BE_BUN=1 --version`, lazily, cache verdict and path, require bare Bun semver output, fail closed. | `oh-my-opencode-slim` host-binary lane; `node --version` also exits 0 |
| R7 | Windows: PATH/PATHEXT resolution, quoted-PATH splitting, absolute entries only, `ComSpec /d /s /c`, `windowsVerbatimArguments`, `windowsHide`, reject `%` and embedded quotes, `.exe` lane before `.cmd`. | `oh-my-opencode-slim` `src/utils/compat.ts`; `opencode-mem` trusted resolver |
| R8 | Resolve executables to absolute paths outside the project root; reuse `isInsideDir` from `src/utils/path-resolver.ts:160` instead of copying it. | `opencode-mem` `resolveTrustedGitCommand`; the project directory is untrusted |
| R9 | Every resolution step is availability-checked; lockfile probes use `path.join`, honour `.pnp.cjs`, and resolve multiple lockfiles deterministically. | Yarn PnP and Windows separators; analyst review |
| R10 | Never inject `--bun`, `--shell`, or an interpreter override; scripts keep the runtime their shebang or command line names. | `--bun` changes shebang semantics silently |
| R11 | State the limit: Tawassul stops requiring npm, but a project whose own scripts call `node` still needs Node. | `package.json` dev scripts use `node` directly |
| R12 | Provide pure seams for tests: platform, `PATH`, `PATHEXT`, `ComSpec`, and the probe spawner are injectable parameters of exported functions, not environment variables. | Windows and non-Bun-host rows are otherwise untestable on Linux |

## Design

### 1. Runner resolution (`src/utils/package-manager.ts`, new)

Exports:

- `type PackageManager = "bun" | "pnpm" | "yarn" | "npm"`.
- `type Runner = { kind: "path"; manager: PackageManager; exe: string } | { kind: "host-bun"; exe: string }`.
- `type RunnerResolution` = `{ kind: "runner"; runner: Runner; source: "override" | "packageManager" | "lockfile" | "bun" | "npm"; skipped: PackageManager[] }` | `{ kind: "override-unavailable"; manager: PackageManager }` | `{ kind: "override-invalid"; value: string }` | `{ kind: "pnp-unavailable"; skipped: PackageManager[] }` | `{ kind: "none"; skipped: PackageManager[] }`.
- `resolveProjectRunner(dir, options)` is async and accepts an injected
  `probeHostBun(exe): Promise<boolean>`, so the module still spawns nothing
  (R12). It resolves in this order:
  1. `TAWASSUL_PACKAGE_MANAGER`, only when the named executable exists. An
     explicit override that is unavailable returns `override-unavailable`; an
     unparsable value returns `override-invalid`. Neither falls through
     silently.
  2. The `packageManager` field in `package.json` (strip `@version`), only when
     its executable exists; otherwise fall through and record the skip reason.
  3. The lockfile manager, only when its executable exists:
     `bun.lock`/`bun.lockb`, `pnpm-lock.yaml`, `yarn.lock`,
     `package-lock.json`/`npm-shrinkwrap.json`, with a `.pnp.cjs` guard that
     keeps Yarn PnP on yarn (R1, R9).
  4. `bun` on `PATH`, else `process.execPath` as a `host-bun` candidate. The
     candidate is returned only when the injected probe accepts it; otherwise
     resolution continues to step 5 (R6, R12).
  5. `npm` on `PATH`, preserving today's behaviour for a host without Bun and a
     project without a lockfile.
  6. `{ kind: "none", skipped }`.
- Multiple lockfiles: newest modification time wins; ties break in the order
  pnpm, yarn, bun, npm. With `.pnp.cjs` present, yarn wins outright and is
  reported as unavailable rather than falling through to Bun.
- `readPackageScripts(dir)` and `hasScript(dir, name)`.
- `findExecutable(name, context)` resolves only absolute `PATH` entries,
  through `PATHEXT` on Windows and the executable bit on POSIX, and rejects a
  candidate inside the project directory via the exported `isInsideDir`
  (R7, R8). Every allowed binary is resolved to an absolute path on every
  platform, so the spawn lane is identical on POSIX and win32.
- `resolveSpawnPlan(exe, args, context)` is pure: it returns the executable,
  argument vector, and optional `ComSpec` wrapper, with `platform`, `pathEnv`,
  `pathExt`, `comSpec`, and `projectRoot` injected (R12). The child environment
  is built separately from the `Runner` descriptor in `secure-exec`.
- The module imports no `node:child_process`; a unit check asserts zero spawn
  imports (R12).
- `src/utils/path-resolver.ts` exports `isInsideDir` with an optional
  `platform` argument defaulting to `process.platform`, so win32 case folding
  is testable on Linux; no copy is added. The existing scanners in
  `src/core/install-lane.ts:36` and `src/services/code-state.ts:30` stay
  untouched; consolidating them is a separate follow-up.

Running project scripts keeps the project's declared manager first, so npm,
pnpm, and yarn semantics are preserved. Bun is the fallback that makes an
npm-less machine work (R1).

### 2. Execution guard (`src/utils/secure-exec.ts`)

- Add `bun` to the allowlist with a dedicated validator (R4):
  - allow `--version`/`-v` and `run <script>` for `PKG_SAFE_SCRIPTS`
    (`lint`, `typecheck`, `test`, `build`) with output-only flags;
  - reject bare `test`, because it starts Bun's own runner (R2);
  - deny `-e`, `--eval`, `-p`, `--print`, `x`, `install`, `add`, `remove`,
    `link`, `update`, `create`, `publish`, `pm`, `repl`, `--preload`,
    `--env-file`, `--cwd`, `--filter`, `--bun`, `--shell`, and direct file
    paths.
- Widen only through a deliberate `PKG_SAFE_SCRIPTS` change with its own denial
  proof. `quality-report` runs only `lint`, `typecheck`, and `test`; anything
  else is out of contract.
- Reject `run <name>` when `package.json` has no such script, for every manager,
  using the explicit `options.cwd` (R3). Without `cwd`, `run <name>` is
  rejected rather than unchecked.
- Reject `--require`, `-r`, `--import`, `--loader`, `--preload`, and `--exec`
  in test arguments for every manager.
- Probe `process.execPath` lazily, once, with `BUN_BE_BUN=1` and `--version`;
  accept only bare semver (`^\d+\.\d+\.\d+`) so `node --version` output (`v22...`)
  is rejected; cache verdict and path; fall back to `PATH` bun and then to a
  clear error (R5, R6).
- Build the child environment as `{ ...process.env, BUN_BE_BUN: "1" }` only
  for the `host-bun` runner. Path runners receive `{ ...process.env }` with no
  extra key (R5).
- On Windows resolve bare names through PATH/PATHEXT and run `.cmd`/`.bat`
  through `ComSpec /d /s /c` with a pre-quoted command line,
  `windowsVerbatimArguments: true`, and `windowsHide: true`. Reject arguments
  containing `%` or an embedded quote, and ignore relative `PATH` entries
  (R7). On win32 the `process.execPath` `.exe` lane is tried before a `.cmd`
  shim, because `execFile` cannot start shims at all.
- Never pass `--bun`, `--shell`, or a script interpreter override (R10).
- Keep `src/tools/search-and-diff.ts` behaviour unchanged; it is the other
  `secure-exec` consumer and must pass its existing proofs.
- `npx` behaviour is unchanged; this plan does not widen it.

### 3. Quality report (`src/tools/quality-report.ts`)

- Delete `detectPackageManager`; use `resolveProjectRunner` and the
  `PKG_SAFE_SCRIPTS` table exported by `secure-exec`. There is no third
  command table.
- Map the test check to `bun run test`, never `bun test` (R2).
- Use one argv shape for every manager: `["run", script]`. Drop the
  `--reporter=verbose` and `--verbose` special cases so npm, pnpm, yarn, bun,
  and host Bun behave identically.
- Skip checks whose script is absent from `package.json` and report
  `not defined` instead of a false failure (R3), using the new keys
  `qualityReportStatusNotDefined` and `qualityReportNotDefinedOutput`.
- When no runner exists, return one message: `qualityReportNoPackageManager` in
  `src/i18n/en.json` and `src/i18n/ar.json` with identical placeholders. An
  unavailable explicit override uses `qualityReportRunnerUnavailable` with the
  same placeholder discipline.
- Keep the resolved manager in the report header, printed only after
  resolution succeeds.
- Pass an explicit `cwd` to every `secureExec` call.

### 4. Permissions (`src/permissions.ts`)

Add only these allow rules, next to the npm block at `permissions.ts:64-85`:

```
"bun --version": "allow",
"bun -v": "allow",
"bun run lint": "allow",
"bun run typecheck": "allow",
"bun run test": "allow",
"bun run build": "allow",
"bun run lint && bun run typecheck": "allow",
"bun run lint; bun run typecheck": "allow",
```

Add these deny rules next to the existing interpreter denies at
`permissions.ts:95-103`:

```
"bun test*": "deny",
"bun install*": "deny",
"bun add*": "deny",
"bun remove*": "deny",
"bun link*": "deny",
"bun x*": "deny",
"bunx *": "deny",
"bun *-e*": "deny",
"bun *--eval*": "deny",
"bun *--preload*": "deny",
```

No `bun lint` or `bun typecheck` shorthand: Bun script shorthand is not part of
the contract. The deny entries sit after the allow block, following the file's
existing convention, and every deny above has a matching denial case in
`scripts/prove-s017.ts`.

Regenerate `opencode.json` with `bun src/scripts/gen-opencode-config.ts` and
`src/FACTS.md` with `bun src/scripts/facts.ts write`. Permission counts feed
the capability manifest, so both files must be current.

### 5. Template and messages

- `src/services/spec-driven/types.ts:328`: keep `runCommand` optional and replace
  the `"npm test"` default with `qualityreport(checks: ["test"])`; update the
  description to "Test command or tool invocation". Making it required would
  break `createSpecFromTemplate`, which returns `null` when a required variable
  is missing (`src/services/spec-driven/manager.ts:108-117`); removing the
  default without a replacement would render an empty line after `Run:`.
- `src/services/ast-service.ts:28`: keep the phrase
  `tawassul-runtime/wasm is missing`, replace the fix line with
  `reinstall the plugin (see docs/installation.md)`.
- `src/bootstrap/plugin-init.ts:98`: replace only the install-message
  substring; that line has no wasm phrase.
- Verify the linked section of `docs/installation.md` does not itself require
  npm. If it does, point at the manual plugin-copy section instead. Do not
  change the installer.
- Update the assertions in `scripts/prove-partial-install.ts:102,147`.
  The installer assertion in `scripts/prove-global-install.ts:766` stays
  unchanged because the installer is out of scope and its warning remains
  correct for the dependency-install lane.

### 6. Proofs and documentation

- Extend `scripts/prove-s017.ts`:
  - table-driven resolver cases over the six steps and both platforms, with
    injected `PATH`, `PATHEXT`, and `projectRoot`: `packageManager: npm@10`
    with no npm resolves to `host-bun`; a Node `process.execPath` yields no
    runner and spawns nothing; win32 yields the `.exe` lane. Win32 filesystem
    cases use POSIX temp paths with injected win32 semantics; drive-letter
    parsing is covered by the pure PATH-splitting and command-line builders;
  - deny `bun install`, `bun -e`, `bunx`, bare `bun test`, `--cwd`, `--filter`,
    `--preload`, `--env-file`;
  - deny `bun run` with no `cwd` and with a script absent from `package.json`;
  - probe tests with an injected spawner returning Bun output and Node output;
  - assert `runnerEnvironment` adds `BUN_BE_BUN: "1"` only for the host lane and drops an inherited `BUN_BE_BUN` from a path runner;
  - assert a Yarn PnP project without yarn returns `pnp-unavailable` and never reaches Bun or npm;
  - assert the resolver module imports no child-process API;
  - run `secureExec("bun", ["--version"])` to prove the resolved Bun lane.
- Update the `denied === 6` counter at `scripts/prove-s017.ts:141` when cases
  are added; do not hardcode a stale count.
- No new proof file, so `PINNED_PROOF_STEPS`, `scripts/proof-shards.json`, and
  the generated count stay untouched. Regenerate with
  `bun scripts/generate-proof-count.ts` only if a proof is added.
- `docs/tools.md`: describe the package-manager behaviour.
- `docs/environment.md`: document `TAWASSUL_PACKAGE_MANAGER`.
- Restate R11 in both docs.

## Work packages

| WP | Files | Requirements | Exit check |
| --- | --- | --- | --- |
| WP1 | `src/utils/package-manager.ts` (new), `src/utils/path-resolver.ts` (export `isInsideDir`), resolver cases in `scripts/prove-s017.ts` | R1, R6, R7, R8, R9, R12 | Typecheck; resolver cases pass; module imports no child-process API |
| WP2 | `src/utils/secure-exec.ts`, denial cases in `scripts/prove-s017.ts` | R2-R8, R10, R12 | Existing `prove-s017` passes; `search-and-diff` proofs unchanged |
| WP3 | `src/tools/quality-report.ts`, `src/i18n/en.json`, `src/i18n/ar.json` | R2, R3, R9 | Resolver is the only detection path; clear no-runner messages; key parity |
| WP4 | `src/permissions.ts`, `opencode.json`, `src/FACTS.md` | Permissions only | Regenerated files are byte-stable on a second run |
| WP5 | `src/services/spec-driven/types.ts`, `src/services/ast-service.ts`, `src/bootstrap/plugin-init.ts`, `scripts/prove-partial-install.ts` | R11 | No runtime `npm test` default; template instantiation still succeeds; assertions updated |
| WP6 | `docs/tools.md`, `docs/environment.md`, full gate | All | `bun scripts/gate.ts fast`, build, full proof stage |

Order is WP1, WP2, WP3, WP5, WP4, WP6. WP1 and WP2 are pure and land before
any consumer changes, so a failure cannot be masked by the tool layer. Each WP
adds its own proof cases; WP6 runs the complete gate.

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

Eight independent reviews of v2; all eight returned REVISE. Confirmed defects
fixed in v3:

- the permission block was an unlabeled fence that would have allowed
  `bun test*`, `bun install*`, `bun x*`, and `bun *-e*`, and omitted
  `bun run test`; it is now split into explicit allow and deny lists;
- resolution steps 1-2 were not availability-checked, so a declared but
  uninstalled manager blocked the Bun lane;
- `BUN_BE_BUN` was merged for every child, and the probe accepted any successful
  `--version`, including Node's;
- WP1 could not be spawn-free while returning a probed binary, and
  `secure-exec` needed `hasScript` from WP1: the resolver now returns an
  unprobed `host-bun` descriptor and `secure-exec` owns the cache;
- a project without a lockfile on a non-Bun host lost the npm fallback;
- the "shared command table" had no owning work package;
- `runCommand` cannot become required without breaking
  `src/services/spec-driven/manager.ts:108-117`;
- Windows and non-Bun-host rows needed injectable seams, now R12.

Adjudicated dissent: `analyst-gemini` proposed widening `bun run` to any script
in `package.json`. Rejected. `quality-report` runs only three checks,
`PKG_SAFE_SCRIPTS` already holds the four allowed names, and an any-script gate
would make the proof surface unbounded. Extension requires a deliberate
`PKG_SAFE_SCRIPTS` change with its own denial proof.

The v4 implementation review found three gaps, now fixed:

- a Yarn PnP project (`.pnp.cjs`) without yarn fell through to Bun or npm; it
  now returns `pnp-unavailable` and the report names the missing yarn;
- the `BUN_BE_BUN` isolation had no proof; `runnerEnvironment` is the single
  builder and its path and host rows are asserted;
- a report whose scripts were all absent counted skipped checks as passed; the
  summary now counts only executed checks and has a dedicated all-skipped
  message.

## Acceptance criteria

- `qualityreport` succeeds in a project with `package-lock.json` on a machine
  with no npm and no Bun on `PATH`, using the host's embedded Bun.
- `qualityreport` succeeds in a project with `bun.lock` and no npm.
- A project declaring `packageManager: "npm@10"` with no npm installed resolves
  to the host Bun lane instead of failing.
- A Yarn PnP project without yarn reports the missing yarn and does not
  downgrade to Bun or npm.
- With no runner at all (non-Bun host, empty `PATH`), one clear message.
- Resolver cases cover all six steps on posix and win32 and assert the
  resolved runner, including the `.exe` lane and the Node `execPath` rejection.
- `bun install`, `bun -e`, `bunx`, bare `bun test`, and `bun test --preload`
  are rejected by `secureExec`; no permission rule allows them.
- `npm test -- --require=...` is rejected.
- `BUN_BE_BUN` is absent from the environment of npm, pnpm, yarn, and
  `ComSpec` children.
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
| Linux, no lockfile, npm on `PATH`, non-Bun host | npm | `npm run <script>` |
| Non-Bun host, empty `PATH` | none | `qualityReportNoPackageManager`, one message |
| Any platform, Yarn PnP without yarn | none | `qualityReportPnpUnavailable`, no downgrade |
| Windows, npm project, no npm | host `.exe` + `BUN_BE_BUN` | Bun lane, no `.cmd` shim |
| Windows, npm on `PATH` only | `ComSpec /d /s /c` | npm runs through `cmd.exe` |
| Any platform, undefined script | any runner | Reported `not defined`, never executed |

Linux rows run in the gate through injected seams. Windows rows are covered by
the pure `resolveSpawnPlan` table on Linux plus one native Windows run before
release.

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
- Yarn PnP without a yarn executable has no fallback; this is reported, not
  silently downgraded.
- The reworded messages must not point at an npm-only installation section.

## Out of scope

- `install.sh`, `scripts/install-global.ts`, and the installer lane.
- `package.json` dev scripts, `scripts/gate-manifest.json`, `pack.sh`,
  `release-smoke.sh`, CI workflows, and release artifacts.
- Consolidating the existing PATH scanners in `src/core/install-lane.ts:36`
  and `src/services/code-state.ts:30`.
