# Installation

Tawassul runs inside OpenCode as a plugin. There are two supported scopes:

- **Project scope** — the plugin lives inside one workspace and loads only there.
- **Global scope** — the plugin is installed once under the OpenCode config
  directory and loads for every workspace of that user.

Project scope needs no installer and never touches your OpenCode configuration.
Global scope is an explicit, reversible operation with its own verification pass.

## Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| OpenCode host | `>=2.2.0` | Audited against `2.2.1`; newer majors run untested and are probed at init |
| Node.js | `26.13.0` | Pinned in `.nvmrc`; used for development and for the build |
| Bun | `1.3.x` | Runs the build and the installer scripts |
| Disk | under 10 MB | Bundle, wasm grammars, and the runtime directory |
| Platform | see [compatibility](compatibility.md) | Database maintenance is POSIX-only |

The published bundle is plain JavaScript. It has no native addon and needs no
compiler at install time.

## Project scope

From a clone of the repository:

```bash
nvm use
npm install
npm run build
```

`npm run build` writes:

| Path | Content |
| --- | --- |
| `dist/index.js` | The plugin bundle used by the host in this workspace |
| `dist/global.js` | The self-contained bundle the global installer ships |
| `.opencode/plugin/tawassul.js` | The host entry the workspace loads |

The host discovers `.opencode/plugin/tawassul.js` on its own. Do not edit
`opencode.json` to register it.

If the host uses a restricted module resolver, install the plugin API once in
the workspace:

```bash
mkdir -p .opencode
printf '{"type":"module","dependencies":{"@opencode/plugin":"^2.2.1"}}\n' > .opencode/package.json
bun install --cwd .opencode
```

## Global scope

The global installer writes outside the workspace, so run it deliberately.

```bash
bun scripts/install-global.ts --dry-run   # prints every path it would write
bun scripts/install-global.ts             # install
bun scripts/install-global.ts --verify    # hash, version, host pin, wasm inventory
```

A successful install prints the bundle path, its version, and the number of
wasm assets staged:

```
install-global: installed ~/.config/opencode/plugins/tawassul.js (v0.1.0-experimental, <bundle-sha>)
install-global: installed 4 wasm assets under ~/.config/opencode/tawassul-runtime/wasm
install-global: no opencode.json edit is needed; the host discovers this file
```

### Release installer

A release checkout uses `install.sh` instead. It needs no Node, Bun, or package
manager: a POSIX shell, `tar`, `gzip`, and `curl` or `wget`.

```bash
sh install.sh --global --dry-run
sh install.sh --global
sh install.sh --global --uninstall
```

For a project scope, name the workspace:

```bash
sh install.sh --project /path/to/workspace
```

The installer downloads the bundle and the runtime archive from the GitHub
release, verifies both against `SHA256SUMS`, refuses when the expected hash is
unavailable, and stages the flat layout:

| Path | Content |
| --- | --- |
| `<config>/opencode/plugins/tawassul.js` | The self-contained bundle |
| `<config>/opencode/tawassul-runtime/wasm/` | Four wasm grammars |
| `<config>/opencode/tawassul-runtime/VERSION` | Marker: version, bundle hash, wasm hashes |

`--prefix <dir>` treats `<dir>` as `HOME`, which is how the release test runs a
scratch install. `--from <dir>` reads the artifacts from a local directory
instead of the network, for an offline or audited install. `--release <v>`
installs a different version. `--dry-run` prints the plan and writes nothing.
`--version` prints the installer version.

The release installer stages the bundle and the grammars. It does not register
the scheduled database maintenance trigger and does not probe the host version;
the repository installer above does both. Use the repository installer from a
source checkout when you want that lane.

A second run replaces the same files and produces the same layout. An uninstall
removes the bundle, the four grammars, and the marker, and keeps every file the
installer did not write. Neither installer edits `opencode.json` or
`opencode.jsonc`.

### What the installer writes

| Path | Content | Removed on uninstall |
| --- | --- | --- |
| `~/.config/opencode/plugins/tawassul.js` | The plugin bundle | Yes |
| `~/.config/opencode/tawassul-runtime/wasm/` | Four wasm grammars | Yes |
| `~/.config/opencode/tawassul-runtime/db/` | Database scripts (POSIX only) | Yes |
| `~/.config/opencode/tawassul-runtime/VERSION` | Marker: version, hashes, owner, host | Yes |

The installer records what it wrote, so an uninstall removes exactly that set
and nothing else. It never edits `opencode.json` or `opencode.jsonc`.

### Environment overrides

| Variable | Effect |
| --- | --- |
| `TAWASSUL_GLOBAL_DIR` | Install under this config root instead of the default |
| `OPENCODE_BIN` | Path to the host binary the installer probes for a version |
| `TAWASSUL_OPENCODE_VERSION` | Pin the host version instead of probing it |
| `TAWASSUL_ASSET_ROOTS` | Extra search roots for the wasm grammars |

`TAWASSUL_GLOBAL_DIR` also moves the HMAC key directory beside the config root.
An explicit `TAWASSUL_HMAC_KEY_DIR` wins over that.

### Upgrading

Rebuild, then install again:

```bash
npm run build
bun scripts/install-global.ts
bun scripts/install-global.ts --verify
```

When the installed marker already matches the current bundle and assets, the
installer reports `already installed` and writes nothing. When the bundle
differs, it replaces the file through a durable write and updates the marker.

### Uninstalling

```bash
bun scripts/install-global.ts --uninstall
```

This removes the bundle and the staged runtime files. State and data are kept,
because they are yours. To archive them as well:

```bash
bun scripts/install-global.ts --uninstall --purge --yes
```

The purge renames these paths with a `.purged-<timestamp>` suffix instead of
deleting them:

- `~/.config/tawassul-v2`
- `~/.local/share/tawassul-v2`
- `~/.config/opencode/tawassul-v2-state`
- `tawassul.jsonc`, `tawassul.json`, and `tawassul-pins.json` in the global
  config root

The global agent roster (`~/.config/opencode/agent`) is kept. Remove those files
by hand if you do not want them.

An uninstall refuses to remove a file that carries no Tawassul marker. Use
`--force` only when you know the file is a Tawassul bundle that lost its marker.

## Verifying that the host loaded the plugin

```bash
opencode debug agents --standalone
```

The roster should list the built-in agents plus `tawa`, `analyst`, `architect`,
`designer`, `dev`, `doc`, `reviewer`, and `tester`. `opencode plugin list` lists
package plugins, not files discovered in the plugin directory, so it is not the
right check for this install.

The plugin directory must exist before the host starts. The installer creates it;
a hand-made install must create it too, or the host refuses to start with
`Location plugins did not finish activating`.

## Platform notes

- **Linux and macOS** — full lane, including database maintenance and scheduled
  triggers.
- **Windows** — native install stages the bundle and the wasm grammars only.
  Database maintenance and scheduled triggers are unavailable on `win32`, and
  the key directory is protected with an `icacls` ACL instead of POSIX modes.
  Native Windows is **pending a native receipt**; see
  [compatibility](compatibility.md).
- **WSL2** — experimental. Keep the key on the Linux filesystem; a Windows mount
  does not carry the same permission semantics.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `not installed: …` on `--verify` | Nothing installed for that user | Run the installer |
| `bundle hash mismatch` | The file was edited after install | Reinstall |
| `host v… is newer than the audited …` | The host is newer than the audited pin | Expected warning; reinstall after auditing |
| `cannot create the runtime layout` | A plain file occupies the runtime path | Remove it or set `TAWASSUL_GLOBAL_DIR` |
| Host reports `Location plugins did not finish activating` | The plugins directory is missing | Create it and restart the host |
| `EPERM: operation not permitted, fsync` on Windows | A pre-release build fsynced a read-only handle | Upgrade; fixed in the current bundle |

More in [troubleshooting](troubleshooting.md).
