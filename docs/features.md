# Features

This page is the capability catalogue. Each row states what exists, where it is
documented, and how far the claim goes.

Status meanings:

- **Ready** - shipped and covered by the gate or a proof on the reference lane.
- **Experimental** - shipped, usable, but not covered by the release gate on
  every platform.
- **Pending** - a documented gap; no receipt exists yet.
- **None** - deliberately not built.

## Team runtime

| Capability | Status | Detail |
| --- | --- | --- |
| Eight specialist agents and one router | Ready | [agents](agents.md) |
| Role-based tool allowance | Ready | [permissions](permissions.md) |
| Model selection per role, with fallbacks | Ready | [agents](agents.md) |
| Runtime roster changes | Ready | [agents](agents.md), [custom roster](../examples/custom-roster.md) |
| Delegation by handoff, with context and files | Ready | [workflow](../WORKFLOW.md) |
| Nested dispatch bounds | Ready | `maxCallDepth`, `maxTotalTasks` |
| Structured discussions with proposals and votes | Ready | [workflow](../WORKFLOW.md) |
| Evidence, claims, and challenges | Ready | [glossary](glossary.md) |

## Durable work

| Capability | Status | Detail |
| --- | --- | --- |
| Goals with items and definition of done | Ready | [workflow](../WORKFLOW.md) |
| Mechanical close: no unfinished item, no unmet criterion | Ready | Evidence rules are enforced by the tool |
| Mission board and activity timeline | Ready | [monitoring](monitoring.md) |
| Records for decisions, fixes, incidents, notes | Ready | Capped by `maxRecords` |
| Code checkpoints through git, without touching `.git` | Ready | [tools](tools.md) |
| Context packs and successor sessions | Ready | [long session](../examples/long-session.md) |
| Retention caps with oldest-first trimming | Ready | [state](state.md) |

## Safety

| Capability | Status | Detail |
| --- | --- | --- |
| Permission guard before an effect | Ready | [permissions](permissions.md) |
| Consent words for destructive tools | Ready | Extensible through `consent-tokens.json` |
| Path containment and protected roots | Ready | [permissions](permissions.md) |
| SSRF preflight before a web request | Ready | [privacy](privacy.md) |
| HMAC-signed state | Ready | Signed, not encrypted |
| Read-only refusal for foreign state | Ready | [state](state.md) |
| Prompt-injection mitigation | Ready, limited | Bounds effects; does not make a model immune |
| Sandboxing | None | The operating-system user is the boundary |
| Telemetry or analytics | None | No endpoint, no crash reporter |

## Install and operations

| Capability | Status | Detail |
| --- | --- | --- |
| Project-scope build and discovery | Ready | [installation](installation.md) |
| Global installer with a marker and verification | Ready | POSIX lane verified |
| Wasm staging beside the bundle | Ready | Four grammars |
| Installer on native Windows | Ready | Native receipt; bundle and wasm lane only |
| Per-project database isolation | Ready | HMAC of the workspace path |
| Database maintenance ladder | Ready on Linux | Manual on macOS; unavailable on native Windows |
| Scheduled triggers | Ready on Linux | systemd or cron; none on macOS |
| Log rotation for the maintenance lane | Ready | Beside the backups |
| Upgrade with state preserved | Ready | [upgrade](upgrade.md) |
| Downgrade across a schema change | None | Restore a backup instead |

## Code intelligence

| Capability | Status | Detail |
| --- | --- | --- |
| Symbol and import queries | Ready with wasm | Four tools degrade with a warning without it |
| Multi-file batch reads | Ready | `batchread` |
| Regex search with context | Ready | `smartgrep` |
| Project tree and dependency map | Ready | `projectmap`, `depmap` |
| Diff inspection | Ready | `gitdiff` |
| Sandboxed execution of project code | None | Read the file; the tool does not run it |

## Web and media

| Capability | Status | Detail |
| --- | --- | --- |
| Fetch, search, map, crawl through a configured service | Ready | Local SSRF preflight |
| Image generation and editing through a provider | Experimental | Provider-dependent |
| Routing a visual task to a suitable agent | Ready | `image_route` |

## Documentation and validation

| Capability | Status | Detail |
| --- | --- | --- |
| Public documentation set with a gate | Ready | [docs index](README.md) |
| English-only and no-comments gate | Ready | [validation](validation.md) |
| 186 isolated proofs | Ready | One child process each |
| Fast, proofs, and smoke stages | Ready | [validation](validation.md) |
| Release tarball, runtime archive, and checksums | Ready | [validation](validation.md#packaging) |
| Shell installer verified against `SHA256SUMS` | Ready | [installation](installation.md#release-installer) |
| SBOM and licence check | Ready | [dependencies](dependencies.md) |
| evals | Experimental | Pilot, not a benchmark |
| Hosted documentation site | None | The repository is the reference |
| npm package | None | Distribution is the bundle and the installer |

## Platform matrix

| Capability | Linux x64 | macOS | Native Windows | WSL2 |
| --- | --- | --- | --- | --- |
| Plugin load and tools | Ready | Experimental | Ready | Experimental |
| Goals, handoffs, records | Ready | Experimental | Ready | Experimental |
| Global installer | Ready | Experimental | Ready | Experimental |
| Database maintenance | Ready | Manual | None | Ready |
| Scheduled triggers | Ready | None | None | Ready |
| POSIX file modes for the key | Ready | Ready | ACL instead | Ready on ext4 |

Native Windows x64 is supported for the bundle and wasm lane: install, verify,
in-place upgrade, uninstall, and purge were exercised on a real Windows 10 host,
with an `icacls` ACL on the key, and the receipt is
`docs/experiments/receipts/2026-11-02-windows-install-cycle-native.md`. It has
no database maintenance and no scheduled trigger. See
[compatibility](compatibility.md).

## What this page is not

It is not a promise that every row works in every configuration. A feature that
depends on the host, a provider, or a platform carries that dependency in its
row. When a claim changes, this page and [compatibility](compatibility.md)
change in the same release.

---

[Documentation index](README.md)
