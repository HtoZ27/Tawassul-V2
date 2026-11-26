# Compatibility

This page states what has been verified, on which host, and what is still
unproven. A row marked experimental is usable but not covered by the release
gate; a row marked pending has no receipt yet and is not a support claim.

## Host

| Host version | Status | Evidence |
| --- | --- | --- |
| `< 2.3.0` | Rejected | The installer refuses below the floor, and the plugin refuses a reported version below it at init |
| `2.2.1 – 2.2.7` | Retired | Assessed before revision 19 of the dispatch plan; accepted only while the floor was 2.2.1, refused now |
| `2.3.0` | Supported, floor | The minimum accepted host; background-subagent terminals are fixed (`E-57`) |
| `2.3.x` above `2.3.0` | Supported, unaudited patch level | The 2.3.x line is floor-supported; only 2.4.0–2.4.1 is audited. The generated `browser` key was not exercised on 2.3.x |
| `2.4.0 – 2.4.1` | Supported, audited | The audited ceiling and the built dependency; browser deny, `part_rows` opt-out, and codemode/video idle kinds are handled |
| `2.4.x` above the audited build | Supported, unaudited patch level | Capability probe at init; installer advises `check:upstream` |
| Newer major (`3.x` and above) | Untested | Accepted in untested mode with a warning; the plugin probes host capabilities at init and reports any missing domain |

The plugin API dependency is `@opencode/plugin ^2.4.1`. The installer refuses a
host below `2.3.0` and warns when the host is newer than the audited `2.4.1`.
The plugin refuses a host that reports a version below `2.3.0` at init; when the
host reports no version, that check is skipped and the capability probe still
runs.

## Platforms

| Platform | Status | Notes |
| --- | --- | --- |
| Linux x64 | Ready | Full lane, including database maintenance and scheduled triggers |
| Linux arm64 | Experimental | Same lane; less runtime evidence |
| macOS arm64 | Experimental | POSIX lane; key directory follows `~/.config` |
| macOS x64 | Experimental | Same as above |
| Windows x64 (native) | **Supported, native receipt** | Bundle and wasm install only; no database maintenance, no triggers; `icacls` key ACL; install, verify, upgrade, uninstall, and purge verified on Windows 10 x64 |
| WSL2 | Experimental | Linux lane; keep the key off `/mnt/` |

Native Windows x64 now has a native receipt for the bundle and wasm lane:
install, verify, in-place upgrade, uninstall, and purge on `C:`, `D:`, and `F:`;
a real `icacls` ACL from the resolved SID; a profile path with a space; a
275-character path; host discovery and a live `debug agents` load from the
Desktop 2.2.5 sidecar; and closed failures for a locked bundle and a locked
state file. The receipt is
`docs/experiments/receipts/2026-11-02-windows-install-cycle-native.md`. The
current installer lane was re-run on 2026-11-03
(`docs/experiments/receipts/2026-11-03-windows-install-cycle-native.md`): rebuild,
flat `plugins/tawassul.js`, four wasm assets, in-place upgrade, 278-character
path, and the security check all passed.

Remaining Windows boundaries: ARM64 is not covered; Windows 11 shares the
file-path format and the Defender update channel with Windows 10, so the path,
ACL, and Defender results carry over, with only version-level differences. The
host-side watcher, service, and SQLite lane stay out of scope. Defender and
SmartScreen were measured on this machine: Defender reported no detection across
install, verify, upgrade, uninstall, and purge, and a kit tagged with
Mark-of-the-Web completed the lane without a prompt. SmartScreen blocks only an
unsigned downloaded executable, which the kit does not contain. The earlier
emulator receipts remain the evidence for the Windows lane under Wine.

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
Linux x64 at the release commit. Native Windows x64 has a separate native receipt
for the bundle and wasm lane; its proofs still run on the POSIX lane. A Windows
workflow (`.github/workflows/windows.yml`) runs the install cycle, PowerShell 7,
a 278-character path, and the tree-sitter lane on `windows-latest`; those steps
are native Windows checks, not proofs. Every other row above is stated with its
own evidence level, and experimental rows make no promise beyond "it runs here".

---

[Documentation index](README.md)
