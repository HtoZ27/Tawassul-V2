# Compatibility

This page states what has been verified, on which host, and what is still
unproven. A row marked experimental is usable but not covered by the release
gate; a row marked pending has no receipt yet and is not a support claim.

## Host

| Host version | Status | Evidence |
| --- | --- | --- |
| `< 2.2.0` | Rejected | The installer and the plugin refuse to start below the floor |
| `2.2.0` | Supported | Plugin API floor used by the bundle |
| `2.2.1` | Supported, audited | The version the current proof run targets |
| `2.2.x` above the audited build | Supported, unaudited patch level | Capability probe at init; installer advises `check:upstream` |
| Newer major (`3.x` and above) | Untested | Accepted in untested mode with a warning; the plugin probes host capabilities at init and reports any missing domain |

The plugin API dependency is `@opencode/plugin ^2.2.1`. The installer refuses a
host below `2.2.0` and warns when the host is newer than the audited `2.2.1`.

## Platforms

| Platform | Status | Notes |
| --- | --- | --- |
| Linux x64 | Ready | Full lane, including database maintenance and scheduled triggers |
| Linux arm64 | Experimental | Same lane; less runtime evidence |
| macOS arm64 | Experimental | POSIX lane; key directory follows `~/.config` |
| macOS x64 | Experimental | Same as above |
| Windows x64 (native) | **Pending native receipt** | Bundle and wasm install only; no database maintenance, no triggers; `icacls` key ACL |
| WSL2 | Experimental | Linux lane; keep the key off `/mnt/` |

Native Windows is deliberately not called supported. The install, verify, and
uninstall cycle has been exercised under an emulator, which proves that the
Windows code path runs, but it says nothing about NTFS ACLs, Defender or
SmartScreen, long paths, case sensitivity, or file locking. The emulator receipt
is `docs/experiments/receipts/2026-11-01-windows-install-cycle-wine.md`; a real
Windows host receipt is still required before the public claim changes.

## Features by platform

| Capability | Linux/macOS | Windows native | WSL2 |
| --- | --- | --- | --- |
| Plugin load, tools, agents, skills | Yes | Yes | Yes |
| Goal ledger, handoffs, records, boards | Yes | Yes | Yes |
| Context store and pack/continue | Yes | Yes | Yes |
| Global installer | Yes | Yes | Yes |
| HMAC key at rest | `0700` directory, `0600` file | `icacls` ACL | POSIX modes |
| Database maintenance | Yes | No | Yes |
| Scheduled triggers (systemd/cron) | Yes | No | Yes |
| Host service management | Yes | No | Yes |

## Runtime

| Component | Requirement |
| --- | --- |
| Node.js (development and build) | `26.13.0`, pinned in `.nvmrc` |
| Bun (build, installer, proofs) | `1.3.x` |
| TypeScript | `5.6.x`, strict |
| Package manager | npm with the committed lockfile |

The published bundle is plain JavaScript and has no native addon. The only
runtime dependencies that must resolve beside the host are `@opencode/plugin`
and the wasm grammars, both staged by the installer.

## Database lane

Database maintenance, retention, and scheduled triggers require POSIX tooling
and are unavailable on native Windows. On Windows the plugin still loads and all
in-process features work; the maintenance trigger reports `unavailable` instead
of pretending to run.

## What "verified" means here

A claim moves from pending to supported only when a receipt exists in
`docs/experiments/receipts/` and the matching gate step passes. Claims backed by
an emulator are labelled as emulator evidence and never counted as native
evidence.

Current gate state: `gate:fast`, the full proof run, and the build are green on
Linux x64 at the release commit. Every other row above is stated with its own
evidence level, and experimental rows make no promise beyond "it runs here".
