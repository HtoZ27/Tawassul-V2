# Report path P1 — isolated routing trial

- Date: 2026-11-05 (UTC)
- Verdict: **pass.** The built bundle booted in a scratch HOME and workspace, recorded a
  normal session and a routed session independently, allowed `write` in the normal session, and
  refused `write` in the routed session with the shipped routing message. No live config, state,
  or install was touched.
- Build: HEAD `5710cbd` plus the P1 working tree, embedded content SHA `14597d069bbe`, bundle
  `dist/global.js` 2,233,340 bytes.
- Host: OpenCode `2.2.5-x64` at `~/.config/ai.opencode.desktop/cli/2.2.5-x64/opencode-cli`.
- Runtime: Bun 1.3.14, Node 26.13.0.
- Agent and model: `dev`, `opencode/big-pickle`.

## Isolation

One scratch root under `/tmp/opencode`. The host received `HOME`, `XDG_CONFIG_HOME`,
`XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `OPENCODE_DB`, `TAWASSUL_V2_STATE_DIR`,
`TAWASSUL_LOG_FILE`, and `TAWASSUL_N2_LOG` under that root, with
`TAWASSUL_REGISTER_TRIGGERS=off`. The live host, live state, and the repository's own
`opencode.json` were not modified.

## Method

1. Copy `.opencode/plugins/tawassul.js` into `<scratch>/workspace/.opencode/plugins/` and symlink
   `<scratch>/workspace/.opencode/node_modules` to the checkout's `.opencode/node_modules`.
2. Copy the generated `.opencode/agents` roster and `deleted-agents.json` into the workspace, then
   run `src/scripts/gen-opencode-config.ts` from the workspace. The generator emitted 30 agents,
   including `dev`.
3. Run the control session with a plain message and the routed session with a leading `@tawa`:

   ```
   opencode-cli run --standalone --auto --format json --agent dev \
     --model opencode/big-pickle \
     'Use the write tool to create a file named control.txt containing exactly hello...'

   opencode-cli run --standalone --auto --format json --agent dev \
     --model opencode/big-pickle \
     '@tawa Use the write tool to create a file named routed.txt containing exactly hello...'
   ```

4. Capture both JSON transcripts, `tawassul.log`, and the host log.

## Result

The control session completed the write:

```
Created file successfully: control.txt
```

The routed session was refused before the file was touched:

```
🚫 bash, edit, and write are blocked while this request is routed. Use your read tools first.
You may call @explore or @general for reconnaissance.
```

The plugin log records the blocking tool call:

```
[tawassul] tool.execute.before error: {"name":"ToolBlockedError"}
```

`control.txt` exists with `hello`; `routed.txt` does not exist.

## Assertions

| # | Assertion | Result |
| --- | --- | --- |
| 1 | the scratch bundle registers its tool set | pass |
| 2 | the scratch bundle records `initPlugin` | pass |
| 3 | the control host run exits zero | pass (`rc=0`) |
| 4 | the control session writes its file | pass |
| 5 | the routed host run exits zero | pass (`rc=0`) |
| 6 | the routed session blocks the write tool | pass |
| 7 | the routed refusal names the allowed reads | pass |
| 8 | the routed session writes no file | pass |
| 9 | the routed refusal carries no erasure phrase | pass |
| 10 | the routed refusal is not a plain permission denial | pass |
| 11 | the control session sees no routing block | pass |

The boot log also recorded `v2 registered 44 tools name-set ...` and
`host capabilities: session=1 tool=1 transform=1 reload=1 hook=1 compacting=1`.

## Scope boundaries

- The trial exercises the user-message path: `recordUserMessage` classifies `@tawa` as `tawa`
  with `source: "classified"`, and `tawaRoutingEnforcementGuard` blocks only that classified
  record at depth 0. It does not observe a child dispatch, a ring hit, or a sentinel.
- The ring, TTL, cap, sweep, guard differential, override preference, and per-session isolation
  are unit-proven by `scripts/prove-report-path.ts` (90 assertions) and registered in the fourth
  proof shard.
- The trial agent was `dev`, whose `edit` permission is allowed, so the refusal is the routing
  guard rather than a role permission. Assertion 10 checks that the transcript contains no
  `denied for agent` line.
- The prompt clause and its sentinel are P2; this trial does not exercise them.

## Reproduction

The scratch harness lived at `/tmp/opencode/p1-trial/trial.ts`; it was not committed. The
scratch root and harness were removed after the evidence above was copied into this receipt.

## Resources

- Memory floor checked before the run: 3,809 MB available against the 1,500 MB floor.
- The two host runs were sequential.
