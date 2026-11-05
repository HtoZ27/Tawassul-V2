# Report path D3 — isolated addressee probe

- Date: 2026-11-05 (UTC)
- Verdict: **pass for policy A; policy B rejected.** A `tawa` coordinator dispatched `tester`. The
  child session ran as `tester`, its parent ran as `tawa`, and the guard that fired named
  `tester`. Policy B would therefore tell the child to return its result to itself.
- Build: HEAD `e329e8b`, `.opencode/plugins/tawassul.js` 2,233,656 bytes, SHA-256 prefix
  `aac6e142de56420f`.
- Host: OpenCode `2.2.5-x64` at `~/.config/ai.opencode.desktop/cli/2.2.5-x64/opencode-cli`.
- Agents and models: coordinator `tawa` on `opencode/deepseek-v4.1-flash-free`; child `tester` on
  `opencode/mimo-v2.6-flash-free`.
- Scratch root: `/tmp/opencode/p3-trial-run-zguri6`.

## Isolation

One scratch root under `/tmp/opencode`. The host received `HOME`, `PWD`, `XDG_CONFIG_HOME`,
`XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `OPENCODE_DB`, `TAWASSUL_V2_STATE_DIR`,
`TAWASSUL_LOG_FILE`, `TAWASSUL_N2_LOG`, and `TAWASSUL_REGISTER_TRIGGERS=off`, all under that root.
`PWD` was set to the scratch workspace. The live host, the live state, and the repository's own
`opencode.json` were not modified.

## Method

1. Build the scratch workspace exactly as in the D8 probe, with one extra change: copy the `dev`,
   `tester`, and `doc` roster entries into the generated config and pin `tester` to
   `opencode/mimo-v2.6-flash-free`. `dev` was not usable because its fallback chain head
   `nvidia/deepseek-ai/deepseek-v4.1-flash` is unavailable in this environment.
2. Run one coordinator session:

   ```
   @tawa Call the subagent tool exactly once with agent "tester" and prompt
   "You are the child. Call the subagent tool exactly once with agent tester and
   prompt self-check. Then stop." Then stop.
   ```

3. Read the parent session's first assistant record for `agent`, the child session row for
   `parent_id`, and the child's first user message and assistant text from the scratch
   `opencode.db`.
4. Render both candidate guard sentences against the observed identities and evaluate each one's
   truth value.

## Observed identities

```
parent session: ses_... agent=tawa
child session:  ses_... parent=<parent> agent=tester
```

The child's delivered first user message was:

```
You are a subagent spawned by another session.
You are the child. Call the subagent tool exactly once with agent tester and prompt self-check. Then stop.

Report back to the coordinator that sent you this work. If you are blocked, state what you
tried, what blocked you, and what you need next. If you pass this work on, repeat this
instruction.

[[tawassul:report-path:v1]]
```

The child attempted the self-dispatch and was blocked with:

```
🚫 Agent "tester" has not produced their analysis yet.
   Produce your analysis first, then dispatch.
```

The child then reported back:

```
Blocked — what happened: ... the subagent dispatch was refused by the system before any child
session was spawned. ... What I need next: the coordinator should either ...
```

## Both solutions, evaluated

Policy A, kept:

```
Return your result to your caller so it can decide the next step.
```

Policy B, rejected:

```
Return your result to tester so it can decide the next step.
```

Policy A is true: the caller is the `tawa` coordinator. The wording does not name it, so it also
survives when the caller is an intermediate agent. Policy B is false in precisely this tree: the
only name available to the guard is `input.agent`, which is `tester`, the running child. Policy B
would tell a child to return its result to itself. The same failure appears in every session whose
running agent differs from its dispatcher, which is every routed child.

## Assertions

| # | Assertion | Result |
| --- | --- | --- |
| 1 | the identity host run exits zero | pass |
| 2 | the coordinator session is recorded | pass |
| 3 | the coordinator creates one child | pass |
| 4 | the parent session runs as `tawa` | pass |
| 5 | the child session runs as `tester` | pass |
| 6 | a guard blocks the child dispatch and names the blocked agent | pass |
| 7 | the guard names the running agent, not the caller | pass |
| 8 | the delivered child message carries the report-path clause | pass |
| 9 | the child addresses its reply to the coordinator instead of the caller by name | pass |
| 10 | `input.agent` differs from the real caller, so policy B names the wrong agent | pass |

## Scope boundaries

- The guard that fired is the "has not produced their analysis yet" gate, not `selfCallGuard`.
  Both read `input.agent`; the observation that the message names `tester` is the same under
  either.
- The probe does not prove that every guard message is reached in production, only that the
  identity available to a guard is the running agent.
- The child's attempt was a self-dispatch. A dispatch to a different agent would render the same
  identity evidence, but was not needed.
- The trial does not measure model compliance with the clause.

## Reproduction

The scratch harness lived at `/tmp/opencode/p3-trial/d3.ts`; it was not committed. The scratch
root remains at `/tmp/opencode/p3-trial-run-zguri6` with its database and `tawassul.log`.

## Resources

- Available memory stayed above the 1,500 MB floor.
- The host run was a single sequential session.
