# Release 0.1.0-experimental — Execution Plan

Revision 5 · 2026-11-01 · owner HtoZ27
Status: ACTIVE. Every work package closes only when its acceptance check passes
on disk.

Revision 5 cancels the canary channel and everything that depended on it:
section 10, the `canary` workflow, the first canary tag in WP13, the canary row
in the CI table, `docs/CANARY.md`, the acceptance item and the risk rows. The
first published artifact is the stable release; no prerelease tag is planned.

Revision 5 also declares native Windows supported, but as of 2026-11-01 that
claim is **pending**. The `win32` lane is implemented and an emulator run under
Wine loaded the real v2.2.5 host and this bundle
(`docs/experiments/receipts/2026-11-01-windows-host-wine.md`), yet no real
Windows host has produced the WP5a receipt. Until one does, Windows stays out of
public support text: the emulator receipt says nothing about NTFS ACLs,
Defender, long paths, case sensitivity or file locking. The OpenCode v2 download
page lists Windows ARM64 and x64 standalone CLI builds and Windows x64 and ARM64
Desktop builds, so a native Windows host loads this plugin without WSL2. The
plugin is a JavaScript bundle and needs no POSIX tool at runtime; only the
installer and the database lane are POSIX-bound. WP5a adds the `win32` installer
lane: an explicit platform branch, `where` instead of `which`, `icacls` on the
key directory, and no database payload, trigger or smoke step.

Revision 4 adds the platform HMAC key table in section 8.1, the Windows guard
ordering, and the state-directory defects found while verifying the code against
the OpenCode v2 documentation. Revision 3 added the verified host contracts in
section 3.3. Revision 2 folded in state topology, the canary channel (cancelled
in revision 5), the three artifact manifests, proof-count sourcing, and the
review points listed in section 3.2. No source file changes are implied by this
document.

This file is a local development document. It is not published. Section 6 lists
the documentation set; section 5.3 lists the three artifacts and what each one
contains.

---

## 1. Decisions

| Item | Decision |
| --- | --- |
| Version | `0.1.0-experimental` |
| Public branch | `main` |
| Prerelease channel | none; the canary channel is cancelled (2026-11-01, section 10) |
| Public history | one root commit; development history stays local |
| Rights holder | `HtoZ27` |
| Contact | `341918981+HtoZ27@users.noreply.github.com` |
| License | MIT, including the documentation |
| Tawassul v1 support | removed entirely |
| `data/kanban` | deleted permanently; no migration |
| `mission-board` | kept as a feature |
| OpenCode host | `2.x` only. `1.x` is not supported at any level |
| Host floor | `>=2.2.1 <3.0.0`; `2.2.0` is not accepted until tested |
| OpenCode 1.x entry | remove `server` from `src/index.ts`; install and init refuse below the floor |
| 2.x event adapter | kept: it maps payloads emitted by OpenCode 2.x, not 1.x support |
| OpenCode DB generation guards | kept: data-safety, not Tawassul v1 |
| Runtime state root | the project directory, in local and global installs alike |
| Configuration state | `<project>/.opencode/`, in local and global installs alike |
| Install-level identity | HMAC key under `${XDG_CONFIG_HOME:-~/.config}/tawassul` unless `TAWASSUL_HMAC_KEY_DIR` or `TAWASSUL_GLOBAL_DIR` overrides; roster and model catalog follow section 5.2 |
| HMAC key directory | `${XDG_CONFIG_HOME:-~/.config}/tawassul` unless an override applies; directory `0700` and key file `0600` on POSIX; an `icacls` directory ACL on native Windows; no migration; see section 8.1 |
| Distribution | GitHub release tarball plus `install.sh`; npm publish deferred to 0.1.1 |
| npm publish | blocked by `private: true`; the tarball is not an npm channel |
| Plugin authoring package | `@opencode/plugin` `2.2.x`; `@opencode-ai/plugin/v2` is not used |
| Config key | `plugins` (plural) only; `plugin` is not read |
| Project discovery | `<project>/.opencode/plugins/tawassul/` with `index.js`; a direct `.js` file also loads |
| Global discovery | `<global-config>/plugins/tawassul/` with `index.js`; here `<global-config>` is `~/.config/opencode` |
| Configured local paths | directories only; a path to a single file is skipped |
| Installer config writes | none; discovery loads the plugin and `opencode.json(c)` is never edited |
| Package installs | bare npm and Git entries only; `opencode plugin add` rejects tarballs |
| Lifecycle scripts | never run by the host; wasm is staged in the artifact |
| Single-file artifact | `dist/global.js`, self-contained and independent of `node_modules` |
| npm entry artifact | `dist/index.js`, used only if a future npm entry is added |
| Package name | `tawassul-v2`; `canonicalRepo()` accepts an optional scope suffix |
| Node | `26.13.0`, pinned and verified; `engines` stays compatible with that pin |
| Bun | `1.3.14` as the build and proof runtime; npm is the package manager |
| Stable release flag | GitHub release `prerelease: false`, title `v0.1.0-experimental (experimental)` |
| Security baseline | CodeQL, Dependabot, dependency-review, Scorecard, public-tree scan, SHA-pinned actions |
| Companion plugins | documented and smoke-tested; no dual-major support |
| Languages | `en` canonical, then `ar`, `fr`, `es`, `zh-CN`, `ru` |
| Linux x64 | Ready |
| Linux arm64 | Experimental |
| macOS arm64/x64 | Experimental |
| Windows native | Pending native receipt: plugin, tools, skills and state; database maintenance and scheduled triggers unavailable. OpenCode v2 ships Windows x64, ARM64 and Desktop builds, so a native host loads the plugin, and the installer needs no bash, sqlite3, fuser or POSIX tooling |
| WSL2 | Experimental: the Linux lane inside the distro, untested hardware |

OpenCode `1.x` is a host major, not Tawassul v1. Removing Tawassul v1 removes
the retired plugin tree and its state; removing OpenCode `1.x` support removes
the old host entry and every install path that targets it. The 2.x event
adapter stays because OpenCode 2.x still emits compatible payloads.

The host floor moved from `2.2.0` to `2.2.1` because `2.2.1` is the only audited
host. An untested minor cannot be the floor that the plugin claims to support.

---

## 2. Work packages

| WP | Scope | Acceptance |
| --- | --- | --- |
| WP0 | Private tag, bundle and worktree backup | tag `private-pre-public-0.1.0`, bundle and archive exist outside the tree |
| WP1 | Remove Tawassul v1 state, HMAC, roster and the OpenCode 1.x `server` entry | typecheck; `prove:independence`; no `server`; host gate rejects below `2.2.1`; no `tawassyl` or `tawassul` key or state directory |
| WP2 | Delete `data/kanban`, the install-directory state fallback, personal paths and v1 installer checks; unify state topology | no `data/kanban`; no `gtttt` or `paassss`; no `PLUGIN_ROOT/data` write; `prove:state-isolation` passes; no `resolveRuntimeStateDir`; no scope branch in a state path; platform guard precedes key and state init; `prove:key-location` passes; read-only degradation |
| WP3 | Repair proofs, manifest, disclosure budgets and package scripts | `gate:proofs` green; catalog and counts agree with `gate-manifest.json` |
| WP4 | Safety and gates: DB switch, docs gate, release consistency, public-tree scan, schema, redacted doctor, first-run notice | each gate passes its own check; restore and degradation proofs pass |
| WP5 | Distribution: package metadata, tarball, runtime archive, `install.sh`, wasm staging, artifact verification, notices, SBOM | `verify:release-artifact`; tarball install, upgrade and uninstall in a scratch HOME; `astquery` works with no `node_modules` |
| WP5a | Native Windows installer lane: platform branch before any dependency probe, `where`-based detection, `icacls` key ACL, no database payload, no trigger, no `dbSmoke`, runtime maintenance disabled on `win32` | `prove:global-install` asserts the lane selection and the ACL argument list with an injected `win32` value; `health` reports `platform: windows` and `maintenance: unavailable`; a real Windows host receipt is recorded before the public claim |
| WP6 | CI and security: workflows, Dependabot, CodeQL, dependency-review, Scorecard, `e2e-latest`, protections | workflows green on `main`; actions SHA-pinned; required checks enabled |
| WP7 | English documentation core | `check-docs` passes |
| WP8 | English documentation extended, repository hygiene, examples and release notes | every listed file exists; templates present |
| WP9 | Arabic translation of the ten core documents | parity and links pass |
| WP10 | `fr`, `es`, `zh-CN`, `ru` translations | parity and links pass |
| WP11 | Dependency documents and SBOM | notices match the built bundle; no copyleft |
| WP12 | Fast gate, proofs, smoke, fresh clone and artifact verification | every stage passes |
| WP13 | Public worktree, root commit, `main` and the release tag | one root commit; assets present; stable release published |
| WP14 | GitHub metadata, branch and tag protections, release notes, Discussions | metadata set; protections active |
| WP15 | Post-release: npm, CLI, docs site, awesome-opencode, OCX/AUR, release-please | 0.1.1 backlog, dropped from the goal before release |

WP0 is complete. WP1 starts after the owner confirms revision 5.

---

## 3. Gap register

This plan was reviewed against nine public projects. The table records what was
adopted for 0.1.0 and what stays deferred. The review itself is part of the
release evidence.

| Source | Practice | Adopted in 0.1.0 | Deferred |
| --- | --- | --- | --- |
| `Devin-AXIS/iPolloWork` | CodeQL, Scorecard, Dependabot, dependency-review, REUSE, i18n CI, installer releases | CodeQL, Scorecard, Dependabot, dependency-review, installer and i18n checks | REUSE, AUR, desktop installers |
| `rynfar/meridian` | npm, release-please, architecture, E2E, monitoring, plugin and migration docs, banner assets, Discussions | architecture, E2E, monitoring, plugin and upgrade docs; logo and Discussions | release-please, npm publish |
| `momozi1996/momo-code` | website, screenshots, translated README, versioned releases | logo, demo media, translated core docs | website and hosted docs |
| `awesome-opencode/awesome-opencode` | curated listing | listing submission after the first release | none |
| `alvinunreal/oh-my-opencode-slim` | JSON Schema, release-artifact verification, cache-stability check, `exports`, `files`, `peerDependencies`, multi-language README | schema, artifact verification, packaging fields, cache-stability note | all-contributors, companion release manifest |
| `upstash/context7` | copy-paste install snippets for several clients, MCP guidance | install matrix and MCP section | a hosted service |
| `Tarquinen/opencode-dynamic-context-pruning` | context compression, config precedence, prompt-cache warning, slash commands | `docs/PLUGINS.md`, cache warning, `protectedTools` snippet | slash commands and TUI panel |
| `boxpositron/envsitter-guard` | dual-major support, permission hooks, secret redaction, weekly `e2e-latest` | permission docs, redaction, weekly `e2e-latest` | dual-major support, rejected: OpenCode 1.x is unsupported |
| `kdcokenny/opencode-worktree` | native V2 worktrees, explicit limitations, config precedence, retirement notice | worktree section, limitations, config precedence | no native worktree tool |
| Local audit | hidden Unicode, generated files, stale evidence, package-name coupling, build-only verification | public-tree scan, self-generating dev files, release consistency, `verify:release-artifact` | none |

### 3.1 OpenCode 1.x decision

**Decision: OpenCode `1.x` is not supported. It is not an experimental lane and
it is not a compatibility target.**

Consequences:

1. `src/index.ts` exports `id` and `setup` only. The `server: initPlugin` entry
   is removed.
2. `scripts/install-global.ts` refuses a host below `2.2.1`. The project entry
   is not installed into an OpenCode 1.x plugin directory.
3. `docs/COMPATIBILITY.md` carries a `Not supported` row and no 1.x install
   instructions.
4. `scripts/prove-host-entry.ts` asserts that no `server` export exists.
   `scripts/prove-v2-compat.ts` asserts that a 1.x host and a host below the
   floor are refused with a clear message.
5. No `plugin` singular config key, no `@opencode-ai/plugin` dependency, and no
   OpenCode 1.x test lane are published.

The 2.x adapter is unaffected. `src/v2/event-adapter.ts` remains because it
normalises payloads emitted by the 2.x host; it is not a 1.x compatibility
layer.

### 3.2 Resolved in revision 2

Every row below was raised in review and is now part of a work package.

| Gap | Resolution | WP |
| --- | --- | --- |
| Six state directories collide across projects on a global install | one runtime state root: the project directory, in both scopes | WP2 |
| `records` and `config` shared across projects on a global install | always `<project>/.opencode/` | WP2 |
| Host config precedence ignores `.opencode/opencode.jsonc` | read global, project root and `.opencode` in the host's order | WP2 |
| Unwritable project directory would fail boot | disable state-backed work, one warning, `health` reports `state: read-only` | WP2 |
| `mission-board` written into the installed plugin folder | keep the feature, delete the `PLUGIN_ROOT/data` fallback | WP2 |
| `data/kanban` left as orphan user data | delete with no migration; development-phase data, recorded in `UPGRADE.md` | WP2 |
| Canary branch needs force-push and a private snapshot | retired 2026-11-01: the canary channel is cancelled, so neither the branch nor its tags exist | — |
| `translated-from` commit does not exist before the root commit | `translated-from-sha256` over the English document set | WP7, WP9, WP10 |
| One allowlist used for three different artifacts | three manifests: git tree, tarball, release assets | WP5 |
| `dist/` shipping status undefined | built, never committed; asserted by a check | WP5 |
| Top-level development directories missing from the deny list | explicit deny list in the public-tree gate | WP4 |
| Actions not pinned; no workflow permissions | every action pinned to a commit SHA; least-privilege `permissions:` | WP6 |
| `SHA256SUMS` presented as tamper protection | documented as corruption detection only | WP7 |
| SBOM built from the lockfile only | generated from the built bundle and runtime archive | WP11 |
| Public-tree gate skips the bundles | scan `dist/index.js` and `dist/global.js` for paths and secrets | WP4 |
| Environment variables have no registry | `scripts/docs-env.json` with a public list and an internal allowlist | WP4 |
| Tool documentation can drift | completeness check against `src/tool-names.ts` | WP4 |
| New gates not wired into the gate runner | added to `scripts/gate-manifest.json` as `fast` steps | WP4 |
| `install.sh` was going to mutate `opencode.json` | discovery removes the need; the installer copies files and never edits config | WP5 |
| No platform guard for the installer and maintenance lanes | Windows runs the plugin, tools and state natively with maintenance disabled; macOS gets manual maintenance | WP2, WP5a, WP7 |
| Dependency policy assumed the host installs local dependencies | `@opencode/plugin` and `zod` are dependencies, matching the docs; `global.js` bundles both | WP5 |
| `web-tree-sitter` wasm missing from project and tarball installs | stage four wasm files beside the bundle; `prove-ast-runtime` in a clean HOME | WP5 |
| `@types/node` is `^24` while Node is `26` | upgrade to `^26` and regenerate the lockfile | WP5 |
| `VALIDATION.md` still cites 109 proofs and a deleted parity document | resolved: the public page is `docs/validation.md`, its counts come from the manifest, and the stale case-colliding copy is removed | WP7 |
| A second transcript generator duplicates `gate.ts` | `gate.ts` owns `docs/CI-TRANSCRIPT.md`; no second generator | WP7 |
| License compliance has no gate | `gen-third-party-notices --check` and `check:licenses` in the fast gate | WP11 |
| The schema has no drift check | `gen-schema --check` is a fast-gate step | WP4 |
| Retaining and deleting project state is undefined | `docs/STATE.md` and `doctor` cover retention, deletion and file modes | WP2, WP7 |
| `install.sh --prefix` is undefined | `--project`, `--global`, `--prefix` and `--version` are specified in section 11 | WP5 |
| Stable release creation is implicit | an explicit release-creation step with asset verification | WP13 |
| `AGENTS.md` still permits legacy reads | clause removed from the public governance file | WP7 |
| The post-release backlog item blocks the goal from closing | dropped from the goal before release | WP13 |
| Proof count drifted | every comparison reads `scripts/gate-manifest.json` | WP3 |
| Host floor `2.2.0` while only `2.2.1` is audited | floor is `2.2.1` | WP1 |
| `packageManager` assumed to install Bun | npm manages packages; Bun is installed only where the build or a proof runs | WP6 |

### 3.3 Verified against the OpenCode v2 host documentation

Checked on 2026-10-30 against `https://opencode.ai/v2/docs/plugins/`,
`https://v2.opencode.ai/docs/build/plugins/`,
`https://opencode.ai/v2/docs/migrate-v1` and the npm registry entries for
`@opencode/plugin` and `@opencode-ai/plugin`.

| Assumption | Documentation | Consequence |
| --- | --- | --- |
| The config key is singular `plugin` | V2 uses `plugins` | Revision 2 already uses the plural |
| A configured entry may point to a `.js` file | Configured local paths must be directories; a path to a single file is skipped | Never add a file path; use discovery |
| `.opencode/plugin/` is the V2 directory | V2 discovers both, but names `.opencode/plugins/` as the V2 layout | Build and docs use the plural |
| The installer must merge `opencode.json` | Discovery loads direct `.js` files from `.opencode/plugins/` | `install.sh` writes no config |
| `opencode plugin add` can install the tarball | `plugin add` accepts npm and Git entries only; tarballs and npm alias targets are rejected | `install.sh` extracts the tarball |
| A local install gets its dependencies installed | Only bare package entries and their production dependencies are installed into an isolated cache; a local directory is loaded in place | The single-file artifact must be self-contained |
| A postinstall step can stage wasm | Package installation does not run lifecycle scripts | Wasm must ship in the artifact |
| The entry needs a `server` export | One default export with `id` and `setup` | Remove `server` |
| `@opencode-ai/plugin/v2` is the authoring package | The v2 branch README and npm `@opencode/plugin` `2.2.x` define the V2 API; some published pages still show the older path | Use `@opencode/plugin` only |
| `opencode plugin update` keeps local installs current | Local plugins are skipped by `plugin update` | `install.sh` owns upgrade |

Four corrections follow from the table:

1. The build writes `.opencode/plugins/tawassul/index.js` from `dist/global.js`,
   not `dist/index.js`, and stages the four wasm files inside the same plugin
   directory. The instruction to run a package install under `.opencode` is
   deleted.
2. `install.sh` copies into the discovery directory and never edits
   `opencode.json(c)`. A manual entry is optional, and it must name a
   directory.
3. Wasm is staged beside the bundle in all three layouts. A proof runs
   `astquery` from a clean `HOME` with no `node_modules`.
4. `dist/index.js` is reserved for a future npm entry. Every project or global
   install uses the self-contained `dist/global.js`.

Two published pages disagree. The `v2.opencode.ai` build page still shows
`import { Plugin } from "@opencode-ai/plugin/v2"`; the current
`opencode.ai/v2/docs` overview uses `@opencode/plugin`. That package is at
`1.19.5`, while `@opencode/plugin` is at `2.2.2` and the v2 branch README names
it as the authoring interface. The plan follows the package the host resolves.

---

## 4. What is removed

Tawassul v1 means the retired plugin tree, its state namespace, its signing
prefixes, its roster file, and its install artifacts. It does not mean the
OpenCode 2.x host API, the OpenCode DB schema generations, or the
`mission-board` feature.

| Area | Files | Action |
| --- | --- | --- |
| State paths | `src/utils/state-paths.ts` | remove `LEGACY_STATE_DIR_ENV`, `LEGACY_READS_ENV`, `LEGACY_STATE_DIR_NAME`, `LEGACY_ROUTER_DIR_NAME`, `legacyStateDir`, `legacyReadsEnabled`, `legacyStatePath`, `stateReadPath`, `legacyFallbackFor` |
| HMAC | `src/utils/crypto.ts` | remove `LEGACY_HMAC_PREFIXES`, `getLegacyKeyDir`, `OLD_SALT_FILE`, `OLD_VERSION_FILE` and every migration; `getKeyDir()` returns `${XDG_CONFIG_HOME:-~/.config}/tawassul`, mode `0700`, key `0600`; keep the `~/.config/tawassul` string in the isolation error message, which already names that path; no migration |
| Bootstrap | `src/bootstrap/service-factory.ts` | remove `migrateLegacyCollectiveMemory` and `stateReadPath` use |
| Persistence | `src/services/persist-utils.ts`, `src/services/background-coordinator/coordinator.ts` | remove legacy fallback reads |
| Code state | `src/services/code-state.ts` | remove `legacyCodeStateRoot` and `migrateLegacy` |
| Roster | `src/utils/path-resolver.ts`, `src/utils/opencode-config.ts`, `src/context/managers/ConfigManager.ts` | remove `TAWASSUL_ROSTER_FILE_LEGACY` and every `tawassul.json` accept path |
| Encrypted fields | `src/context/migration.ts`, `src/context/managers/ModelManager.ts`, `src/context/managers/StateManager.ts` | remove `replaceLegacyEncryptedFields` |
| Health | `src/tools/tawa/health.ts` | remove the legacy router line |
| AST warning | `src/services/ast-service.ts` | replace the `install:global` instruction with the project, global and tarball wasm paths from `docs/INSTALL.md` |
| Text | `src/i18n/en.json` | remove the legacy roster note |
| Mission board migration | `src/services/mission-board.ts`, `src/scripts/migrate-mission-board.ts` | delete `DATA_DIR`, `shouldRunPluginFolderMigration`, `migrateLegacyDataDir`, `migrateLegacyBoardDataDir` call sites and the script; keep the feature |
| Kanban data | `data/kanban` | delete the directory and every reference; no migration, no orphan handling |
| State routing | `src/utils/path-resolver.ts`, `src/utils/state-paths.ts`, `src/context-class.ts`, `src/bootstrap/service-factory.ts`, `src/bootstrap/tool-registry.ts`, `src/services/mission-board.ts`, `src/services/goal-store.ts` | remove `resolveRuntimeStateDir` and every `scope === "global"` branch on a state path; make `stateDir()` take the project directory instead of a home-based default; delete `legacyStateDir()` |
| Host config precedence | `src/utils/path-resolver.ts` | `resolveActiveConfigPath` reads global, project root and `.opencode/opencode.jsonc` in the host's order |
| Doctor | `scripts/doctor-v2.sh` | remove the external tree section and v1 global package checks |
| Installer | `scripts/install-global.ts` | remove `LEGACY_PACKAGE`, `refuseLegacyPackage` and v1 artifact checks; target `plugins/tawassul/index.js` with `tawassul-runtime/wasm` inside that directory; floor `2.2.1` |
| Entry point | `src/index.ts` | remove the `server: initPlugin` export and the intersection type |
| Local build | `build-v2.mjs` | copy `dist/global.js` to `.opencode/plugins/tawassul/index.js`; stage the four wasm files in `.opencode/plugins/tawassul/tawassul-runtime/wasm`; remove `.opencode/plugin/tawassul.js` and the empty singular directory; delete the `bun install` instruction |
| Proofs | `scripts/prove-state-namespace.ts`, `scripts/prove-p09.ts` | delete |
| Proofs | `scripts/prove-v2-independence.ts` | invert: assert absence of every removed name, including the legacy environment variables; update the build-target assertion to `.opencode/plugins/tawassul/index.js` |
| Proofs | `scripts/prove-first-boot-seed.ts`, `prove-d05.ts`, `prove-desktop-scan.ts`, `prove-global-install.ts`, `prove-feature-index-english.ts`, `prove-g003i2/i3/i5/i6.ts`, `prove-e14/e15/e44.ts`, `prove-b03.ts`, `prove-cancel-metric.ts`, `prove-db-retention.ts`, `prove-gen-guard-wal.ts`, `prove-guard-matrix.ts`, `prove-goal-capture.ts`, `prove-goal-item-ids.ts`, `prove-store-priming.ts`, `prove-disclosure.ts` | update fixtures, line budgets and expected counts |
| Package scripts | `package.json` | remove `prove:state-namespace`, `prove:p09` and their manifest entries; add the new scripts in section 5 |
| Personal paths | `scripts/doctor-v2.sh`, `scripts/prove-g002i4.ts` | remove `gtttt`, `paassss`, `/home/htoz` |
| Developer docs | `AGENTS.md`, `RULES.md`, `UPSTREAM.md`, `README.md` | rewrite; the ownership boundary drops `TAWASSUL_V2_LEGACY_READS` and the legacy-read exception, because no legacy read survives WP1 |
| Ledger | `scripts/check-shared-parity.ts`, `scripts/shared-parity.json`, `SHARED.md`, `docs/SHARED-PARITY.md` | delete, remove the gate step |
| Package-name coupling | `src/services/db-maintenance-trigger.ts` | `canonicalRepo()` accepts `tawassul-v2` and `@scope/tawassul-v2` |

Hard rule: the words `tawassyl`, `gtttt`, `paassss` and any absolute home path
must not appear in the published tree. The `src/v2/` adapter and
`scripts/guard-db-generation.sh` keep their host and DB generation vocabulary.

### 4.1 Kanban policy

`data/kanban` is development-phase residue. It is deleted with the migration
code, and no user data is preserved. This is safe only because 0.1.0 has never
been installed by a user. `docs/UPGRADE.md` states it in one line so the
decision is not rediscovered later.

---

## 5. What is added

| Area | Files | Purpose |
| --- | --- | --- |
| Maintenance switch | `src/services/db-maintenance-trigger.ts` | `TAWASSUL_DB_MAINTENANCE=off` disables the trigger |
| First-run notice | `src/services/db-maintenance-trigger.ts`, `src/tools/tawa/health.ts` | one-time warning and a `dbMaintenance` health field |
| Read-only degradation | `src/bootstrap/plugin-init.ts`, `src/tools/tawa/health.ts` | `state: read-only` instead of a failed boot |
| Platform guard | `src/bootstrap/plugin-init.ts` | Windows: native run, maintenance disabled; macOS: manual maintenance |
| Documentation gate | `scripts/check-docs.ts` | links, anchors, versions, tools, env vars, languages, hidden Unicode |
| Environment registry | `scripts/docs-env.json` | public variables and an internal allowlist |
| Public-tree gate | `scripts/check-public-tree.ts` | allowlist, deny list, forbidden strings, secrets, hidden Unicode, bundle scan |
| Release consistency | `scripts/check-release.ts` | tag, package, CHANGELOG, docs, FACTS, proof count from the manifest |
| Release preparation | `scripts/release/prepare-public.ts` | allowlist copy from `scripts/release/public-files.json` |
| Package build | `scripts/release/pack.sh` | `npm pack`, runtime archive and checksums |
| Installer | `scripts/release/install.sh` | download, checksum, preflight, discovery install, dry-run, uninstall; never edits config |
| Runtime staging | `build-v2.mjs`, `scripts/install-global.ts` | four wasm files beside the bundle in project, global and tarball layouts |
| License check | `scripts/gen-third-party-notices.ts --check` | fails on notice drift or a copyleft dependency |
| Artifact verification | `scripts/verify-release-artifact.ts` | tarball and asset contents, wasm, hashes, no forbidden files |
| SBOM | `scripts/gen-sbom.ts` | CycloneDX JSON from the built bundle and the runtime archive |
| Notices | `scripts/gen-third-party-notices.ts` | regenerate `THIRD-PARTY-NOTICES.md` from the same inputs |
| Schema | `src/scripts/gen-schema.ts`, `tawassul.schema.json` | JSON Schema for the plugin config; `--check` is a fast-gate step |
| Doctor | `scripts/doctor-v2.sh --redact`, `--json` | shareable diagnostic report |
| Cache note | `docs/PLUGINS.md`, `docs/FEATURES.md` | prompt-cache impact of compression |
| CI | `.github/workflows/ci.yml` | rules, typecheck, docs, release check, build on `main` |
| Release | `.github/workflows/release.yml` | release assets on a `v*` tag |
| CodeQL | `.github/workflows/codeql.yml` | JavaScript and TypeScript analysis |
| Dependency review | `.github/workflows/dependency-review.yml` | block vulnerable or copyleft dependency changes |
| Scorecard | `.github/workflows/scorecard.yml` | OpenSSF supply-chain score |
| Host watch | `.github/workflows/e2e-latest.yml` | weekly smoke against the newest OpenCode 2.x |
| Dependabot | `.github/dependabot.yml` | npm and GitHub Actions updates |
| Community | `.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/CODEOWNERS` | bug, feature and compatibility intake |

`docs/CI-TRANSCRIPT.md` stays generated by `scripts/gate.ts`. No second
transcript generator is added.

### 5.1 Additions are accepted one at a time

Each addition in the table above is accepted by its own check and by nothing
else. A new component is not required to demonstrate compatibility with the
other additions, nor with the components that already exist, and no combined
compatibility test is part of the gate. Overlap is expected rather than
exceptional: the documentation gate, the public-tree gate and the release check
inspect different properties of the same files, and the database switch, the
first-run notice and the health field all describe one trigger. Where two
additions collide, the answer is a documented precedence rule and one owning
file, never a cross-compatibility proof and never a weakened check.

Consequences:

1. `check-docs` is accepted by `npm run check:docs` alone.
2. `check-public-tree` is accepted by `npm run check:public-tree` alone.
3. `check-release` is accepted by `npm run check:release` alone.
4. The maintenance switch is accepted by its own proof. It is not re-tested as a
   group with the notice, the health field or the restore drill.
5. A collision between two additions is a defect inside one of them and is fixed
   in the owning file. It is not resolved by relaxing both.
6. When two additions cannot coexist in one code path, the later one is scoped
   to its own entry point instead of being merged into the earlier one.

`npm run gate:fast`, `npm run gate:proofs` and `npm run ci` still execute every
check in sequence. Passing them together is a run, not a compatibility proof,
and it does not create that obligation.

### 5.2 State topology

Scope decides where the plugin file, the roster and the signing key live. It
does not decide where runtime state lives.

| Store | Local install | Global install |
| --- | --- | --- |
| `goals/` | `<project>/goals` | `<project>/goals` |
| `sagas/` | `<project>/sagas` | `<project>/sagas` |
| `timeline/` | `<project>/timeline` | `<project>/timeline` |
| `mission-board/` | `<project>/mission-board` | `<project>/mission-board` |
| `metrics.json` | `<project>/metrics.json` | `<project>/metrics.json` |
| `handoff-ledger.jsonl` | `<project>/handoff-ledger.jsonl` | `<project>/handoff-ledger.jsonl` |
| `records`, `config`, `state.json` | `<project>/.opencode/` | `<project>/.opencode/` |
| Roster (`tawassul.jsonc`) | `<project>/.opencode/` | install config directory |
| HMAC keys | key directory from section 8.1; `TAWASSUL_HMAC_KEY_DIR` overrides | same as local |
| Model catalog | `<project>/.opencode/` | install config directory |

Implementation rules:

1. `resolveRuntimeStateDir` is deleted. Every store receives the project
   directory once, from plugin init.
2. `<project>` is the directory the host passes to the plugin. It is not
   derived from the install scope.
3. `TAWASSUL_V2_STATE_DIR` overrides the project directory for every store.
   `TAWASSUL_STATE_DIR` remains as a compatibility alias and loses to
   `TAWASSUL_V2_STATE_DIR`.
4. No branch in a state path may read the install scope.
5. A read-only project directory does not fail boot: state-backed features are
   disabled, one actionable warning is logged, and `health` reports
   `state: read-only`.
6. There is no fallback into the install directory, the global config directory
   or a hash-named directory.

Consequences:

- Two projects never share a state file, in either install scope.
- A global install writes into each project it opens. `docs/STATE.md` and
  `docs/INSTALL.md` tell the user to add the six entries to the project
  `.gitignore`.
- `mission-board` remains a feature. Only its install-directory fallback is
  removed.
- `config` in the table is Tawassul's own state, not the host
  `opencode.json(c)`. Host config is read in the host's order: global config,
  project root, then `.opencode/opencode.jsonc`.

Proof `scripts/prove-state-isolation.ts`: two scratch projects in global scope,
each writes one goal, one saga, one timeline event, one handoff, one board and
one metric; assert that no path is shared and that no file lands outside the
two project roots.

### 5.3 Three artifacts, three manifests

One allowlist cannot describe three different things. Each artifact has its own
manifest and its own verification.

| Artifact | Manifest | Contains | Excludes |
| --- | --- | --- | --- |
| Git tree | `scripts/release/public-files.json` | source, scripts, English and translated docs, packaging metadata, `assets/`, `examples/` | state, logs, `dist/`, `node_modules/`, development notes |
| npm tarball | `package.json` `files` | `dist/index.js`, `dist/global.js`, runtime wasm, schema, README, LICENSE, CHANGELOG | `src/`, `scripts/`, docs, tests |
| Release assets | `scripts/release/pack.sh` | `dist/index.js`, `dist/global.js`, tarball, runtime archive, `SHA256SUMS`, SBOM, notices, `VERSION` | everything else |

Install layouts:

| Layout | Entry | Wasm | Config |
| --- | --- | --- | --- |
| Project | `<project>/.opencode/plugins/tawassul/` with `index.js` | `<project>/.opencode/plugins/tawassul/tawassul-runtime/wasm/` | none; discovery |
| Global | `<global-config>/plugins/tawassul/` with `index.js` | `<global-config>/plugins/tawassul/tawassul-runtime/wasm/` | none; discovery |
| Tarball package | `<pkg>/dist/index.js` | `<pkg>/tawassul-runtime/wasm/` | `exports` in `package.json` |

A single-file install means one bundled entry, `index.js`, plus the wasm
directory. It has no `node_modules` and no second JavaScript file.

Rules:

1. `dist/` is built, never committed. A check asserts `git ls-files dist` is
   empty.
2. The published git tree contains exactly the allowlisted paths. The deny list
   names `goals/`, `sagas/`, `timeline/`, `mission-board/`, `metrics.json`,
   `handoff-ledger.jsonl`, `extracted_files/`, `node_modules/`, `dist/`,
   `opencode.json`, `opencode.json.bak.*`, every internal log and every
   `docs/historical-*` file.
3. The tarball is minimal: no documentation tree, no scripts, no source.
4. Built bundles appear only in the npm tarball and in release assets. They
   never appear in the git tree.
5. The project and global layouts copy `dist/global.js`, which is
   self-contained. They never use `dist/index.js`, which externalizes its
   imports and needs `node_modules`.
6. The four wasm files are `web-tree-sitter/web-tree-sitter.wasm`,
   `tree-sitter-javascript/tree-sitter-javascript.wasm`,
   `tree-sitter-typescript/tree-sitter-typescript.wasm` and
   `tree-sitter-typescript/tree-sitter-tsx.wasm`. They are staged, never
   installed by a lifecycle script.
7. `install.sh` writes no config. A manual entry is optional and must name the
   plugin directory, not the file.
8. `opencode plugin add` is never used for the tarball. It accepts npm and Git
   entries only.
9. `opencode plugin add github:HtoZ27/tawassul-v2` is not supported. `dist/`
   is not committed and the host never runs lifecycle scripts, so a Git entry
   has no built bundle. The release tarball is the only package source.

Dependency policy:

- `@opencode/plugin` is a dependency, matching the docs package example. The
  host resolves it to its runtime instance. It stays external in
  `dist/index.js` and is bundled into `dist/global.js`.
- `zod` is a dependency for `dist/index.js`. It is bundled into
  `dist/global.js`, so a project or global install needs no `node_modules`.
- `web-tree-sitter` and both grammar packages stay build dependencies. Their
  JavaScript is bundled; only the four wasm files are shipped.
- `effect` is not imported by this plugin, so it is not declared. If a future
  effect entrypoint is added, `effect` becomes a peer and must stay external.

`package.json` declares `"dependencies": { "@opencode/plugin": "^2.2.1",
"zod": "^4.1.8" }`. Build-only packages, including `web-tree-sitter`, both
grammar packages and `@types/node` `^26`, stay in `devDependencies`.

---

## 6. Documentation suite

English is canonical. The `0.1.0` column marks required files. The
`Translated` column marks the ten files delivered in every language.

| File | Audience | 0.1.0 | Translated |
| --- | --- | --- | --- |
| `README.md` | user | yes | yes |
| `LICENSE` | legal | yes | no |
| `CHANGELOG.md` | user | yes | no |
| `CONTRIBUTING.md` | developer | yes | no |
| `SECURITY.md` | security | yes | no |
| `CODE_OF_CONDUCT.md` | community | yes | no |
| `SUPPORT.md` | community | yes | no |
| `docs/INSTALL.md` | user | yes | yes |
| `docs/COMPATIBILITY.md` | user | yes | yes |
| `docs/FEATURES.md` | user | yes | yes |
| `docs/TOOLS.md` | user | yes | yes |
| `docs/USER-GUIDE.md` | user | yes | yes |
| `docs/TROUBLESHOOTING.md` | user | yes | yes |
| `docs/DATABASE.md` | user | yes | yes |
| `docs/SECURITY-MODEL.md` | user | yes | yes |
| `docs/ENVIRONMENT.md` | user | yes | yes |
| `docs/DEPENDENCIES.md` | user | yes | no |
| `docs/PRIVACY.md` | user | yes | no |
| `docs/STATE.md` | user | yes | no |
| `docs/CONFIGURATION.md` | user | yes | no |
| `docs/PERMISSIONS.md` | user | yes | no |
| `docs/AGENTS.md` | user | yes | no |
| `docs/GLOSSARY.md` | user | yes | no |
| `docs/LIMITATIONS.md` | user | yes | no |
| `docs/PLUGINS.md` | user | yes | no |
| `docs/UPGRADE.md` | user | yes | no |
| `docs/MONITORING.md` | user | yes | no |
| `docs/KNOWN-ISSUES.md` | user | yes | no |
| `docs/ARCHITECTURE.md` | developer | yes | no |
| `docs/FAQ.md` | user | yes | no |
| `docs/ROADMAP.md` | user | yes | no |
| `docs/validation.md` | developer | yes | no |
| `docs/CI-TRANSCRIPT.md` | developer | yes | no |
| `docs/RELEASE-NOTES-0.1.0.md` | user | yes | no |
| `docs/i18n/LANGUAGES.md` | user | yes | no |
| `examples/README.md` plus five recipes | user | yes | no |
| `THIRD-PARTY-NOTICES.md` | legal | yes | no |
| `AGENTS.md` | developer | yes | no |
| `RULES.md` | developer | yes | no |
| `UPSTREAM.md` | developer | yes | no |
| `tawassul.schema.json` | user | yes | no |
| `opencode.example.json` | user | yes | no |

Not published: `ISSUES.md`, `PLAN.md`, `PLAN-DB-INSTALL.md`,
`REMAINING-WORK.md`, `TRIAGE.md`, `STABILITY.md`, `VERIFICATION-20261026.md`,
`RECOVERY-20261025.md`, `CUTOVER.md`, `DECOUPLING.md`, `SCRIPT-PARITY.md`,
`SHARED.md`, `docs/SHARED-PARITY.md`, `docs/FUTURE-WORK-PLAN.md`,
`docs/RELEASE-0.1.0-PLAN.md`, `docs/portable-context-handoff.md`,
`docs/historical-*`, `scripts/release/public-files.json` and every internal log.

`docs/INSTALL.md` covers three modes: project discovery, global discovery and
the tarball. The OpenCode 2 config key is `plugins` (plural) only when a manual
entry is used; the installer relies on discovery and never edits
`opencode.json(c)`. Project discovery is
`<project>/.opencode/plugins/tawassul/`, global discovery is
`<global-config>/plugins/tawassul/`, and a configured path must be a
directory. `opencode plugin add` accepts npm and Git entries only, so the
GitHub tarball is installed by `install.sh`. A `plugins/` directory beside a
project-root `opencode.json(c)` is not discovered; the plugin must live under
`.opencode/plugins/` or be configured by directory path.

`docs/STATE.md` carries the topology table from section 5.2, the two state
environment variables and their precedence, the section 8.1 platform key table,
and a `.gitignore` snippet for the six project-level entries.

`docs/ENVIRONMENT.md` documents `TAWASSUL_HMAC_KEY_DIR` as read-only, gives the
four-step key precedence from section 8.1, and notes that `TAWASSUL_GLOBAL_DIR`
moves the key as well as the plugin.

`docs/KNOWN-ISSUES.md` must list at minimum: Windows without database
maintenance or background triggers, macOS without a
scheduler, network filesystem refused for VACUUM, prune irreversibility, prompt
cache invalidation after compression, AST degradation
when the four wasm files are missing, a read-only project directory, local
plugins skipped by `opencode plugin update`, a manual config entry pointing at a
file being skipped, a key directory under `/mnt/c` on WSL2, a Windows key
directory protected by `icacls` rather than a POSIX mode, port discovery falling
back to the fixed candidate list on Windows because the `ss` and `netstat` flags
used on POSIX do not exist there, and a key that does not move between OS users.

`docs/validation.md` is rewritten in WP7. It carries no literal proof count and
no reference to `SHARED-PARITY`; the count comes from
`scripts/gate-manifest.json` and the transcript from `scripts/gate.ts`.

`docs/SECURITY-MODEL.md` must state that `SHA256SUMS` detects corruption, not
tampering, because it is published in the same release. It must also state that
the key directory is `0700` and the key file `0600` on POSIX, and that on
Windows the directory ACL is restricted to the current user with `icacls`
rather than a POSIX mode.

---

## 7. Languages

Order of delivery:

1. `en` — canonical.
2. `ar` — full user-facing set.
3. `fr`.
4. `es`.
5. `zh-CN`.
6. `ru`.

Every translation carries:

```
docs-version: 0.1.0-experimental
translated-from-sha256: <hash of the English document set>
translation: machine-assisted
source-language: en
```

The hash covers the English files of the same document, so it is stable before
the root commit exists. `check-docs` recomputes it and rejects a stale value.

The ten translated files are: `README`, `INSTALL`, `COMPATIBILITY`, `FEATURES`,
`TOOLS`, `USER-GUIDE`, `TROUBLESHOOTING`, `DATABASE`, `SECURITY-MODEL`,
`ENVIRONMENT`.

`docs/i18n/LANGUAGES.md` is the status table. A language is complete only when:

1. every file exists;
2. the heading sequence and count match English;
3. the fenced-code count and command text match English;
4. every local link resolves after the language prefix is applied;
5. the version and source hash are present and current;
6. the language switcher is present in every translated README;
7. the English-precedence banner is present;
8. no hidden Unicode or bidi control character is present.

RTL policy:

- Arabic files are UTF-8 without a BOM and without bidi control characters.
- Tables, lists and code fences keep the English structure; only prose is
  translated.
- Tool names, environment variables, paths, commands and error strings stay in
  Latin script inside Arabic prose.
- No manual direction overrides are used; GitHub renders the paragraph
  direction.

Review policy: `translation: machine-assisted` is the 0.1.0 norm for every
language except English. A file moves to `reviewed` only after a native reader
confirms headings, commands and links. The banner states that English wins on
any conflict.

Rule change: `AGENTS.md` rule 1 becomes "English is canonical; translations
under `docs/i18n/` are exempt and must carry `docs-version` and
`translated-from-sha256`." Code, tool names, error strings and environment
variables stay English in every language.

---

## 8. Platform and host matrix

| Environment | Status | Evidence |
| --- | --- | --- |
| Linux x64 | Ready | current host, full gate, systemd user timer |
| Linux arm64 | Experimental | portable code, untested hardware |
| macOS arm64/x64 | Experimental | manual install preflight, no scheduler, manual maintenance only |
| Windows native | Pending native receipt: plugin, tools, skills, state | OpenCode v2 native Windows host; installer stages the bundle and wasm only, so no bash, sqlite3 or fuser is required. The emulator run under Wine loaded the host and the bundle; a real Windows host receipt is still required before the public claim |
| WSL2 | Experimental | the Linux lane inside the distro; untested hardware |

| Host | Status | Behaviour |
| --- | --- | --- |
| OpenCode `2.2.1` | Ready | audited host |
| OpenCode `>=2.2.1 <3.0.0` | Supported | capability probe at init |
| OpenCode `3.x` | Untested | warning, no state migration |
| OpenCode `1.x` | Not supported | the module is not executed; the installer refuses it |
| OpenCode `<2.2.1` | Not supported | init logs one error and disables state-backed work |

| Install scope | Plugin location | Runtime state root | Config state root |
| --- | --- | --- | --- |
| Project | `<project>/.opencode/plugins/tawassul/` with `index.js` and `tawassul-runtime/wasm/` | `<project>` | `<project>/.opencode` |
| Global | `<global-config>/plugins/tawassul/` with `index.js` and `tawassul-runtime/wasm/` | `<project>` | `<project>/.opencode` |

`<global-config>` is `~/.config/opencode` unless `TAWASSUL_GLOBAL_DIR` or
`XDG_CONFIG_HOME` overrides it. Neither scope writes a config entry; discovery
loads the file. The HMAC key directory is
`${XDG_CONFIG_HOME:-~/.config}/tawassul`; `TAWASSUL_HMAC_KEY_DIR` overrides
it, and section 8.1 gives the per-platform enforcement. Host discovery
probes both `opencode` and `opencode2`; the binary must report a version in
range.

Runtime: Node `26.13.0` pinned in `.nvmrc`, declared as the `engines` floor, and
verified in CI. Earlier Node versions are not supported, including for source
builds. npm is the package manager: `npm ci` installs from
`package-lock.json`, and every published script is invoked through npm. Bun
`1.3.14` is not a package manager here; it is the build and proof runtime,
because `build-v2.mjs` imports `build` from `bun` and the gate manifest runs
`bun scripts/*.ts`. It is installed only in jobs that build or run proofs.
Linux requires `sqlite3`, `procps` (`free`), `psmisc` (`fuser`), and `timeout`
or `python3`.

Platform behaviour:

- Windows native: the plugin runs natively, like the OpenCode v2 Windows CLI and
  Desktop. It keeps every tool, skill and state-backed feature; database
  maintenance and every background trigger stay unavailable, `health` reports
  `maintenance: unavailable` and `platform: windows`, and the installer stages
  the bundle and wasm only. It never fails the host boot.
- macOS: no scheduler is installed. Maintenance stays manual through the
  doctor and the health tool, and the first-run notice says so.
- Read-only project directory: state-backed features are disabled with one
  warning; `health` reports `state: read-only`.

Database maintenance availability:

| Platform | Backup | Prune | WAL checkpoint | VACUUM |
| --- | --- | --- | --- | --- |
| Linux x64 | yes | yes | yes | quiescent only |
| Linux arm64 | expected | expected | expected | quiescent only |
| macOS | yes with `sqlite3` | yes with `sqlite3` | yes with `sqlite3` | manual only |
| WSL2 | expected | expected | expected | quiescent only |
| Windows native | no | no | no | no |

On native Windows no database script is staged and no trigger is armed, so all
four operations are unavailable there; a user who needs them runs the Linux lane
inside WSL2.

On POSIX, when `sqlite3`, `fuser` or `free` is missing, the plugin boots, skips
the affected operation, and logs one actionable warning. It never fails the host
boot.

### 8.1 HMAC key location by platform

The key directory comes from `globalConfigBaseDir()`, which has no platform
branch. OpenCode places the user config at `~/.config/opencode` on every
platform, and only its system directory is platform-specific, so the key mirrors
the host instead of inventing a per-platform layout.

| Platform | Key directory | Permission enforcement | Status |
| --- | --- | --- | --- |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/tawassul` | `0700` directory, `0600` file | supported |
| macOS | `~/.config/tawassul`, `XDG_CONFIG_HOME` honoured | `0700`/`0600` on APFS | experimental |
| WSL2 | the same Linux path inside the distro | `0700`/`0600` on ext4, not on `/mnt/c` | experimental |
| Windows native | `%USERPROFILE%\.config\tawassul` | directory ACL restricted to the current user with `icacls`; POSIX modes are not claimed | supported |

Resolution order, verified in `src/utils/crypto.ts` and
`src/utils/path-resolver.ts`:

1. `TAWASSUL_HMAC_KEY_DIR` must already contain the key file; Tawassul never
   generates or replaces the key there.
2. `TAWASSUL_GLOBAL_DIR` moves the key to
   `dirname(TAWASSUL_GLOBAL_DIR)/tawassul`.
3. `XDG_CONFIG_HOME` gives `$XDG_CONFIG_HOME/tawassul`.
4. Otherwise `~/.config/tawassul`.

Rules:

1. `TAWASSUL_HMAC_KEY_DIR` pins the key when `TAWASSUL_GLOBAL_DIR` or
   `XDG_CONFIG_HOME` moves the install.
2. The platform guard runs before `getKeyDir()`, `stateDir()`, the logger file
   and DB maintenance. On `win32` it keeps state-backed work enabled, disables
   database maintenance and triggers, and creates the key directory with an
   `icacls` ACL.
3. macOS uses `~/.config`, matching OpenCode. No `Application Support` path is
   added.
4. WSL2 keeps the key on the Linux filesystem. `doctor` warns when the resolved
   key directory is under `/mnt/`.
5. Windows native is implemented and pending a native receipt. The installer
   applies `icacls` to the key directory, never reuses the POSIX mode claim, and
   stages no database payload. Durable writes fsync the writable handle they
   created; reopening the temp file read-only failed `FlushFileBuffers` with
   `EPERM` on the Windows side of Wine, and the installer proof now pins the
   writable-descriptor contract.
6. `secret-tool` and `security` are POSIX keyring backends. On `win32` the
   keyring lookup fails closed to the file store under the key directory, so
   Windows is never described as using a system keyring.

---

## 9. Database safety

`docs/DATABASE.md` opens with a warning box: the plugin may back up, compact,
rebuild and prune the OpenCode database.

| Operation | Trigger | Effect |
| --- | --- | --- |
| WAL checkpoint | WAL above 64 MiB | truncate WAL |
| Backup | scheduled maintenance | consistent `.backup` snapshot, `quick_check`, session count |
| Prune | scheduled maintenance | delete messages older than 90 days |
| VACUUM | quiescent DB at the cap | rebuild the file, reclaim space |
| Rotation | every backup | keep the last 5 backups by default |
| State backups | state save | keep at most 2 backups per file |

Opt-outs: `TAWASSUL_DB_MAINTENANCE=off`, `--prune-days 0`, `--event-only`,
`--check`, `TAWASSUL_DB_SCRIPT`, `TAWASSUL_DB_CAP_BYTES`.

First run: the trigger logs one notice per installed version, stating that
backup, prune and VACUUM are enabled, linking `docs/DATABASE.md`, and naming
`TAWASSUL_DB_MAINTENANCE=off`. The `health` tool reports
`dbMaintenance: enabled | disabled | unavailable`.

Restore drill: `scripts/prove-db-restore.ts` creates a scratch database, runs
maintenance, removes the live file, restores the newest backup, runs
`quick_check`, and compares the session count.

Degradation: `scripts/prove-db-degrade.ts` runs with a `PATH` that lacks
`sqlite3`, `fuser` and `free`, and asserts a clean boot with a warning. A DB
generation outside the known set is refused for maintenance, not rewritten.
A database on a network filesystem is detected and refused for VACUUM.

---

## 10. Prerelease policy — canary cancelled

The canary channel is cancelled (owner decision 2026-11-01). There is no
`v*-canary.*` tag, no `canary` workflow, no canary branch and no
`docs/CANARY.md`. The first published artifact is the stable release described in
section 9; the "experimental" marker lives in the version string, not in a
prerelease channel.

If a prerelease is ever needed later:

- it reuses the release workflow with `prerelease: true` on an immutable tag;
- the tag points at a commit already public on `main`, so no snapshot step exists;
- a tag is never moved, deleted or reused;
- if it is published to a package registry it uses the `beta` dist-tag, never
  `latest` (section 12.1);
- rollback installs the previous tarball, and state does not cross project
  boundaries.

Users testing an early build isolate `HOME`, `XDG_*`, `OPENCODE_DB`,
`TAWASSUL_V2_STATE_DIR` and `TAWASSUL_HMAC_KEY_DIR`, as `docs/STATE.md` and
`docs/ENVIRONMENT.md` describe.

---

## 11. Verification

| Stage | Command | Required result |
| --- | --- | --- |
| Fast gate | `npm run gate:fast` | pass, including the new gate steps |
| Documentation gate | `npm run check:docs` | pass |
| Public-tree gate | `npm run check:public-tree` | pass |
| Release consistency | `npm run check:release` | pass |
| State isolation | `npm run prove:state-isolation` | two projects share no file |
| Key location | `npm run prove:key-location` | directory `0700` and file `0600` on POSIX; `XDG_CONFIG_HOME`, `TAWASSUL_GLOBAL_DIR` and `TAWASSUL_HMAC_KEY_DIR` precedence; the `win32` lane returns the `icacls` ACL arguments instead of a mode, and no POSIX mode is claimed there |
| Proofs | `npm run gate:proofs` | every manifest entry passes |
| Smoke | `npm run gate:smoke` | pass |
| Build | `npm run build` | `dist/index.js` and `dist/global.js` |
| Package | `npm run pack:release` | tarball, runtime archive and checksums |
| Artifact | `npm run verify:release-artifact` | contents, wasm and hashes match |
| AST runtime | `npm run prove:ast-runtime` | `astquery` works with `node_modules` absent |
| Fresh clone | `npm ci && npm run verify` | pass under Node 26.13.0 |
| Tarball install | `install.sh --project <scratch> --dry-run` and `install.sh --prefix <scratch> --global` | install, upgrade and uninstall in a scratch HOME |

Each row is accepted on its own; see section 5.1 for why no row is required to
prove compatibility with another row.

Gate wiring: `check:docs`, `check:public-tree`, `check:release`,
`prove:state-isolation` and `prove:key-location` are steps in
`scripts/gate-manifest.json`, not only package scripts. The proof count is read from that manifest; no published
document or script carries a literal count.

`check-docs` enforces: every registered tool documented, every environment
variable in `scripts/docs-env.json` documented, every local link and anchor
resolves, the version matches `package.json`, the translation hash matches the
English set, every language file is complete, and no hidden Unicode or bidi
control character is present in a published document.

Tool documentation is checked against `src/tool-names.ts`: every name has a
section and every section names a known tool. Descriptions stay hand-written.

`check-public-tree` enforces: every published file is in the allowlist, no path
outside the allowlist exists, no denied path exists, and no file contains
`tawassyl`, `gtttt`, `paassss`, an absolute home path, a secret pattern, a
private key, or a hidden Unicode character. It scans `src/`, `scripts/`,
`docs/`, `README.md`, `package.json`, `package-lock.json`,
`opencode.example.json`, `dist/index.js` and `dist/global.js`. Binary files are
hashed, not decoded.

`check-release` enforces: `v*` tag equals `package.json` equals the
`CHANGELOG.md` heading equals every `docs-version` equals the FACTS release
version, and the proof names and count equal `scripts/gate-manifest.json`. The
command has no prerelease mode: the canary flag left with the channel in
revision 5, so a version that is not the exact release version fails.

`verify-release-artifact` enforces the three manifests in section 5.3: tarball
file list, runtime archive contents, wasm presence, checksum match and absence
of forbidden files.

`install.sh` contract: `--project <dir>`, `--global`, `--prefix <dir>` (treat
`<dir>` as `HOME` for a scratch install), `--version`, `--help`, `--dry-run`
and `--uninstall`. It verifies the checksum, detects the platform, falls back
to `shasum -a 256`, refuses offline when the expected hash is unavailable,
downloads `dist/global.js` and the runtime archive, installs
`tawassul/index.js` from `dist/global.js` plus the four wasm files under
`tawassul/tawassul-runtime/wasm/`, removes exactly that directory on
`--uninstall`, removes the alternate single-file layout on upgrade, writes no
`opencode.json(c)`, and produces the same result on a second run.

Windows install paths: `install.sh` is a POSIX shell script, so on native
Windows it runs under Git Bash (Git for Windows), which supplies `bash`,
`shasum` and the core utilities it calls. The second path is
`bun scripts/install-global.ts --install`, which needs no shell at all and is
the lane WP5a hardens. Both write `tawassul.js` and the four wasm files into the
host global directory (`%USERPROFILE%\.config\opencode` by default) and neither
edits the host config. OpenCode v2 does not support Windows package managers, so
no winget, Chocolatey or Scoop package is planned.

Windows prerequisites, in preference order: (1) copy `dist/global.js` and the
four wasm files into `%USERPROFILE%\.config\opencode\plugins\tawassul\` by hand,
which needs nothing beyond Explorer; (2) `bun scripts/install-global.ts
--install`, which needs Bun 1.3 or newer; (3) `install.sh`, which needs Git for
Windows for `bash` and `shasum`. A stock Windows profile can carry none of them:
the profile inspected while writing this plan has no Git, Node, Bun or `.config`
directory, so path 1 is the only one that always works and the other two must
state their prerequisite where they are offered.

---

## 12. Publishing

1. Tag the private history `private-pre-public-0.1.0`.
2. Create a bundle backup and a worktree archive.
3. Build the public worktree with `scripts/release/prepare-public.ts` from
   `scripts/release/public-files.json`.
4. Run `npm ci && npm run verify`, `npm run check:public-tree`,
   `npm run check:release`, `npm run pack:release` and
   `npm run verify:release-artifact` in the worktree.
5. Commit as `HtoZ27 <341918981+HtoZ27@users.noreply.github.com>`.
6. Push `main` and `v0.1.0-experimental` over HTTPS with a fine-grained PAT
   that has `Contents: Read and write`.
7. Verify the remote tree equals the local tree before enabling protections.
   Before protections exist, a bad root commit means deleting and recreating the
   empty repository. After protections exist, a bad release gets a new patch
   tag; the old tag is never moved.
8. Enable branch protection on `main`: no force push, no deletion, required
   checks `ci`, `docs` and `build`. The workflow job names must match these
   strings exactly.
9. Protect `v*` tags: restrict creation, update and deletion to the owner.
10. Create a `release` environment restricted to `v*` tags with the owner as
    required reviewer.
11. Enable secret scanning, push protection, Dependabot alerts, private
    vulnerability reporting and Discussions.
12. Set `main` as the default branch, add the description, topics, homepage
    and social preview.
13. Create the GitHub release `v0.1.0-experimental` from the tag with
    `prerelease: false`, the title `v0.1.0-experimental (experimental)`, the
    body from `docs/RELEASE-NOTES-0.1.0.md`, and the assets from `pack.sh`.
    The `release` workflow creates it; this step verifies that the tarball,
    runtime archive, `SHA256SUMS`, SBOM, notices and `VERSION` are attached.
14. Stop there. No prerelease tag is created; the next tag is the first patch
    after 0.1.0.

### 12.1 Publish order if a package registry is added later

Out of scope here (section 15), but the order is fixed for the first publish and
for any later npm entry: annotated tag, then the GitHub release, then the
package registry, and a prerelease that is ever reintroduced publishes with the
`beta` dist-tag and never with `latest`.

---

## 13. Acceptance

1. OpenCode `1.x` does not execute the module; hosts `2.0`–`2.1` are refused at
   install and disable state at init with one error; no `server` entry remains.
2. No Tawassul v1 artifact remains in the published tree.
3. No personal path, secret or hidden Unicode remains in the published tree.
4. A fresh clone passes `npm ci && npm run verify` under Node `26.13.0`.
5. `check-release` passes: tag, package, CHANGELOG, docs, FACTS and the manifest
   proof count agree.
6. `check-docs` passes for English and every translated language.
7. All 42 tools and every registry environment variable are documented.
8. `check-public-tree` passes over every published file and every built bundle.
9. `verify:release-artifact` passes for the tarball and the runtime archive.
10. `THIRD-PARTY-NOTICES.md` and the SBOM match the built bundle; no copyleft.
11. The tarball installs, upgrades and uninstalls in a scratch HOME.
12. `main` carries exactly one root commit and the `v0.1.0-experimental` tag,
    and no prerelease tag exists.
13. Branch, tag and environment protections are active.
14. The database restore drill and the missing-dependency degradation proof pass.
15. Two projects in global scope share no state file.
16. No internal log or secret is published.
17. A project install and a global install are discovered from `plugins/`
    without editing `opencode.json(c)`.
18. `astquery` works from a single-file install with `node_modules` absent, and
    no wasm is loaded from `node_modules`.
19. On Linux and macOS the HMAC key lives under
    `${XDG_CONFIG_HOME:-~/.config}/tawassul` with directory `0700` and file
    `0600`; on Windows the key lives under
    `%USERPROFILE%\.config\tawassul` and the directory ACL is restricted to
    the current user with `icacls`, and no POSIX mode is claimed there.
20. The `win32` installer lane stages `tawassul.js` and the four wasm files only:
    it runs no POSIX dependency probe, writes no database payload, installs no
    trigger and runs no `dbSmoke`; `health` reports `platform: windows` and
    `maintenance: unavailable`; a recorded Windows host receipt exists before
    the release is published.

---

## 14. Risks

| Risk | Mitigation |
| --- | --- |
| Legacy removal breaks a hidden dependency | typecheck plus the full proof stage before commit |
| Proof fixtures depend on removed names | update or delete in the same commit as the code |
| HMAC and state continuity | no migration; the development-phase key is recreated at `${XDG_CONFIG_HOME:-~/.config}/tawassul` or at the section 8.1 override; bundle backup before boot |
| Global install writing into a project root | documented `.gitignore` snippet; state stays out of the tarball and the git tree |
| Read-only project directory | state features disabled with one warning; `health` reports it |
| Large documentation drift | `check-docs` runs in the fast gate |
| Translation staleness | `docs-version`, sha256 source hash, heading, code-block and link parity |
| A tag is reused or moved | the release workflow refuses an existing release name, and protections restrict `v*` to the owner |
| The `win32` lane runs a POSIX probe and reports missing Linux tools | the platform branch runs before `preflightMarks()`, so Windows never probes `sqlite3`, `free` or `fuser` |
| A Windows key directory inherits the POSIX mode claim | section 8.1 requires `icacls`, and `prove:key-location` asserts the ACL arguments instead of a mode |
| Windows database maintenance silently spawns `bash` | `armDbMaintenanceTrigger()` returns early on `win32`, the payload is not staged, and `health` reports `maintenance: unavailable` |
| Missing wasm in release assets | runtime archive, `verify:release-artifact` and `prove:ast-runtime` |
| `zod` missing after a single-file install | `dist/global.js` bundles it; the AST proof runs with `node_modules` absent |
| Package rename breaks DB maintenance | `canonicalRepo()` accepts the scope suffix; gate proves it |
| Companion plugin conflict | `docs/PLUGINS.md` plus an isolated hook smoke test |
| Stale CI evidence | `check-release` compares transcript version and manifest proof count |
| PAT storage | credential cache, fine-grained token, revoke after release |
| Hidden Unicode in imported text | public-tree scan rejects zero-width and bidi controls |
| Actions drifting | every action pinned to a commit SHA; Dependabot updates the pin |
| `TAWASSUL_GLOBAL_DIR` silently moves the key | the precedence is documented; `doctor` prints the resolved key directory |
| A WSL2 key on `/mnt/c` looks protected but is not | `doctor` warns when the key directory is under `/mnt/` |
| A native Windows receipt is missing and the claim is unproven | the matrix marks Windows supported with a receipt required, and acceptance 20 blocks the release until a real host transcript is recorded |

---

## 15. Out of scope for 0.1.0

- npm publish, trusted publishing and provenance.
- A `bin` CLI beyond `install.sh` and `doctor`.
- OCX, AUR, Homebrew or Nix packaging.
- A hosted documentation site or Discord server.
- Slash commands and a TUI panel.
- release-please and automated changelog generation.
- Signed tags or GPG-signed commits.
- Build provenance attestations.
- A Windows package manager package (winget, Chocolatey, Scoop), which OpenCode
  v2 itself does not support either.
- Dual-major OpenCode support.
- Replacing the Bun build and proof runtime with a Node-only toolchain.
- A benchmark or token-cost study.

These are 0.1.1 or later. None of them may reopen the retired v1 channel or
restore OpenCode 1.x support.

---

## 16. Owner decisions

Decided before revision 2: OpenCode `1.x` is not supported; Node `26.13.0`;
npm deferred; `tawassul-v2` stays the package name; documentation is MIT;
`data/kanban` is deleted; `mission-board` stays a feature.

Decided in revision 2: runtime state lives in the project directory in both
install scopes; configuration state lives in `<project>/.opencode/`; the canary
branch is deleted and replaced by tags; the host floor is `2.2.1`; the proof
count is read from `scripts/gate-manifest.json`.

Decided in revision 3: `private: true` stays and blocks npm publish; the HMAC
key directory sits beside the config root (named `tawassul` in revision 6);
single-file
installs use `dist/global.js`; the host loads plugins by discovery and
`install.sh` never edits config; `@opencode/plugin` is the only authoring
package.

Decided in revision 4: the key stays at
`${XDG_CONFIG_HOME:-~/.config}/tawassul` on Linux, macOS and WSL2; the
Windows guard runs before key and state init; `TAWASSUL_HMAC_KEY_DIR` pins the
key when `TAWASSUL_GLOBAL_DIR` or `XDG_CONFIG_HOME` moves it. Revision 5 keeps
the key location and replaces the Windows outcome: the guard now enables the
native lane instead of refusing it.

Decided in revision 5: the canary channel is cancelled, so no canary tag,
workflow or document exists; a prerelease, if one is ever reintroduced, uses the
`beta` dist-tag. Native Windows is supported for the plugin, tools, skills and
state, because OpenCode v2 ships Windows x64 and ARM64 CLI builds and Windows
Desktop builds; database maintenance and scheduled triggers stay unavailable
there, the installer applies `icacls` instead of POSIX modes, and a real Windows
host receipt is required before the public claim.

Decided in revision 6: every key-path mention names `tawassul`, the directory
`src/utils/crypto.ts` and `README.md` already use; `tawassul-v2` stays the state
and package name only. The installer derives the Windows key directory from the
runtime resolution order (`TAWASSUL_HMAC_KEY_DIR` is operator-managed and left
untouched, then the parent of `TAWASSUL_GLOBAL_DIR`, then `XDG_CONFIG_HOME`,
then `~/.config`). Host probing resolves `.cmd` and `.ps1` shims on Windows, the
installer writes markers and bundles with a durable `fsync` and a symlink
refusal, and the plan states the Windows prerequisites this disk lacks.

Revisit after the first release: npm scope, a minimal CLI, a hosted docs site,
whether the stable release should move from GitHub releases to npm as the
primary channel, and whether a prerelease channel is worth its cost once the
release pipeline is stable.

---

## 17. Carried open items

Source: `REMAINING-WORK.md` section G, refreshed on `1a2b5a9`. The historical
ledger keeps its rows; this release plan owns the live disposition. None of
these items changes the acceptance list in section 13.

### 17.1 Host-bound SHARED entries

| Entry | Host ask | Release impact |
| --- | --- | --- |
| `S-042` | Loader-level dedupe of local plugin entries across workspace entries; the plugin already prevents duplicate registration | none for acceptance 17 |
| `S-046` | Host default policy or rule registration for unknown permission actions; the bridge forces ask for `tawassul.ask` | none |
| `S-048` | Host documentation for the input and output schema pairing used by third-party plugins | none |
| `S-051` | Public contract documentation for permission evaluate mutation and tool reload | none |

### 17.2 Host-release follow-ups

Tracked in `UPSTREAM.md`: the live check of host retry behavior for throttled
requests (`E-44`), fork and revert from any message (#58865), the latest
compaction context payload (#59020), keyed session instruction entries (#56550),
and provider-reported session costs (#58562). Assess on the next host release;
no repository action now.

### 17.3 Owner decisions already taken

- Real global install: declined on 2026-10-29 (`I-01`); isolated-HOME
  validation stands. The section 13 acceptance still exercises the tarball in a
  scratch HOME.
- Workspace residue: declined. Ten `pre-refresh` copies, twelve `retired` files,
  and five inert dist-only package directories stay outside this tree; the owner
  replaces the v1-loaded plugin in each project manually.

### 17.4 Observations

- Host 2.2.0 held zero `event` rows after 3.5 days while `event_sequence`
  advanced; the write path is undetermined (`PLAN-DB-INSTALL.md` F14). No
  repository action unless the host changes.
- `docs/FUTURE-WORK-PLAN.md` stays an owner file, modified and uncommitted; its
  measured corrections live in `REMAINING-WORK.md`. It is never edited or
  committed from the release work.

### 17.5 Binding constraints

- No guard fix may edit a `bash` permission entry; guard code may refuse a
  specific command (`ISSUES.md` D-00 and the bash guard decisions).
- Tawassul v1 stays retired; no v1 entry, host or dependency returns.

### 17.6 Out of scope by owner decision

- Cold-boot acceptance N1-N5 for v2 (`S-033.3` = n-a, `E-56`, decision
  2026-10-30). v2 makes no N1-N5 claim.
