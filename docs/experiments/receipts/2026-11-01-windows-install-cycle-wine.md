# Windows install cycle under Wine — emulator receipt

- Date: 2026-11-01
- Verdict: **emulator evidence, not a native Windows receipt.** Acceptance item 20 stays open.
- Kit: `/home/htoz/tawassul-windows-kit`, unpacked to a fresh directory, `RUN-RECEIPT.cmd` driven by Wine's `cmd`
- Bun: 1.3.14 **baseline** for win-x64; the normal build aborts with `Illegal instruction` on a host without AVX2
- Host: `opencode.exe` v2.2.5 win-x64 from the same release the earlier host receipt used
- Emulator: Wine 9.0 through `/usr/lib/wine/wine64`, clean prefix, `env -i` so no Linux variable leaks into the Windows process
- Build under test: `HEAD` `3cea413`, which carries the `durableWriteFile` fix; the shipped kit embeds that commit hash in `TAWASSUL_SOURCE_SHA`

## The defect this run found

`durableWriteFile` wrote its temporary file, reopened it with `openSync(temp, "r")`, and then called `fsync`. On Windows `fsync` becomes `FlushFileBuffers`, and that call requires a handle opened for writing. A read-only handle fails with `EPERM`, so the very first durable write — the ownership claim — aborted the install:

```
EPERM: operation not permitted, fsync
      at fsyncFileDescriptor (src/core/install-write.ts:47:11)
      at durableWriteFile (src/core/install-write.ts:99:7)
      at writeAtomic (scripts/install-global.ts:511:3)
      at claimOwnership (scripts/install-global.ts:384:3)
```

The POSIX lane never noticed because `fsync` accepts a read-only descriptor there. This is the documented Windows contract, not a Wine quirk: the handle must carry `GENERIC_WRITE`.

The fix keeps one descriptor for the whole write: `openSync(temp, "wx", mode)`, write through it, `fsync` that same writable handle, then rename. `scripts/prove-global-install.ts` now traces the descriptor calls and asserts that exactly one temp file is created with `wx` and fsynced once, so a future regression that reopens read-only fails the proof on Linux.

## Proven

| Claim | Evidence |
| --- | --- |
| The kit installs on the Windows lane without any POSIX tool | `install-global: installed C:\users\htoz\.config\opencode\plugins\tawassul.js (v0.1.0, eb795d40276d)` |
| The Windows lane stages wasm only and no database payload | `installed 4 wasm assets under ...\tawassul-runtime\wasm`, followed by `the Windows lane stages no db scripts` in the dry run |
| The bundle passes its own verification | `install-global: verified ...tawassul.js (v0.1.0, eb795d40276d, global scope, 4 wasm assets)` |
| The real host discovers and loads the file | `debug paths` reports `config C:\users\htoz\.config\opencode`; `debug agents --standalone` lists `tawa`, `analyst`, `architect`, `designer`, `dev`, `doc`, `reviewer`, `tester` beside the seven host defaults |
| Uninstall removes the plugin and the staged runtime | `removed ...\plugins\tawassul.js` and `removed 5 installed runtime file(s)`; the directory is empty afterwards |
| The cycle exits clean | `RUN-RECEIPT.cmd` returns 0 and writes an 11,496-line `receipt.txt` |

Five runtime files is the Windows count: the marker plus four wasm assets. The POSIX lane removes ten because it also stages five database scripts.

## Additional probes

- **Space in the kit path.** The whole cycle was repeated from `Z:\tmp\opencode\kit e2e space` and again exited 0: install, verify (on the pre-rebuild bundle `76533e573d03`, 4 wasm assets), host roster, uninstall.
- **Shipped artifact re-verified.** After the kit was rebuilt at `HEAD` `3cea413`, the runner was executed once more on the shipped copy and exited 0; that is the run cited in the table (`eb795d40276d`).
- **Overwrite inside the Windows lane.** A direct `durableWriteFile` probe wrote `one\n`, then `two\n` over the same file; the read-back was `two\n`. `rename` replaced the existing target, so the upgrade path does not need the unlink fallback that `atomicWriteFile` carries.
- **Space in the destination directory.** The same probe wrote `space\n`, then `space-two\n` at mode `0640` under `C:\users\htoz\dw dir with space\probe.json`; both read-backs were correct.
- **Profile path with a space stays untested.** Wine rebuilds `USERPROFILE` from its own registry, so the override to `C:\users\htoz\Profile Space` never reached the Windows process and the install still landed under `C:\users\htoz`. A real `C:\Users\First Last` profile is exactly what a native receipt must cover.

## Not proven

- `where`, `icacls`, `powershell`, `reg`, and `certutil` are absent from the Wine prefix, so no ACL argument was exercised. The installer printed `could not resolve the current user SID — apply the key directory ACL with icacls manually` and continued; the native run must show the resolved SID path instead.
- Real NTFS ACLs, Defender or SmartScreen handling, long paths, case sensitivity, and file locking stay untested.
- In-place upgrade through the installer and `--purge --yes` on Windows stay untested; only a clean install, verify, and uninstall ran. The raw `durableWriteFile` overwrite path did pass in the probe above.
- The native service and its SQLite database are not part of this lane and were not exercised.

None of this closes acceptance item 20, which asks for a receipt from a real Windows machine.

## How to reproduce

```
WINEPREFIX=<fresh prefix> env -i WINEPREFIX=<fresh prefix> WINEDEBUG=-all \
  WINEDLLOVERRIDES="mscoree,mshtml=" PATH=/usr/bin:/bin USER=htoz \
  /usr/lib/wine/wine64 cmd /c "Z:\path\to\tawassul-windows-kit\RUN-RECEIPT.cmd"
```

The runner writes `receipt.txt` beside itself. Every command appends with its own redirect because a single block redirect produced an empty receipt under Wine's `cmd`.
