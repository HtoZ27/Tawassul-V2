# Report path P2 — isolated clause injection trial

- Date: 2026-11-05 (UTC)
- Verdict: **pass.** A routed coordinator dispatched `explore`; the child's first user message
  carried the report-path clause exactly once and ended with the sentinel, and the plugin recorded
  a tawa ring hit for the child. A normal coordinator produced no clause and no sentinel. No live
  config, state, or install was touched.
- Build: HEAD `d50e8e8` plus the P2 working tree, embedded content SHA `f2f5e7a3c5cc`,
  `dist/global.js` 2,233,656 bytes.
- Host: OpenCode `2.2.5-x64` at `~/.config/ai.opencode.desktop/cli/2.2.5-x64/opencode-cli`.
- Runtime: Bun 1.3.14, Node 26.13.0.
- Agents and model: coordinator `tawa`, child `explore`, `opencode/big-pickle` for both.

## Isolation

One scratch root under `/tmp/opencode`. The host received `HOME`, `XDG_CONFIG_HOME`,
`XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `OPENCODE_DB`, `TAWASSUL_V2_STATE_DIR`,
`TAWASSUL_LOG_FILE`, and `TAWASSUL_N2_LOG` under that root, with
`TAWASSUL_REGISTER_TRIGGERS=off`. The live host, live state, and the repository's own
`opencode.json` were not modified. The generated scratch config set `explore` to
`opencode/big-pickle` so the child would not inherit an unavailable default model.

## Method

1. Copy `.opencode/plugins/tawassul.js` into `<scratch>/workspace/.opencode/plugins/` and symlink
   `<scratch>/workspace/.opencode/node_modules` to the checkout's `.opencode/node_modules`.
2. Copy the generated `.opencode/agents` roster and `deleted-agents.json` into the workspace, then
   run `src/scripts/gen-opencode-config.ts`.
3. Write a minimal `package.json` so the child has a readable file.
4. Run two coordinator sessions with the same dispatch instruction:

   ```
   opencode-cli run --standalone --auto --format json --agent tawa \
     --model opencode/big-pickle '<dispatch instruction>'

   opencode-cli run --standalone --auto --format json --agent tawa \
     --model opencode/big-pickle '@tawa <dispatch instruction>'
   ```

   The instruction asked `tawa` to call the task tool once with
   `subagent: ["explore"]` and the prompt `Read package.json and then reply with the
   final line of the request you received, verbatim. Do not call any other tool.`
5. Read the child's first user message from the scratch `opencode.db` by the child session id in
   the ring log, and inspect `tawassul.log` for the routing decision.

## Result

The normal session dispatched the child with no report-path text:

```
no sentinel in the control transcript
```

The routed session recorded the ring match for the child session:

```
[routing] dispatch ring hit session=ses_... dispatcher=ses_... mode=tawa sentinel=true
```

The child's stored first user message is the host preamble, the dispatcher prompt, and the
clause:

```
You are a subagent spawned by another session.
Read package.json and then reply with the final line of the request you received, verbatim.
Do not call any other tool.

Report back to the coordinator that sent you this work. If you are blocked, state what you
tried, what blocked you, and what you need next. If you pass this work on, repeat this
instruction.

[[tawassul:report-path:v1]]
```

The message contains one sentinel, ends with it, and keeps the dispatcher prompt. The child read
`package.json` successfully. The plugin log recorded no `sentinel-only dispatch record` and no
`tawa ring hit without the sentinel`.

## Defects found and fixed

The trial exposed two integration defects that the unit proofs could not see.

1. **The v2 bridge blocked every native dispatch.** `subagentArgsToV1` copied the host's `agent`
   field into `subagent` but left `agent` in place. `getTaskAgents` reads both, so
   `internalDuplicateGuard` rejected the call as `Internal duplicate: agent "explore" was called
   twice in the same call`. The bridge now moves the value instead of copying it, and
   `v1ArgsToSubagent` restores `agent` for the host. Five new assertions in
   `prove-report-path.ts` cover the move, the single extracted target, the accepted dispatch, the
   restored host field, and a genuine duplicate that is still rejected.
2. **The ring never matched a native child prompt.** The host prepends
   `You are a subagent spawned by another session.` to the child's user message, so the
   start-anchored ring match always failed and only the sentinel fallback fired. That fallback is
   non-latching, and it does not protect a normal parent whose dispatch prompt quotes `tawa`: the
   child would be reclassified from its own text. The match is now normalized containment
   (`includes`), not `startsWith`; the stored prompt is always at least 32 characters, so the
   match stays specific. Three new assertions cover a host-prefixed child, a prefixed normal
   parent that quotes `tawa`, and a prefixed tawa entry without the sentinel.

## Assertions

| # | Assertion | Result |
| --- | --- | --- |
| 1 | the scratch bundle registers its tool set | pass |
| 2 | the scratch bundle records `initPlugin` | pass |
| 3 | the control host run exits zero | pass (`rc=0`) |
| 4 | the routed host run exits zero | pass (`rc=0`) |
| 5 | the normal dispatch carries no sentinel | pass |
| 6 | the normal dispatch carries no clause | pass |
| 7 | the plugin records a tawa ring hit for the child | pass |
| 8 | the child user message ends with the sentinel | pass |
| 9 | the child user message carries exactly one sentinel | pass |
| 10 | the child user message carries the clause | pass |
| 11 | the child user message keeps the dispatcher prompt | pass |
| 12 | the ring match replaces the cold-start fallback | pass |
| 13 | the plugin records no unsentinelled tawa hit | pass |
| 14 | the routed coordinator is not blocked from dispatching | pass |

## Scope boundaries

- The child's final model response was replaced by an unrelated goal-guidance line injected by the
  host after the sentinel. The sentinel evidence therefore comes from the child's raw stored user
  message, not from the child's reply.
- `handoff` is excluded by design; the effect records and injects only `task`.
- The clause is text, not enforcement. A child that ignores it still returns its result; the
  blocking path remains the routing guard proved in P1.
- The trial does not measure token cost or model compliance with the clause.

## Reproduction

The scratch harness lived at `/tmp/opencode/p2-trial/trial.ts`; it was not committed. The scratch
root and harness were removed after the evidence above was copied into this receipt.

## Resources

- Memory floor checked before the runs: 3,693 MB available against the 1,500 MB floor.
- The two host runs were sequential.
