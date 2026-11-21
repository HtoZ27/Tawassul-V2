# Plugins

Tawassul is an OpenCode plugin. The host loads one JavaScript file, and the file
keeps its dependencies inside itself. This page covers how the host finds that
file, what the package contains, and what changes when two copies are present.

## One file, discovered

The host discovers the bundle without any configuration edit:

| Scope | Entry | Runtime beside it |
| --- | --- | --- |
| Project | `<project>/.opencode/plugins/tawassul.js` | `<project>/.opencode/tawassul-runtime/` |
| Global | `<config>/opencode/plugins/tawassul.js` | `<config>/opencode/tawassul-runtime/` |

`<config>` is the OpenCode configuration root, `~/.config` by default. The
runtime directory holds the four wasm files (one runtime, three grammars).
The repository installer also stages the database scripts under
`tawassul-runtime/db/` on POSIX; the release installer stages no database
scripts in its `--project` and `--global` modes, while its `--db-maintenance`
mode stages those five scripts and no plugin. The plugin directory must exist
before the host starts; the installer creates it.

The entry file is a real file, not a symlink. A symlinked entry is reported as a
failure by `doctor`, because a link can point outside the install and disappear
independently of it.

Discovery is the install. The host loads the plugin files in those directories at
startup with no registration step and no confirmation prompt, so a copied file is
active on the next start and deleting it is the uninstall. The singular `plugin/`
directory is read as well as `plugins/`; keep one copy per scope.

## The configuration entry

If discovery is not an option, the host accepts a manual entry. The OpenCode 2
key is `plugins` (plural), and a configured path must name a **directory**; a
path to a single `.js` file is skipped by the host. Point the entry at a
directory that contains the bundle rather than at the bundle itself.

The installer never edits host configuration. It relies on discovery and leaves
`opencode.json` and `opencode.jsonc` untouched. See
[installation](installation.md) for the release installer and the manual copy,
and [`opencode.example.json`](../opencode.example.json) for a minimal manual
entry.

`opencode plugin add` accepts npm and Git entries only. It is not used for the
release tarball, and a Git entry has no built bundle because `dist/` is not
committed.

## What the package contains

The release tarball is a small package, not a dependency tree:

```text
package/
  dist/index.js
  dist/global.js
  tawassul-runtime/wasm/...
  package.json
  README.md  LICENSE  CHANGELOG.md  NOTICE.md  tawassul.schema.json
```

`dist/index.js` keeps `@opencode/plugin` external so the host resolves its own
runtime instance. `dist/global.js` is self-contained: it bundles `@opencode/plugin`
and every other import, so a global file works with no `node_modules` beside it.
Both files carry a content marker, and `verify:release-artifact` checks it.

`package.json` declares the two entry points:

```json
"exports": {
  ".": "./dist/index.js",
  "./global.js": "./dist/global.js"
}
```

The schema ships as `tawassul.schema.json`, the file the configuration editor
reads. See [configuration](configuration.md) for the keys it describes.

## Two copies in one host

One workspace loads one copy. A project install and a global install can both be
discovered when both directories exist; the project entry wins for that
workspace. `doctor` reports the resolved scope and warns when a global entry is
the one that loads, so a per-project state surprise has a visible cause.

Two Tawassul copies in the same workspace are a defect. The second copy yields at
init instead of registering a second time, and the log records it.

## Prompt cache

A plugin does not change how the host caches a prompt prefix. Tawassul changes
it indirectly through context compression: a compressed transcript is a
different prefix, so the provider rebuilds its cache from the new prefix. The
compression is deliberate — it keeps a long session inside the model budget —
but the cache rebuild is the cost. `TAWASSUL_MAX_CONTEXT_TOKENS` and the
handoff path change when compression runs.

## Verifying the install

```bash
bash scripts/doctor-v2.sh
```

The doctor checks the entry, the runtime inventory, the key, the database lane,
and the host version. `opencode plugin list` is not the check: it lists package
plugins, not files discovered in the plugin directory. Verify the roster
instead:

```bash
opencode debug agents --standalone
```

---

[Documentation index](README.md)
