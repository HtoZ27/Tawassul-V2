# Report path R5/R2 — isolated session-key and tawa-redirect probes

- Date: 2026-11-05 (UTC)
- Verdict: **pass.** `ToolContext.sessionID` is the host session key and equals
  `session_v2.id`; `record` never uses it and persists no session field; `ctx.sessionId` is the
  synthetic plugin id. A non-tawa caller that targets `@tawa` through `handoff` is blocked by
  `tawaRedirectGuard`, which names the caller and sends the result back to it.
- Build: HEAD `f1b7df5`, `.opencode/plugins/tawassul.js` 2,233,656 bytes, SHA-256 prefix
  `9ec7397cde952cb4`.
- Host: OpenCode `2.2.5-x64`, reported as `opencode v2.2.5`.
- Agents and models: coordinator `tawa` on `opencode/deepseek-v4.1-flash-free`; child `tester`
  on `opencode/mimo-v2.6-flash-free`.
- Scratch roots: `/tmp/opencode/r5-host-run-9BSj0S` for the R5 host run;
  `/tmp/opencode/r2-host-run-vbVb29` for the R2 child run.

## Isolation

Each host run received `HOME`, `PWD`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`,
`XDG_CACHE_HOME`, `OPENCODE_DB`, `TAWASSUL_V2_STATE_DIR`, `TAWASSUL_LOG_FILE`, `TAWASSUL_N2_LOG`,
and `TAWASSUL_REGISTER_TRIGGERS=off`, all under its own scratch root. `PWD` was set to the scratch
workspace. The live host, the live state, and the repository's own `opencode.json` were not
modified. The R5 host run used a copy of the bundle with one added log line; the only behavioural
difference is the append, which is wrapped in `try/catch` and never changes tool output.

## Method A — bridge harness, no host

`/tmp/opencode/r5-probe/harness.ts` imports `makeV2Tool` from `src/v2/adapters.ts`, the real
`buildRecordTool` from `src/tools/record.ts`, `SessionManager` from
`src/context/session-manager.ts`, and `RecordEntrySchema` from `src/validation.ts`.

1. A probe tool receives a `V2ToolContext` carrying `sessionID: ses_probeR5Host00000000000000`,
   `messageID: msg_probeR5Message000000000`, and `agent: dev`. The harness captures the v1
   `ToolContext` that the bridge builds and compares the three fields.
2. The real `record` tool runs through the same bridge with a fake context that supplies
   `records`, `recSeq`, `getMaxRecords`, `saveState`, `recordRecordCreated`, and `getSaveHealth`.
   The harness reads the produced entry and the schema shape.
3. `SessionManager` is constructed in a scratch directory and its `sessionId` is compared with the
   host key.

Result: 10 of 10 assertions pass. The captured v1 context carried the host id
`ses_probeR5Host00000000000000`; the record entry keys were
`id,timestamp,agent,type,title,detail,severity,provenance`; `RecordEntrySchema` keys were
`id,type,timestamp,agent,title,detail,severity,specializations,locations,provenance,decision_kind`;
the synthetic id was `session-1793903901513-e56d2174`.

## Method B — scratch host run

1. Copy the bundle into `<scratch>/workspace/.opencode/plugins/` and add one log statement in
   `makeV2Tool.execute`, immediately after `buildV1ToolContext`:

   ```
   try { appendFileSyncR5(process.env.TAWASSUL_R5_PROBE, JSON.stringify({
     tool: "any", sessionID: context.sessionID, agent: context.agent,
     messageID: context.messageID }) + "\n"); } catch {}
   ```

   The `appendFileSync` import is aliased so it cannot collide with the bundle's own binding.
2. Generate the scratch roster, pin `tawa` to `opencode/deepseek-v4.1-flash-free`, and run one
   session:

   ```
   Call the record tool exactly once with type "note", title "R5HOST-7a41",
   and detail "host session key probe". Do not call any other tool. Then stop.
   ```

3. Read the probe line, the coordinator row from `session_v2`, and the persisted state file.

Result: the probe line carried
`sessionID=ses_e53004e6cffePK6uiSVZiejFUP` and `agent=tawa`; the marker's `session_v2.id` was the
same string. The persisted record was:

```
{"id":"R-001","timestamp":"2026-11-05T18:36:46.784Z","agent":"tawa",
 "type":"note","title":"R5HOST-7a41","detail":"host session key probe",
 "provenance":"tool_observed"}
```

No session key appears in the record, the vector index, or the feature index. Six of six
assertions pass.

## Method C — guard probe, no host

`/tmp/opencode/r5-probe/r2-guard.ts` calls the exported `tawaRedirectGuard.check` directly with a
`handoff` input from `tester` and the arguments `{ to: "@tawa", task: "R2 probe" }`, then runs six
controls. The guard returned:

```
🚫 Agent "tester" cannot invoke @tawa. @tawa reads results and decides the next dispatch.
Complete what you can, call @explore or @general with task(), and return your result to your caller.
```

The control matrix: `@TAWA` is blocked by normalisation; `task` with `subagent: "@tawa"` is
blocked; a root-like caller and a `tawa` caller pass; a `handoff` to `@dev` passes. Nine of nine
assertions pass.

## Method D — R2 child host run, guard order

1. A routed coordinator dispatched `tester` with a prompt that first asked for the single word
   `READY`, then for one `handoff(to: "@tawa", task: "R2CHILD-8e2f")`, and then for the exact
   error text.
2. The child session exists with `parent_id` equal to the coordinator id
   `ses_e52fdadeeffe9HTXd9DBatUGKQ`; its row is `ses_e52fd943dffeglgIMej5hn6nay`.
3. The child was blocked before `tawaRedirectGuard` ran: the stored error is
   `Agent "tester" has not produced their analysis yet. Produce your analysis first, then
   dispatch.` That is `firstResponseGuard` (`resource-guards.ts:18-28`), which runs earlier in the
   pipeline and requires `hasAgentResponded(sessionID, agent)` before any task-family tool.
4. No `Tawa redirect blocked` line appears in `tawassul.log` for this run, and no handoff state
   file was written. The child never reached the tawa guard, so this run does not prove the
   R2 guard from a child; Method C proves the guard itself. This is a guard-order observation, not
   an R2 failure.

## Assertions

| # | Assertion | Result |
| --- | --- | --- |
| 1 | the probe tool receives a v1 context | pass |
| 2 | `ToolContext.sessionID` equals the host id | pass |
| 3 | `ToolContext.agent` passes through | pass |
| 4 | `ToolContext.messageID` passes through | pass |
| 5 | `record` writes exactly one entry | pass |
| 6 | the record entry has no session key | pass |
| 7 | the record entry is agent-tagged | pass |
| 8 | `RecordEntrySchema` has no session field | pass |
| 9 | `ctx.sessionId` matches the synthetic format | pass |
| 10 | `ctx.sessionId` differs from the host key | pass |
| 11 | the R5 host run exits zero | pass |
| 12 | the host creates a session for the marker | pass |
| 13 | the record tool reaches the tool bridge | pass |
| 14 | the tool context id equals `session_v2.id` | pass |
| 15 | the tool context names the running agent | pass |
| 16 | the record persists without a session field | pass |
| 17 | `handoff` to `@tawa` is blocked for `tester` | pass |
| 18 | the block names the caller | pass |
| 19 | the block keeps `@tawa` as a non-target | pass |
| 20 | the block sends the result to the caller | pass |
| 21 | `@TAWA` is blocked by normalisation | pass |
| 22 | `task` with `subagent: "@tawa"` is blocked | pass |
| 23 | a root-like caller is not blocked | pass |
| 24 | a `tawa` caller is not blocked | pass |
| 25 | a `handoff` to `@dev` is allowed | pass |

## Scope boundaries

- The R5 host run proves the key reaches the tool bridge and that the record entry omits it. It
  does not implement R5 and does not resolve the root session.
- The R2 guard probe proves the guard's decision and message. The child host run proves the guard
  pipeline is live for a real child, but `firstResponseGuard` fires before the tawa guard; the
  tawa guard itself is proven in Method C, not by the child run.
- The patch in Method B is confined to the scratch bundle and only appends a JSON line.
- The repository's own `opencode.json`, live state, and live host were not touched.

## Reproduction

The harnesses lived at `/tmp/opencode/r5-probe/harness.ts`, `host.ts`, `r2-guard.ts`, and
`r2-host.ts`; they were not committed. The scratch roots remain under `/tmp/opencode` with their
databases, logs, and state.
