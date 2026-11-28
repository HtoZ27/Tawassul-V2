# Release notes: 0.1.8-experimental

**Status:** ninth public release, experimental. It keeps the 2.4 host surface,
caches tool schemas per plugin copy, and records the corrected memory-retention
findings. Read [limitations](limitations.md) before running it on work you
cannot restore.

**Version:** `0.1.8-experimental`.
**Date:** 2026-11-28.

## What changed

- Tool schema collection now uses a bounded cache keyed by the install URL and
  the tool surface, with a 64-entry cap. Repeated setup work on the same plugin
  copy no longer rebuilds the same schemas.
- The memory-retention issue record and plan were corrected after heap
  snapshots and a clean-host A/B slope measurement. No leak fix was proven in
  this tree and no cleanup-timeout change is included.

## Verification

| Check | Result at this release |
| --- | --- |
| Fast gate | 16 steps |
| Proofs | 192 steps, one child process each |
| Smoke | 6 steps, including the release artifacts, global boot, and independence boot |
| Proof files | 195, all catalogued across the stages |

- `npm run gate:fast`: PASS.
- `npm run build`: PASS.
- Clean-host A/B (24 alternating samples, strict `WeakRef` GC canary): no
  in-tree change improved the heap slope, so no cleanup-timeout fix is included
  in this release. The report is tracked upstream as
  [anomalyco/opencode#66944](https://github.com/anomalyco/opencode/issues/66944).

## Artifacts

| Artifact | Purpose |
|---|---|
| `tawassul-0.1.8-experimental.global.js` | Self-contained bundle for the global install |
| `tawassul-runtime-0.1.8-experimental.tar.gz` | Staging runtime: wasm grammars |
| `tawassul-db-maintenance-0.1.8-experimental.tar.gz` | Database maintenance scripts |
| `tawassul-0.1.8-experimental.index.js` | Project-build plugin entry |
