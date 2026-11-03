# Windows host under Wine — emulator receipt

- Date: 2026-11-01
- Verdict: **emulator evidence, not a native Windows receipt.** Acceptance item 20 stays open.
- Host artifact: `opencode-windows-x64.zip` from the v2.2.5 GitHub release, sha256 `2f3bfd6b3527c60c2a882557b20ddc9ba6bdff4b5a8fe61c853da8fcfb3076e8`, matching `SHA256SUMS`
- Node probe: `node.exe` v22.14.0 win-x64, sha256 `33b1bc1a8aca11fd5a4f2699e51019c63c0af30cf437701d07af69be7706771b`
- Emulator: Wine 9.0 (Ubuntu 9.0~repack-4build3) through `/usr/lib/wine/wine64`; the `wine` wrapper on `PATH` fails with `could not load kernel32.dll`
- Build under test: HEAD `4fb8f8a` plus the `v2DataRoot()` fallback committed beside this receipt

## Proven

| Claim | Evidence |
| --- | --- |
| The Windows host binary runs | `opencode.exe --version` prints `opencode v2.2.5` |
| A Windows Node process reports the target platform | `process.platform` is `win32`, `process.arch` is `x64`, `process.version` is `v22.14.0` |
| The host resolves XDG-style paths, not `%APPDATA%` | `debug paths` prints `config C:\users\htoz\.config\opencode`, `data C:\users\htoz\.local\share\opencode`, `state C:\users\htoz\.local\state\opencode` |
| The plugin directory the installer targets is discovered | the host logs `msg="loading plugin" id="C:\users\htoz\.config\opencode\plugins\tawassul.js"` for a file placed there |
| The shipped bundle satisfies the v2 plugin contract | the same log carries no `failed to load plugin` for `tawassul.js`, while two control files with a wrong default export fail with `Plugin must export a default definition with an id and an effect or setup function` |
| The plugin registers its roster | `debug agents --standalone` lists 15 agents; the seven host defaults plus `tawa`, `analyst`, `architect`, `designer`, `dev`, `doc`, `reviewer`, `tester` from this plugin |
| A root-only `$HOME` no longer blanks the data root | the bundled `v2DataRoot()` probe under `env -u HOME` prints `C:\users\htoz\.local\share\tawassul-v2` |

The control files matter: a loader that ignores a directory cannot report a contract error for a file inside it. Both `~/.config/opencode/plugins/` and `~/.config/opencode/plugin/` are scanned, so the installer's plural target is correct.

`opencode plugin list` prints `No plugins found` in this setup. That subcommand lists configured package plugins, not files discovered in the plugin directories, so it is not evidence against the load.

## Not proven

- `where`, `icacls`, `powershell`, `reg`, and `certutil` are absent from the Wine prefix. Dependency probing and ACL hardening cannot run.
- Real NTFS ACLs, Defender, long paths, case sensitivity, and file locking are untested.
- The background service and its SQLite database ran only after the environment was sanitised; service startup timing under Wine is not representative.
- The host logs `watcher backend not supported` for the config directory under Wine; native Windows file watching is untested.
- No upgrade-in-place, uninstall, or purge cycle was exercised on a Windows host.

None of this closes acceptance item 20, which asks for a receipt from a real Windows machine.

## The `$HOME` gap this run found

The host's own paths do not depend on `$HOME`; our `v2DataRoot()` did. With `HOME` unset, which is the normal state of a native Windows process, the old code returned an empty string. That silently disabled the file log in `src/utils/logger.ts` and the project state root in `src/utils/project-identity.ts`.

`v2DataRoot()` now falls back to `safeHomedir()` when `HOME` is missing or `/`, and keeps returning an empty string only when no home can be resolved at all. `scripts/prove-state-namespace.ts` pins both cases, and the bundled probe above confirms the result on the Windows side of Wine.

## Reproduce

```
curl -sSLo opencode-windows-x64.zip \
  https://github.com/anomalyco/opencode/releases/download/v2.2.5/opencode-windows-x64.zip
curl -sSLo SHA256SUMS \
  https://github.com/anomalyco/opencode/releases/download/v2.2.5/SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS
unzip opencode-windows-x64.zip

export WINEPREFIX=/tmp/opencode/wine-node/prefix
export WINEDEBUG=-all
export WINEDLLOVERRIDES="mscoree,mshtml="
mkdir -p "$WINEPREFIX"
env -i WINEPREFIX="$WINEPREFIX" WINEDEBUG=-all WINEDLLOVERRIDES="mscoree,mshtml=" \
  PATH=/usr/bin:/bin USER=htoz \
  /usr/lib/wine/wine64 ./opencode.exe debug paths
```

## Environment hazard

The first attempt failed with `SQLiteError: unable to open database file`. The cause was not Wine: the shell that launched Wine carried `OPENCODE_DB=/home/user/.local/share/opencode/tawassul-v2/opencode.db` from the Linux session, and Wine turned that into `C:\home\htoz\...`. Running Wine through `env -i` with a minimal environment removed the false failure. Any future emulator run must not inherit the outer OpenCode session's variables.
