# Privacy

This page states what Tawassul stores, where it goes, how long it stays, and what
you can delete. It describes the plugin only; the OpenCode host and your model
provider have their own policies.

## What is stored

| Data | Where | Why |
| --- | --- | --- |
| Records | State file | Decisions, fixes, incidents, notes |
| Handoffs | State file | Task, context, files, result, status |
| Goals, items, criteria, evidence | Goal ledger | Durable objectives and their proof |
| Boards and task state | State file | Mission board and status |
| Discussions, proposals, votes | State file | Collaborative decisions |
| Agent roster and model map | State file and config | Who exists and which model each role uses |
| Context packs | Data directory | Continue a long session in a successor |
| Errors and ratings | State file | Health and performance reporting |
| Paths | State file and logs | Resolve the workspace and diagnose failures |

A record or a handoff contains the text you or the model put there. That can
include code, file paths, error messages, and personal names. Treat the state
directory with the same care as the workspace it describes.

The plugin does not store provider credentials. It does not read the host's
credential store, and no configuration key accepts a key.

## What leaves the machine

| Flow | Destination | Trigger |
| --- | --- | --- |
| Model prompts | The provider configured in OpenCode | Every model call |
| Web fetch/search | The fetch service configured for `web` | An explicit `web` call |
| Image prompt | The image provider configured for `imagegen` | An explicit `imagegen` call |

There is no telemetry, no analytics endpoint, no update check, and no crash
reporter. The only local network calls are to the host's own server on
`localhost` for the model list.

## Redaction

- Logs redact key-shaped values and never include a provider key.
- Outbound text passes the privacy guard; `privacyGuardParanoid` enables the
  strictest mode.
- The `web` tool refuses private, loopback, link-local, and unique-local targets
  before a request leaves the machine, and re-checks the final URL.
- A tool result that is too large is truncated before it enters the context,
  which also bounds how much of a sensitive file is repeated.

Redaction reduces accidental disclosure. It is not a guarantee that free text
contains no secret. Do not paste a key into a prompt and expect a filter to catch
it.

## Retention

| Data | Default retention |
| --- | --- |
| Records | 5000, oldest dropped on write |
| Handoffs | 2000, oldest dropped on write |
| Goals | 5000, oldest closed dropped first |
| Evidence | 100 entries per goal |
| Context packs | Until deleted; list them with `thread(action: "list")` |
| Database backups | 5, rotated |
| Logs | Your file, your rotation policy |

Retention is a cap, not a promise of deletion at a time. A record that must
disappear should be deleted, not left to age out.

## Your controls

| Goal | Action |
| --- | --- |
| Stop all storage and registration | `disabled: true` in config, or `TAWASSUL_DISABLED=1` |
| Run without touching real state | `TAWASSUL_ISOLATED=1` |
| Keep the key off a Windows mount | `TAWASSUL_HMAC_KEY_DIR` on a Linux filesystem |
| Delete one record | `record(delete: "R-001")` |
| Delete one goal | `goal(delete: "G-001")` |
| Delete a pack | Remove it from the context-pack directory |
| Archive everything | `uninstall-global --purge --yes` |
| Delete a workspace's state | Remove `<project>/.opencode/` while the host is stopped |
| Reduce what is logged | Leave `TAWASSUL_DEBUG` unset; set `TAWASSUL_QUIET` |

## Third parties

The host, the model provider, the fetch service, and the image provider are third
parties. Their retention and training policies apply to what you send them. The
plugin cannot revoke a request that already left the machine.

## Children and sensitive data

The plugin is a developer tool. It is not designed for personal data, health
data, or anything regulated. If a workspace contains such data, do not enable
context packs or records for it, and check the provider policy before sending a
prompt.

## Changes

If a release adds a new outbound flow or a new stored field, this page changes in
the same release. A privacy-relevant change without a documentation change is a
release blocker.
