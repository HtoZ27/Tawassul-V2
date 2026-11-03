# Linux isolated global install — receipt

- Date: 2026-11-03
- Verdict: **pass.** The global installer, its verify pass, the real host
  discovery, an idempotent second install, and the uninstall all ran in a
  scratch HOME with no live install touched.
- Build: `8d782d5`, bundle `dist/global.js` 2,388,910 bytes, content digest
  `33d786300095`, version `0.1.0-experimental`, source digest `0b6f050cc4c0`.
- Runtime: Bun 1.3.14, Node 26.13.0, OpenCode host `2.2.5-x64`.
- Isolation: `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`,
  `XDG_CACHE_HOME`, `OPENCODE_DB`, and `TAWASSUL_GLOBAL_DIR` all pointed under
  one scratch root; `TAWASSUL_REGISTER_TRIGGERS=off`; no `opencode.json(c)`
  was edited.

## Cycle

| Step | Command | Result |
| --- | --- | --- |
| Dry run | `bun scripts/install-global.ts --dry-run` | 0; would write the bundle, 4 wasm assets, and 5 db scripts |
| Install | `bun scripts/install-global.ts` | 0; installed the bundle and 4 wasm assets |
| Verify | `bun scripts/install-global.ts --verify` | 0; `global scope, 4 wasm assets` |
| Second install | `bun scripts/install-global.ts` | 0; `already installed` (idempotent) |
| Host paths | `opencode-cli debug paths` | 0; config, data, state, and cache resolve under the scratch root |
| Host roster | `opencode-cli debug agents --standalone` | 0; `tawa`, `analyst`, `architect`, `designer`, `dev`, `doc`, `reviewer`, and `tester` appear beside the host defaults |
| Uninstall | `bun scripts/install-global.ts --uninstall` | 0; removed the bundle and 10 runtime files |

The host log records the load:

```
msg="loading plugin" id=<scratch>/config/opencode/plugins/tawassul.js
entrypoint=file://<scratch>/config/opencode/plugins/tawassul.js
```

## Notes

- The isolated HOME has no host on `PATH`, so the installer used the audited
  `2.2.1`; the real host later loaded the same file and reported `2.2.5`.
- `plugin list --standalone` prints `No plugins found` because the installer
  never edits `opencode.json(c)`. The flat file is discovered by the host, as
  the `loading plugin` line and the roster prove.
- The uninstall keeps the generated roster and the state/data namespaces; that
  is the documented default. `--purge --yes` archives them instead.
- The scratch root and its logs stay outside the repository.
