# Probe 0 — token usage, context durability, and dispatch semantics

- Date: 2026-11-06 (UTC)
- Verdict: **pass with corrections.** Fifteen questions have live evidence (the `fasttrack`
  leg of Q10 and the 50k boundary of Q14 remain code-settled); Q13 cannot be built as written, and
  the live runs show why. The correction is recorded in plan Section 17.7, not by editing the Q13
  row.
- Host: OpenCode 2.2.5 (`opencode-cli`), audited target 2.2.1; Bun 1.3.14 on Linux x64.
- Model: `opencode/big-pickle` for every root and child; reported `cost` is 0 on every event.
- Isolation: `HOME`, `XDG_*`, and `OPENCODE_DB` under `/tmp/opencode/probe0`; `--standalone`;
  `TAWASSUL_WATCHER=off`; `TAWASSUL_REGISTER_TRIGGERS=off`; one host at a time.
- Probe plugin: `ws/.opencode/plugins/probe0.js` (event sink, tool hooks, `session.context`
  inspection, optional compaction request); preserved as
  `docs/experiments/receipts/2026-11-06-token-usage-probe-plugin.js`.
- Base revision: `f9f339a` plus the local D13 changes; no ledger code was written.

## Artifacts

| Log | Run |
| --- | --- |
| `logs/base2.jsonl` | root reads `data/large.txt`, then dispatches one child; child marker |
| `logs/post.jsonl` | host restart, root resume, `session.get` and `session.context` snapshot |
| `logs/q12.jsonl` | `steps: 2` agent, three requested reads |
| `logs/q13.jsonl` | child attempts a nested dispatch as its first action |
| `logs/q13b.jsonl` | four sequential root dispatches |
| `logs/q13c.jsonl` | four parallel root dispatches in one turn |
| `logs/q14.jsonl` | one `handoff` with a 3.5k payload; child context snapshot |
| `logs/q16.jsonl` | five identical `shell` calls |
| `logs/q9b.jsonl` | child context before compaction; compaction request |
| `logs/q9c.jsonl` | child context after compaction |

The extracted numbers behind every row are in
`docs/experiments/receipts/2026-11-06-token-usage-probe.json`.

All runs exited 0. Root session `ses_e4fa35e16ffe7C44xW2CkbwKLj`, child
`ses_e4fa2b251ffev7gVH2DsEPZHdB`, child marker `PROBE0-CHILD-MARKER-7F3A`.

## The sixteen answers

| # | Answer | Evidence |
| --- | --- | --- |
| 1 | **Yes.** `session.usage.updated` reaches `plugin.event`; it is ephemeral, pushed at turn end. | Every run logged usage events; `post.jsonl` received usage at `31.502`, before `execution.succeeded` at `31.503`. |
| 2 | **Cumulative.** Successive events grow monotonically; the last event equals `session.get`. | Root ends at `input 70484, output 402, reasoning 828, cache.read 238080, cost 0`; `session.get(root)` after restart returns exactly these numbers. Store the latest, not a sum. |
| 3 | **Yes.** Child usage carries the child `sessionID`. | Child events: `input 19765` then `39363` under `ses_e4fa2b25...`; the root events never carry them. |
| 4 | **No.** `tokens.input` excludes `cache.read`. | Bare restart request: `input 280` with `cache.read 51200`; cumulative root: `input 70484` against `cache.read 238080`. |
| 5 | **No.** `session.get(root).tokens` does not aggregate children. | Root `70484/402/828`; child `39363/56/0`; the root snapshot is unchanged after the child exists. A tree map is required. |
| 6 | **Yes, present and stable across a restart.** | `session.get(child).parentID = ses_e4fa35e16ffe7C44xW2CkbwKLj` in the post-restart snapshot. One child only: provisional. |
| 7 | **Yes for the exercised paths.** | `tool.before` records `agent=tawa` for the root and `agent=tawa-pickle` for the child. The missing-agent path was not produced; the bypass row stays required. |
| 8 | **No, cost stays 0.** | Every `session.usage.updated` on `opencode/big-pickle` reports `cost 0`; so do child turns and the compaction. Weighted tokens are the unit; label rows `cost_unpriced`. |
| 9 | **Yes after restart; no exact answer after compaction.** | After a restart `session.context(child)` returns the assistant message `content[0].text = PROBE0-CHILD-MARKER-7F3A`. After a manual compaction the original message is gone; the window starts with a `compaction` message whose model-written `summary` happens to contain the marker. Exact output needs capture at return or a file pointer. |
| 10 | **No truncation at return for `task` or `handoff`.** | `task` returned the full `<subagent …>` envelope with `truncated: false`; `handoff` returned a 3,595-character output containing both `Q14-PAYLOAD-START` and the final `Q14-TAIL-9C2E`. `fasttrack` is not run; it shares the same exclusion list. |
| 11 | **The schema is fully inside the cached prefix on repeat requests.** | Schema 24,513 B ≈ 6,128 tokens. A bare post-restart request billed `input 280` and `cache.read 51200`, 8.4× the schema estimate; cumulative cache reads reach 238,080. `cache.write` is 0 throughout (implicit cache). Option 11 is hygiene, not savings. |
| 12 | **Yes, `steps` is honoured host-side.** | `stepper` with `steps: 2` performed one tool step, then the host stopped the turn; the assistant text begins `!!!!!Maximum steps for this agent have been reached`. One tool call only (`tool.before=1`, `tool.after=1`). |
| 13 | **Cannot be built as written; see the section below.** | Knob 4 is clamped to 3 at startup; no chain reaches depth 4; non-root callers may only target exempt agents; four parallel root dispatches pass the cap of 3. |
| 14 | **No second truncation observed.** | The 3,595-character `handoff` output kept its head and tail markers; the 50k cap excludes `task`/`handoff`/`fasttrack` (`tool-execute.ts:771-772`). The >50k boundary itself remains code-settled, not runtime-probed. |
| 15 | **Yes, `session.text.ended` is an earlier observation point.** | Order: `text.ended 31.502` → `usage.updated 31.502` → `execution.succeeded 31.503`; no next request and no `session.idle` in `run` mode. Hook the echo detector there. |
| 16 | **No block, as expected.** | Five identical `shell` calls (`printf probe16`) all completed: `tool.before=5`, `tool.after=5`, every result `exit 0`. `REPEAT_BLOCK_TOOLS` is still `read|grep|glob`. |

## Q13 — why the four-deep chain is not constructible

The recipe assumes that a nested dispatch raises a per-chain depth. The implementation counts
something else, and three independent guards close the path.

1. **The counter is per session, not per chain.** `callDepthGuard` reads
   `ps(ctx).callDepth.get(input.sessionID)` (`dispatch-guards.ts:38`). `commitCallDepthEffect`
   increments that same session key (`dispatch-guards.ts:249`) and `tool-execute.ts:515-527`
   decrements it when the `task` returns. A new child session starts at zero, so every level
   dispatches at depth 1. Four sequential root dispatches all passed (`q13b`); four parallel root
   dispatches all passed (`q13c`, all four `tool.before` within 41 ms and all four completed).
   The parallel batch exceeds the knob's ceiling of 3 because validation and commit are not
   atomic: every call passes the guard before any call commits.
2. **The non-root target in the recipe is not permitted.** `TASK_PERMISSIONS` grants every
   non-`tawa` role only `explore` and `general` (`security-policy.ts:97-108`), and those targets
   are exempt from the depth branch up to `MAX_EXEMPT_CALLS` (`dispatch-guards.ts:34-37`). A
   non-root caller that names a non-exempt target is rejected by
   `taskToolAuthorizationGuard` (`dispatch-guards.ts:155`). The requested combination — non-root
   caller, non-exempt target — is unreachable.
3. **A child's first action cannot be a dispatch.** `firstResponseGuard`
   (`resource-guards.ts:25-26`) returned `🚫 Agent "tawa-pickle" has not produced their analysis
   yet` on the child's first tool call in `q13`; the dispatch never reached the depth branch.

D13 already bounds the knob at 3 at the wiring point (`limits.ts:15-20`,
`config-facade.ts:61-70`). The live host logged the clamp twelve times, for example
`maxCallDepth 4 is bounded by the host ceiling 3; using 3`. Under that ceiling the guard rejects
any dispatch whose session counter is already 3, before `checkCap` at `:42`; a chain never reaches
counter 3, so the three outcomes in Q13 collapse for a different reason than the row assumed. The
D13 proof (`scripts/prove-call-depth-clamp.ts`) covers
the guard and `checkCap` agreement at ceilings 1..3 for prior depths 0..20; this probe adds the
live wiring evidence and the two dispatch facts above.

This is a finding about the semantics, not a request to redesign `callDepth` or
`MAX_CALL_DEPTH`. K3 is satisfied at the config surface; the plan's Q13 assumption is corrected
in Section 17.7.

## Context durability (Q9)

- **Restart:** after stopping and restarting the host, `session.context(child)` returned the
  child's assistant message with `content[0].text = PROBE0-CHILD-MARKER-7F3A` (`q14`, `q9b`).
  The message survives because it is stored, not because the host keeps it in memory.
- **Compaction:** a manual `session.compact` on the child ran (`compaction.started` / `ended`).
  The next `session.context` started with a `compaction` message, then the post-compaction user
  and assistant turns. The original assistant message was no longer a separate entry. The
  database row for the compaction message contains a generated `summary` that includes
  `PROBE0-CHILD-MARKER-7F3A`, so the marker is recoverable in this run — but the summary is
  model-written and lossy, so exact output is not guaranteed. Capture at return (`Q10`) or a file
  pointer remains mandatory for exact results.

## Schema caching (Q11)

The schema is 24,513 B. At the usual 4 B/token that is about 6,128 tokens. A bare request after
restart reported `input 280` and `cache.read 51,200`, and the cumulative root cache read reached
238,080 while `cache.write` stayed 0. The cached prefix is therefore several times larger than
the schema, and the schema is fully cached once the provider cache is warm. The first three
requests of a cold session reported `cache.read 384`, so the warm-up is real and worth stating:
the 41% raw share is a cold-start figure, not a per-request marginal cost.

## Limits of this probe

- One child for Q6; the orphan rate and event-loss rate are P2 measurements.
- `fasttrack` was not executed; its return path shares `TASK_TOOL_NAMES` and the same exclusion.
- The >50k boundary of the output cap was not produced at runtime; 3,595 characters is enough to
  catch small second-truncation caps, not the 50k boundary itself.
- Q13's chain could not be produced; the alternatives above are the live evidence.
- `session.idle` does not fire in `run` mode; it is a desktop/idle-host event, so Q15 uses
  `session.text.ended`.

## Reproduction

```
env HOME=/tmp/opencode/probe0/home \
  TAWASSUL_OPENCODE_BIN=<opencode-cli> \
  TAWASSUL_WATCHER=off TAWASSUL_REGISTER_TRIGGERS=off \
  PROBE0_LOG=<log> PROBE0_LABEL=<label> \
  bash scripts/opencode-v2-iso.sh run --standalone --auto \
    --model opencode/big-pickle --agent tawa --format json "<prompt>"
```

`q14` used `PROBE0_INSPECT=ses_e4fa2b251ffev7gVH2DsEPZHdB`; `q9b` added
`PROBE0_COMPACT=<child>`; `q9c` inspected the post-compaction window. The probe plugin was
removed with the rest of `/tmp/opencode/probe0` after the evidence above was captured.
