# Roadmap

This page states what is shipped, what is next, and what is deliberately out of
scope. A dated promise is not made here; each item names the condition that
closes it.

## Shipped

`0.1.4-experimental` is the current public release, built on the first public
release `0.1.0-experimental`. It carries:

- Eight specialist agents and `tawa` routing, with a roster that is seeded on
  first boot.
- The full tool surface: reading, AST queries, dependency maps, search, git
  diffs, web fetches, and the orchestration tools.
- The goal ledger, mission boards, checkpoints, memory records, discussions and
  context packs.
- Project-local state with an HMAC signature, a quarantine for refused files,
  and a read-only degradation path when the state directory cannot be written.
- A release installer for project and global discovery, with a native Windows
  lane for the bundle and wasm.
- English documentation, a JSON Schema for the configuration, and a
  reproducible release artifact.

## Next

| Item | Condition to close |
| --- | --- |
| Arabic and further language translations | The ten core documents pass heading, command and link parity under `docs/i18n/` |
| Package registry publication | An owner decision to publish; the tarball is already built and verified |
| A hosted documentation site | A generator is chosen and the source documents stay canonical |
| A Windows database maintenance lane | The POSIX-only database scripts gain a supported Windows path with a native receipt |
| A macOS scheduler | An installer-managed `launchd` job is shipped and verified |
| Post-release project metadata | Repository protections, release notes and Discussions are configured on the public remote |

## Explicitly out of scope

- A command-line interface beyond `install.sh` and `doctor`.
- A hosted service, telemetry, or a remote state store. State stays local.
- Storing, proxying, or logging a provider credential.
- Widening a host permission. The guard narrows what a tool may do; it never
  expands it.
- A second plugin copy in one workspace, or a compatibility target for the
  retired first-generation plugin.

## How work is decided

An item moves from this page to a release only when it has a proof or a receipt
that names its evidence. Until then it is a direction, not a commitment. Known
defects and their workarounds live in [known issues](known-issues.md); design
boundaries live in [limitations](limitations.md).

---

[Documentation index](README.md)
