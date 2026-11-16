# Report path D8 — isolated dispatch-argument probe

- Date: 2026-11-05 (UTC)
- Verdict: **pass.** A routed coordinator dispatched `explore`; the child's first user message
  carried the report-path clause exactly once and ended with the sentinel, while a normal
  coordinator produced no clause and no sentinel. A dispatch that carried only `description` was
  refused by the host with `prompt: Missing key` and created no child.
- Build: HEAD `e329e8b`, `.opencode/plugins/tawassul.js` 2,233,656 bytes, SHA-256 prefix
  `aac6e142de56420f`.
- Host: OpenCode `2.2.5-x64` at `~/.config/ai.opencode.desktop/cli/2.2.5-x64/opencode-cli`.
- Agents and models: coordinator `tawa` on `opencode/deepseek-v4.1-flash-free`; children
  `explore` and `doc` on the same model.
- Scratch root: `/tmp/opencode/p3-trial-run-zZkusH`.

## Isolation

One scratch root under `/tmp/opencode`. The host received `HOME`, `PWD`, `XDG_CONFIG_HOME`,
`XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `OPENCODE_DB`, `TAWASSUL_V2_STATE_DIR`,
`TAWASSUL_LOG_FILE`, `TAWASSUL_N2_LOG`, and `TAWASSUL_REGISTER_TRIGGERS=off`, all under that root.
The live host, the live state, and the repository's own `opencode.json` were not modified. `PWD`
had to be set to the scratch workspace because the host resolves the project config from it.

## Method

1. Copy `.opencode/plugins/tawassul.js` into `<scratch>/workspace/.opencode/plugins/` and symlink
   `<scratch>/workspace/.opencode/node_modules` to the checkout's `.opencode/node_modules`.
2. Copy the generated `.opencode/agents` roster and `deleted-agents.json` into the workspace, write
   a placeholder `opencode.json`, then run `src/scripts/gen-opencode-config.ts --project`.
3. Set `explore` and `doc` to `opencode/deepseek-v4.1-flash-free` and write a minimal
   `package.json` so the children have a readable file.
4. Run one warm-up session so the generated roster is visible, then three measured runs:

   ```
   opencode-cli run --standalone --auto --format json --agent tawa \
     --model opencode/deepseek-v4.1-flash-free '<instruction>'
   ```

   - control: no `@tawa` mention; dispatch `explore` with `description` `LABEL-AAA-111` and a
     prompt that asks the child to read `package.json` and echo its last line.
   - routed: the same instruction prefixed with `@tawa`.
   - description-only: `@tawa`; dispatch `doc` with only `description`
     `LABEL-BBB-222 read package.json and reply with the first line`, explicitly forbidding a
     `prompt` field.
5. Read each child's first user message from the scratch `opencode.db` and inspect
   `tawassul.log` for the routing decision.

## Result

The control child carried neither the clause nor the sentinel. The routed child's stored first
user message was:

```
You are a subagent spawned by another session.
Read package.json and then reply with the final line of the request you received, verbatim.
Do not call any other tool.

Report back to the coordinator that sent you this work. If you are blocked, state what you
tried, what blocked you, and what you need next. If you pass this work on, repeat this
instruction.

[[tawassul:report-path:v1]]
```

The message ends with the sentinel, carries exactly one sentinel, keeps the dispatcher prompt, and
does not contain the `LABEL-AAA-111` description. The plugin log recorded:

```
[routing] dispatch ring hit session=ses_... dispatcher=ses_... mode=tawa sentinel=true
```

No `sentinel-only dispatch record` and no `tawa ring hit without the sentinel` line appeared.

The description-only run produced no child session. The coordinator's tool error was:

```
Invalid arguments for tool "subagent": prompt: Missing key
```

The coordinator also observed that the plugin had already appended the clause and sentinel to
`description` before validation, which is the designed three-key precedence: the mutation finds
`description`, but the host reads only `prompt`. This is the D8 finding: `prompt` is a required
host argument, and `description` is a label, never the delivered text.

## Assertions

| # | Assertion | Result |
| --- | --- | --- |
| 1 | the control host run exits zero | pass |
| 2 | the routed prompt run exits zero | pass |
| 3 | the control coordinator creates one child | pass |
| 4 | the routed coordinator creates one child | pass |
| 5 | the control marker is stored | pass |
| 6 | the routed marker is stored | pass |
| 7 | the control child stores a first user message | pass |
| 8 | the control child message carries no sentinel | pass |
| 9 | the control child message carries no clause | pass |
| 10 | the routed child stores a first user message | pass |
| 11 | the routed child message ends with the sentinel | pass |
| 12 | the routed child message carries exactly one sentinel | pass |
| 13 | the routed child message carries the clause | pass |
| 14 | the routed child message keeps the prompt text | pass |
| 15 | the description label is not promoted to the delivered prompt | pass |
| 16 | the plugin records a tawa ring hit | pass |
| 17 | the ring match replaces the cold-start fallback | pass |
| 18 | no unsentinelled tawa ring hit is recorded | pass |
| 19 | a description-only dispatch is refused by the host | pass |

## Scope boundaries

- The description-only branch proves a refusal, not a delivered message. No child exists to read.
- The trial does not measure token cost or model compliance with the clause.
- `handoff` is excluded by design; the effect records and injects only `task`.
- The trial ran against the generated scratch roster; the live `opencode.json` was not read or
  written.

## Reproduction

The scratch harness lived at `/tmp/opencode/p3-trial/trial.ts`; it was not committed. The scratch
root remains at `/tmp/opencode/p3-trial-run-zZkusH` with its database and `tawassul.log`.

## Resources

- Available memory stayed above the 1,500 MB floor.
- The three measured host runs were sequential.
