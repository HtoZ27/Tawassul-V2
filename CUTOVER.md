# Cutover log — 2026-10-24

Day 5 of `PLAN.md`. This is the live dual-generation gate and the v1
retirement record. Host: `opencode v2.1.4` at `~/.opencode/bin/opencode`.
Tree at the start of the gate: `3379550` (clean). Freeze commit follows this
file.

## 1. Clean-tree CI

Command: `npm run ci` on `3379550` with no uncommitted files.

- Log: `/tmp/opencode/ci-day5-clean.log`
- Result: `rc=0`
- Tail: `release-smoke: direct tools OK (42 registered, health + help executed)`
  and `SMOKE PASS: host v2.1.4, scratch boot, 42 tools, health + help`.

## 2. Live dual-generation boot

Both workspaces were booted on the same machine with the installed host.
The v1 lane is pinned to `1.18.30` in its own `tawassul-versions.env`; no
`1.18.30` binary exists on this host any more, so the v1 workspace can only
be probed on 2.1.4. That probe is included because it shows why the v1 lane
cannot run here: the 2.1.4 host writes `session_v2` into every DB, and the
v1 guard refuses that DB.

| Gate | v2 workspace | v1 workspace |
| --- | --- | --- |
| Workspace | `/home/htoz/Desktop/Tawassul V2` | `/tmp/opencode/dual-v1` (v1 bundle) |
| Plugin entry | `.opencode/plugin/tawassul.js` | `.opencode/plugin/tawassul.js` (v1 build) |
| Plugin copies in workspace | 1 | 1 |
| Host | 2.1.4 (pinned) | 2.1.4 (v1 pin 1.18.30 absent) |
| Setup owner | v2 seat registry, one entrypoint | one entrypoint |
| Registered tools | 42 (`v2 registered 42 tools`) | 42 (`v2 registered 42 tools` via the v1 bundle's adapter) |
| Init | `initPlugin=21.54ms` | `initPlugin` line present, background init healthy |
| Direct tool call | `health` + `help` | `health` (v1 format, `DB isolation: isolated`) |
| Reply | `DUAL` from the model | `DUAL` from the model |
| DB | `~/.local/share/tawassul-v2/opencode-v2.db` | `/tmp/opencode/dual-v1/host.db` |
| DB generation | v2 path | 2.1.4 host schema (`session_v2`) |

Commands:

```
scripts/opencode-v2-iso.sh run --standalone --auto --format json \
  --model opencode/big-pickle "Reply with exactly: DUAL"

cd /tmp/opencode/dual-v1 && \
  OPENCODE_DB=/tmp/opencode/dual-v1/host.db \
  TAWASSUL_STATE_DIR=/tmp/opencode/dual-v1/state \
  TAWASSUL_LOG_FILE=/tmp/opencode/dual-v1/tawassul.log \
  ~/.opencode/bin/opencode run --standalone --auto --format json \
  --model opencode/big-pickle "Reply with exactly: DUAL"
```

Evidence:

- v2 boot: `rc=0`, session `ses_e91401b24ffeYNLQ3WR2lCaK35`, plugin log
  `~/.local/share/tawassul-v2/tawassul/tawassul.log` at 16:30:33–16:30:37.
- v1 boot: `rc=0`, session `ses_e913fdbd6ffep8p9KfEiDJUBf2`, plugin log
  `/tmp/opencode/dual-v1/tawassul.log` at 16:30:50.
- Direct tools: `/tmp/opencode/dual-tools.txt` (v2) and
  `/tmp/opencode/dual-tools-v1.txt` (v1); both `tools: 42`.
- The v1 bundle was probed from a copy in `/tmp` because `bun` treats an
  unknown extension as text; the retired file itself was not modified.

Key finding: the v1 bundle runs on 2.1.4 only because its tree also carries
the v2 adapter. The DB it leaves behind carries `session_v2`, so the v1
guard refuses it. The v1 lane has no supported host on this machine
(1.18.30 absent), which is the retirement condition.

## 3. Generation guard matrix

`scripts/guard-db-generation.sh --db … --expect … --json`:

| DB | Expect | Verdict | rc |
| --- | --- | --- | --- |
| synthetic 1.18 schema (`session`, `session_message`, `data_migration`) | v1 | ok (warn-only non-empty `session_message`) | 0 |
| same synthetic v1 DB | v2 | refused `non-v2-path` | 2 |
| synthetic v1 content at a `tawassul-v2` path | v2 | refused `marker-v1-content` | 2 |
| same synthetic v1 content at a plain path | v1 | ok | 0 |
| synthetic v2 content (`session_v2`) at a plain path | v1 | refused `marker-session_v2` | 2 |
| same synthetic v2 content | v2 (`--path-rule warn`) | ok, warning `non-v2-path` | 0 |
| synthetic `tawassul-v2` path (`session_v2`) | v1 | refused `tawassul-v2-path` | 2 |
| same synthetic v2 DB | v2 | ok | 0 |
| live v2 DB `~/.local/share/tawassul-v2/opencode-v2.db` | v1 | refused `tawassul-v2-path` | 2 |
| live 2.1.4 boot DB `/tmp/opencode/dual-v1/host.db` | v1 | refused `marker-session_v2` | 2 |
| shared host DB `~/.local/share/opencode/opencode.db` | v1 | refused `marker-session_v2` | 2 |

Full transcript: `/tmp/opencode/dual-gate.txt`. Both directions refuse; the
guard never fails open.

## 4. Freeze

- `SHARED.md`: frozen banner at the top. It remains a historical record; no
  new `S-###` entries and no anchor gate.
- `package.json`: `verify` is now `check:rules && check:sh && typecheck &&
  build`; `check:shared` is gone.
- Deleted: `scripts/port-from-v1.mjs`, `test-utils.ts`,
  `scripts/check-shared-anchors.mjs` (its only job was cross-tree anchors).
- `scripts/check-v2-rules.mjs`: single-file list no longer names the deleted
  checker.
- `AGENTS.md`: v1 is retired/read-only, the transfer channel is closed, and
  the build/verify list matches the new chain.
- `RULES.md`: local copy of the memory-cap and sequential-heavy-work rules;
  `AGENTS.md` no longer points into the v1 tree.
- `scripts/opencode-db-maintenance.sh`: vendoring comment no longer names the
  v1 path.

## 5. Retirement

| Action | Result |
| --- | --- |
| v1 plugin disabled in active workspaces | 6 files renamed to `tawassul.js.retired-20261024` under `vusial 2`, `vpro`, `vusual`, `athan new vrsion`, `dart22222222`, `ciel-osk-workspace` |
| v1 reference tree | its `.opencode/plugin/tawassul.js` renamed to `.retired-20261024` |
| Explicit config entry | `/home/htoz/Desktop/paassss/opencode.json` `plugin` set to `[]` |
| v1 MCP entries | 9 workspace `opencode.json` files set `mcp.tawassul.enabled = false` (`New Folder`, `athan new vrsion`, `ciel-osk-workspace`, `dart22222222`, `okttob`, `tawassyl`, `vpro`, `vusial 2`, `vusual`) |
| v1 MCP files | 7 files renamed to `tawassul.mjs.retired-20261024` in the workspaces that carried one, including the reference tree |
| Remaining auto-loaded `tawassul.js` | only `/home/htoz/Desktop/Tawassul V2/.opencode/plugin/tawassul.js` |
| Remaining runnable `tawassul.mjs` | none |
| v1 tree | `chmod -R a-w`; a write probe is refused |
| v1 git remote | none configured (`git remote -v` empty); nothing to push |
| Documents config | `/home/htoz/Documents/opencode.json` already has `"plugin": []`; no stale entry to delete, so no owner prompt was needed |
| Install method | `npm install` then `npm run build`; the host loads `.opencode/plugin/tawassul.js`, and `scripts/opencode-v2-iso.sh` is the pinned launcher |

Rollback (only if the owner reopens v1): `chmod -R u+w
/home/htoz/Desktop/tawassyl`, rename the seven `.retired-20261024` files back
to `tawassul.js`, rename the seven MCP files back to `tawassul.mjs`, set
`mcp.tawassul.enabled` back to `true` in the 9 configs, restore the `paassss`
plugin entry, and revert the freeze commit. v1 state under
`~/.config/tawassyl` was never modified.

## 6. Residual notes

- The v2 legacy read fallback (`~/.config/tawassyl/state`) is intentional and
  remains; it reads only when the v2 file is absent and never writes v1.
- The v1 HMAC key file remains readable at `~/.config/tawassul/.tawassul-hmac-key`;
  v2 writes use `TAWASSUL_V2_HMAC_V1:` and verify both prefixes.
- v2 independence is enforced by `scripts/prove-v2-independence.ts`: no v1
  tree reference in `src/` or the build/launcher, the legacy state name only
  in `state-paths.ts`, no v1 manifest dependency, and exactly one host entry.
- Day 6 delivered the operator `README.md` (install, state/HMAC migration,
  guard codes, troubleshooting) and the final full proof run (25 proofs).
