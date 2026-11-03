# Release artifact install — receipt

- Date: 2026-11-03
- Verdict: **pass.** `verify:release-artifact` accepts the seven release
  assets, `install.sh` installs, upgrades, and uninstalls the release bundle in
  a scratch HOME, and `astquery` answers from both the single-file layout and
  the npm tarball layout with no `node_modules`.
- Build: source `8d782d5`, bundle `dist/global.js` 2,388,910 bytes, content
  digest `33d786300095`, version `0.1.0-experimental`, source digest
  `0b6f050cc4c0`.
- Artifacts: `dist/release/`, built 2026-11-03 18:29, seven assets plus
  `SHA256SUMS`.
- Runtime: Bun 1.3.14; `install.sh` run through `sh` with `env -i`.

## Artifact verification

`npm run verify:release-artifact` reports:

```
verify-artifact: OK (0.1.0-experimental; 7 assets, 6.3 MiB; tarball, runtime
archive, bundle, index, SBOM, notices and checksums agree)
```

## `install.sh` cycle

Scratch root: one `mktemp -d` directory with an empty `home/` and `proj/`; the
`--global --prefix` lane writes only under `<root>/home/.config/opencode`.

| Step | Result |
| --- | --- |
| `--global --prefix <root>/home --from dist/release --dry-run` | 0; prints the entry, runtime, source and the no-config rule |
| `--project <root>/proj --from dist/release --dry-run` | 0; prints the project entry and runtime |
| `--global --prefix <root>/home --from dist/release` | 0; installed the bundle (`33d786300095`) and four wasm grammars |
| Second install (upgrade) | 0; entry SHA-256 and marker SHA-256 unchanged |
| Installed files | entry, marker, and four wasm files only; no `node_modules` |
| `--uninstall` | 0; removed the entry and the runtime; no file remained under the config root |

## AST runtime

Both checks ran with `env -i` and a scratch HOME:

| Layout | Check | Result |
| --- | --- | --- |
| `install.sh` global | `bun scripts/check-ast-bundle.ts --plugin <root>/home/.config/opencode/plugins/tawassul.js` | `ast-bundle: PASS tools=44` |
| `install.sh` global | `bun scripts/check-ast-runtime.ts --runtime <root>/home/.config/opencode/tawassul-runtime` | `ast: PASS typescript=3 tsx=1 javascript=1` |
| npm tarball | extract `tawassul-0.1.0-experimental.tgz`, then `check-ast-bundle.ts --plugin <pkg>/package/dist/global.js` | `ast-bundle: PASS tools=44` |

The extracted tarball holds 11 files: `dist/`, `tawassul-runtime/`,
`package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `NOTICE.md`. It has
no `node_modules` and no source tree.

## Notes

- `install.sh` consumes the release assets (`*.global.js`, the runtime archive,
  and `SHA256SUMS`), not the npm tarball; the tarball layout is checked
  separately above.
- The installer verifies both asset hashes before writing, refuses a path
  outside `tawassul-runtime/`, and requires exactly four wasm files.
- `install.sh` never edits `opencode.json(c)`. Discovery loads the flat file.
- The scratch root and its logs stay outside the repository.
