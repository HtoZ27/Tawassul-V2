# D12 record half — no-agent call rows

- Date: 2026-11-07 (UTC)
- Verdict: **record implemented; the policy decision stays open.** Every tool call whose
  `input.agent` is absent now writes a `kind: "noagent"` ledger row and increments
  `summary().noAgentRows`, which `health()` prints. Whether the plugin should default, deny, or
  warn on that path is still an owner decision, so no guard changed.
- Base revision: `5e29a79`.
- Runtime: Bun 1.3.14 on Linux x64; the proof uses an isolated temporary directory.
- Proof: `scripts/prove-usage-ledger.ts`, now 122 assertions, gate step `usage-ledger`.
- Gate: `npm run verify` passed (`GATE PASS: fast (16 step(s))` plus the build).

## Why

Probe 0 Q7 found `input.agent` populated on the exercised paths (`tawa` for the root,
`tawa-pickle` for the child) but never produced the missing-agent path. D12 records that the
missing path skips dedup, the loop guard, and `consume` while the pipeline still runs, and requires
`no-agent` calls to be recorded before any policy is chosen. This receipt covers only the record.

## Change under proof

| File | Change |
| --- | --- |
| `src/services/usage-ledger.ts` | `UsageNoAgentRow`, `recordNoAgent`, `kind: "noagent"` absorption on reload, and `noAgentRows` in the summary |
| `src/hooks/tool-execute.ts` | the before hook records a no-agent row when `normalizedAgent` is absent |
| `src/tools/tawa/health.ts` | prints `- No-agent calls: N` in the `## Usage ledger` block |

The row carries `v`, `kind`, `ts`, `sessionID`, and `tool`. It is written for every such call, not
only for repeats; the shadow repeat detail keeps its own `agentMissing` flag.

## Method

The ledger proof adds seven assertions:

1. A valid no-agent call returns a row naming the tool.
2. An empty session id is rejected.
3. An empty tool name is rejected.
4. The summary counts the row.
5. Reload restores the count from JSONL.
6. The tool hook contains the `recordNoAgent` call.
7. Health prints the no-agent line.

The existing 115 assertions run unchanged, so the shadow, lineage, backfill, reload, and rotation
coverage still holds.

## Results

```
PROOF PASS: usage ledger covers parsing, pricing, lineage, backfill, reload, gaps, injection, no-agent rows, and rotation
```

`npm run verify` passed the 16-step fast gate and the build.

## Still open

| Item | Status |
| --- | --- |
| The D12 policy (default, deny, or warn) | undecided; no guard was added |
| A live run that actually produces `input.agent === undefined` | not produced by Probe 0 |
| Reading the no-agent rate over the shadow window | pending the 7-day or 30-session window |

Rollback is the three edits above; no other behaviour depends on the row.
