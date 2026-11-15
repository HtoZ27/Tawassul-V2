# Orientation Channel Plan (2026-11-15)

Status: shipped 2026-11-15. The orientation skill was withdrawn by its probe; the
delivered channel is the `help` description and output, the `addagent` first line,
and the explicit `@addagent` delegation guidance. The sections below keep the
reviewed draft and its measurements; the final state is in "Final reconciliation".
Owner: dev for implementation, the analyst team for review.
Scope: one orientation skill, a self-contained `help`, and one clarified
`addagent` first line, funded by description trims so the steady-state session
cost does not grow.

This is an internal working plan, like the other `docs/plan-*.md` documents. It is
untracked today, and the public-tree check ignores untracked files outside the
public prefixes. Commit it with a matching `internal` entry in
`scripts/release/public-files.json`: `check-public-tree` rejects an internal entry
that is listed but not tracked.

## Final reconciliation (2026-11-15)

The plan is closed as shipped. The orientation skill did not earn its entry: it
loaded in one of eight relevant foreign-project sessions (0.125, below the 0.5
kill threshold), so it was withdrawn and the skill count stayed at 16. The
always-sent channel shipped instead: the 88-byte `help` description, the
five-line `help` output, the `addagent` first line, and the explicit
`@addagent` delegation guidance.

| Item | Final state | Evidence |
| --- | --- | --- |
| `help` description | 88 B, names Tawassul and both roster tools | `prove-constraint-retention` 395 assertions |
| `help` output | 5 lines, 501 B English and 785 B Arabic, no missing path; the smoke canary checks the overview's identity line | Measured from `helpOverview`; `prove-e27` 11; `release-smoke.sh` and `prove-global-boot` |
| Description trims (11 tools) | Live total 15,857 B, cut 288 B (1.78%) from 16,145 B; schema 19,548 B unchanged | `prove-context-diet` 71; receipt `2026-11-15-schema-payload.json` |
| Orientation skill | Withdrawn; 16 skills ship; no eval ledger entry | Probe receipt `2026-11-15-orientation-probe.json`; `prove-skills-manifest` 348; `prove-md-gate` 15 |
| Skill registration | 44-tool name set unchanged; no filesystem writer | `prove-skill-registration` 92 |
| Skill load rate and pilot replay | 16/16 shipped skills meet threshold; fixture replay pass | `prove-skill-load-rate` 164; `prove-pilot-eval` 328 |
| Capability warning | One `logger.warn` per process when `ctx.skill.transform` is absent | `src/skills/pilot.ts`; build and typecheck |
| `@addagent` guidance | Main session calls `subagent` with `agent: "addagent"` and passes the request unchanged; limited to a leading mention and never sent to the addagent agent | Final live `out14`: parent `ses_e1fdffa0cffemPU5iF1QzRxetC` quoted the guidance and called `subagent(agent=addagent)`; child `ses_e1fdfdad3ffe8HeYrje7wgqMh7` called `addagent` itself, got the zero-write "All agents already exist: @designer-mimo", then `check`; receipt `2026-11-15-addagent-guidance-probe.json` |
| Seeded `@addagent` description | 479 B dispatcher wording; new projects only | `check:config` green; existing `opencode.json` keeps its description |
| Consent copy | Wait for the user's reply, then retry once; gate logic untouched | `check:rules` 632 files |
| v1 guard | Retired v1 tree no longer blocks `install:global` | `prove-global-install`; `prove:independence` |
| Proof count | 183, no new proof file | `npm run ci`: fast 16 steps, proofs 183 steps (461,408 ms), smoke 6 steps (60,987 ms), `GATE PASS: fast + proofs + smoke`; `docs/CI-TRANSCRIPT.md` has 0 FAIL rows |
| Global install | Final bundle installed and smoke-checked | `npm run install:global`: `/home/user/.config/opencode/plugins/tawassul.js` (v0.1.0-experimental, `2352401855cf`), 4 wasm assets, systemd timer, `--check` OK |
| Live host | Restart loaded the current project entry; verify-only fresh | `npm run host:refresh -- --verify-only`: `live_bundle=0ed16ed2c2a7`, `init=2026-11-15T16:50:43.930Z` newer than `entry=2026-11-15T16:49:27Z`, `pid=2151653`; no reload needed |

### Final interference matrix

| Surface | Interference checked | Result |
| --- | --- | --- |
| `prove-context-diet` | Every per-tool description byte, total 15,857, schema 19,548, archived baseline, and receipt rows | Pass, 71 assertions |
| `prove-record-search` | The local byte canary moves with the diet: `handoff` 1,008 + `record` 496 = 1,504 | Pass, 32 assertions |
| `prove-constraint-retention` | 103 pinned phrases; exactly the eleven fixture tools may shrink; `help` stays at 88 B | Pass, 395 assertions |
| 44-tool name set | No add, rename, or removal; skill registration leaves the surface untouched | Pass, 92 assertions |
| `prove-skills-manifest` | Manifest, registry, eval ledger, README table, fixture call signature all at 16 | Pass, 348 assertions |
| `prove-md-gate` | `skills/**/SKILL.md` count stays 16; English-only and comment-free | Pass, 15 assertions |
| `prove-skill-load-rate` | 16 live rows, no skills-off row, every threshold met | Pass, 164 assertions |
| `prove-pilot-eval` | One fixture per skill, `E1` method, procedure replay | Pass, 328 assertions |
| `message-updated` guidance | Non-addagent behavior stays `Boolean(agent)`; addagent requires a leading mention and an active agent other than addagent | Typecheck; final live `out14`; the resumed checkpoint exposed the quoted-mention false positive that the guard now rejects |
| `routing-guidance` | New `guide.directAddagent` key, 152 B, only in the explicit-mention path | `prove-feature-index-english` key parity; `check:rules` |
| i18n tables | 638 keys in both; placeholder parity; Arabic confined to `ar.json`; no bidi controls; the `guide.*` pin moves 33→34 with the new key | `prove-feature-index-english` 60 assertions; `check:rules` 632 files; `check:docs` |
| `gen-opencode-config` | Seed wording changes first-run output only; `--check` and `check:config` stay green; 35 agents | `bun src/scripts/gen-opencode-config.ts --check` |
| Consent gate | Copy only; the gate, tokens, and fail-closed path are unchanged | `check:rules`; source review of `consent-gate-guard.ts` |
| `install-global` | v1 guard removed; the archive is not a conflict; project duplicate and legacy package guards remain | `prove-global-install`; `prove:independence` |
| Smoke `help` canary | The five-line `help` output no longer contains "Available tools"; `release-smoke.sh` and `prove-global-boot` now assert the overview's identity line instead, with the output bytes unchanged | `prove-e27` 11 assertions; `npm run ci` |
| `opencode.json` | Generated and untracked; descriptions preserved; no hand edit | `--check` green |
| Host refresh | Entry hash and init freshness checked before touching the live host | `npm run host:refresh -- --verify-only` |

Residual risks after the shipped state:

1. An existing project keeps the old `@addagent` agent description because the
   generator preserves descriptions. The live fix is the guidance in the bundle,
   so a project must rebuild or reinstall to receive it.
2. A mid-sentence `@addagent` mention no longer receives the delegation guidance;
   the model can still choose `subagent` from the agent description, but the
   forced nudge covers the documented leading form.
3. The `subagent` tool is logged as `[task]`; evidence must use the tool-facing
   name from `tool_use`, not the log tag.
4. The `help` output is a smoke canary surface: `release-smoke.sh` and
   `prove-global-boot` assert a substring of it. A future wording change must
   update both anchors with the text, or the smoke stage fails at exit 4.
5. The final live probe's child prompt was host-wrapped, so the active-agent
   exclusion of the guidance guard is verified from the branch, not observed live.
   The leading-mention path and the child's own tool execution are live-proved.

## Problem

In local projects that load the global install, models see the project content but
not the plugin. Reported symptoms:

1. A model does not know Tawassul exists.
2. A model sees the tools but does not know they belong to the plugin.
3. A model does not know when to use them.
4. A model searches the workspace for the tool source and state, and wastes time.
5. A model adds or removes an agent by editing `.opencode/agents/` or
   `opencode.json` by hand, or fails to use `addagent` and `@addagent` for the
   same job. This is the most frequent reported failure.

Confirmed causes:

- `help()` returns one sentence whose only pointer is `docs/tools.md`, a path that
  does not exist in a foreign project and is not shipped in `dist/global.js`
  (`src/tools/misc-tools.ts:11`, `src/i18n/en.json:261`).
- The 16 shipped skills are all task-scoped. No skill description matches "what is
  this plugin", "which entry tool do I start with", or "add or remove an agent".
- No plugin name appears in the `help` description. `check` is the only entry tool
  whose description says "Tawassul" (`src/tools/diagnostics.ts:267`); `panic` also
  names it (`src/tools/system-controls.ts:217`), but it is a destructive reset, not
  an entry point.
- No orientation text is injected at session start. The existing session
  injections (goal digest, decisions, handoffs, session index) stay unchanged
  (`src/hooks/session.ts:327`, `:385`, `:492`).
- The roster knowledge already exists twice in this repository's context: the
  `addagent` agent description (556 B) and the `addagent` tool description
  (1,068 B) both say the files are written programmatically. In a foreign project
  with only the global install, the agent description is absent: the installer
  keeps the global agent roster but writes none (`scripts/install-global.ts:1146`),
  so only the tool description is sent. The fix therefore relies on the always-sent
  tool descriptions and the `help` line, not on `@addagent`. The failure in both
  cases is a missing trigger, not missing knowledge. The tool's first line,
  "Add one or more specialist agents.", reads like task delegation, which is the
  wrong association.

## Decision

Add one orientation skill, make `help` self-contained, and clarify the first line
of the `addagent` tool description. Do not inject text into sessions.

Final state: the skill was withdrawn by its probe, and the shipped decision is the
`help` description and output, the `addagent` first line, and the explicit
`@addagent` delegation guidance. The guidance is event-driven by a leading
mention, not session-start injection; a session that never mentions `@addagent`
carries no additional bytes.

Reasons:

- Skill descriptions are already part of the host context. The incremental cost is
  one description line, and the procedure is loaded only when matched.
- The repository measures skill value. `prove-skill-load-rate` refuses a skill that
  does not reach its declared threshold, and every skill declares a kill criterion.
  An injected line has no such gate.
- `help` alone is proven insufficient by the reported symptom: a model that does not
  know the plugin exists will not call `help`.
- The roster trigger belongs in a skill description because the model forms intent
  from the user's request ("add an agent"), not from the tool list.

The added bytes are funded by trimming redundant prose from the eleven tool
descriptions that the repository already treats as budgeted, so the steady-state
session cost does not grow.

The skill is an amplifier, not the only channel. The `help` description is always
sent with the tool list, and its 88-byte wording now carries the roster rule at no
net cost. If the skill entry exceeds the funding or the body does not arrive, the
top reported failure still has a visible instruction; the skill adds the
natural-language trigger and the procedure, and the probe decides whether it earns
its entry.

## Hard constraints

1. Tool description budget: `scripts/prove-context-diet.ts` freezes a target of
   16,213 bytes. The live total is 16,145 bytes. No description may exceed its
   frozen per-tool baseline.
2. `scripts/prove-constraint-retention.ts` pins 103 phrases across eleven tool
   descriptions through the dated fixture `docs/experiments/fixtures/constraint-retention.json`.
   Every pinned phrase survives in the live description, and exactly the eleven
   fixture tools may be smaller than the 2026-10-31 frozen baseline. No twelfth
   tool may shrink, and `help` may not shrink at all: it sits exactly at its
   frozen 88 bytes.
3. `prove-pilot-eval` and `prove-skills-manifest` require every skill body to be a
   numbered procedure with backticked `tool(args)` calls, and the fixture replay to
   match the call sequence exactly.
4. `findForbidden` rejects these words anywhere in a skill body: never, must,
   required, requires, do not, don't, cannot, shall, always, only, prerequisite,
   prohibit, guarantee, returns, fails, before, unless, accepts, expects, produces,
   emits.
5. A skill ships only with a live load sample at or above its threshold:
   `prove-skill-load-rate` and `prove-pilot-eval` both fail otherwise.
6. English is canonical. Arabic is permitted only in `src/i18n/ar.json`, and the
   replacement Arabic text carries no bidi control characters.
7. No new proof file. The proof count stays 183.
8. `addagent` and `kick` run in the main session only (`callerIsMainSession` in
   `src/tools/agent-management.ts`); `@addagent` is the dispatcher where that agent
   is installed. The skill body must state the main-session rule and qualify
   `@addagent`, because the global install does not ship an agent roster.
9. Every eval receipt `method` must contain the literal `E1`;
   `prove-pilot-eval` asserts `receipt.method.includes("E1")`.
10. The schema-payload receipt is a live pin, not a declaration of intent:
    `prove-context-diet` compares every per-tool description row and the total with
    the live measurement.

## Local review findings (second pass, 2026-11-15)

The first draft of this plan was reviewed against the live tree. Ten findings
changed the plan. Verdicts use the vocabulary established, limited, refuted.

The third pass is complete: seven analyst models reviewed this file independently
and answered the four questions in the next section. Their verdicts are recorded
below the queue.

| # | Finding | Evidence | Verdict | Action |
| --- | --- | --- | --- | --- |
| R1 | The funding trims broke a hard gate. `prove-constraint-retention` pins phrases that the first trim list deleted or rewrote: `DO NOT mix actions in one call`, `Required: completeHandoff (the handoff ID)`, `N total results: primary plus N-1 copies`, `context ≥ 5 words (required)`, `THIS IS THE ONLY interface`, `never search data files`, `Never sets, pauses, resumes or clears it`. | `scripts/prove-constraint-retention.ts:148-159`, `docs/experiments/fixtures/constraint-retention.json` | refuted for the old trim list | The trim list was rebuilt around the pinned phrases. A local replay of the proof's own assertion over the live descriptions confirms all 103 phrases survive. |
| R2 | `help` cannot shrink. The same proof asserts that exactly the eleven fixture tools are smaller than the frozen baseline. `help` is not one of them and sits exactly at 88 bytes, so a 77-byte description would make twelve slimmed tools and fail the proof. | `scripts/prove-constraint-retention.ts:132-146` | established | `help` stays at exactly 88 bytes and the plugin identity is rewritten inside that budget. |
| R3 | No tool outside the eleven may be trimmed, because the slimmed set is compared for exact equality. | same | established | Every trim targets one of the eleven. The other thirty-three descriptions are untouched. |
| R4 | The skill body may not arrive in a foreign project. `registerPilotSkills` passes `path: resolve(base, skill.directory, "SKILL.md")` with `base = ctx.location.directory` (`src/skills/pilot.ts:80`; the base is assigned at `:98`), and the global install ships only the flat bundle, so that path never exists outside this repository. `Skill.Info` carries both `path` and `content`. | `src/skills/pilot.ts:80,98`, `node_modules/@opencode/schema/dist/skill.d.ts`, `scripts/install-global.ts` (no skills copy) | limited | The E1 workspace copied only `opencode.json`, `.opencode/agents` and `dist/global.js`, and its receipt records the body's first step in the transcript, so `content` is very likely the carrier. The host implementation is not inspectable here, so the probe must check the body text, not the skill's presence. |
| R5 | The first draft's 122-byte skill description was budget-shaped, while `docs/skills.md` states that skill descriptions are "reviewed for clarity, never truncated to a byte target". | `docs/skills.md:54` | established | The description was rewritten for clarity at 138 bytes with five triggers. The only omitted trigger, "continuing a long session", is owned by `tawassul-context-continue`. |
| R6 | The first draft stripped `caller-agnostic` from the `goal` description to save 16 bytes. | `src/tools/goal.ts:36` | established | The rebuilt trim pool does not need that byte, so the adjective stays. |
| R7 | `addagent` and `kick` write either the project `opencode.json` with `.opencode/agents/`, or the global roster, depending on scope. `kick` on two or more agents shows a confirmation card and is fail-closed without it. | `src/tools/agent-management.ts:603-727`, `:1099-1137` | established | The skill body says "the agent file and the roster". The probe removes exactly one agent so the card path is not involved. |
| R8 | The replacement Arabic text must not carry bidi control characters, which `prove-feature-index-english` and `check-public-tree` both reject. | `scripts/prove-feature-index-english.ts:152`, `scripts/check-public-tree.ts` | established | The proposed Arabic block was checked with the same regex and is clean. Key parity stays 638/638 (the new guidance key adds one to both tables). |
| R9 | The probe must run outside this repository: `install-global` states that the tree's own project entry supersedes the global copy. | `scripts/install-global.ts:352-358` | established | The probe runs in a disposable scratch directory. |
| R10 | The eval receipt `method` must contain `E1`, and the schema-payload receipt pins every per-tool byte. | `scripts/prove-pilot-eval.ts`, `scripts/prove-context-diet.ts:211-229` | established | Both are written into the plan verbatim, and the payload receipt is generated from the live measurement. |

## External review queue (third pass, 2026-11-15)

| Reviewer | Model | Status |
| --- | --- | --- |
| `analyst-mimo` | mimo | accept-with-fixes |
| `analyst-pickle` | big-pickle | accept-with-fixes |
| `analyst-gemini` | gemini-flash-lite | accept-with-fixes |
| `analyst-minimax` | minimax | accept-with-fixes |
| `analyst-deepseek` | deepseek | accept-with-fixes |
| `analyst-beam-free` | beam-free | accept |
| `analyst-glm-5.3-flash-free` | glm-5.3-flash | accept-with-fixes |

Each reviewer answers four questions:

1. Verdict: accept, accept with fixes, or reject.
2. The strongest remaining risk, with a file and a line.
3. One concrete improvement, or a better alternative to the skill channel.
4. Any factually wrong claim: a budget byte, a proof assertion, a path, or a count.

### Third-pass results

| Reviewer | Verdict | Finding | Action |
| --- | --- | --- | --- |
| `analyst-pickle` | accept-with-fixes | `src/skills/pilot.ts:76-82` also passes `path` and `autoinvoke: true`; the 261 B entry is an estimate and no gate measures the rendered skill bytes | Budget note softened, risk row added, the probe records the rendered block |
| `analyst-pickle` | accept-with-fixes | "Nothing is injected at session start" is false: `src/hooks/session.ts:327`, `:385`, `:492` inject the digest, decisions, handoffs and the session index | Corrected: no orientation text is injected; the existing injections are named and unchanged |
| `analyst-pickle` | accept-with-fixes | Line drift: `misc-tools.ts:8`, `diagnostics.ts:267`, `docs/skills.md:54` | Corrected |
| `analyst-pickle` | accept-with-fixes | Better channel: put the roster trigger in the 88-byte `help` description | Adopted, refined to name `addagent` and `kick` and to avoid the absolute "never" |
| `analyst-gemini` | accept-with-fixes | Body-path risk at `src/skills/pilot.ts:80` (`base` at `:98`); bundle the body at build time | Already R4; the plan's `with { type: "text" }` import is the bundle path, and the probe checks the body text |
| `analyst-deepseek` | accept-with-fixes | The 27 B net is a margin on an unmeasured field estimate; `path`/`autoinvoke` may erase it | Risk row and probe measurement stand; the `help` line is the zero-cost fallback |
| `analyst-deepseek` | accept-with-fixes | The four procedure steps never name the roster action the trigger solicits | The first step is `help()`, and the new help output carries the roster rule; a roster call would need args and would execute in the replay |
| `analyst-deepseek` | accept-with-fixes | `diagnostics.ts:267`, and `panic` also names Tawassul at `system-controls.ts:217` | Both corrected; the "entry tool" qualifier is now explicit |
| `analyst-minimax` | accept-with-fixes | R4 cites `pilot.ts:98` for the `path` resolution; that line is `:80`, and `:98` is the base assignment | Corrected |
| `analyst-minimax` | accept-with-fixes | The `docs/tools.md:113` and `docs/end-user-guide.md:714` rows are doc-authored summaries, not the tool string | §8 now says to replace the summary, not to substitute the tool text |
| `analyst-minimax` | accept-with-fixes | The authored `SKILL.md` body is 887 B with the trailing newline, not 892 B | Corrected |
| `analyst-minimax` | accept-with-fixes | Make the fallback independent of the skill domain by spending `addagent`'s 158 B headroom; cross-check the probe receipt in a proof | Not adopted: the 88-byte `help` line is already always sent and names both roster tools, and a cross-check between two probe-authored artifacts is not a live witness. The probe transcript stays the evidence. |
| `analyst-beam-free` | accept | The rendered skill block is unmeasured; `path`/`autoinvoke` may flip the −27 B net | Already the standing risk. Omitting `path` would fail `Skill.Info`, and omitting `autoinvoke` would remove the load path; the probe measures the block and drops the skill if the delta is positive. |
| `analyst-glm-5.3-flash-free` | accept-with-fixes | `@addagent` may be absent in a foreign project with only the global install; mirror the roster rule into the `@addagent` agent description | Verified: `install-global` keeps but does not write the global agent roster (`scripts/install-global.ts:1146-1150`), so the agent description is not a reliable foreign-project channel. The skill body now says "where available"; the always-sent `help` line and the main-session tools carry the fix. The mirror is rejected because the agent is absent. |
| `analyst-glm-5.3-flash-free` | accept-with-fixes | Body count ~880 B, and the id is 19 B not 20 B | The body was 887 B at that review; the `@addagent` wording makes it 899 B (898 without the newline). The id is 20 B (`tawassul` 8 + hyphen 1 + `orientation` 11), so the 261 B estimate stays. |
| `analyst-mimo` | accept-with-fixes | The XML wrapper is 85 B, so the entry is 261 B and the net is −27 B, not 262 B/−26 B | Adopted: every 262/−26 reference is corrected |
| `analyst-mimo` | accept-with-fixes | Put the roster clause in `check`'s description, the tool models call first | Rejected: `check` is outside the eleven fixture tools. Growing it trips `grown.length === 0`; shrinking it makes a twelfth slimmed tool. The 88-byte `help` line is the zero-cost channel. |
| `analyst-mimo` | accept-with-fixes | Some fixes landed mid-review, and the docs, key parity, `skill.d.ts` and body count were unverified | The docs, line refs, 638-key parity and `path`/`content` fields are verified against disk; the body was 887 B at that read and is 899 B after the `@addagent` wording (the skill itself was later withdrawn). |

## Probe result (2026-11-15) — skill retired

The live gate ran twice: eight archived sessions in a scratch project outside the
repository, each with the built bundle at `.opencode/plugins/tawassul.js` and the
model `google/gemini-3.5-flash-lite`. The receipt is
`docs/experiments/receipts/2026-11-15-orientation-probe.json`.

| Round | Session | Loaded | Tools used |
| --- | --- | --- | --- |
| 1 | orientation-map | yes, full body | `skill`, `directresponse` |
| 1 | roster-add | no | `addagent` |
| 1 | roster-remove | no | `kick`, `kick` |
| 1 | state-location | no | `directresponse` |
| 2 | orientation-map | no | none |
| 2 | roster-add | no | `addagent` |
| 2 | roster-remove | no | repeated `kick` |
| 2 | state-location | no | `directresponse` |

One load in eight relevant sessions, 0.125, below the 0.5 kill threshold. The
skill is withdrawn: its body, manifest entry, fixture and proof expectations are
reverted, and no eval ledger entry is written. The rendered block was 1,266 B and
the body arrived in full in the one loading session, so the withdrawal is a
load-rate decision, not a delivery failure.

What ships instead is the channel that measured clean in every roster session: the
88-byte `help` description and its roster line, the five-line `help` output, the
`addagent` first line, and the explicit `@addagent` delegation guidance. Every
roster prompt used `addagent` or `kick`, and none edited `.opencode/agents` or
`opencode.json`. The description total still falls from 16,145 to 15,857 bytes.
The live `out12` session proved the guidance path: the main session called
`subagent` with `agent: "addagent"`, and the child called `addagent` and wrote
`designer-mimo`. The guidance is limited to a leading `@addagent` mention and is
not sent to the addagent agent, so quoted mentions and child sessions do not
self-delegate.

## Budget ledger

| Item | Current | After | Delta |
| --- | --- | --- | --- |
| `help` description | 88 B | 88 B | 0 B |
| `goal` description | 1,564 B | 1,535 B | −29 B |
| `handoff` description | 1,117 B | 1,008 B | −109 B |
| `record` description | 541 B | 496 B | −45 B |
| `thread` description | 883 B | 849 B | −34 B |
| `timeline` description | 437 B | 424 B | −13 B |
| `kick` description | 793 B | 761 B | −32 B |
| `override` description | 619 B | 595 B | −24 B |
| `discussion` description | 387 B | 376 B | −11 B |
| `addagent` description | 1,068 B | 1,077 B | +9 B |
| Total description bytes | 16,145 B | 15,857 B | −288 B |
| Orientation skill entry (withdrawn) | 0 | 0 | 0 |
| Orientation skill body (withdrawn) | 0 | 0 | 0 |
| Session injection | 0 | 0 | 0 |
| Net steady state | | | −288 B (~−72 tokens) |
| `help` output on call | 283 B | 501 B | ~+55 tokens, on demand only |
| `help` output, Arabic | 764 B | 785 B | +21 B, on demand only |

The skill entry is costed from the fields the plugin supplies and the host's XML
wrapper:

```
  <skill>
    <id>tawassul-orientation</id>
    <name>Plugin orientation</name>
    <description>Use when adding or removing an agent, delegating to a specialist, recording a decision, tracking a goal, or explaining how Tawassul works.</description>
  </skill>
```

85 B wrapper + 20 B id + 18 B name + 138 B description = 261 B. This is a field
estimate, not a measured worst case: `addPilotSkills` also passes a `path` and
`autoinvoke: true` (`src/skills/pilot.ts:76-82`), and the host may render them. The
repository's own `registeredSkills` measurement counts description bytes only, so
under that measure the entry is 138 B and the net is −151 B. Neither measure is
the rendered session; the probe records the rendered block, and a positive delta
there drops the skill.

The probe retired the skill, so the entry and body rows are zero in the shipped
tree and the whole description cut is a net reduction. The stop line is 15,910
bytes. The measured description total is 15,857, fifty-three bytes below it. Do
not go past the named edits.

## Interference review (2026-11-15)

This table is the pre-probe review. The shipped interference matrix is in "Final
reconciliation"; the 16→17 rows below are historical.

| Surface | Result |
| --- | --- |
| `collectToolSchemas` / `measureSchemaPayload` | Reads `args` only. Description edits leave the 19,548 B schema payload unchanged. |
| 44-tool name set and hash | Unchanged. No tool is added, renamed, or removed. |
| `opencode.json`, `tawassul.schema.json`, `src/FACTS.md` | No skill or description dependency. `check:config`, `check:schema`, `check:facts` stay green. |
| `helpOverview` | One consumer: `buildHelpTool` (`src/tools/misc-tools.ts:11`). No proof or document pins the text. |
| `prove-context-diet` | Pins every per-tool description byte, the total, `archivedBaseline`, and `schemaPreCut`. The new receipt must be measured after the edits. |
| `prove-constraint-retention` | The eleven pinned tools stay below their frozen baselines; the other thirty-three do not move; all 103 pinned phrases survive. |
| Frozen-baseline growth check | `help` 0 B headroom, `goal` 343 B, `handoff` 1,667 B, `addagent` 158 B, `kick` 515 B. No description grows. |
| `prove-skills-manifest` | `skill.tools` sorted must equal the procedure tools sorted; the README table must match the manifest byte for byte; `ledger.evals.length` must equal the manifest length; the fixture call signature must equal the procedure. |
| `prove-pilot-eval` | `method` must contain `E1`; one fixture entry per skill; `recorded.calls` must equal the procedure length; `buildCheckTool(fake)` and `buildStatusTool(fake)` are safe because `ctx` is read only inside `execute`. |
| `prove-skill-load-rate` | Every skill needs a live row at or above its threshold; `skillsOff` is 0; the live rate must equal loaded/relevant. |
| `prove-md-gate` | Counts `skills/**/SKILL.md` files: 16; the 16→17 row was the pre-probe draft, withdrawn with the skill. |
| `prove-skill-registration` | Count 16; the 16→17 row was the pre-probe draft. The skills module must keep no filesystem writer; the 44-name tripwire must stay unchanged. |
| `check-docs` | Requires every manifest skill id in `docs/skills.md`. `docs/tools.md` only needs each tool name in backticks. |
| `check-public-tree` | `skills/**` and `src/i18n/` are public prefixes; the new files are classified automatically. The new Arabic text carries no bidi controls. |
| `prove-feature-index-english` | English table carries no Arabic; Arabic table carries Arabic; no bidi controls; key parity and placeholder parity hold. |
| `prove-context-baseline` | `registeredSkills` is a dated artifact (count 3), not a live comparison; i18n drift is INFO only. |
| Rendered skill block | No existing gate measures it. `prove-context-diet` counts tool descriptions only; the 261 B entry is a field estimate, and `path`/`autoinvoke` may render. The probe records the rendered block. |
| `prove-reload-live`, `prove-s005`, `prove-concordance` | Assert only that `help` is callable/non-empty and that its name is in the role matrix. Descriptions do not matter. |
| `prove-thread-tool` | Its "packing the same handoff twice" hit is an assertion message, not a description pin. |
| Build outputs | `bun build-v2.mjs` regenerates both `dist/global.js` and `.opencode/plugins/tawassul.js`. `install-global` warns that the project entry supersedes the global copy inside this repository, so the probe must run outside it. |

## Changes

### 1. `help` description

`src/tools/misc-tools.ts:8`. The size is frozen at 88 bytes, so the wording is
rewritten inside the budget rather than shortened.

Replace:

```
Show a short overview of the available tool families and where the full reference lives.
```

with:

```
Tawassul help: overview, ledgers, state. Agent changes use addagent and kick, not files.
```

88 bytes, exactly the frozen size. The first word is now the plugin name, so the
tool list itself carries the identity. The second sentence carries the roster
trigger into the always-sent tool list, and it names both roster tools without the
absolute "never" that would also forbid legitimate manual edits to agents outside
the Tawassul roster.

The wording comes from `analyst-pickle`'s third-pass alternative, refined to cover
removal as well as addition. It is a fallback, not a replacement for the skill
trigger: the skill description still matches the natural-language request, while
this line is visible before any skill loads.

### 2. `help` output

`src/i18n/en.json:261`, key `helpOverview`. Replace the sentence with:

```
Tawassul is an in-process team plugin; no plugin files exist here. Handoffs, records, goals, and state live behind these tools: the workspace holds no copy.
Loop: direct, or @tawa routes it to one specialist; long work resumes from a handoff checkpoint.
Ledgers: handoff (agent work), record (decisions), goal (objectives + DoD).
Start with check, show_board, status. Skills carry the procedures.
Roster: write @addagent <spec> with model <model> from <provider>; files are generated, not hand-edited.
```

The value is the five lines joined by newlines: 501 bytes, no trailing newline.
The fenced block adds one formatting newline that is not part of the value.

`src/i18n/ar.json`, same key. Arabic table entry:

```
توسّل إضافة فريق تعمل داخل العملية؛ لا ملفات إضافة هنا. السجلات والأهداف والـ handoffs والحالة تعيش خلف هذه الأدوات: مساحة العمل لا تحتفظ بنسخة.
الحلقة: الطلب مباشر، أو @tawa يوجّهه إلى مختص واحد؛ العمل الطويل يستأنف من checkpoint.
السجلات: handoff (عمل الوكلاء)، record (القرارات)، goal (الأهداف + تعريف الإنجاز).
ابدأ بـ check وshow_board وstatus. المهارات تحمل الإجراءات.
الوكلاء: اكتب @addagent <المواصفة> with model <النموذج> from <المزوّد>؛ الملفات مولّدة ولا تُحرَّر يدويًا.
```

The Arabic file is the only place Arabic is permitted in this change. The block
is 785 bytes, carries no bidi control characters, and keeps the key count at 638.

### 3. Description trims (funding)

Every edit below is inside one of the eleven budgeted tool descriptions, and every
pinned phrase of `constraint-retention.json` survives unchanged.

`src/tools/goal.ts`:

- `"read with goal(list/board), write here."` becomes `"read with goal(list/board)."`
  (−12 B; the line already states that the tool is the only interface)
- `"reads the host /goal for this session;"` becomes `"reads the host /goal;"`
  (−17 B)

`src/tools/handoff.ts`:

- `"  parallelCopies — N total results: primary plus N-1 copies; results side by side."`
  becomes `"  parallelCopies — N total results: primary plus N-1 copies."` (−22 B)
- `"• completeHandoff — Required: completeHandoff (the handoff ID). Optional: result (summary)."`
  becomes `"• completeHandoff — Required: completeHandoff (the handoff ID); optional result."`
  (−11 B)
- `"• undo — Required: undo (the handoff ID); reverts accepted to pending."`
  becomes `"• undo — undo (the handoff ID); reverts accepted to pending."` (−10 B)
- `"• rescue — Required: rescue (handoff ID), to (new agent), context (reason); @analyst only."`
  becomes `"• rescue — rescue (handoff ID), to (new agent), context (reason); @analyst only."`
  (−10 B)
- `"• resumeInterrupted — Required: resumeInterrupted (handoff ID); reopens an interrupted handoff."`
  becomes `"• resumeInterrupted — handoff ID; reopens an interrupted handoff."` (−30 B)
- `"• helpRequest — Required: to, task, context, helpRequest: true."`
  becomes `"• helpRequest — to, task, context, helpRequest: true."` (−10 B; the
  create line still carries `Required: to, task, context`)
- `"checkpoint (create only, low context):"` becomes `"checkpoint (create only):"`
  (−13 B)
- `"files optional but recommended."` becomes `"files optional, recommended."` (−3 B)

`src/tools/record.ts`:

- `'READ-BACK: record(get: "R-001") → one by id; record(list: true) → all'`
  becomes `'READ-BACK: record(get: "R-001") → one; record(list: true) → all'` (−6 B)
- `'SEARCH: record(search: "text") → matches in title/detail, max 20'`
  becomes `'SEARCH: record(search: "text") → title/detail, max 20'` (−11 B)
- `'EXAMPLES: record(type: "decision", title: "We use React", detail: "We chose React for its easy ecosystem")'`
  becomes `'EXAMPLES: record(type: "decision", title: "We use React", detail: "Why React")'`
  (−28 B; the shape is unchanged)

`src/tools/timeline.ts`:

- `"View the activity timeline — tasks, handoffs, discussions, checkpoints by time/date."`
  becomes `"View the activity timeline — tasks, handoffs, discussions, checkpoints."`
  (−13 B)

`src/tools/thread.ts`:

- `"Portable context handoff for agent-to-agent, model-to-model and thread continuation."`
  becomes `"Portable context handoff for agent, model, and thread continuation."`
  (−17 B)
- `"packing the same handoff twice is idempotent until it is revoked"`
  becomes `"packing twice is idempotent until it is revoked"` (−17 B)

`src/tools/agent-management.ts`, `kick`:

- `"removing two or more agents shows a confirmation card"`
  becomes `"removing two or more shows a confirmation card"` (−7 B)
- Delete `" (see kickNotAnalystHint)"`, an internal reference the model cannot use.
  (−25 B)

`src/tools/agent-management.ts`, `addagent` first line:

- `"Add one or more specialist agents."`
  becomes `"Add or patch a specialist agent definition."` (+9 B; it removes the
  task-delegation reading that competes with the `task` tool)

`src/tools/override.ts`:

- `"• REDIRECT — send a pending handoff to a different agent. Required: handoffId, to. Optional: reason."`
  becomes `"• REDIRECT — pending handoff to another agent. Required: handoffId, to; reason optional."`
  (−12 B)
- `"• CANCEL — cancel a pending handoff. Required: handoffId. Optional: reason."`
  becomes `"• CANCEL — cancel a pending handoff. Required: handoffId; reason optional."`
  (−1 B)
- `"• FORCE-COMPLETE — mark a handoff as completed. Required: handoffId, force: true. Optional: reason."`
  becomes `"• FORCE-COMPLETE — mark a handoff completed. Required: handoffId, force: true; reason optional."`
  (−4 B)
- `"• REROUTE — tell the system which agent should handle the current message. Required: to. Optional: reason."`
  becomes `"• REROUTE — tell the system which agent handles the current message. Required: to; reason optional."`
  (−7 B)

`src/discussion/discussion-tools.ts`:

- `"Open a discussion window for agents to debate and solve problems collaboratively."`
  becomes `"Open a discussion window for agents to solve problems collaboratively."`
  (−11 B)

No rule, limit, argument shape, or pinned phrase is lost. The `Required:` labels
that remain keep their meaning; where a label was dropped, the argument list and
its pinned form stayed.

### 4. New skill `tawassul-orientation` (withdrawn)

Withdrawn by the probe at 0.125. The body below is the reviewed draft, kept as a
record; the shipped tree contains no such skill and the manifest stays at 16.

`skills/tawassul-orientation/SKILL.md` (946 bytes with the trailing newline, 945 without):

```
# Plugin orientation

1. Read the plugin map with `help()`.
2. Read the live team with `check()`.
3. Read the board with `show_board()`.
4. Read the recent activity with `timeline()`.
5. Read the session state with `status()`.

## The model

Tawassul runs in-process. Handoffs, records, goals, and state live behind these tools; the workspace holds no copy.

A request goes direct, or `@tawa` routes it to one specialist. Long work resumes from a handoff checkpoint.

The ledgers are handoff (agent work), record (decisions, fixes, incidents), and goal (objectives and definition of done).

Roster changes run in the main session: `addagent` adds or patches an agent, and `kick` removes one. They write the agent file and the roster programmatically; those files are generated, not hand-edited. Where the `@addagent` agent is available, it dispatches the same pair.

A skill description that matches the task is the signal to load its procedure.
```

The body avoids every word in the forbidden list. `parseProcedure` yields exactly
five calls: `help`, `check`, `show_board`, `timeline`, `status`, all with empty args. The roster
tool names appear without parentheses, so they are prose, not procedure steps.

The procedure's first step is `help()`, and the new `help` output carries the
roster rule, so the loaded procedure reaches the roster channel without a roster
call in the parsed sequence. A roster call inside the procedure would need required
arguments and would execute during the replay; the five zero-arg reads stay the
procedure, and the roster tools stay in prose.

`skills/manifest.json`, append:

```json
{
  "id": "tawassul-orientation",
  "name": "Plugin orientation",
  "directory": "skills/tawassul-orientation",
  "description": "Use when adding or removing an agent, delegating to a specialist, recording a decision, tracking a goal, or explaining how Tawassul works.",
  "scope": "plugin orientation across the roster, the ledgers, and the entry tools",
  "tools": ["help", "check", "show_board", "timeline", "status"],
  "evalId": "orientation-basic",
  "loadRateThreshold": 0.5,
  "killCriterion": "Retire to the help text when fewer than half of the relevant fixture sessions load it."
}
```

The `tools` array must stay the five procedure tools. `addagent` and `kick` are
named in prose only; adding them to `tools` would fail the sorted-list assertion.

`src/skills/pilot.ts`:

- import the body with `with { type: "text" }` under the existing imports;
- add `"tawassul-orientation": orientationBody` to `BODIES`;
- in `registerPilotSkills`, when `ctx.skill?.transform` is absent, log one warning
  guarded by a module-level flag: the host did not expose the skill domain, so the
  shipped skills are not registered.

### 5. Capability diagnostic

`src/skills/pilot.ts`, `registerPilotSkills`:

```
[tawassul] v2 skill domain unavailable: the host did not expose ctx.skill.transform; shipped skills are not registered
```

One `logger.warn` on the absent domain, once per process. Without it a global
install cannot prove whether skills reached the host at all. The message carries no
forbidden word and costs no model tokens.

### 6. Evaluation artifacts (withdrawn)

Withdrawn with the skill; no fixture and no eval ledger entry ship. The files
below are the reviewed draft, kept as a record.

`docs/experiments/fixtures/orientation-basic.json`:

```json
{
  "id": "orientation-basic",
  "skillId": "tawassul-orientation",
  "sessions": [
    {
      "name": "orientation-map",
      "request": "I am new to this project; show me how this plugin works and where to start.",
      "relevant": true,
      "loaded": true,
      "calls": [
        { "tool": "help", "args": {} },
        { "tool": "check", "args": {} },
        { "tool": "show_board", "args": {} },
        { "tool": "timeline", "args": {} },
        { "tool": "status", "args": {} }
      ]
    },
    {
      "name": "roster-add",
      "request": "Add an agent named reviewer with model gemini from google.",
      "relevant": true,
      "loaded": true,
      "calls": [
        { "tool": "help", "args": {} },
        { "tool": "check", "args": {} },
        { "tool": "show_board", "args": {} },
        { "tool": "timeline", "args": {} },
        { "tool": "status", "args": {} }
      ]
    }
  ]
}
```

`docs/experiments/receipts/2026-11-15-orientation-eval.json`:

```json
{
  "date": "2026-11-15",
  "method": "offline replay of the authored orientation fixture against the shipped procedure text; the live load rate was measured on an isolated host on 2026-11-15 by the E1 method, with XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_STATE_HOME, XDG_CACHE_HOME, OPENCODE_DB, TAWASSUL_STATE_DIR and TAWASSUL_HMAC_KEY_DIR redirected under one root",
  "fixtures": [
    {
      "evalId": "orientation-basic",
      "skillId": "tawassul-orientation",
      "sessions": 2,
      "relevant": 2,
      "loaded": 2,
      "procedureExecuted": true,
      "calls": 5
    }
  ],
  "replayLoadRate": { "relevant": 2, "loaded": 2, "rate": 1 },
  "liveLoadRate": {
    "sessions": [
      { "evalId": "orientation-basic", "session": "orientation-map", "agent": "build", "loaded": true },
      { "evalId": "orientation-basic", "session": "roster-add", "agent": "build", "loaded": true },
      { "evalId": "orientation-basic", "session": "roster-remove", "agent": "build", "loaded": true },
      { "evalId": "orientation-basic", "session": "state-location", "agent": "build", "loaded": true }
    ],
    "relevant": 4,
    "loaded": 4,
    "rate": 1,
    "skillsOff": 0
  },
  "notes": "The live rows are the measured probe result. A relevant session that did not load is recorded with loaded false; the rate is computed from the rows, not assumed."
}
```

The four live rows are placeholders for the probe result. Every relevant prompt is
recorded, including a failed load. The `E1` sentence is mandatory.

`docs/experiments/evals.json`, append to `evals`:

```json
{
  "id": "orientation-basic",
  "skillId": "tawassul-orientation",
  "fixture": "docs/experiments/fixtures/orientation-basic.json",
  "receipt": "docs/experiments/receipts/2026-11-15-orientation-eval.json",
  "verdict": "pass"
}
```

The `pass` verdict and the live rows are written only after the probe succeeds.

### 7. Budget receipt

Create `docs/experiments/receipts/2026-11-15-schema-payload.json` as a copy of
`2026-11-13-schema-payload.json` with:

- `descriptionBytes` = the live measured total (expected 15,857);
- these `descriptionLines` rows updated to the measured bytes and
  `Math.ceil(bytes / 4)` tokens:
  - `goal` 1,535 B, 384 tokens;
  - `handoff` 1,008 B, 252 tokens;
  - `record` 496 B, 124 tokens;
  - `timeline` 424 B, 106 tokens;
  - `thread` 849 B, 213 tokens;
  - `kick` 761 B, 191 tokens;
  - `override` 595 B, 149 tokens;
  - `discussion` 376 B, 94 tokens;
  - `addagent` 1,077 B, 270 tokens;
  - `help` stays at 88 B, 22 tokens;
- every other field, including `schemaPayload`, `schemaLines`, `schemaPreCut`, and
  `archivedBaseline`, unchanged.

`scripts/prove-context-diet.ts`: point `PAYLOAD_RECEIPT` at the new dated file. Do
not rewrite the 2026-11-13 receipt; it records a past measurement. The proof pins
every row, so the receipt is generated from the live measurement, never from the
expected numbers above.

### 8. Proof updates (16→17 rows historical)

The 16→17 edits below were the pre-probe draft and were reverted with the skill;
the shipped proofs and docs keep 16. The retained edits are the `help` rows and
the doc summaries.

- `scripts/prove-skills-manifest.ts:73`: 16 to 17 (reverted; shipped count 16).
- `scripts/prove-skills-manifest.ts` definitions map: add `help`, `check`, `status`
  (reverted with the skill; the shipped map is unchanged).
- `scripts/prove-pilot-eval.ts` definitions map: add `help`, `check`, `status`
  (reverted with the skill; the shipped map is unchanged).
- `scripts/prove-skill-registration.ts:243`: 16 to 17 (reverted; shipped count 16).
- `scripts/prove-skill-load-rate.ts:48`: 16 to 17 (reverted; shipped count 16).
- `scripts/prove-md-gate.ts:84,87`: 16 to 17 (reverted; shipped count 16).
- `README.md` generated skills table: append the manifest row exactly as the proof
  computes it, and change "Sixteen procedures" to "Seventeen procedures"
  (reverted; shipped text stays sixteen).
- `docs/skills.md`: "sixteen" to "seventeen", add the shipped-skills row, add the
  line "`tawassul-orientation` is available to every agent", and add the id to the
  delivery section (reverted; shipped text stays sixteen).
- `docs/tools.md:113` and `docs/end-user-guide.md:714`: these rows are doc-authored
  summaries, not the tool string. Replace the summary with "Print the plugin map:
  identity, ledgers, state, and the roster rule". Neither document quotes the old
  sentence, so there is no text substitution to make.
- `docs/end-user-guide.md:730`: "sixteen" to "seventeen".
- `CHANGELOG.md`: one line under `## [Unreleased]` / `### Added`.

### 9. Build, install, refresh

`npm run build` regenerates `dist/global.js` and `.opencode/plugins/tawassul.js` in
one step. `npm run install:global` installs the flat global file.

`install-global` warns that this repository's own project entry supersedes the
global copy when the repository is opened. The manual probe therefore runs in a
scratch directory outside the repository, never here.

After a build that should reach the live host of this repository, run
`npm run host:refresh -- --verify-only` first. That step checks that the live
plugin init is newer than the plugin entry without touching the host. Run the
default reload (or `-- --restart`) only when the check says the host is stale and
the user accepts the interruption; neither mode rebuilds, so both follow
`npm run build`.

## Risk treatment

Historical: the skill rows record the gate that retired it. The shipped residual
risks are listed in "Final reconciliation".

| Risk | Detection | Treatment | Stop condition |
| --- | --- | --- | --- |
| A trim breaks a pinned constraint phrase | `prove-constraint-retention` names the tool and the phrase | Restore the phrase and cut elsewhere; every candidate trim was replayed against the fixture before it was written here | Fix the description before any other proof. |
| A trim shrinks a twelfth tool | `prove-constraint-retention` reports "the diet touched the fixture's tool count (12/11)" | Restore that tool and cut inside the eleven instead | Restore. |
| The skill body never reaches a foreign project | The probe transcript shows the skill name but not the body's first step | The cause is `path` resolution: the global install ships no `skills/` tree. The fallback is to ship the skills tree with the global install, which changes the install layout and the `verify:global` hashes | Stop. That fallback is a separate change and needs its own authorization. |
| The host does not expose `ctx.skill` | The new capability warning appears once per process, and the new skill is absent from the host list | Confirm the warning in the host log; if it fires, the skill channel is unavailable in that host | Stop. Keep the `help` and `addagent` changes and report the measurement. An injected line needs a new authorization. |
| The probe does not load the skill | Zero loaded rows, or a rate below 0.5 | Apply the kill criterion: do not add the ledger entry, remove the skill, keep the funded `help` and `addagent` changes | Do not ship the skill. Record the negative probe receipt. |
| The skill loads but roster prompts still edit files | The probe transcript shows `edit`/`write` on `.opencode/agents` or `opencode.json` | The trigger is insufficient. The first fallback is the remaining 158 B of `addagent` headroom: add one explicit clause that says the tool replaces manual edits, and fund it with further trims. Injection stays the last resort | Do not claim the top symptom is fixed. Keep the skill only if the other prompts load at or above 0.5 and the kill criterion passes. |
| The skill loads inside a subagent and the roster tool refuses it | The tool returns the caller-is-not-main-session hint | The body states the main-session rule; the subagent returns the request to the main session or, where installed, delegates to `@addagent` | Do not add a subagent-side workaround. |
| `@addagent` is absent in a foreign project with only the global install | The probe transcript shows the model trying `@addagent` and failing, and the agent list has no `addagent` | The skill body says "where available"; the main-session `addagent`/`kick` tools work without it. `install-global` keeps the global agent roster but writes none (`scripts/install-global.ts:1146-1150`) | Do not add an agent install to this change; report the roster path. |
| The receipt row does not match the live measurement | `prove-context-diet` fails on the first mismatched row or on the total | Regenerate every row from the live measurement. Never hand-edit the total alone | Fix the receipt before any other proof. |
| The receipt `method` misses `E1` | `prove-pilot-eval` fails immediately | Include the E1 sentence verbatim | Fix the receipt. |
| The ledger is written before the probe | `prove-skills-manifest` fails the ledger/manifest count, or `prove-skill-load-rate` reports no live sample | Follow the stage order: probe first, ledger after | Do not add the ledger entry early. |
| The `addagent` line trips the frozen growth check | `prove-context-diet` prints `grown` with `addagent` | Revert the +9 B first line; the skill trigger remains | Keep the skill only if the budget still closes. |
| The host wrapper or extra fields are larger than the estimate | The probe's rendered skill block exceeds 261 B and the net turns positive | The 261 B covers id, name, and description plus an 85 B wrapper; `path` and `autoinvoke` may also render (`src/skills/pilot.ts:76-82`). Measure the rendered block; if the delta is positive, drop the skill and keep the help and addagent changes | Do not claim no net growth without the measured block. |
| The local host still shows the old text | `help` returns the old sentence, or the skill is absent locally | Run `npm run build` then `npm run host:refresh`; probe outside the repository | Do not diagnose a build problem as a skill-domain problem. |
| The Arabic documentation drifts | `docs/i18n/ar/end-user-guide.md` still says "sixteen" and the key count is stale | Not gated. Record it as a follow-up translation update | Out of the minimum fix. |

## Manual acceptance (the real gate)

Historical probe procedure: the skill was withdrawn, so the skill rows below are
the record of the gate that retired it. The shipped roster-channel evidence is the
final `out14` (receipt `2026-11-15-addagent-guidance-probe.json`): a leading
`@addagent` request made the main session quote the injected guidance, call
`subagent` with `agent: "addagent"`, and pass the request unchanged. The child
session called `addagent` itself with the requested name; because the earlier probe
had already written `designer-mimo`, the re-add returned "All agents already
exist" and wrote nothing. The child then called `check` and never called
`subagent`, so it did not delegate to itself.

Foreign-project probe, before the skill ships:

1. Run `npm run build`, `npm run install:global`.
2. Create a scratch project outside this repository with no Tawassul files.
3. Confirm the global install loads and that the new skill appears in the host
   skill list. If it does not appear, check the new capability warning. A missing
   domain stops this plan; report it instead of shipping.
4. Run four prompts with a cheap model:
   - "How does this plugin work?"
   - "Add an agent named reviewer with model gemini from google."
   - "Remove the reviewer agent."
   - "Where are handoffs stored?"
5. Record, for each prompt:
   - whether the skill loaded, and whether the loaded text contains the body's
     first step, "Read the plugin map with `help()`";
   - whether the model called `help`;
   - whether the model searched the workspace for plugin files;
   - for the roster prompts, whether it used `addagent`/`kick` or, where present,
     `@addagent`, instead of editing files by hand. The global install does not
     ship an agent roster, so `@addagent` may be absent; the main-session tools are
     the guaranteed path.

Write the result to `docs/experiments/receipts/2026-11-15-orientation-probe.json`.
Every relevant prompt becomes a live row, including a failed load. Only the
measured rows may produce the live table in the eval receipt.

If no session loads the skill, the skill does not ship; the kill criterion applies,
and the `help` and `addagent` changes remain as the delivered items.

The final guard check uses the same scratch project: a message that quotes
`@addagent` mid-sentence produces no delegation guidance, and an addagent child
prompt that carries `@addagent` at the start is not told to delegate to itself.
The leading mention in `out12` remains the positive control.

## Verification

Stage 1, after the code, i18n, docs, and budget-receipt edits:

```
npm run typecheck
npm run check:rules
npm run check:docs
bun scripts/prove-constraint-retention.ts
bun scripts/prove-context-diet.ts
bun scripts/prove-md-gate.ts
```

Stage 2, the live gate:

```
npm run build
npm run install:global
# probe in a scratch directory outside the repository
```

Stage 3, after the probe writes the receipts and the ledger entry:

```
bun scripts/prove-skills-manifest.ts
bun scripts/prove-skill-registration.ts
bun scripts/prove-skill-load-rate.ts
bun scripts/prove-pilot-eval.ts
npm run verify
npm run ci
```

`prove-skills-manifest`, `prove-skill-load-rate`, and `prove-pilot-eval` could not
pass before the probe while the skill was a candidate, because they required the
ledger entry and a live row. That order is historical: with the skill withdrawn,
the proofs pass at 16 without a probe entry.

Final closing run (2026-11-15), after the withdrawal and the `@addagent`
guidance:

```
npm run check:rules
npm run check:docs
bun scripts/prove-constraint-retention.ts
bun scripts/prove-context-diet.ts
bun scripts/prove-md-gate.ts
bun scripts/prove-skills-manifest.ts
bun scripts/prove-skill-registration.ts
bun scripts/prove-skill-load-rate.ts
bun scripts/prove-pilot-eval.ts
bun scripts/prove-global-install.ts
npm run prove:independence
npm run verify
npm run ci
npm run install:global
npm run host:refresh -- --verify-only
```

Results: `check:rules` 632 files OK; `check:docs` green; every named proof green;
`npm run verify` green; `npm run ci` `GATE PASS: fast + proofs + smoke` (16 fast,
183 proof steps in 461,408 ms, 6 smoke steps in 60,987 ms; 0 FAIL rows in
`docs/CI-TRANSCRIPT.md`); `install:global` installed the final bundle
(`2352401855cf`); `host:refresh -- --verify-only` reported the live host fresh
(`live_bundle=0ed16ed2c2a7`, init newer than entry). The final live probe `out14`
then exited 0 against the same bundle.

Three exact-pin interferences surfaced only in the full CI and were fixed as proof
updates caused by the intentional changes: the smoke `help` canary (`e27`), the
`guide.*` key count 33→34, and the `handoff`/`record` byte canary 1,117/541→1,008/496.
No feature was traded for another; the consent gate and the 44-tool surface are
unchanged.

## Acceptance criteria

1. `help` description is 88 bytes, names the plugin, and carries the roster trigger
   ("Agent changes use addagent and kick, not files"); the live description total
   is at or below 15,910 bytes (expected 15,857); no per-tool description exceeds
   its frozen baseline; `addagent` stays at or below 1,235 bytes.
2. All 103 pinned constraint phrases survive; the slimmed set is still exactly the
   eleven fixture tools.
3. `help()` returns the five-line map above, names the plugin, the three ledgers,
   and the roster rule, and cites no missing path.
4. `tawassul-orientation` is absent from the manifest, the registry, the fixtures,
   and the eval ledger; 16 skills ship; the probe receipt records 0.125 (1/8) and
   the withdrawal.
5. The `@addagent` guidance is injected only for a leading mention and is never
   sent to the addagent agent; a quoted or mid-text mention gets no guidance, and
   the child session cannot self-delegate. The add path is live-proved by
   `out12`.
6. No session-start injection was added; the explicit-mention guidance is
   event-driven and absent from a session that never mentions `@addagent`; no new
   tool; tool-name tripwire unchanged; proof count remains 183.
7. The capability warning fires once per process when the skill domain is absent.
8. The `addagent` first line reads "Add or patch a specialist agent definition.",
   and the shipped channels name `addagent` and `kick`: the `help` description,
   the `help` output roster line, and the `addagent` first line. The explicit
   `@addagent` guidance instructs the main session to call `subagent` with
   `agent: "addagent"` and not to call the tools itself.
9. In the probe, both roster prompts use `addagent`/`kick` or, where present,
   `@addagent`; neither edits `.opencode/agents/` or `opencode.json` by hand. The
   add path is live-proved by `out12`; the remove path's consent copy now says to
   wait for the user's reply and not to retry before approval, but the remove path
   is not re-probed live in this pass.

## Stop conditions

- The live probe does not load the skill: do not ship it; keep the `help` and
  `addagent` changes and report the measurement.
- The loaded skill has no body in a foreign project: stop; the fix is a different
  install layout and needs its own authorization.
- The host does not expose a skill domain in a foreign project: stop; the next
  decision is an injected line (~15 tokens per session), which this plan does not
  authorize.
- The skill loads but both roster prompts still edit files by hand: do not claim
  success; report the result and keep the skill only if the other criteria hold.
- A trim breaks a pinned constraint phrase or shrinks a twelfth tool: restore that
  text; the budget is funded from the eleven pinned tools only.
- The `addagent` line trips the frozen per-tool growth check: revert that line.
- Safe trims cannot reach 15,910 bytes: stop trimming and record the residual
  positive delta instead of cutting behavioral detail.

## Out of scope

- Session injection of any kind.
- New tools, tool renames, or changes to the tool-name set.
- Changes to `chat.message`, injection budgets, or compaction.
- Rewriting the 2026-11-13 receipt or the dated constraint-retention fixture.
- Shipping a `skills/` tree with the global install; that is the fallback for the
  body-path risk and needs its own change.
- Updating `docs/i18n/ar/end-user-guide.md`; it is a follow-up translation task.
