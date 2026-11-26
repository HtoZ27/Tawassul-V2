# Dependencies

Tawassul ships as a bundle, not as a package tree. A user does not run
`npm install` to use the plugin, and the bundle has no native addon and no
post-install script. This page records what is built in, what the host must
provide, and how the dependency inventory is audited.

## What the host must provide

| Requirement | Version | Why |
| --- | --- | --- |
| OpenCode | `>= 2.3.0`, audited at `2.4.1` | Host runtime and plugin API |
| Node.js or Bun | Whatever the host itself runs on | The bundle is an ES module |
| `sqlite3` CLI | Any recent build | Database maintenance and backups only |
| POSIX shell and `bash` | - | Maintenance and installer scripts |
| `systemd` or `cron` | Optional | Scheduled maintenance triggers |

The bundle imports Node built-ins only. `@opencode/plugin` stays external in
`dist/index.js` when it resolves beside the host, and is bundled into
`dist/global.js` so the global file works without a package tree.

## Direct components

Versions match `package.json` and the lockfile at the release commit.

| Component | Version | Licence | Role | In the bundle |
| --- | --- | --- | --- | --- |
| [`@opencode/plugin`](https://www.npmjs.com/package/@opencode/plugin) | `^2.4.1` | MIT | Plugin API types and hooks | External when resolvable |
| [`zod`](https://www.npmjs.com/package/zod) | `^4.1.8` | MIT | Configuration and tool schemas | Bundled |
| [`confbox`](https://www.npmjs.com/package/confbox) | `^0.1.8` | MIT | JSONC parsing | Bundled |
| [`web-tree-sitter`](https://www.npmjs.com/package/web-tree-sitter) | `^0.26.13` | MIT | AST queries | Bundled, wasm staged |
| [`tree-sitter-javascript`](https://www.npmjs.com/package/tree-sitter-javascript) | `^0.25.0` | MIT | JavaScript grammar | Wasm staged |
| [`tree-sitter-typescript`](https://www.npmjs.com/package/tree-sitter-typescript) | `^0.23.2` | MIT | TypeScript and TSX grammars | Wasm staged |

Build and development tools are not shipped: TypeScript, `@types/node`, and the
test and proof scripts stay in `devDependencies`.

## The wasm files

Four wasm files are staged under the sibling `tawassul-runtime/wasm` directory
by the global installer: one runtime and three grammars. The local build stages
the same four files under `.opencode/tawassul-runtime/wasm`.

| File | Role |
| --- | --- |
| `web-tree-sitter/web-tree-sitter.wasm` | The runtime |
| `tree-sitter-javascript/tree-sitter-javascript.wasm` | JavaScript |
| `tree-sitter-typescript/tree-sitter-typescript.wasm` | TypeScript |
| `tree-sitter-typescript/tree-sitter-tsx.wasm` | TSX |

The installer records each file in its marker, and `verify:global` checks the
inventory and hash. Without the wasm files the plugin logs one `AST degraded`
warning and keeps running: `astquery` returns a misleading `not supported` or
`not found` message, `readsymbol` silently falls back to a regex read, and
`depmap` with `ast: true` returns no imports (`ast: false`, the default, uses
the regex fallback). See
[known issues](known-issues.md#ast-tools-warn-ast-degraded).

## Licence policy

- Every direct component is permissively licensed (MIT, ISC, BSD, Apache-2.0,
  or BlueOak-1.0.0).
- No copyleft licence (GPL, LGPL, AGPL, MPL) appears in the installed tree at
  this lockfile.
- Two components carry attribution terms rather than a plain permissive grant:
  one under `CC-BY-3.0` and one dual `AFL-2.1 OR BSD-3-Clause`. The dual licence
  is used under its BSD option. `NOTICE.md` records the direct components; a
  redistribution of the bundle must keep that file.
- A dependency whose licence changes is a release blocker until `NOTICE.md` and
  this page change with it.

## Auditing the inventory

The installed tree at the release lockfile holds 281 packages: 126 MIT, 69
Apache-2.0, 65 ISC, 14 BlueOak-1.0.0, and a small remainder of BSD, CC, and
public-domain terms.

To list the licence of every installed package:

```bash
node -e '
const fs = require("fs"), path = require("path");
const lock = require("./package-lock.json");
for (const key of Object.keys(lock.packages)) {
  if (!key.startsWith("node_modules/")) continue;
  let licence = "MISSING";
  try {
    licence = JSON.parse(fs.readFileSync(path.join(key, "package.json"), "utf8")).license;
  } catch {}
  console.log(`${licence}\t${key}`);
}
'
```

To compare the lockfile with the tree:

```bash
npm ci --dry-run
npm ls --all
```

`verify:global` covers the shipped artifact, not the dependency tree: it checks
the bundle hash, the marker, the host pin, and the wasm inventory.

## SBOM

`npm run sbom` writes a CycloneDX 1.5 document to `dist/sbom.cdx.json`:

```bash
npm run build
npm run sbom
```

It records every installed package with its version, purl, SPDX licence, and
lockfile integrity hash, plus the bundle hash and the four wasm hashes. The
serial number is derived from the component list, so the same lockfile produces
the same document. `SOURCE_DATE_EPOCH` fixes the timestamp for a reproducible
release.

`npm run gate:fast` runs the same generator with `--check`: a missing licence, a
copyleft licence, or an unreadable lockfile fails the gate. The SBOM is a release
asset; it is not committed, because a committed copy would drift from the
lockfile it describes.

The committed [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md) is the same
inventory as a readable page. `npm run check:notices` regenerates it and fails
when it drifts from `package-lock.json`, when a package has no licence, or when
a copyleft licence appears. It is a fast-gate step.

## Supply-chain rules

- The installer never runs a package manager.
- The bundle never loads code from the network.
- A wasm file is loaded from the runtime directory beside the bundle, not from
  an arbitrary path.
- `package-lock.json` is committed; a release builds from `npm ci`, not from a
  floating install.
- The build prints whether the host package was treated as external, so a bundle
  that silently stopped externalising it is visible in the build log.

---

[Documentation index](README.md)
