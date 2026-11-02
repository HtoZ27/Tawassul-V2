# Windows install cycle — native receipt

- Date: 2026-11-02
- Verdict: **native Windows receipt.** Acceptance item 20 is satisfied for the
  bundle and wasm lane on Windows x64.
- Machine: Windows 10 IoT Enterprise LTSC 21H2, build 19044, x64
- CPU: Intel Core i5-2320 (Sandy Bridge, no AVX2)
- Drives exercised: `C:`, `D:`, `F:`
- Host: OpenCode Desktop 2.2.5, sidecar
  `%LOCALAPPDATA%\Programs\ai.opencode.desktop\resources\opencode-cli.exe`,
  `opencode-cli.exe --version` prints `opencode v2.2.5`
- Bun: 1.3.14 **baseline** (`bun-windows-x64-baseline`). The normal build aborts
  with `Illegal instruction` on this no-AVX2 host. Bun 1.4.4 runs, but it hit the
  same zod locale cycle while the build bug below was present.
- Build under test: `dist\global.js`, 2,386,529 bytes,
  sha256 `05f4c4abaeeef85a8c7a426481d7efe64fcdf75fd8e3916b3903f6791b5115c2`,
  content digest `4cf5e97dfb1f`. Earlier sub-runs in the tables below record their
  own marker hashes.
- Project entry: `.opencode\plugins\tawassul.js`, byte-identical to `dist\index.js`
  (2,139,581 bytes). The host discovers the plural directory without a
  configuration edit, so acceptance item 17 holds on this build.
- Reproduce: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows-install.ps1 -Action cycle -GlobalDir <path>`
  from Windows PowerShell 5.1 or PowerShell 7. `scripts\windows-install.cmd` is an
  optional compatibility shim around the same script, not part of the primary
  lane.

## Defects this run found and fixed

1. **Native build was impossible.** `build-v2.mjs` derived the zod locale file
   name with `args.path.lastIndexOf("/")`. On Windows the path uses `\`, so the
   base name became the whole path, the guard never matched `en.js`, and the
   English-locale plugin rewrote `zod/v4/locales/en.js` to re-export itself:
   `error: Detected cycle while resolving import "default"`. The separator is now
   resolved with `lastIndexOf("/")` and `lastIndexOf("\\")`, and the native build
   completes.
2. **Host discovery missed the real Desktop layout.** `hostCandidates()` only
   looked in `%LOCALAPPDATA%\ai.opencode.desktop\cli` and
   `~/.config/ai.opencode.desktop/cli`. The shipped Desktop puts the sidecar in
   `%LOCALAPPDATA%\Programs\ai.opencode.desktop\resources\opencode-cli.exe`
   (machine-wide: `%ProgramFiles%\ai.opencode.desktop\resources\...`). Without
   this the installer silently fell back to `v2.2.1` and never recorded the real
   host. The installer now discovers `v2.2.5` and warns that it is newer than the
   audited `v2.2.1`.
3. **Long paths skipped the key ACL.** `icacls` is a Win32 tool and fails past
   `MAX_PATH` with "path not found". The installer only warned and continued,
   leaving the key directory with inherited ACLs while reporting a successful
   install. `windowsAclPath()` now prefixes paths of 260 characters or more with
   `\\?\` (and `\\?\UNC\` for UNC), and `icacls` applies the restriction at a
   275-character path.
4. **Purge was skipped when the plugin was already gone.** `--uninstall --purge
   --yes` returned early with "nothing installed" and archived nothing while the
   state namespaces still existed. The early return now releases ownership and
   runs the purge.
5. **Locked files produced a raw stack.** Uninstall on a locked bundle printed
   `EBUSY ... rm` with a stack trace and exit 1; purge on a locked state file did
   the same with `EPERM`. Both now fail with an actionable message and exit 2,
   and succeed when retried after the handle is released.
6. **An unusable operator key directory passed verification.** With
   `TAWASSUL_HMAC_KEY_DIR` pointing at a directory that held no key, `install`
   and `--verify` both reported success, while `wrapWithHmac` threw
   `HmacKeyUnavailableError` on first use. The installer now pre-checks an
   explicit key directory on both commands and exits 2 with the key path, the
   expected size, and both remedies.
7. **A missing git aborted the whole tool registry.** `buildCodeStateTool` ran
   `new CodeStateService(...)` while the registry was being assembled, and that
   constructor calls `git init`. On a machine without git it threw
   `Executable not found in $PATH: "git"`, aborted the registry build, and left
   every tool unregistered, including `astquery`. The service factory already had
   a null-service fallback; the tool now builds its service lazily, logs the
   degradation, and returns a clear "Code snapshots need git on PATH" message
   while the remaining tools register normally. `scripts/prove-no-git-init.ts`
   boots with an empty `PATH` and asserts the registry and `astquery` survive.

## Proven

| Claim | Evidence |
| --- | --- |
| A native Windows build completes | `resolve guard: @opencode/plugin external`, `Build complete: dist\index.js`, `Global build complete: dist\global.js`, `Embedded content SHA: 909f07aae70f` |
| A clean install writes the flat bundle and four wasm assets | `installed C:\Users\htoz\.config\opencode\plugins\tawassul.js (v0.1.0, a77a2f5cb29f)` and `installed 4 wasm assets under ...\tawassul-runtime\wasm` |
| The Windows lane stages no database payload | `the Windows lane stages no db scripts` in the dry run; the installed runtime holds the marker plus four wasm files |
| The bundle verifies | `verified ...\tawassul.js (v0.1.0, a77a2f5cb29f, global scope, 4 wasm assets)` |
| The key directory gets a real ACL from the resolved SID | `whoami /user` returns `S-1-5-21-3933359323-4026136743-463518354-1001`; `icacls` shows exactly three non-inherited ACEs: the current user, `NT AUTHORITY\SYSTEM`, `BUILTIN\Administrators`; SDDL carries `D:PAI` with no inherited ACEs |
| The installer and the runtime resolve the same key path | six cases compared side by side, then a real 32-byte key was written at the installer path and `hmacKeyFileExists()` returned true for each: profile on `C:`, profile on `D:`, profile with a space, `XDG_CONFIG_HOME` on `E:`, `TAWASSUL_GLOBAL_DIR` on `F:`, and an explicit `TAWASSUL_HMAC_KEY_DIR` |
| The key the installer protects is the key that signs | with `TAWASSUL_GLOBAL_DIR` on `F:`, `hmacSign` produced `2067785c…55a49`, identical to an independent `createHmac("sha256", <key file>)` over the same payload; the key file is 32 bytes |
| The key file inherits only the protected principals | `Get-Acl` on `F:\tawassul-windows-test\tawassul\.tawassul-hmac-key` lists `BUILTIN\Administrators`, `NT AUTHORITY\SYSTEM`, and the current user, all inherited from the restricted directory and no other principal |
| An unusable operator key directory fails early | empty directory: `TAWASSUL_HMAC_KEY_DIR points at …\.tawassul-hmac-key, which is absent — the runtime refuses to sign without it`, exit 2 on both `install` and `--verify`; a 31-byte key: `the key at … is 31 bytes; expected 32`, exit 2 |
| A profile path with a space installs and verifies | `installed C:\Users\htoz\Profile Space\.config\opencode\plugins\tawassul.js` and `verified ...` followed by `icacls` on the same path |
| A path beyond `MAX_PATH` installs, verifies, and keeps the ACL | 275-character `TAWASSUL_GLOBAL_DIR`; `restricted the key directory ACL to the current user (...)`; `Get-Acl` on `\\?\...` shows the same three ACEs and `D:PAI` |
| A non-system drive works | install, verify, ACL, and uninstall on `D:\tawassul-windows-test\opencode`; full automated cycle on `F:\tawassul-windows-test\opencode` exits 0 |
| The real host loads the global copy | from a neutral directory, `opencode-cli.exe debug agents --standalone` exits 0 and lists `analyst`, `architect`, `designer`, `dev`, `doc` from this plugin |
| In-place upgrade over an existing install works | the marker version was lowered to `0.0.0-receipt`, the installer rewrote the bundle, marker, and all wasm assets, and `--verify` passed |
| Uninstall removes the plugin and staged runtime | `removed ...\plugins\tawassul.js` and `removed 5 installed runtime file(s)` |
| Purge archives state and data on NTFS | `archived ...\.config\tawassul-v2 to ...tawassul-v2.purged-2026-11-02T15-07-52-762Z` and the matching data namespace |
| A locked bundle fails closed and recovers | locked handle: `cannot remove ... (EBUSY) — a running OpenCode host may still hold it; stop the host and retry`, exit 2; after release: uninstall exits 0 |
| A locked state file fails closed and recovers | locked handle: `cannot archive ... (EPERM) — ... stop the host and retry`, exit 2; after release: purge archives and exits 0 |
| Purge runs when only state remains | with the plugin already removed, `--uninstall --purge --yes` archives both namespaces and exits 0 |
| The automated cycle is unattended and bounded | `scripts\windows-install.ps1 -Action cycle` passes install, verify, upgrade, uninstall, and purge with a 180-second bound per child and no prompt |
| Every step reports its duration | `install-global install exit=0 seconds=3.4`, `install-global --verify exit=0 seconds=0.4`, the upgrade `install` `exit=0 seconds=1.3`, and `--uninstall --purge --yes exit=0 seconds=0.2` |
| A cycle never touches the operator's state | two guard files planted in `~\.config\tawassul-v2` and `~\.local\share\tawassul-v2` survived a full cycle unchanged, no `tawassul-v2.purged-*` archive appeared in the profile, and the isolated home under `%TEMP%` was created and removed |
| A hanging child is killed at the bound | `Invoke-BoundedProcess <bun> @("-e","setInterval(()=>{},1000)") 3` returned `timedOut=True` in 3.1 seconds with zero `bun` processes left, while a normal call still returned its exit code and stdout |
| The tree-sitter lane parses from the installed assets | the installer staged exactly four wasm files (web-tree-sitter plus the TypeScript, TSX, and JavaScript grammars); `AstService` loaded them and returned `ast: PASS typescript=3 tsx=1 javascript=1` with the expected symbols and the `node:fs` import |
| The installed bundle answers `astquery` without git | `scripts/check-ast-bundle.ts` imported the installed `plugins/tawassul.js`, `init ready=true`, the structure output held `Square`, `total`, and `node:fs`, the symbol query returned `Square`, the kind filter kept `total`, and all 44 tools registered: `ast-bundle: PASS tools=44` |
| The tool registry survives a missing git | `scripts/prove-no-git-init.ts` with `PATH` set to an empty directory: `PROOF PASS: init and the tool registry survive a missing git (6 assertions)` |
| The project entry lives in the plural discovery directory | `.opencode\plugins\tawassul.js` is byte-identical to `dist\index.js` (2,139,581 bytes, equal sha256), the empty `.opencode\plugin\` directory is gone, and the build, the installer, the doctor, the smoke script, and the independence proof all name `plugins` |
| The primary Windows lane never invokes `cmd.exe` | `windows-ci.ps1 -Mode cycle` printed `cmd-free: PASS` with a child-call counter at 0; `windows-security-check.ps1` runs install, verify, and purge through `windows-install.ps1`; the long-path cleanup uses `System.IO.Directory.Delete` instead of `cmd /c rd` |
| The `.cmd` shim still works when it is present | the optional shim probe ran `windows-install.cmd -Action cycle` through `cmd.exe` and exited 0 with `PASS (cycle)`; when `cmd.exe` or the shim is absent the probe records `cmd-shim=skipped` instead of failing |
| The plural project entry resolves to project scope | `detectInstallScope` on `.opencode\plugins\tawassul.js` returns `project` while the global target returns `global`; the in-tree proof that reaches this assertion is POSIX-only, so the check ran natively here |

## Defender and SmartScreen

Measured on the same machine with Defender running in `Normal` mode: real-time,
behaviour monitoring, IOAV, and on-access protection all enabled; signatures
`1.463.84.0`, age 0 days; PUA blocking enabled during the session. MAPS
reporting and cloud-delivered protection stayed at `0` (off), the on-demand scan
reported `not-admin`, and the exclusion list could not be read without elevation.

| Claim | Evidence |
| --- | --- |
| Defender reports no detection over the scanned set | `Get-MpThreatDetection` returned 0 before and after, `Get-MpThreat` was empty, and the Defender operational log had no 1116/1117 event in its last 400 entries. This is zero detections over the files this lane wrote, not a guarantee against an exclusion: the exclusion list needs elevation, so an excluded path cannot be ruled out without an administrator |
| A downloaded kit (Mark-of-the-Web, zone 3) installs, verifies, and purges without a prompt | `windows-install.ps1` and `dist/global.js` were tagged with `ZoneId=3` (plus `windows-install.cmd` when the shim is present); install exit 0, verify exit 0, purge exit 0, no dialog |
| SmartScreen is present and active at its default | `smartscreen.exe` 10.0.19041.5848 and `smartscreenps.dll` 10.0.19041.7663 are present; `SmartScreenEnabled` is absent, so Windows uses its default (`Warn`); `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppHost\EnableWebContentEvaluation` is `1` |
| SmartScreen blocks a downloaded unsigned executable and waits for a person | an unsigned `bun build --compile` binary (97,757,272 bytes) tagged with `ZoneId=3` was launched through the shell; `Start-Process` blocked synchronously for 102.9 seconds while the dialog was open, and returned "L'opération a été annulée par l'utilisateur" once the operator dismissed it by hand |
| The shipped kit contains no executable and needs no SmartScreen decision | the bundle is plain JavaScript, the wasm assets are data, and the only executable in the flow is Bun, whose copy here is signed and `Valid` (`CN=Codeblog CORP`) |
| The automated security lane stays unattended | `scripts\windows-security-check.ps1` without `-ProbeShellLaunch` prints `verdict=PASS` with install, verify, and purge driven by `windows-install.ps1`, an optional `cmd-shim exit=0`, `scan=not-admin` for the on-demand probe, and `tags removed, remaining=0`; it opens no dialog |

## Not proven

- Windows ARM64 was not exercised; this receipt covers Windows x64 build 19044.
  Windows 10 and Windows 11 share the file-path format, the 260/32,767-character
  limits, and the Defender update channel, so the path and Defender results carry
  over; the remaining differences are application and OS build versions.
- `.github/workflows/windows.yml` has not run on GitHub from this machine. Its
  `cycle`, `pwsh7`, `longpath`, and `ast` modes were all executed natively here;
  `pwsh7` used portable PowerShell 7.4.13 Core. `windows-latest` is Windows
  Server, and Windows Server shares the path and ACL model with Windows 10/11.
- The `ast` mode covers the engine, the three grammars, the structure and import
  extraction, and now the installed bundle's own `astquery` tool and registry. It
  still does not drive a live host process, so host-side dispatch after a reload
  is not re-proven there.
- Defender and SmartScreen were exercised only as described above. The
  SmartScreen probe used an unsigned, freshly built binary; a signed publisher
  with low reputation, a per-user "Run anyway" override, and a machine-wide
  SmartScreen policy were not measured. The Defender numbers are zero detections
  over the files this lane wrote: the exclusion list needs an administrator to
  read, and the on-demand scan reported `not-admin`, so neither an excluded path
  nor a clean full scan is claimed.
- Cloud-delivered protection and MAPS reporting were off for every run.
- The native service and its SQLite database are not part of this lane. Database
  maintenance and scheduled triggers stay `unavailable` on Windows.
- The host-side watcher backend was not measured on native Windows.
- The profile with a space was `C:\Users\htoz\Profile Space`, not a real
  `C:\Users\First Last` account; the path shape is covered, the account creation
  is not.
- File locking was simulated with an exclusive `FileShare.None` handle, not by a
  live host holding the installed bundle.
- `scripts/prove-global-install.ts` is a POSIX gate: it runs `npm run build` and
  asserts POSIX mode bits, so it cannot finish on this machine. It stops at
  `the durable write keeps the requested mode` after 20 assertions. Its new
  key-directory assertions and its plural `detectInstallScope` assertion were
  exercised natively and passed; the CI lane remains the authority for the whole
  file.
- `scripts/prove-host-discovery.ts` also stays a POSIX gate; its fake hosts are
  shell scripts. The native host load above is the Windows evidence instead.

## First-run cost

The first run on a machine is slower than every later run, and the difference is
not a hang:

- `dist\global.js` is built once. `Invoke-Build` bounds that child at 300 seconds
  and prints `dist/global.js is absent; building it first (this is the slow first
  run)` before it starts, then `build-v2.mjs exit=0 seconds=...` when it ends.
- Defender scans every freshly written file. A 2.4 MB bundle and four wasm assets
  are written on install; a 97.7 MB compiled probe was also written once during
  the SmartScreen test. Signatures were current (`1.463.84.0`, age 0 days) and the
  scan produced no detection, but it does add time on the first write.
- The SmartScreen probe is the only step that waits for a person: `Start-Process`
  blocked synchronously for 102.9 seconds until the dialog was dismissed. It is
  opt-in (`-ProbeShellLaunch`) and is not part of the default lane.

Warm runs measured on this machine after the bundle existed: cycle 5.7 seconds
(install 3.4, verify 0.4, upgrade install 1.3, verify 0.4, purge 0.2) and the
security lane 7.1 seconds with no window. The same cycle took 6.0 seconds on the
final no-git build.

## Windows CI

`.github/workflows/windows.yml` runs on `windows-latest` with a matrix of four
modes, all through `scripts/windows-ci.ps1`:

| Mode | What it proves |
| --- | --- |
| `cycle` | The full ladder through `windows-install.ps1` (Windows PowerShell 5.1) with no `cmd.exe` child (`cmd-free: PASS`): install, verify, upgrade, purge, isolated state removed, guard files in the real profile untouched, three explicit ACEs and no inherited ACE on the key directory; the `.cmd` shim is probed only when it exists |
| `pwsh7` | The same cycle driven by PowerShell 7; executed natively here under portable PowerShell 7.4.13 Core, which closes the "only 5.1 was tested" gap |
| `longpath` | Install, verify, and uninstall at a 278-character `TAWASSUL_GLOBAL_DIR`, with `icacls` succeeding on the `\\?\` path |
| `ast` | `AstService` loads the four staged wasm assets and parses TypeScript, TSX, and JavaScript, then `scripts/check-ast-bundle.ts` imports the installed bundle and asserts init, the registry, and the `astquery` structure, symbol, and kind queries |

The workflow installs Bun 1.3.14, installs dependencies, builds the bundle, and
uploads each receipt as an artifact. It runs on every push and pull request.

The `ast` mode imports `AstService` from the repository source and points it at
the wasm assets the installer staged in a temporary global directory, then
imports the installed `plugins/tawassul.js` with an isolated home and asserts
`init ready=true`, all 44 tools, and the three `astquery` query shapes. It still
does not drive a live host process, so host-side dispatch after a reload is not
re-proven there.

All four modes printed `verdict=PASS` on this machine, independently of the
workflow: `cycle` in 4.9 seconds, `pwsh7` in 9.9 seconds under portable PowerShell
7.4.13 Core, `longpath` at 278 characters, and `ast` in 5.0 seconds with
`typescript=3 tsx=1 javascript=1` plus `ast-bundle: PASS tools=44`. The workflow itself has not been executed on
GitHub from here. `windows-latest` is a Windows Server image; the path, ACL, and
Defender baseline it exercises is the same one Windows 10 and Windows 11 use.

## How to reproduce

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows-install.ps1 ^
  -Action cycle -GlobalDir D:\tawassul-windows-test\opencode -Log receipt.txt
```

The same script runs unchanged under PowerShell 7.4 Core. `scripts\windows-install.cmd`
is an optional compatibility shim that forwards its arguments to the same `.ps1`
file, and it is not required by any lane.

The script finds Bun through `-Bun`, `TAWASSUL_BUN`, `PATH`, `%USERPROFILE%\.bun`,
`%LOCALAPPDATA%\Programs\bun`, or `<repo>\runtime\bun.exe`, resolves the installer
and the bundle relative to itself, and never prompts. Every child process has an
explicit timeout; a timeout kills the child and fails the step, and every step
prints its exit code and duration.

The same gate is available as a script and is what the workflow calls:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows-ci.ps1 ^
  -Mode cycle -Log ci-receipt.txt
```

`-Mode pwsh7` drives the same cycle with PowerShell 7, `-Mode longpath`
installs, verifies, and uninstalls at a 278-character path, and `-Mode ast`
parses TypeScript, TSX, and JavaScript from the wasm assets the installer
staged. Each mode prints `verdict=PASS` or exits 1 with the failed assertion.

`-Action cycle` runs in an isolated home under `%TEMP%` and removes it at the end,
so it never archives the operator's `~\.config\tawassul-v2` or
`~\.local\share\tawassul-v2`. Pass `-StateRoot <dir>` to choose that home and
`-KeepState` to keep it for inspection; pass `-StateRoot $env:USERPROFILE` only
when a deliberate real-profile purge is intended.

For the Defender and SmartScreen receipt:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows-security-check.ps1 ^
  -Bun <path-to-bun.exe> -Log security-receipt.txt
```

It tags `windows-install.cmd`, `windows-install.ps1`, and `dist\global.js` with
`ZoneId=3`, runs install, verify, and purge through the tagged wrapper, compares
the Defender detection count, and removes every tag in a `finally` block. It
finishes in seconds and opens no window. Add `-ProbeShellLaunch` only when a
person is present: the SmartScreen probe builds an unsigned executable, tags it,
and launches it through the shell, where the dialog waits for a decision.
