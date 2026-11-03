# HMAC key rotation: state rejection and recovery

- Date: 2026-11-03
- Verdict: **PASS** for the rotation heal and the live recovery. The canonical
  state was rejected by HMAC verification, quarantined once by the new build,
  and then restored from the intact payload with 2019 records and 1000 handoffs.
- Machine: Windows 10 IoT Enterprise LTSC 21H2, build 19044, x64
- Host: OpenCode Desktop 2.2.5, sidecar `opencode-cli.exe`
- Bun: 1.3.14 baseline; Node: v26.13.0
- HEAD at the time of the live recovery: `c0b19a2` plus the uncommitted
  rotation-heal change set

## Symptom

The live host loaded the canonical state file and logged:

```
HMAC signature verification FAILED - file may be tampered with
State file rejected: ...\projects\<key>\.opencode\tawassul-state.json (hmac)
State save skipped: session is isolated (fail-safe read-only). No writes to the host state file.
```

The session stayed read-only, health showed the state file present, and the
ledger in memory was empty. A later init of the new build moved the rejected
file aside and started a fresh empty ledger, so the visible history disappeared
even though the bytes were still on disk.

## Root cause

- Canonical state mtime: `2026-11-01T02:31:48.700Z`, 3,213,875 bytes,
  SHA-256 `defa5f74fc0b...`.
- Current HMAC key birth time: `2026-11-02T15:21:05Z`.
- The canonical file predates the current key, so its signature was produced by
  an older key that no longer exists. The HMAC check can never succeed again.
- The payload itself was intact: `StateSchema` PASS, `migrateStateData` PASS,
  2019 records, 1000 handoffs, 36 ratings, 4 dynamic agents, version 5,
  `_meta.revision` 894.

The pre-fix behavior was incomplete in two directions: a missing key made the
session permanently read-only, and a rotation was indistinguishable from
tampering, so the only automated path was quarantine plus an empty ledger.

## Fix

- `src/utils/crypto.ts`: `hmacKeyCreatedAtMs()` exposes the key creation time so
  the state layer can tell rotation from tampering.
- `src/context/managers/StateManager.ts`: `signedBeforeKey`, `quarantineMove`,
  and `pruneQuarantineCopies` move a rejected canonical file aside only when it
  predates the current key. A file that is newer than the key and fails HMAC
  stays read-only (tamper behavior preserved). Quarantine copies are capped at
  `MAX_QUARANTINE_COPIES = 5` when a new copy is created.
- `scripts/prove-e13.ts`: tamper plus rotation scenario, 38 assertions.
- `scripts/prove-s033.ts`: Windows `delimiter` fix for the PATH probe, 41
  assertions.

## Recovery

The old key is unrecoverable, so restoring history required an explicit trust
decision: validate the plaintext payload, re-sign it with the current key, and
write it back after a backup.

1. Backups: canonical copy beside the file
   (`tawassul-state.json.unverified-backup-2026-11-03T04-48-04`) and
   `C:\Users\htoz\AppData\Local\Temp\opencode\old-live-state-unverified.raw`;
   both matched SHA-256 `defa5f74fc0b...`.
2. Migration and validation: `StateSchema` PASS before and after,
   `migrateStateData` PASS, 2019 records and 1000 handoffs.
3. Re-sign: `wrapWithHmac` with the current key, `unwrapWithHmac` round-trip
   PASS, re-serialized file 3,567,322 bytes.
4. Restore: the live 19,074-byte empty generation was backed up as
   `tawassul-state.json.pre-restore-2026-11-03T04-52-23`; the recovered file was
   installed with `File.Replace` and verified byte-for-byte before the sidecar
   was restarted.
5. Restart: sidecar pid 5488 was force-stopped so no shutdown flush could
   overwrite the new file; the Desktop supervisor started pid 1136. The plugin
   initialized at `04:52:32Z` with bundle bytes 2,142,233, health `healthy`, all
   44 tools registered, and no HMAC or isolation line.

## Live evidence after the restart

| Check | Result |
| --- | --- |
| Restore status file | `ok=true`, final bytes 3,567,322, HMAC valid, 2019 records, 1000 handoffs |
| `record(get: "R-1001")` | returned the original recovered record text |
| `status()` | 2019 session records, 78 completed handoffs |
| `health()` | pending flushes 0, state file present, HMAC key present |
| Write probe `R-3022` | canonical rewritten at `04:52:57Z`, 3,214,958 bytes, 2020 records, probe present |
| Delete probe `R-3022` | canonical rewritten at `04:53:08Z`, 3,214,655 bytes, 2019 records, probe absent |
| Log since `04:52:32Z` | no HMAC failure, no rejection, no quarantine, no isolation, no save skip |

The size drop from 3,567,322 to about 3,214,958 bytes is expected: the recovery
copy was pretty-printed, the plugin writes compact JSON with the same content.

## Verification

| Command | Result |
| --- | --- |
| `bun scripts/gate.ts fast` | `GATE PASS: fast (11 step(s), 20015ms)`, 157 proofs, exit 0 |
| `bun scripts/prove-e13.ts` | `PROOF PASS` 38 assertions, exit 0 |
| `bun scripts/prove-s033.ts` | `PROOF PASS` 41 assertions, exit 0 |
| `bun build-v2.mjs` | `dist\index.js`, `dist\global.js`, `.opencode\plugins\tawassul.js`; four wasm assets |
| `install-global.ts` isolated lane | install, `--verify`, tamper exit 2, uninstall, purge all as expected |

## Boundaries

- The old HMAC key was not recovered. The restored signature attests only the
  current key, not the integrity of the bytes between 2026-11-01 and the
  recovery; that gap is covered by the saved pre-recovery backups.
- The inactive project key that also holds a byte-identical 3,213,875-byte
  generation was left untouched. Only the live key was restored.
- Existing quarantine copies were not pruned by hand. The new cap applies when
  the next quarantine copy is created.
- The v1 tree was not read, built, or modified.
- `gate:proofs` and `npm run ci` still need a POSIX host with `python3` and
  `/usr/bin` shims; only `gate:fast` ran natively.
