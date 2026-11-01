# E4 — installer ledger and global scope

- Date: 2026-11-01
- Host: OpenCode 2.2.5 (declared pin `2.2.0` in the isolated environment)
- Build under test: HEAD `e10baec` plus the E4 proof extension
- Runtime: bun 1.3.14
- Isolation: `HOME=/tmp/opencode/e4/home`, `XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME` under that home, `OPENCODE_DB=/tmp/opencode/e4/smoke.db`, `TAWASSUL_REGISTER_TRIGGERS=off`. No live global directory, no live host and no live state root was touched; no cron entry was registered.

## Question

Can the installer record a per-file ownership ledger, verify it, and uninstall without touching user content in an isolated global directory?

## Method and raw result

Install into the isolated global directory:

```
install-global: installed /tmp/opencode/e4/home/.config/opencode/plugins/tawassul.js (v0.1.0, 05a7c60d8730)
install-global: installed 4 wasm assets under .../tawassul-runtime/wasm
install-global: no opencode.json edit is needed; the host discovers this file
```

Twelve files were written:

| Path under the global config | Owner |
| --- | --- |
| `plugins/tawassul.js` | install (bundle) |
| `tawassul-install-owner` | install (scope owner marker, holds the project path) |
| `tawassul-runtime/VERSION` | install (ledger) |
| `tawassul-runtime/wasm/web-tree-sitter/web-tree-sitter.wasm` | install (asset) |
| `tawassul-runtime/wasm/tree-sitter-javascript/tree-sitter-javascript.wasm` | install (asset) |
| `tawassul-runtime/wasm/tree-sitter-typescript/tree-sitter-typescript.wasm` | install (asset) |
| `tawassul-runtime/wasm/tree-sitter-typescript/tree-sitter-tsx.wasm` | install (asset) |
| `tawassul-runtime/db/opencode-db-maintenance.sh` | install (db payload) |
| `tawassul-runtime/db/guard-db-generation.sh` | install (db payload) |
| `tawassul-runtime/db/opencode-db-scheduled.sh` | install (db payload) |
| `tawassul-runtime/db/db-env.sh` | install (db payload) |
| `tawassul-runtime/db/doctor-v2.sh` | install (db payload) |

Ledger shape (`tawassul-runtime/VERSION`): package, version `0.1.0`, host `2.2.0`, `sourceSha`, `contentSha` `f21ec4eebe1b`, bundle `{ path, sha256 05a7c60d8730, bytes 2313405 }`, 4 wasm records, 5 db records, the preflight dependency table, the trigger mode `manual`, and `installedAt`. Every owned file is listed with a path and a sha256. There is no separate skills ledger because the three skills and the one command are compiled into the bundle: the bundle sha256 and `contentSha` cover them, and a separate staging directory would add a second source of truth.

Skills and commands are distributed inside the bundle, not as staged files. The install proof now asserts the installed bundle text contains `tawassul-goal-review`, `tawassul-handoff-triage`, `tawassul-context-continue` and `tawassul-goals`.

## User content

A user skill (`skills/user-notes/SKILL.md`) and a user command (`command/user-review.md`) were written into the user's own global directories, then:

| Step | Result |
| --- | --- |
| `--verify` with user content present | exit 0, `verified ... (v0.1.0, 05a7c60d8730, global scope, 4 wasm assets)` |
| `--uninstall` | exit 0, `removed plugins/tawassul.js`, `removed 10 installed runtime file(s)`, `kept global roster and state` |
| Manifest after uninstall | `skills/user-notes/SKILL.md` and `command/user-review.md` remain; every install-owned file is gone |

Uninstall removed exactly the files the ledger lists and kept both user artifacts. A tampered bundle fails verification (`bundle hash mismatch`) and passes again once restored.

## Proof delta

`scripts/prove-global-install.ts` gained eight assertions and now reports 188 (was 180): the four embedded skill and command ids, verify with user content present, bundle tamper failure, verify after restore, and the two user-file survival checks. No new proof file was added, so the gate proof count stays at 147 steps.

## D4 decision

| Field | Decision |
| --- | --- |
| Ledger shape | The `tawassul-runtime/VERSION` marker is the owner ledger: one path plus sha256 per owned file (bundle, wasm, db), with stale-asset pruning driven by the marker. No separate skills ledger; the bundle hash and `contentSha` cover the embedded skills and command. |
| Uninstall semantics | Uninstall removes only marker-listed files, refuses an unmarked target without `--force`, keeps unlisted runtime files and user skills and commands, and leaves the user config and database byte-identical. |
| Distribution proof | One isolated proof (`global-install`, 188 assertions) covers install, corrupt-verify, and uninstall; `global-boot` covers the isolated global boot and registration. |
| Real global install | Not performed and not required in this session. Project scope stays the supported path; a real global install belongs to the release track after `0.1.0-experimental` is verified, and its artifacts are already covered by the isolated trials. |
| Fallback (not taken) | Keep the global install disabled and ship project scope only. |

Evidence: the install, verify and uninstall transcripts quoted above; `scripts/prove-global-install.ts` (188 assertions, `PROOF PASS: global installation`).
