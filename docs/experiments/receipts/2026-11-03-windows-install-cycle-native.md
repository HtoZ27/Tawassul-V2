# Windows install cycle — current-lane receipt

- Date: 2026-11-03
- Verdict: **PASS** for the current installer lane. `scripts/install-global.ts`
  is the only installer; the retired `scripts/windows-install.ps1` and
  `scripts/windows-install.cmd` ladder is not used.
- Machine: Windows 10 IoT Enterprise LTSC 21H2, build 19044, x64
- Host: OpenCode Desktop 2.2.5, sidecar `opencode-cli.exe`
- Bun: 1.3.14 baseline (`bun-windows-x64-baseline`); Node: v26.13.0
- HEAD: `a1cef5a` plus the uncommitted current-lane changes
- Built artifact: `dist\global.js`, 2,386,535 bytes, bundle
  `de94733580e2`, content digest `cf165778ee27`

## Commands and results

| Command | Result |
| --- | --- |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows-ci.ps1 -Mode cycle -Bun <bun>` | `verdict=PASS` in 4.7s; key ACL explicit=3 inherited=0 |
| `scripts\windows-ci.ps1 -Mode ast -Bun <bun>` | `verdict=PASS`; `wasm=4 grammars=3`; `ast: PASS typescript=3 tsx=1 javascript=1`; `ast-bundle: PASS tools=44` |
| `scripts\windows-ci.ps1 -Mode longpath -Bun <bun>` | `verdict=PASS`; long path length=278 |
| `scripts\windows-security-check.ps1 -Bun <bun>` | `verdict=PASS`; purge exit=0; `tags removed, remaining=0` |
| `bun scripts\gate.ts smoke --only release-smoke` | `SMOKE PASS: host v2.2.5, scratch boot, 44 tools, model reply, health + help` |
| `bun scripts\gate.ts fast` | `GATE PASS: fast (11 step(s))`, `157 proofs across 3 isolated gate stages` |

## What `-Mode cycle` exercises

The cycle now rebuilds the bundle and exercises the in-place upgrade path that
the retired ladder used to cover:

1. `bun build-v2.mjs` completes.
2. Install into an isolated home exits 0 and writes the flat entry
   `plugins\tawassul.js` plus four wasm assets under `tawassul-runtime\wasm`.
3. `--verify` exits 0.
4. A second install reports `already installed` (idempotent).
5. The marker version is lowered to `0.0.0-receipt`, install runs again, and the
   marker is rewritten to `0.1.0`; `--verify` exits 0.
6. `--uninstall --purge --yes` removes the entry and the runtime, and the
   isolated state is archived inside the isolated home, never in the operator's
   real profile.
7. The key directory has three explicit ACEs and no inherited ACE.

## Real-profile global install check

A separate opt-in check installed the current bundle into the operator's real
global directory (`~/.config/opencode`), loaded it, and then removed it. This
check is additional evidence; it is not part of `-Mode cycle`.

| Command | Result |
| --- | --- |
| `bun scripts/install-global.ts --yes` | installed `plugins\tawassul.js` (2,390,278 bytes, marker `96adb98bf968`) and 4 wasm assets; re-applied the key-directory ACL with `icacls` to `~/.config/tawassul` |
| `bun scripts/install-global.ts --verify` | exit 0; `global scope`, 4 wasm assets, bundle hash match |
| `bun scripts/install-global.ts --yes` again | `already installed` (idempotent) |
| `bun scripts/check-ast-bundle.ts --plugin ~/.config/opencode/plugins/tawassul.js` | `ast-bundle: PASS tools=44`; healthy init from the installed path; `astquery` executed and `codestate` registered |
| `bun scripts/install-global.ts --uninstall` | removed the entry and 5 runtime files (marker plus 4 wasm); kept the roster, state, and data namespaces |
| `bun scripts/install-global.ts --verify` after uninstall | exit 2, `not installed` |

Pre/post inventory of `~/.config/opencode`: 13 files before, 13 after. The 8
agent files, `tawassul.jsonc`, `service.json`, and `tawassul-v2-state/*` were
byte-identical. The only changed file was the pre-existing global
`tawassul-state.json` (2801 to 2841 bytes, revision 2, 0 records, 0 handoffs):
the running Desktop host hot-loaded the global copy while it existed and
flushed its empty global state, then delegated to the project copy. The live
project state was untouched (2019 records, 1001 handoffs), the sidecar stayed on
pid 6908, and the window logged no `SAVE_CONFLICT`, no rejection, and no
quarantine.

The installer also re-applied the key-directory ACL to
`C:\Users\user\.config\tawassul` (the live key directory) with `icacls`. The
same user retained access: the next project save succeeded at `06:10:27Z` and
the canonical state still verifies with the current key.

## Boundaries

- `-Mode pwsh7` was not re-run here because `pwsh` is not installed on this
  machine. The mode itself is proven: the 2026-11-02 receipt executed it
  natively under portable PowerShell 7.4.13 Core (`verdict=PASS`, 9.9 seconds,
  all four modes green), so this is a missing re-run on this host, not an
  untested path.
- `gate:proofs` and `npm run ci` were not run natively: the proof stage needs a
  POSIX host with `python3` and `/usr/bin` shims, and this machine has neither
  Python nor a WSL distro. `gate:fast`, the build, the smoke stage, and three of
  the four Windows CI modes (`cycle`, `ast`, `longpath`) ran natively.
- GitHub Actions, Linux, and macOS lanes were not run in this receipt.
- The live Desktop host was not restarted; the cycle uses the built artifact and
  an isolated home. The scratch smoke boot runs the plugin without `git` on its
  PATH, so `codestate` returns its documented degraded message while all 44
  tools register.
