# Installation

Tawassul runs inside OpenCode as a plugin. There are two supported scopes:

- **Project scope** — the plugin lives inside one workspace and loads only there.
- **Global scope** — the plugin is installed once under the OpenCode config
  directory and loads for every workspace of that user.

Project scope needs no installer and never touches your OpenCode configuration.
Global scope is an explicit, reversible operation with its own verification pass.

> **Recommendation:** use project scope for local projects. Install globally
> only when you want Tawassul in every workspace of the user.

## Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| OpenCode host | `>=2.3.0` | Floor `2.3.0`; audited and built against `2.4.1`; newer hosts are probed at init |
| Node.js | `26.13.0` | Pinned in `.nvmrc`; used for development and for the build |
| Bun | `1.3.x` | Runs the build and the installer scripts |
| Disk | under 10 MB | Bundle, wasm files, and the runtime directory |
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
| `.opencode/plugins/tawassul.js` | The host entry the workspace loads |
| `.opencode/tawassul-runtime/wasm/` | Four wasm files (one runtime, three grammars) for the AST tools |
| `.opencode/tawassul-runtime/db/` | Database scripts (POSIX only) |

The host discovers `.opencode/plugins/tawassul.js` on its own. Do not edit
`opencode.json` to register it.

If the host uses a restricted module resolver, install the plugin API once in
the workspace:

```bash
mkdir -p .opencode
printf '{"type":"module","dependencies":{"@opencode/plugin":"^2.4.1"}}\n' > .opencode/package.json
bun install --cwd .opencode
```

## Drop-in load

Copying the bundle into a plugin directory is a complete install. The host reads
that directory at startup and loads the plugin files it finds; nothing registers
the file, and nothing asks for confirmation.

| Scope | Bundle | Runtime |
| --- | --- | --- |
| Project | `<project>/.opencode/plugins/tawassul.js` | `<project>/.opencode/tawassul-runtime/wasm/` |
| Global | `<config>/opencode/plugins/tawassul.js` | `<config>/opencode/tawassul-runtime/wasm/` |

Copy `dist/global.js` for a hand install: it carries every dependency, so no
`node_modules` sits beside it and the host runs no package install. The four
wasm folders keep their names under `tawassul-runtime/wasm/`. The singular
`plugin/` directory is read as well in both scopes; one copy per scope is the
rule, and `install-global` refuses to run while a project copy exists.

Create both directories before the host starts; a missing plugin directory stops
it with `Location plugins did not finish activating`. A hand copy carries no
install marker, so `--verify` and `--uninstall` do not see it and Windows gets no
key-directory ACL. Deleting the bundle unloads the plugin on the next start, and
removing `tawassul-runtime/` also removes the AST grammars.

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
install-global: installed ~/.config/opencode/plugins/tawassul.js (v0.1.7-experimental, <bundle-sha>)
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

A standalone daily database maintenance lane is a third mode. It installs no
plugin and needs no workspace:

```bash
sh install.sh --db-maintenance --dry-run
sh install.sh --db-maintenance
sh install.sh --db-maintenance --uninstall
```

The installer downloads the bundle and the runtime archive from the GitHub
release, verifies both against `SHA256SUMS`, refuses when the expected hash is
unavailable, and stages the flat layout. `--db-maintenance` downloads
`tawassul-db-maintenance-<version>.tar.gz` instead and verifies it the same way.

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

The release installer stages the bundle and the grammars. `--global` and
`--project` do not register the scheduled database maintenance trigger and do
not probe the host version; the repository installer above does both.
`--db-maintenance` is the exception: it registers the schedule and installs no
plugin at all. Use the repository installer from a source checkout when you
want the plugin and the lane together.

A second run replaces the same files and produces the same layout. An uninstall
removes the bundle, the four grammars, and the marker, and keeps every file the
installer did not write. Neither installer edits `opencode.json` or
`opencode.jsonc`.

### Database maintenance lane

`--db-maintenance` installs one global, standalone lane: the five scripts under
`<config>/opencode/tawassul-runtime/db/` and a `MAINTENANCE` marker beside them.
It writes no plugin bundle, no `VERSION` marker, and no project configuration,
so it works on a host that never installs the plugin.

The target is the desktop sidecar database,
`<data>/opencode/tawassul-v2/opencode.db`, and it must already exist: the host
creates it on first launch. The installer refuses a symlinked or foreign path,
and it refuses a home that has never started the host once. Pass `--db` to name
a different sidecar database.

#### Using the downloaded archive

`tawassul-db-maintenance-<version>.tar.gz` is the same lane as a standalone
asset: exactly the five scripts, with no bundle, no wasm, and no manifest. It
exists for two cases: a host that never installs the plugin still needs its
database bounded, and an offline or audited machine must install the lane from
files it already holds.

`--from <dir>` reads the archive from a local directory instead of GitHub. That
directory must hold both the archive and the release `SHA256SUMS`; the installer
checks the archive against that file and refuses a missing or mismatched entry.

```bash
sh install.sh --db-maintenance --from ~/Downloads
```

To run one pass without installing anything, unpack the archive and keep the
five scripts in one directory. They resolve each other from their own location,
so nothing else is needed:

```bash
tar -xzf tawassul-db-maintenance-<version>.tar.gz
bash tawassul-db-maintenance/opencode-db-maintenance.sh \
  --db "$HOME/.local/share/opencode/tawassul-v2/opencode.db" --check
```

`--check` prints the sizes and what a run would delete, and changes nothing.
Drop it to back up, prune, and vacuum. A manual run registers no schedule: the
daily timer or cron line exists only when the installer writes it. The script
refuses a database a live process holds unless `--allow-in-use`, and it always
refuses a live `VACUUM`. See [database](database.md) for every flag, the exit
codes, and the retention window.

The daily run is registered with a systemd user timer when available and a cron
line otherwise. `TAWASSUL_REGISTER_TRIGGERS` chooses the mechanism: `auto` (the
default), `systemd`, `cron`, `manual`, or `off`. A schedule owned by another
installer is never overwritten silently: under `auto` the lane stays `manual`
and names the schedule's owner, while a forced `systemd` or `cron` fails
loudly. `--force` takes the schedule over and re-stamps it.

Under a `--prefix` that is not the real config root, registration is `manual`:
nothing is written to the host's user units or crontab, the marker records
`"trigger": "manual"`, and the installer prints the command that runs the lane.
Forcing `systemd` or `cron` there is refused with the same manual command
instead of writing a schedule that points into the prefix. Such an installation
appears only in that prefix's doctor report; when the prefix resolves to the
real config root, the real doctor reports it.

`TAWASSUL_DB_GAP_SECONDS` sets the minimum interval between runs; the marker's
`gapSeconds` is the fallback, and 86400 seconds is the default.
`TAWASSUL_DB_MAINTENANCE=off` installs the scripts without a schedule, removes a
schedule this lane owns, and records `"trigger": "off"`.

### Removing the lane

The lane is global and standalone. Deleting the plugin file, ending a project,
or deleting a project directory does not remove its scripts, `MAINTENANCE`,
timer, or cron line, and the daily run continues. Remove it with:

```bash
sh install.sh --db-maintenance --uninstall
```

A project install is removed with `sh install.sh --project <dir> --uninstall`.
If the runtime directory was deleted by hand, `doctor` reports
`stale maintenance schedule: <mechanism> -> <path> (missing)` and prints the
exact, owner-matched cleanup command; it never edits a schedule it does not own.

`--db-maintenance` and the plugin coexist in either order; when the plugin
installed the scripts first, pass `--force` so the lane takes them and the
schedule over. When a repository `VERSION` marker records the database lane,
`--db-maintenance --uninstall` removes only `MAINTENANCE`, keeps the shared
scripts, and prints the cleanup command for the schedule it leaves, because
that marker still points at them. `install-global` does the
mirror image: while `MAINTENANCE` exists it installs the bundle and grammars,
skips the database scripts, timer, and cron line, and preserves them on
uninstall.

### What the installer writes

| Path | Content | Removed on uninstall |
| --- | --- | --- |
| `~/.config/opencode/plugins/tawassul.js` | The plugin bundle | Yes |
| `~/.config/opencode/tawassul-runtime/wasm/` | Four wasm files (one runtime, three grammars) | Yes |
| `~/.config/opencode/tawassul-runtime/db/` | Database scripts and `MAINTENANCE`, written by `--db-maintenance` and by the repository installer (POSIX only) | `--db-maintenance --uninstall` removes them; `install-global --uninstall` preserves them while `MAINTENANCE` exists |
| `~/.config/opencode/tawassul-runtime/VERSION` | Marker: version, hashes, owner, host | Yes |

The installer records what it wrote, so an uninstall removes exactly that set
and nothing else. It never edits `opencode.json` or `opencode.jsonc`. At boot
a project-scope install repairs an existing `opencode.json` or `opencode.jsonc`
and creates any missing `.opencode/agents/*.md`; when the workspace has neither
config, the first-boot seed creates a minimal `opencode.json` unless
`TAWASSUL_NO_AUTOCONFIG=1` is set. A global-scope install never writes project
config or project agent files. Global `addagent` and `kick` write the roster to
`~/.config/opencode/tawassul.jsonc`; the global `opencode.json` and
`opencode.jsonc` are never written.

### Environment overrides

| Variable | Effect |
| --- | --- |
| `TAWASSUL_GLOBAL_DIR` | Install under this config root instead of the default |
| `TAWASSUL_REGISTER_TRIGGERS` | Schedule mechanism for `--db-maintenance`: `auto`, `systemd`, `cron`, `manual`, or `off` |
| `TAWASSUL_DB_GAP_SECONDS` | Minimum seconds between scheduled maintenance runs (default 86400) |
| `OPENCODE_BIN` | Path to the host binary the installer probes for a version |
| `TAWASSUL_OPENCODE_VERSION` | Pin the host version instead of probing it |
| `TAWASSUL_ASSET_ROOTS` | Extra search roots for the wasm grammars |

`TAWASSUL_GLOBAL_DIR` also moves the HMAC key directory beside the config root.
An explicit `TAWASSUL_HMAC_KEY_DIR` wins over that. The installer treats an
explicit key directory as operator-managed: it never writes a key there, and
`install` or `--verify` exits 2 when the key file is absent or is not 32 bytes,
because the runtime refuses to sign without it.

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
- `~/.config/opencode/tawassul-v2-state`, when a pre-release build left it
  behind
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

The roster is selectable in the desktop app only with **Show agent** on:
**Settings → General → Show agent** ("Switch between agents in the composer").
With it off, every session stays on the Build agent, and the specialists load
but cannot be chosen.

The plugin directory must exist before the host starts. The installer creates it;
a hand-made install must create it too, or the host refuses to start with
`Location plugins did not finish activating`.

## Platform notes

- **Linux and macOS** — full lane, including database maintenance and scheduled
  triggers.
- **Windows** — native install stages the bundle and the wasm files only.
  Database maintenance and scheduled triggers are unavailable on `win32`, and
  the key directory is protected with an `icacls` ACL instead of POSIX modes.
  Native Windows x64 has a native receipt; see [compatibility](compatibility.md).
  The zero-dependency path is a hand copy: rename `dist\global.js` to
  `%USERPROFILE%\.config\opencode\plugins\tawassul.js` and copy the four wasm
  files, keeping their folders, under
  `%USERPROFILE%\.config\opencode\tawassul-runtime\wasm\`. That needs nothing
  beyond Explorer, but a hand copy has no install marker, no key-directory ACL,
  and no `--verify` coverage; use it only when Bun and Node are both
  unavailable. `bun scripts\install-global.ts` stages the same layout plus the
  install marker, supports `--verify` and `--uninstall`, and needs Bun 1.3 or
  newer (Node 24 or newer runs the same script; verified on Node 26.13.0). Set `TAWASSUL_GLOBAL_DIR` to
  install somewhere other than `%USERPROFILE%\.config\opencode`. Defender
  reports no detection for the bundle, and SmartScreen gates only an unsigned
  downloaded executable, which the release does not contain.
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
| `cannot remove … (EBUSY)` or `cannot archive … (EPERM)` on Windows | A running host still holds the plugin or a state file | Stop the host and rerun the same uninstall or purge command |
| `TAWASSUL_HMAC_KEY_DIR points at … which is absent` | The variable must name a directory that already holds a 32-byte key | Write the key there, point the variable at an existing key directory, or unset it and let Tawassul manage `~/.config/tawassul` |

More in [troubleshooting](troubleshooting.md).

---

[Documentation index](README.md)
