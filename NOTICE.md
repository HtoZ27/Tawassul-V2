# Notices

Tawassul is an OpenCode plugin. It is not affiliated with OpenCode, and it does
not vendor the host.

## Third-party components

The following components are used at build time, at runtime, or as the host the
plugin extends. All are consumed as published packages; this repository does not
contain their source.

| Component | Version | License | Role |
| --- | --- | --- | --- |
| OpenCode | `>=2.2.1` | MIT | Host runtime and plugin API |
| [`@opencode/plugin`](https://www.npmjs.com/package/@opencode/plugin) | `^2.2.1` | MIT | Plugin API types and hooks |
| [`zod`](https://www.npmjs.com/package/zod) | `^4.1.8` | MIT | Configuration and tool schemas |
| [`web-tree-sitter`](https://www.npmjs.com/package/web-tree-sitter) | `^0.26.13` | MIT | AST queries |
| [`tree-sitter-javascript`](https://www.npmjs.com/package/tree-sitter-javascript) | `^0.25.0` | MIT | JavaScript grammar (wasm) |
| [`tree-sitter-typescript`](https://www.npmjs.com/package/tree-sitter-typescript) | `^0.23.2` | MIT | TypeScript and TSX grammars (wasm) |
| [`confbox`](https://www.npmjs.com/package/confbox) | `^0.1.8` | MIT | JSONC parsing for the configuration file |

The wasm grammars are staged by the global installer and recorded in its marker
so that an uninstall removes exactly what was installed.

## Licence inventory

Every component above is permissively licensed. No copyleft dependency is
distributed with this plugin.

`THIRD-PARTY-NOTICES.md` is the complete inventory of the installed tree at the
release lockfile. This page lists only the components that ship inside the
bundle or as wasm grammars.

Release rule: the inventory is reconciled with the lockfile before a release is
tagged, and a mismatch blocks the release. `npm run check:notices` is that gate:
it fails when the inventory drifts, when a package has no licence, or when a
copyleft licence appears.

## Trademarks

OpenCode is a project of its respective maintainers. All other product names are
the property of their owners and are used only to describe compatibility.
