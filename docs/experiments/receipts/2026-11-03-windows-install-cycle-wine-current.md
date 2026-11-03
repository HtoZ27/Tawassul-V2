# Windows global install under Wine — current-build receipt

- Date: 2026-11-03
- Verdict: **emulator evidence, not a native Windows receipt.** The current
  bundle installs, verifies, reinstalls, and uninstalls on the Windows lane
  under Wine 9.0. Native NTFS ACLs, Defender, and SmartScreen stay unproven.
- Build: `8d782d5`, bundle `dist/global.js` 2,388,910 bytes, content digest
  `33d786300095`, version `0.1.0-experimental`, source digest `0b6f050cc4c0`.
- Kit: a scratch copy of the Windows x64 kit with the current `src/`, `dist/`,
  `scripts/`, `package.json`, and `build-v2.mjs`; Bun 1.3.14 **baseline** for
  win-x64; `opencode.exe` v2.2.5 win-x64.
- Emulator: Wine 9.0 through `/usr/lib/wine/wine64`, a fresh prefix, and
  `env -i` so no Linux variable leaks into the Windows process.

## Cycle

| Step | Result |
| --- | --- |
| Dry run | 0; would write the bundle and 4 wasm assets; `Windows lane stages no db scripts` |
| Install | 0; host `v2.2.5` accepted with the audited-ceiling warning; installed the bundle and 4 wasm assets |
| Verify | 0; `global scope, 4 wasm assets` |
| Second install | 0; `already installed` (idempotent) |
| Host paths | 0; config `C:\users\user\.config\opencode`, data under `.local\share\opencode` |
| Host roster | 0; `tawa`, `analyst`, `architect`, `designer`, `dev`, `doc`, `reviewer`, and `tester` appear beside the host defaults |
| Uninstall | 0; removed the bundle and 5 runtime files (marker plus 4 wasm assets) |

The host log records the load:

```
msg="loading plugin" id="C:\users\user\.config\opencode\plugins\tawassul.js"
entrypoint=file:///C:/users/user/.config/opencode/plugins/tawassul.js
```

## Notes

- The Windows lane stages no database payload; the 5 removed runtime files are
  the marker and the 4 wasm assets. The POSIX lane removes 10 because it also
  stages the 5 database scripts.
- `where`, `icacls`, `powershell`, `reg`, and `certutil` are absent from the
  Wine prefix. The installer printed `could not resolve the current user SID` and
  the instruction `apply the key directory ACL with icacls manually`, then
  continued. No ACL argument was exercised.
- `plugin list --standalone` prints `No plugins found` because the installer
  never edits `opencode.json(c)`; the flat file is discovered by the host, as
  the `loading plugin` line and the roster prove.
- Real NTFS ACLs, Mark-of-the-Web, Defender, SmartScreen, long paths, case
  sensitivity, and file locking remain native-Windows checks.
- The scratch kit, prefix, and receipt stay outside the repository.
