# Upstream Watch — OpenCode Compatibility

Status: 2026-10-27 · audited through v2.2.0 · built host contract 2.2.0

Purpose: one standing section that answers, for every OpenCode release, four
questions — what changed, does it touch Tawassul, what did we do about it, and
where is the evidence. The goal is that a host upgrade never arrives as a
surprise: compatibility work is planned, conflicts are caught before a live
session, and host improvements become tracked candidates instead of folklore.

Source: <https://opencode.ai/changelog>

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
3. **Live check** — `bun scripts/check-upstream.ts` reads the changelog and
   compares it with the registry. It exits 1 when a release above the audited
   ceiling appears, and 0 when the tree is aligned. It is read-only: it never
   upgrades a dependency, edits a permission entry, or changes state.

`scripts/prove-upstream-sync.ts` proves the parser, the validator, and the
drift report, including twelve deliberate registry corruptions that must each
fail. The live check is not part of `ci` because it needs the network; the
offline gate is.

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
patch release on a user machine never turns into a hard failure.
6. Record the outcome in `ISSUES.md` and in the ledger below.

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
| v2.2.0 | 2026-10-27 | 2026-10-27 | 2.2.0 | partial | 30 tracked changes: one guard (`E-43`, fixed), one adoption (`E-42`, fixed), three follow-ups (`E-44`, `E-45`, and `E-46` fixed), eight candidates, eleven aligned, six ignored |

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

### Follow-ups that need a host restart or a measurement

| PR | Change | Verdict | Issue | Action |
| --- | --- | --- | --- | --- |
| #58331 | Dev builds use a separate server, database, and port | tracked | `E-46` | `health` now names the desktop sidecar DB lane instead of calling it a mismatch |
| #58866 | Throttled requests retry instead of reporting context overflow | tracked | `E-44` | Defer transient limits to the 2.2.0 host retry; keep the legacy path below it |
| #58817 | Shutdown exits after ten seconds | tracked | `E-45` | Bound dispose at 7.5 s with a 2.5 s margin under the host cap |

### Candidates

| PR | Change | Why it is not adopted yet |
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

## Open follow-ups from v2.2.0

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
- A green offline gate proves the registry is well formed. It does not prove
  compatibility; only a live boot and the proofs do that.
