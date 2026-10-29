# Upstream Watch — OpenCode Compatibility

Status: 2026-10-29 · audited through v2.2.1 · built host contract 2.2.1

Purpose: one standing section that answers, for every OpenCode release, four
questions — what changed, does it touch Tawassul, what did we do about it, and
where is the evidence. The goal is that a host upgrade never arrives as a
surprise: compatibility work is planned, conflicts are caught before a live
session, and host improvements become tracked candidates instead of folklore.

Sources: <https://github.com/anomalyco/opencode/releases> (live feed) and
<https://opencode.ai/changelog> (published page). The GitHub feed is the
earlier signal; the page sometimes lags by a release.

## Three layers

1. **Registry** — `src/upstream/registry.json` holds every audited release and
   one item per change that constrains this plugin. Each item carries a pull
   request number, a lowercase topic, a verdict, an optional issue id, and one
   line of reasoning.
2. **Offline gate** — `bun scripts/check-upstream.ts --offline`, wired as the
   `upstream-registry` step of `gate:fast`. It validates the registry without
   network access: semantic versions, descending order, real calendar days,
   an audit date not before the release, unique pull requests and topics, known
   verdicts, an issue id on every adopted/guarded/tracked change, and an
   `auditedThrough` that equals the newest audited release.
3. **Live check** — `bun scripts/check-upstream.ts` reads both live sources,
   merges their versions, and compares the union with the registry. It exits 1
   when a release above the audited ceiling appears in either source, 0 when
   the tree is aligned, and 2 when neither source is reachable. A source whose
   newest release is below `auditedThrough` is reported as lagging instead of
   hiding the newer release. It is read-only: it never upgrades a dependency,
   edits a permission entry, or changes state.

`scripts/prove-upstream-sync.ts` proves both parsers, the merge, the
validator, and the drift report, including nineteen deliberate registry
corruptions that must each fail. The live check is not part of `ci` because it
needs the network; the offline gate is.

## Routine when a new release appears

1. Run `npm run check:upstream`.
2. Read the release notes and mark every breaking change and every
   security-relevant change first.
3. Add the release to the registry, one item per change that matters. Use an
   existing issue id when the change maps to a known defect; register a new
   entry in `ISSUES.md` when it does not.
4. Do the work one fix per commit, each with an isolated proof.
5. Raise `auditedThrough` only when the release is fully assessed, and update
   `hostContract` only when the built dependency actually moves.
6. Record the outcome in `ISSUES.md` and in the ledger below.

## Host compatibility policy

Frequent OpenCode releases must not block end users. The plugin entry has no
host-version gate: any host that loads it runs it, and an unknown host keeps
the legacy rate-limit path (`E-44`). The launcher, the global installer,
`doctor-v2.sh`, and the release smoke enforce a **supported range** instead of
an exact pin:

- accepted: `>= 2.2.0 < 3.0.0`;
- a newer 2.x host runs with a warning and the audited ceiling stays visible;
- a host below `2.2.0` is refused (v1/legacy contract);
- a `3.x` host is refused until a major release is audited, because it can
  change the plugin API and the database contract;
- `TAWASSUL_OPENCODE_VERSION` is an optional exact pin for reproducible runs
  and wins over the range.

`auditedThrough` is the newest *assessed* release, not the installed one, so a
patch release on a user machine never turns into a hard failure. The build
dependency uses a caret range (`^2.2.1`), never an exact pin; the lockfile
supplies reproducibility and `check-sdk-pins` keeps the range, the lock, the
installed package, and the audited ceiling in agreement.

Never: auto-bump dependencies, auto-edit a permission entry, or adopt an
experimental API without a proof. The owner's bash-permission rule applies to
everything here.

## Verdicts

| Verdict | Meaning |
| --- | --- |
| `adopted` | We rely on the new host behavior or API now. |
| `aligned` | Host behavior already matches ours; no code change. |
| `candidate` | Worth adopting later; no current defect depends on it. |
| `guarded` | We added or extended a defence because of the change. |
| `tracked` | Needs follow-up work or live verification; an issue is open. |
| `ignored` | Not applicable to this plugin; the note gives the reason. |

Release status is `aligned` (nothing open), `partial` (assessment or fixes
still running), or `blocked` (a host defect prevents the work).

## Version ledger

| Release | Date | Audited | Host contract | Status | Summary |
| --- | --- | --- | --- | --- | --- |
| v2.2.1 | 2026-10-29 | 2026-10-29 | 2.2.1 | partial | 24 tracked changes: two follow-ups (`E-44`, `E-55`), seven candidates, six aligned, nine ignored |
| v2.2.0 | 2026-10-27 | 2026-10-27 | 2.2.0 | partial | 30 tracked changes: one guard (`E-43`, fixed), one adoption (`E-42`, fixed), one follow-up (`E-44`), thirteen aligned (`E-45`, `E-46`), eight candidates, six ignored |

## v2.2.0 — what changed for us

### Security and truthfulness

| PR | Change | Verdict | Issue | Action |
| --- | --- | --- | --- | --- |
| #59315 | Code Mode exposes MCP tools when `execute` is denied | guarded | `E-43` | Tawa refuses `execute` by name; normal agents keep it |
| #59459 | Server returns a reference id when a response cannot be encoded | adopted | `E-42` | Localized the missing handoff result; fixed with JSON-safe tool metadata |

### Reliability we already match

| PR | Change | Verdict | Issue | Action |
| --- | --- | --- | --- | --- |
| #51133 | Host waits for plugin reloads before steps and tool calls | aligned | `E-38` | Fingerprint skip stays; no unbounded reload |
| #58798 | Tool schemas convert once | aligned | `B-01` | Placeholder and reload contract unchanged |
| #59082 | Agent and provider lists wait for plugins | aligned | `E-17` | Empty-catalog window narrows; fail-closed check stays |
| #58851 | Streamed text survives a finish reason | aligned | `E-15` | Truncation window closes on the host side |
| #58864 | Event type filter | aligned | — | Whole-stream mapping is unchanged; filtering is available if profiling asks for it |
| #58847 | `@opencode/ai` promise root | aligned | — | The plugin does not import `@opencode/ai` directly; the external list is unchanged |
| #58448 | Tool-call memory release | aligned | — | The host releases tool-call memory; RSS is remeasured after the next restart |
| #59441 | Compaction token sizing | aligned | — | Compaction uses the provider token count; our context hook is unaffected |
| #58997 | Deleted project sessions | aligned | — | Sessions and instruction entries survive a deleted project directory |
| #58815 | Service state out of shells | aligned | — | The background service state directory stays out of tool shells |
| #59089 | External-directory project filesystem | aligned | `E-39` | External-directory checks use the project filesystem; the pre-flight URL check stays |
| #58331 | Dev builds use a separate server, database, and port | aligned | `E-46` | `health` names the desktop sidecar DB lane instead of calling it a mismatch |
| #58817 | Shutdown exits after ten seconds | aligned | `E-45` | Dispose is bounded at 7.5 s with a 2.5 s margin under the host cap |

### Follow-ups that need a host restart or a measurement

| PR | Change | Verdict | Issue | Action |
| --- | --- | --- | --- | --- |
| #58866 | Throttled requests retry instead of reporting context overflow | tracked | `E-44` | Defer transient limits to the 2.2.0 host retry; keep the legacy path below it |

### Candidates

| PR | Change | Why it is not adopted yet |
| --- | --- | --- |
| #55246 | Desktop plugin manager shares plugins | Experimental; install follow-ups stay frozen until it settles |
| --- | --- | --- |
| #56550 | Keyed session instruction entries | Replaces synthetic notices, but needs a 2.2.0 host build first |
| #59469 | GUI plugin APIs (toasts, dialogs, tabs) | Experimental; text notices stay until the API settles |
| #59190 | Host image generation | The Codex imagegen transport still works |
| #59380 | Decision provider endpoints | Routing stays in the plugin for now |
| #59020 | History starts at the latest completed compaction | Recheck the context payload after the upgrade |
| #58865 | Rewind and fork from any message | Plugin state has no message anchor yet |
| #58562 | Provider-reported session costs | Compare with our estimate after the upgrade |

### Ignored

| PR | Change | Reason |
| --- | --- | --- |
| #59157 | Prompt-cache TTL | Host configuration; no plugin cache policy |
| #59295 | OpenTUI 0.7 peers | TUI-only; this plugin ships no TUI |
| #59032 | GitHub Action removed | No workflows in this tree |
| #59101 | SDK discards inline tool images | Our results carry no inline file payloads |
| #59090 | Machine hostname in `/api/info` | Informational; the plugin does not identify the machine |
| #59207 | Kimi tool-schema fix | No Kimi model is pinned here |

## v2.2.1 — what changed for us

Audited 2026-10-29 against
<https://github.com/anomalyco/opencode/releases/tag/v2.2.1>. The
`@opencode/plugin` 2.2.1 type surface changes one line (`generate` returns
`ExperimentalGenerateApi`) and adds `experimental.idle`; no import in this
tree breaks. `SessionDomain` still has no `export`/`import`, so the portable
handoff plan cannot use them.

### Follow-up

| PR | Change | Verdict | Issue | Action |
| --- | --- | --- | --- | --- |
| #59649 | Throttling retries instead of a false context overflow | tracked | `E-44` | Host 2.2.1 keeps the defer path; `prove-e44` runs the 2.2.0/2.2.1 boundary |
| #59437 | `/goal` plus the `experimental.idle` session hook | tracked | `E-55` | The host `/goal` is mirrored read-only by `goal(host: true)` and `goal(board)`; `experimental.idle` is not registered, so the host keeps sole ownership of continuation |

### Candidates

| PR | Change | Why it is not adopted yet |
| --- | --- | --- |
| #59939 | Opt-in `image_generate` tool | Experimental; the Codex imagegen transport still works |
| #60096 | Configurable default image model | Depends on the `image_generate` decision |
| #59401 | Opt-in scheduled prompts | Our scheduler only runs database maintenance |
| #60085 | GPT Image 2 after Codex sign-in | Host image models may replace the external transport |
| #59963 | Responses API freeform tools | Tool-schema travel changes; verify against our JSON schemas |
| #59934 | Tool output keeps more context headroom | Remeasure large tool results on 2.2.1 |
| #59887 | Desktop `/reload` | Must be proven against the plugin reload fingerprint |

### Aligned

| PR | Change | Action |
| --- | --- | --- |
| #60057 | Credential and cache keys stay out of model variants | Our generated config adds none |
| #59500 | Prompt-cache settings stay host configuration | Matches the no-cache-policy stance |
| #59417 | Git snapshots handle a split index | Our worktree commands do not touch the index |
| #59834 | Code Mode parse/await diagnostics | The tawa `execute` guard is unchanged |
| #60087 | Desktop follows each plugin server endpoint | Our event stream uses the resolved URL |
| #59736 | The timeline tolerates malformed tool metadata | Reinforces the JSON-safe metadata fix in `E-42` |

### Ignored

| PR | Change | Reason |
| --- | --- | --- |
| #59977 | `@opencode/ai` provider removals | The plugin imports only `@opencode/plugin` |
| #59506 | Legacy `@opencode/ai` entry points removed | No such import in this tree |
| #59765 | `@opencode/ai` configure types renamed | Provider types live outside the plugin |
| #59457 | Schedule client methods | The plugin never manages host schedules |
| #59419 | Snapshot capture coalescing | Host-side; no plugin surface |
| #59592 | Console web search gating | Web search stays opt-in and unused |
| #59072 | Experimental client method grouping | No generated client calls |
| #59987 | Compaction through the Promise AI client | Requires `@opencode/ai`, which is not imported |
| #59948 | Code Mode extension globals | The plugin declares none |

## Open follow-ups

### From v2.2.1

1. `E-44`: confirm on the live 2.2.1 host that throttling is retried by the
   host and the plugin schedules no second retry.
2. `E-55`: the host `/goal` mirror is attached; verify it on a live 2.2.1 host
   and confirm our ledger stays the only writer (no `experimental.idle`).
3. Prove Desktop `/reload` against the plugin reload fingerprint (`E-38`).
4. `E-54`: recoverable quota probes are implemented; verify a real quota
   notice, the 5/10/20-minute probe sequence, and the final notice after three
   probes.

### From v2.2.0

1. `E-43`: verify on a live 2.2.0 host that tawa cannot start Code Mode.
2. `E-42`: done 2026-10-27. The encode failure was undefined keys in a fresh
   handoff entry; result metadata is now JSON-safe, and live create and cancel
   both returned their results. Keep the reference id in mind for future
   encode failures.
3. Retry dedupe (`E-44`, fixed), the ten-second shutdown budget (`E-45`,
   fixed), and the dev/sidecar DB lane (`E-46`, fixed).
4. Fork/revert behavior for goals and handoffs once 2.2.0 is the running host.
5. Compaction payload check after the host starts history at the latest
   completed compaction.
6. Adopt `session.instructions.entry` to replace synthetic notices.
7. Decide whether a host-level `execute: "deny"` entry is accepted by the
   config schema on 2.2.0; until then the name guard is the only layer.

## Boundaries

- The registry records only changes that constrain this plugin. It is not a
  copy of the changelog.
- `auditedThrough` means "assessed", not "installed". The running host can lag
  and `health` is the place to read the live version.
- `ISSUES.md` remains the defect register. This file records upstream context
  and the verdict per change.
- Boot config repair is project-scoped (`V-13`): `repairProjectConfigBoot`
  never rewrites the user-global config, the runtime `execute.before` deny
  covers a stale global file, and the only global write is the opt-out roster
  seed.
- A green offline gate proves the registry is well formed. It does not prove
  compatibility; only a live boot and the proofs do that.
