# Report path P0 — isolated host trial

- Date: 2026-11-05 (UTC)
- Verdict: **pass.** The built bundle booted in a scratch HOME and workspace, registered its
  44 tools, and refused a redirect of a handoff to the router with the shipped caller-facing
  message. No live config, state, or install was touched.
- Build: HEAD `d919f84`, embedded content SHA `240a88c20f59`, bundle `dist/global.js` 2,226,592
  bytes.
- Host: OpenCode `2.2.5-x64` at `~/.config/ai.opencode.desktop/cli/2.2.5-x64/opencode-cli`.
- Runtime: Bun 1.3.14, Node 26.13.0.
- Agent and model: `analyst`, `opencode/big-pickle`.

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
   including `analyst`.
3. Run the host:

   ```
   opencode-cli run --standalone --auto --format json --agent analyst \
     --model opencode/big-pickle \
     'Call the override tool exactly once with handoffId "H-001", to "@tawa", and reason
      "isolated trial". Then repeat the tool output verbatim.'
   ```

4. Capture the JSON transcript, `tawassul.log`, and the host log.

## Result

The `override` call was refused before any handoff lookup:

```
🚫 Redirecting a handoff to @tawa is forbidden. Results return to the caller. Redirect it to a
registered agent, or complete your work and return the result.
```

The plugin log records the same call and the same message:

```
[tawassul] 🚨 Tawa call detected: agent="analyst" tool="override" fields=[to] session="ses_..."
[tawassul] ◀ [override] analyst done (10ms): 🚫 Redirecting a handoff to @tawa is forbidden.
Results return to the caller. Redirect it to a registered agent, or complete your work and
return the result.
```

## Assertions

| # | Assertion | Result |
| --- | --- | --- |
| 1 | the scratch bundle registers its tool set | pass |
| 2 | the scratch bundle records `initPlugin` | pass |
| 3 | the isolated host run exits zero | pass (`rc=0`) |
| 4 | the redirect to the router is refused | pass |
| 5 | the refusal states where results go | pass |
| 6 | the refusal names a reachable class of target | pass |
| 7 | the refusal names no substitute agent | pass |
| 8 | the refusal carries no erasure phrase | pass |

The executed assertion count was 8. The boot log also recorded
`v2 registered 44 tools name-set ...` and `host capabilities: session=1 tool=1 transform=1
reload=1 hook=1 compacting=1`.

## Scope boundaries

- A fresh-session `handoff(to: "tawa")` is intercepted by `firstResponseGuard` first:
  `Agent "analyst" has not produced their analysis yet. Produce your analysis first, then
  dispatch.` The trial therefore targeted `override`, which is not behind that gate. The
  task and handoff target guards remain covered by `prove-guard-routing.ts`.
- The host exposes a `subagent` tool whose subagents are `explore` and `general`; it does not
  expose a tool named `task`. The `subagent` alias is normalized inside the plugin. This trial
  therefore exercised the plugin-owned `override` surface rather than the host's spawn tool.
- A follow-up probe should send two prompts to one persistent host process and confirm that
  `hasAgentResponded` survives across steps. That matters for P1's per-session routing state,
  which is trialled only after this receipt.

## Reproduction

The scratch harness lived at `/tmp/opencode/p0-trial/trial.ts`; it was not committed. The
scratch root was removed after the evidence above was copied into this receipt.

## Resources

- Memory floor checked before the run: 4,058 MB available against the 1,500 MB floor.
- The heavy host run was sequential; the scratch root and harness were removed afterwards.
