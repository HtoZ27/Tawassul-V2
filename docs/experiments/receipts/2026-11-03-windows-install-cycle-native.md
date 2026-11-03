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

## Boundaries

- `-Mode pwsh7` was not run: `pwsh` is not installed on this machine.
- `gate:proofs` and `npm run ci` were not run natively: the proof stage needs a
  POSIX host with `python3` and `/usr/bin` shims, and this machine has neither
  Python nor a WSL distro. `gate:fast`, the build, the smoke stage, and three of
  the four Windows CI modes (`cycle`, `ast`, `longpath`) ran natively.
- GitHub Actions, Linux, and macOS lanes were not run in this receipt.
- The live Desktop host was not restarted; the cycle uses the built artifact and
  an isolated home. The scratch smoke boot runs the plugin without `git` on its
  PATH, so `codestate` returns its documented degraded message while all 44
  tools register.
