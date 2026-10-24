# Tawassul V2

Tawassul is an OpenCode plugin: a per-workspace team runtime with routing,
handoffs, a goal ledger, mission boards, checkpoints, and a 42-tool surface.
This tree is the only runnable Tawassul plugin. The v1 tree is retired and
read-only.

- Host: OpenCode `2.1.4` (pinned)
- Plugin API: `@opencode/plugin` 2.1.4
- Runtime: Node 24+ and Bun
- Language: English only; no code comments

## Install

From this directory:

```
npm install
npm run build
```

`npm run build` writes `dist/index.js` and the host entry
`.opencode/plugin/tawassul.js`. The host auto-loads that file for this
workspace. A fresh clone needs no config edit for the plugin itself.

If the host runs with a restricted module resolver, install the plugin peer
once inside the workspace:

```
mkdir -p .opencode
printf '{"type":"module","dependencies":{"@opencode/plugin":"2.1.4"}}\n' > .opencode/package.json
bun install --cwd .opencode
```

Use the pinned launcher for normal boots:

```
scripts/opencode-v2-iso.sh run --standalone --auto --format json \
  --model opencode/big-pickle "Reply with exactly: OK"
```

The launcher pins the host, refuses a binary that is not 2.1.4, applies the
generation guard, runs DB maintenance at the cap, and logs one
`[launcher] watcher mode=… decision=…` line per launch.

## Verify

```
npm run verify      # rules + shell syntax + typecheck + build
npm run ci          # verify + config/facts + all 25 proofs + release smoke
```

`npm run ci` ends with `smoke:release`: host pin check, a scratch workspace
boot with an isolated `OPENCODE_DB`, 42 registered tools, and direct `health`
plus `help` calls. A broken plugin cannot pass it.

## Independence

v2 runs from this tree alone: no runtime import, script, or build step references
`/home/htoz/Desktop/tawassyl`. `npm run prove:independence` enforces that,
checks that the only legacy name in `src/` is the read-only state fallback,
and asserts exactly one host entry (`.opencode/plugin/tawassul.js`).

The only v1-era surfaces v2 still touches are read-only:

- the legacy state directory, and only when the v2 file is missing;
- the existing HMAC key, so previously signed state stays verifiable.

The v1 tree is retired: its plugin bundle and MCP server are renamed
`.retired-20261024`, every workspace config sets
`mcp.tawassul.enabled = false`, and the tree is read-only.

## State and migration

| Surface | Path | Rule |
| --- | --- | --- |
| Plugin state | `~/.config/tawassul-v2/state` | override `TAWASSUL_V2_STATE_DIR` |
| Legacy read fallback | `~/.config/tawassyl/state` | read-only, only when the v2 file is absent; never written |
| Data root | `~/.local/share/tawassul-v2` | log at `tawassul/tawassul.log`; N2 at `n2-auto.jsonl` |
| Host DB | `~/.local/share/tawassul-v2/opencode-v2.db` | v2 lane only |
| HMAC key | `~/.config/tawassul/.tawassul-hmac-key` | 32 bytes, readable during migration |

Writes use `TAWASSUL_V2_HMAC_V1:`. Verification also accepts the legacy
`TAWASSUL_HMAC_V1:` and `TAWASSULL_HMAC_V1:` prefixes, so old state remains
readable. Legacy files are never modified.

The v1 state is frozen reference. Do not copy it, do not point v1 at a
`tawassul-v2` path, and do not point v2 at a v1 or shared DB. The guard is the
boundary:

```
scripts/guard-db-generation.sh --db <path> --expect v1|v2 --json
```

Exit `0` is allowed, `2` is a generation refusal, and `3` is a probe failure
(fail-closed). `CUTOVER.md` records the full dual-generation matrix and the
rollback procedure.

## 42-tool surface

Every tool is callable directly; `help` lists the catalog and each tool carries
its own description. Common entry points:

- `health` — event-loop lag, RSS, timers, DB mode, pending flushes
- `help` — available tools
- `goal` — goal ledger, board, evidence, close gate
- `handoff` / `fasttrack` — task transfer between agents
- `record` — decisions, fixes, incidents, notes
- `checkpoint` / `codestate` — code snapshots and undo
- `pause` / `resume` / `panic` — workflow control

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `generation guard refused` | The DB belongs to the other generation; use the v2 DB or a fresh file. |
| `refusing host vX — pinned v2.1.4` | Install 2.1.4 or set `TAWASSUL_OPENCODE_VERSION` deliberately. |
| Plugin registered 0 tools | Run `npm run build`; confirm `.opencode/plugin/tawassul.js` exists. |
| Boot has no watcher line | Use `scripts/opencode-v2-iso.sh`; a bare host binary skips the launcher policy. |
| Plugin log is empty | `TAWASSUL_LOG_FILE` is unset or set to empty (empty disables the sink). Default is under the data root. |
| State looks stale | Read `health` and the plugin log; do not copy v1 state. |

## Docs map

- `PLAN.md` — priority plan and day-by-day history
- `CUTOVER.md` — dual-generation evidence, freeze, retirement, rollback
- `TRIAGE.md` — S-055 A–L verdicts with evidence
- `DECOUPLING.md` — namespace and shared-surface decisions
- `SHARED.md` — frozen historical cross-tree issues log
- `RULES.md` — memory cap and sequential heavy-work rules
- `AGENTS.md` — project rules for agents working in this tree
