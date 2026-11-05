# Report Path to the Coordinator — Design Plan

Revision: 7.1. Revision 5 was the reviewed design (see Section 12); revision 6 recorded the P2
trial findings: the host prefixes native subagent prompts, so ring matching is containment, and
the v2 bridge moves the host `agent` field into `subagent` instead of copying it. Revision 7
closed every question in Section 10 by ballot and recorded the P3 probes: the host requires
`prompt` on the `subagent` tool, `description` is never promoted to the delivered text, and
`input.agent` names the running agent rather than the dispatcher. Revision 7.1 corrects the R5
rationale after a five-agent review: `ToolContext.sessionID` is a host key, and `record` simply
does not use it.
Status: P0, the P0 amendment, P0b, P1, P2, and P3 are closed in this tree as of 2026-11-05. P3 is
a decision, not code: lineage exists, but R2 stays unimplemented because K10 binds.
The phase table below remains the design record.
Date: 2026-11-05
Scope: Tawassul V2, this tree, OpenCode host >= 2.2.0
Companion document: `docs/plan-token-burn-control.md`
Audience: the owner, implementers, and independent reviewers.

---

## 0. The rule in one sentence

> `@tawa` is never a dispatch target. It is the terminus of the return path, and only in routed mode.

The system currently collapses two different intents into one prohibition. Invoking tawa and
reporting to tawa are not the same act, and a single "cannot use @tawa" message erases the second
one from the agent's model of the system.

| Intent | Form | Correct policy |
| --- | --- | --- |
| Invoke tawa as a worker | `task(target: "@tawa")` | forbidden |
| Pass work to tawa | `handoff(to: "@tawa")` | forbidden |
| Redirect a handoff to tawa | `override(REDIRECT, to: "@tawa")` | forbidden |
| Deliver a result to the coordinator | the `task()` return value | required in routed mode |
| Deliver a blocker so the coordinator can re-dispatch | result text | required in routed mode |

The distinction matters because tawa's job is to read results from many agents, understand them,
and decide whether the task needs another dispatch. If the return path is not stated, every guard
that blocks a dispatch teaches the agent the wrong lesson: pick a substitute agent and continue.

---

## 1. Constraint K10

> **K10.** Guidance that directs a report to `@tawa` applies only when the session is in routed
> mode. Normal model distribution to agents must never return a message or a result to tawa.

**Routed mode** is defined as: the root user message mentioned `@tawa`, or used an explicit
dispatch command. It is not the same as direct routing to a single non-tawa agent. A `dev`
session that dispatches to `@explore` and `@general` is normal distribution and must stay free of
any tawa reference.

Why the scope is mandatory:

- Without it, every multi-agent run acquires a phantom coordinator. A normal `dev -> explore`
  child would be told to report to an agent that is not part of its tree.
- The plugin cannot tell a tawa child from a normal root once the child session starts. If the
  text names tawa unconditionally, the leak is not occasional; it is every child in every session.
- A normal root that receives "report to @tawa" has no way to comply, because `task()` returns to
  the immediate caller and `handoff(to: "@tawa")` is forbidden.

---

## 2. State before P0 (commit C2), read from this tree on 2026-11-05

This section records the tree before the P0 work landed. Rows 1-14 are applied in the working tree
today, so a citation such as `en.json:241` shows the old sentence here and the new one in the file.
Section 6 carries both the pre-P0 and the post-P0 text per row.

### 2.1 Three prohibitions and no guidance

| Location | Behaviour |
| --- | --- |
| `src/hooks/guards/dispatch-guards.ts:52-76` | `tawaRedirectGuard` blocks a `task`/`handoff` that names tawa; the message is returned at `:75` |
| `src/tools/handoff.ts:762-764` | the handoff tool refuses `to: "@tawa"` |
| `src/services/handoff-service.ts:675-676` | `redirectHandoff` refuses to redirect a handoff to tawa |

All three are correct as prohibitions, with one qualification: they are not unconditional.
`dispatch-guards.ts:56` exempts root-like callers and a tawa caller, and `handoff.ts:762` exempts a
tawa caller. That is intentional, but the plan and its messages must not describe the prohibition
as absolute.

None of the three states what the agent should do instead with its result.

The handoff refusal is the most explicit erasure: `src/i18n/en.json:241` reads
`"Agent {agent} cannot hand off to @tawa. Complete the task yourself."` The agent is told to
finish alone, not to return the result to the coordinator.

### 2.2 Ten messages prescribe a substitute agent

| Location | Current instruction |
| --- | --- |
| `dispatch-guards.ts:38` | "use handoff instead of nested task(), or split the task into smaller parts" |
| `dispatch-guards.ts:75` | "cannot redirect to @tawa. Complete the task yourself or use task() to another agent." |
| `dispatch-guards.ts:103` | "use different agents in the chain, or start a new task for the user" |
| `dispatch-guards.ts:116` | same, for a handoff loop |
| `dispatch-guards.ts:129` | "use handoff for distribution, merge tasks, or start a new task for the user" |
| `dispatch-guards.ts:144` | "Use @tawa for distribution." |
| `dispatch-guards.ts:155, :157` | "cannot use task(). Distribution is via @tawa only." |
| `dispatch-guards.ts:159, :161` | same sentence, from the target and permission branches |
| `dispatch-guards.ts:182` | "use another agent from the same role (e.g. dev-pickle or dev-mimo)" |
| `dispatch-guards.ts:214` | "Try again later or use another agent" |

The row at `:144` is the loudest live violation of K10. `sameRoleDistributionGuard` returns it to
any non-root, non-tawa caller, reachable from a normal `dev` tree, and it names tawa
unconditionally. It was absent from revision 1 of this plan; four of the five reviewers found it.

Every one of these messages turns a blocked branch into a new branch. In the token-burn dossier
this is defect D1 seen from the message side: the guard does not multiply budgets by itself, but
it instructs the agent to multiply sessions.

`circuitBreakerGuard` at `dispatch-guards.ts:187-202` goes further. It lists every agent in the
breaker map as a fallback, with no role filter. The map is populated by
`src/hooks/tool-execute.ts:587`, which records a failure when a heartbeat is stale, not on every
tool failure. The path still admits any agent, including tawa, so the guard can recommend the one
target the neighbouring guard forbids.

### 2.3 The routing signal is global, not per session

| Location | Behaviour |
| --- | --- |
| `src/context-class.ts:125-127` | `userMentionedTawa`, `directRoutingAgent`, `userExplicitDispatch` live on the shared context |
| `src/bootstrap/hooks-registration.ts:189-206` | every session reads and writes the same object |
| `src/hooks/message-updated.ts:132-139` | `detectTawaMention` resets all three flags on every user message |

Consequence: two concurrent sessions share one routing state. A normal user message in session B
clears routed mode for session A. Any conditional text built directly on these fields will be
applied to the wrong session.

`directRoutingAgent` has three write sites, not one: `message-updated.ts:161`, `override.ts:147`,
and the reset at `message-updated.ts:133`. Any migration must enumerate all of them.

### 2.4 Session lineage exists and was unused

- `task` is a host tool. The plugin never implements it and never sees the child session id at
  dispatch time. That part of the original premise holds.
- The stronger premise was wrong: `session.created` carries an optional `parentID`
  (`@opencode/schema/dist/event-manifest.d.ts:277-330`, `session.d.ts:36`), and `setup.ts:766`
  subscribes to raw events, so lineage is available to the plugin.
- The `parentID` field at `src/validation.ts:115` belongs to `HandoffEntrySchema`
  (`src/validation.ts:84-124`), not to a session. The goal record uses `parentId` at
  `src/validation.ts:491`, a different field in a different schema.
- `callDepth` counts dispatches inside one session (`dispatch-guards.ts:233-249`). A child starts
  at zero, so it cannot infer that it belongs to a tawa tree from the counter.
- `getCurrentAgent` at `src/hooks/guards/shared/normalize.ts:28` returns `input.agent`, the agent
  that is running, not the agent that called it. The dispatcher's identity is derivable only from
  `session_v2.parent_id`, which the dispatch-time guard does not read.
- A post-hoc channel also exists: the `experimental.idle` hook at `setup.ts:720-725` feeds
  `noteExperimentalIdle`, and the background list it stores carries `childSessionID` per live
  subagent (`src/tools/task-control.ts:18`). It arrives after dispatch and does not identify the
  parent of a child prompt at its first message, so it cannot replace the ring.

Consequence: lineage could replace the ring as the inheritance channel, but R2 remains
unimplemented because K10 forbids returning or re-dispatching to `@tawa`, not because the host
withholds the parent id. The sentinel remains the only channel, and the ring remains the only
dispatch-time match.

### 2.5 The root-turn gate cannot identify a root

The `chat.message` bridge builds its input at `src/v2/setup.ts:259` and forwards the agent only for
the assistant role:

```
agent: role === "assistant" ? (event.agent as string | undefined) : undefined
```

Every user-role message therefore arrives with `agent === undefined`, root or child alike. The
definition at `message-updated.ts:589`,

```
const isRootUserMessage = role === "user" && !input.agent;
```

is true for every user message. The context hook that feeds the bridge is registered per session
(`setup.ts:708-711`), so child sessions reach it too.

Two corollaries, both verified in this tree:

- The gate in revision 2 is not closed and safe; it is open and blind. A child prompt that quotes
  `tawa` would write routed mode into its own session, and `tawaRoutingEnforcementGuard` only
  applies at depth 0 (`resource-guards.ts:84`), so the permission block would land on the root of
  that session rather than on the child.
- There is no main-session key to fall back on. `ctx.sessionId` is generated locally at
  `src/context/session-manager.ts:44-46` as `session-<timestamp>-<uuid>` and passed to hooks at
  `hooks-registration.ts:188`; it never equals a host session id.

---

## 3. Why the naive implementation fails

| Attempt | Failure |
| --- | --- |
| Add "report to @tawa" to every guard message | Leaks into normal distribution; violates K10 |
| Add it only when `input.agent === "tawa"` | The agent that needs the instruction is the child, not tawa; a role condition is also disallowed by K1 |
| Add it only when `ctx.userMentionedTawa` | The flag is global; a concurrent session flips it |
| Add it only when `callDepth === 0` | A normal root also has depth zero |
| Allow `handoff(to: "@tawa")` | Handoffs pass work; a child would assign work to the coordinator |
| Add a `report` tool that targets tawa | Needs lineage to know which tawa session; without it, it hardcodes the leak |
| Write the clause with the word "tawa" but without `@` | `TAWA_MENTION_REGEX` at `message-updated.ts:53` matches bare `tawa`, so this reclassifies the child exactly like the `@` form |

The only formulation that survives all seven is: keep the addressee generic in guard text, and put
the tawa-specific instruction where the routing state is actually known, which is the dispatch
itself.

---

## 4. Design

### 4.1 Per-session routing state

Extend `PipelineState` rather than adding a new store. `PipelineState` already owns the per-session
maps, `MAX_SESSIONS = 50`, and `sweepStaleSessions` (`PipelineState.ts:16-29,142`).

The sweep does not discover maps; it enumerates them by hand. The collect loop at
`PipelineState.ts:165-171` lists seven maps, and the eviction loop at `:179-189` deletes them one by
one. A new map is invisible to both until it is added to both, and `MAX_SESSIONS` bounds
`staleSessions.size` (`:172`), not the size of any individual map. The tree already carries the
failure mode this creates: `pendingAgentLocks` is deleted at `:186` but never collected in
`:165-171`, so a session that exists only in that map is never evicted. Adding `routing` therefore
has three mandatory edits — the collect loop, the eviction loop, and `resetAll` (`:228-238`) — and
the risk rating in Section 9 holds only if all three land.

Written at the existing user-message site, after `detectTawaMention` (`message-updated.ts:614`)
and `detectDirectRouting` (`:615`), so both per-message signals are final before the record is
written; `input.sessionID` is already in scope. The record has to represent four different intents, and the two
sources differ in permission consequences:

```
type RoutingMode = "tawa" | "direct" | "explicit" | "normal";
type RoutingSource = "classified" | "dispatch" | "override";

routing: Map<sessionID, {
  mode: RoutingMode;
  directAgent: string | null;
  preferredAgent: string | null;
  source: RoutingSource;
  latched: boolean;
}>
```

`explicit` is required: `speculativeDispatchGuard` reads `ctx.userExplicitDispatch` today
(`resource-guards.ts:101`), and a three-value mode cannot express "the user asked for distribution"
without either losing that block or keeping a global read that the migration claims to remove.
`preferredAgent` is a separate field: an override preference must survive the rest of the turn in
which it was written, and a new user message clears it (4.6). `latched`
distinguishes a ring-derived record from a sentinel-only one; `source` alone cannot, because both
are dispatch records and only the ring hit may survive the session's next user message (4.1 rules
1-3).

Four rules on the write, in this order:

1. **A dispatched prompt inherits.** On every `task` dispatch the plugin stores
   `{ dispatcherSessionID, prompt, mode, at }` in a bounded ring of 64 entries inside
   `PipelineState`, where `prompt` is the text **before** the clause is appended. A user message
   whose whitespace-collapsed, lower-cased text contains a stored prompt is a dispatch prompt.
   The match is containment, not a fixed-length prefix: the host prepends
   `You are a subagent spawned by another session.` to native subagent prompts, so a start-anchored
   match never fires in production. Containment still requires the full stored prompt, which is at
   least 32 characters, and it normalizes whitespace and case so host reformatting does not break
   it. **A ring hit whose mode is `tawa` is honoured only when the message also ends
   with the sentinel**; a tawa ring match without it is ignored and logged, and classification
   takes over. Every other ring hit inherits `normal`, so a dispatched child never carries the
   parent's `direct` or `explicit` mode. Entries expire after ten minutes, are purged on every write
   and match, and are **not** consumed, because two parallel siblings must both inherit.
   Inheritance applies only to a session's first user message
   (`routing.has(sessionID) === false`), and every hit is logged. A ring hit writes `latched: true`.
   Prompts shorter than 32 characters are not stored; the sentinel covers them.
2. **The sentinel is the cold-start fallback.** If no ring entry matches, the session has no record
   yet, and the message ends with `[[tawassul:report-path:v1]]`, the session records `tawa` with
   `source: "dispatch"`, `latched: false`, **for that message only**. A hand-typed sentinel therefore
   reverts on the next plain message, and a routed child still receives the clause on its first
   message. Depth 2-3 prompts carry their own sentinel.
3. **Only a ring-derived dispatch record latches.** A later plain user message in the same session
   never overwrites a record whose `source` is `dispatch` and `latched` is true. A sentinel-only
   record carries `latched: false` and is per message (rule 2); sessions that were not dispatched
   have no such record and fall through to rule 4.
4. **Everything else is classified, per message.** With no ring hit and no latched dispatch record,
   the mode comes from the message: `tawa` when `TAWA_MENTION_REGEX` matches, `direct` when the
   direct-routing detector finds one agent, `explicit` when `EXPLICIT_DISPATCH_REGEX` matches
   without tawa, `normal` otherwise, with `source: "classified"` and `latched: false`. A classified
   record never latches: the next plain message rewrites it to `normal` and unblocks the session.
   `directAgent` is written from `detectDirectRouting` (`message-updated.ts:161`) and is null on
   every message that does not classify as direct, matching the reset at `:133`. A new user message
   also clears `preferredAgent`, reproducing that same per-message reset; within the turn that
   follows an override, tool calls do not rewrite the record, so the preference is honoured until
   that turn ends.

The ring is required, not optional hardening. `callDepth` is per session and every child starts at
zero (`PipelineState.ts:16`, `dispatch-guards.ts:37`), while `tawaRoutingEnforcementGuard` only acts
at depth 0 (`resource-guards.ts:85`). A child that inherited `tawa` would therefore have `edit`,
`write`, and `bash` blocked. `source` keeps that guard honest: it blocks `classified` records only.

The write never reads `input.agent`, which is always undefined for the user role (2.5).
`isRootUserMessage` stays where it is for the ask channel, but it is not a routing condition.

Guards read `ps(ctx).routing.get(input.sessionID)` and fall back to
`{ mode: "normal", directAgent: null, preferredAgent: null, source: "classified", latched: false }`.
The fail-safe default is `normal`: if the record is missing, nothing is routed and no clause is
emitted.

### 4.2 A universal addressee

Every guard message that blocks a dispatch ends with the same sentence:

> Return your result to your caller. Do not substitute another agent on your own.

This is true in both modes:

- in normal distribution the caller is the normal root agent;
- in routed mode the caller is tawa, or an intermediate that relays to tawa.

It never names tawa, so it cannot leak. It never names a role, so it cannot prescribe an
unreachable target. It also removes the reason for `circuitBreakerGuard` to enumerate fallbacks
and for `deletedAgentGuard` to hardcode `dev-pickle` and `dev-mimo`.

The word "caller" is deliberate. The plugin does not read the caller's name at dispatch time:
`input.agent` names the running agent, so any name it printed would be a guess. The probe in 10.1
shows that failure mode directly.

### 4.3 A prompt clause, only in routed mode

When a dispatch leaves a session whose `mode` is `"tawa"`, append one clause to the dispatch
prompt:

```
Report back to the coordinator that sent you this work. If you are blocked, state what you tried,
what blocked you, and what you need next. If you pass this work on, repeat this instruction.

[[tawassul:report-path:v1]]
```

Properties:

- **It contains no standalone "tawa" token.** `TAWA_MENTION_REGEX` matches bare `tawa` as well as
  `@tawa`; naming it in the clause would reclassify the child through the very detection path this
  design is trying to keep clean. The sentinel contains the letters `tawa` inside `tawassul`, but
  the regex requires a non-letter after the token, so neither the clause nor the sentinel matches.
  In routed mode the coordinator that dispatched the child is tawa by definition, so the word is
  unnecessary. Proof 10 asserts both regexes are false.
- **It trips neither detector.** `EXPLICIT_DISPATCH_REGEX` matches `\bdispatch\b`, `\bdistribute\b`,
  `\bdelegate\b`, `hand[ -]?off`, and three "… to agents" forms (`message-updated.ts:55-56`).
  The clause arrives as the child's own user message, so any of those words would set
  `ctx.userExplicitDispatch` in the child session and `speculativeDispatchGuard` would block
  `edit`, `write`, and `bash` at depth 0 (`resource-guards.ts:101-104`). "Sent you this work" and
  "pass this work on" are deliberate; revision 4's "If you dispatch further" was the defect. A
  proof asserts both regexes are false on the emitted clause.
- It is emitted by the dispatcher, which is the only party that knows the mode.
- **The sentinel is the last line, never the first.** Revision 3 wrote the tag at the start and
  then tested `endsWith`, which meant neither inheritance nor idempotence could ever fire. The
  sentinel `[[tawassul:report-path:v1]]` on its own final line is detected with a trim-then-end
  check, and the guard skips injection when it is already present. The same pattern already exists
  at `dispatch-guards.ts:172-183` for the `[report-only]` caveat.
- **The ring is the primary channel; the sentinel is the cold-start fallback.** A dispatch records
  the prompt fingerprint before the child runs (4.1). If the plugin restarted and the ring is empty,
  the sentinel still lets the child inherit on its first message.
- It applies to `task` only. `handoff` is excluded because `completeHandoff` does not push a result
  to the `from` agent: it runs side effects, clears run flags, calls `updateLastActive`, flushes,
  and returns the handoff record (`handoff-service.ts:472-510`). A handoff recipient must complete
  the handoff with its `result:` field instead. This resolves the split among the reviewers: three
  said handoff has no return path, two said the host guarantees it; reading the completion path
  confirms the first three.
- Insertion point: an unconditional effect after `commitCallDepthEffect` in `VALIDATION_PIPELINE`
  (`validation-pipeline.ts:133`). `task` is tawa-related, so `isTawaRelated` (`:245`) always routes
  it to `VALIDATION_PIPELINE`; `ESSENTIAL_STAGES` never sees a dispatch, and the discussion pipeline
  carries no `task`. The existing guard cannot host it: `taskToolAuthorizationGuard` returns `null`
  at `:157` when the caller is tawa or root-like, and its only prompt mutation (`:178-181`) sits
  inside the `GENERAL_REPORT_ONLY_CALLERS && targets.includes("general")` branch (`:172-183`), so in
  routed mode the clause would never be written. The unmanaged-actor shortcut at `:219-243` returns before
  the effect, so a dispatch from an actor outside the roster gets no clause and no ring entry; that
  is the existing boundary, and the commit must state it. The effect sees `output.args`, the
  dispatcher session id, and the routing record, which is all the injection needs.
- Emission rule: the effect records every `task` dispatch in the ring with the dispatching session's
  mode, and appends the clause only when that mode is `tawa` and the prompt does not already end
  with the sentinel. The dispatch text lives in one of three keys the tree already reads: `prompt`
  (the precedent at `dispatch-guards.ts:178`), `desc` (`resource-guards.ts:111`), or `description`
  (the fallback at `dispatch-guards.ts:179`). The effect mutates them in that order of precedence —
  the first non-empty one wins — and never writes a second clause into a key the host also
  concatenates. `desc` may be a string or an array (`resource-guards.ts:112-113`); for an array, the
  clause is appended per element and one ring entry is written per element, each with its own
  sentinel. A normal dispatch therefore produces a `normal` ring entry, so its child inherits
  `normal` instead of being reclassified from the child's own text.

This is text, not enforcement. It changes what the child is told, not what it is allowed to do.

### 4.4 The prohibition message

`tawaRedirectGuard` becomes the one place that states both halves:

> Agent "{agent}" cannot invoke @tawa. @tawa reads results and decides the next dispatch.
> Complete what you can, call {allowed targets} with task(), and return your result to your caller.

When `allowedTaskTargetsText` returns a list, the message names it as well (`call @explore or
@general with task()`), because those targets are reachable for that caller and K5 asks the message
to name them. The implementation keeps that branch.

The handoff refusal becomes:

> Agent {agent} cannot hand off to @tawa. Handoffs pass work; results travel back to the caller.
> Complete your work and return the result.

`redirectHandoff` keeps its own shorter message, because it is an administrative override, not an
agent action:

> Redirecting a handoff to @tawa is forbidden. Results return to the caller.

The generic invitation to hand off was removed from messages 2 and 8 after review. "Use handoff for
other agents" promises a path that `handoffSameRole` may close, so the sentence named a route the
caller might not have; that is a K5 violation even when the wording is softer than "use another
agent". Both messages now end at the targets the caller can actually call and at the return path.
Because the old text was pinned by two assertions, `prove-guard-routing.ts` changed in the same
commit: the redirect message must name a reachable target and the return path and must contain no
generic transfer phrase, and the peer message must name the allowed targets and must contain no
`handoff` at all.

### 4.5 Behaviour matrix

| Session | Routing record | Guard addressee | Prompt clause |
| --- | --- | --- | --- |
| tawa root | `tawa`, classified | caller (the user) | emitted on every dispatch in a routed turn |
| child, depth 1 | `tawa`, dispatch (ring; sentinel-only is per message) | caller (tawa) | emitted on its own dispatches |
| child, depth 2-3 | `tawa`, dispatch | caller (the intermediate) | emitted on its own dispatches |
| normal root | `normal`, classified | caller (the user) | none |
| child of a normal root | `normal`, dispatch | caller (the normal root) | none |
| root with an override preference | `normal`, classified, `preferredAgent` set | caller (the user) | none |

Inheritance does not narrow a child's permissions. `tawaRoutingEnforcementGuard`, and the explicit
half of `speculativeDispatchGuard` after migration, block only a record whose `source` is
`classified`, at depth 0 (`resource-guards.ts:84-104`); `tawaRoutingEnforcementGuard` also keeps its
existing `isTawaAgent` exemption. The direct half follows `preferredAgent` / `directAgent`, which is
scoped to the root session and never inherited by a child. A child whose first message matches the
ring with the sentinel, or matches a sentinel-only cold start, carries a `dispatch` record, and
`edit`, `write`, and `bash` stay available even when the child's own prompt quotes the word tawa.
A tawa-mode ring hit without the sentinel is not a match (4.1 rule 1), so it takes the miss path
below. A child that matches neither falls
back to classification; if its prompt names tawa, the message is treated as a routed root and the
tool block applies for that turn — normally the only user turn the child gets. The record itself
stays per message and never latches (4.1 rule 4). The normalized match and the sentinel make that
double miss unlikely, but a miss is logged as a defect, not silently accepted. The rewritten clause
is what makes the common case hold before the migration lands.

The addressee column is constant on purpose. That is what makes the design safe without lineage.

### 4.6 Guard migration checklist

The routing record must replace every guard read of the global flags, not only the message text.
The known sites and their new source:

| Guard | Location | Today | After migration |
| --- | --- | --- | --- |
| `firstResponseGuard` | `resource-guards.ts:21` | `ctx.directRoutingAgent`, plus an agent-name exemption | `record.preferredAgent ?? record.directAgent` |
| `tawaRoutingEnforcementGuard` | `resource-guards.ts:83-90` | `ctx.userMentionedTawa \|\| ctx.userExplicitDispatch` | `(mode === "tawa" \|\| mode === "explicit") && source === "classified" && !isTawaAgent(input.agent)` at depth 0; the tool filter stays `edit`/`write`/`bash` |
| `speculativeDispatchGuard` | `resource-guards.ts:95,101` | `ctx.directRoutingAgent`, `ctx.userExplicitDispatch` | `record.preferredAgent ?? record.directAgent` for the direct half; `mode === "explicit" && source === "classified"` for the explicit half |

The message-updated decisions at `message-updated.ts:182` and `:636` stay on the per-message flags;
they answer "what does this message ask for", not "what is this session's mode".

Migration preserves the one-turn duration: `detectTawaMention` already resets all three flags on
every user message (`message-updated.ts:131-134`). What changes is scope: the decision becomes per
session instead of the shared context, and it is gated on `source: "classified"` so a dispatched
child never blocks. A classified record is per message (4.1 rule 4) and never latches, so the next
plain message reclassifies to `normal` and unblocks. That is the intended semantics of K10, and it
must be stated in the commit. Two conditions keep it safe: the block is depth-0 only
(`resource-guards.ts:85`), and it applies to `classified` records only, so a child whose record
came from a dispatch keeps its tools.

`override.ts:147` also writes `directRoutingAgent`. If the guards stop reading the global without
moving that write, preferred routing dies on the next message. The override must write
`preferredAgent` into the record for `cctx.sessionID` with `source: "override"`. On a fresh record
that write is `{ mode: "normal", directAgent: null, preferredAgent, source: "override", latched:
false }`. Tool calls later in the same turn do not rewrite the record, so both guards honour the
preference. The next user message rewrites `mode`, `source`, and clears `preferredAgent`, which is
exactly the one-turn duration `message-updated.ts:133` produces today. A new override or session
eviction also clears it.

### 4.7 What this deliberately does not do

- It does not allow `task()` or `handoff()` to tawa in any mode.
- It does not add a tool, a message type, or a new permission.
- It does not change `MAX_CALL_DEPTH`, `callDepth`, or host nesting.
- It does not condition any guard on an agent role. The existing exemptions (`dispatch-guards.ts:57`,
  `:142`, `:157`) stay exactly as they are; this plan adds no new role condition.
- It does not make the prompt clause blocking. A child that ignores it still returns its result
  through the normal tool result.
- It does not attach the clause to `handoff`.

---

## 5. Options considered

| ID | Option | Feasible today | Cost | Verdict |
| --- | --- | --- | --- | --- |
| R0 | Rewrite the messages to "return to your caller"; no new state | yes | S | safe, but silent in routed mode |
| R1 | R0 + per-session routing record + prompt clause | yes | M | recommended |
| R2 | `handoff(to: "@tawa", report: true)` | no | M | blocked by the standing owner prohibition on handoff to tawa; lineage exists (`session.created.parentID`) but does not lift it |
| R3 | Dedicated `report` tool | no | M | lineage exists, but a tool that pushes to tawa is a re-dispatch route and K10 forbids it; it also duplicates the `task()` return value |
| R4 | Structured `blocker`/`needs` fields on the tool result | partly | L | the `task` result shape belongs to the host; the plugin authors handoff results itself, so a structured field is feasible there only |
| R5 | `record` entry tagged with the root session, read by tawa later | partly | M | the host key exists in `ToolContext.sessionID` (`src/tool.ts:5`, `src/v2/adapters.ts:84`), but `record` never uses it and `RecordEntrySchema` carries no session field; the root id needs lineage resolution, and the channel is pull, not push |

R2, R3, and R5 are not wrong in principle. R2 and R3 are blocked by K10's prohibition on
returning or re-dispatching to tawa. R5 is not blocked by the host: `ToolContext.sessionID`
carries the host session key, but `record` never reads it, the record schema has no session
field, and the root id needs lineage resolution; the pull-not-push shape is a design choice.
R5 is therefore an implementation gap, not an owner decision. The `experimental.idle` snapshot is
post-hoc — it lists live children after dispatch, not the parent of a child at its first
message — so it does not change the verdict. Lineage is available (2.4), but it only changes the
verdict for R2 and R3 if the owner lifts K10; until then, R1 is the only design that satisfies
K10 without guessing.

---

## 6. Message inventory

Rows 1-14 are already applied in the working tree; the "Current" column records the text before P0,
so their locations are the pre-P0 (HEAD) lines. Rows 15-30 are untouched by P0, so their locations
are the same in both trees. Rows 15-18 and 27-29 are one-line string edits; 19-26 and 30 change
eight role prompts plus the shared `AgentManager` template.

| # | Location | Current | Proposed |
| --- | --- | --- | --- |
| 1 | `dispatch-guards.ts:38` | "use handoff instead of nested task(), or split the task into smaller parts" | "Return your result to your caller so it can decide the next step." |
| 2 | `dispatch-guards.ts:75` | "cannot redirect to @tawa. Complete the task yourself or use task() to another agent." | "cannot invoke @tawa. @tawa reads results and decides the next dispatch. Complete what you can, call {allowed targets} with task(), and return your result to your caller." |
| 3 | `dispatch-guards.ts:103` | "use different agents in the chain, or start a new task for the user" | "Return your result to your caller instead of repeating the call." |
| 4 | `dispatch-guards.ts:116` | same, via handoff | "Return your result to your caller instead of repeating the handoff." |
| 5 | `dispatch-guards.ts:129` | "use handoff for distribution, merge tasks, or start a new task for the user" | "Return your result to your caller instead of opening another branch." |
| 6 | `dispatch-guards.ts:144` | "Use @tawa for distribution." | "Return your result to your caller for distribution." |
| 7 | `dispatch-guards.ts:155, :157` | "cannot use task(). Distribution is via @tawa only." | "Return your result to your caller for any other agent." |
| 8 | `dispatch-guards.ts:159, :161` | "cannot use task(). Distribution is via @tawa only." | "may only call {allowed targets} with task(). Return your result to your caller for any other agent." |
| 9 | `dispatch-guards.ts:182` | "use another agent from the same role (e.g. dev-pickle or dev-mimo)" | "Return what you have to your caller; it will choose a live agent." |
| 10 | `dispatch-guards.ts:187-202` | lists every non-open agent, unfiltered | "Agent {agent} is unavailable. Return your result to your caller so it can choose the next step." |
| 11 | `dispatch-guards.ts:214` | "Try again later or use another agent" | "Return your result to your caller so it can decide the next step." |
| 12 | `i18n/en.json:241` | "cannot hand off to @tawa. Complete the task yourself." | "cannot hand off to @tawa. Handoffs pass work; results travel back to the caller. Complete your work and return the result." |
| 13 | `handoff-service.ts:676` | "Redirecting to @tawa is forbidden." | "Redirecting a handoff to @tawa is forbidden. Results return to the caller." |
| 14 | `resource-guards.ts:22` | "You must produce your analysis first before using ${input.tool}()." | "Produce your analysis first, then dispatch." |
| 15 | `src/tools/override.ts:35` | "Redirecting to @tawa is forbidden. Complete the task yourself or use override(handoffId: …, to: \"@dev\")" | "Redirecting a handoff to @tawa is forbidden. Results return to the caller. Redirect it to a registered agent, or complete your work and return the result." |
| 16 | `src/tools/override.ts:145` | "Preferred reroute to @tawa is forbidden. Use override(to: \"@dev\") for another agent." | "Preferred reroute to @tawa is forbidden. Name a registered agent instead." |
| 17 | `en.json:238`, `ar.json:238` | "cannot hand off to an agent with the same role … Complete the task yourself." | "cannot hand off to an agent with the same role … Return your result to your caller." |
| 18 | `ar.json:241` | stale Arabic mirror of the old `en.json:241` | translate the shipped English sentence from row 12 into Arabic; do not copy the English text |
| 19 | `src/core/agent-data.ts:216` | "Critical rule: complete the task yourself … Do not return the task to @tawa or any other agent." | "Return your result to your caller. You are invoked directly — run the analysis and return the result. If you need reconnaissance, call task() only for @explore or @general, then return." |
| 20 | `src/core/agent-data.ts:223` | "No rerouting: do not use task() to return the task to @tawa or @dev. Complete the analysis yourself and return the result." | "Return your result to your caller. If you need reconnaissance, call task() only for @explore or @general, then return." |
| 21 | `src/core/agent-data.ts:262` | "Critical rule: do not use task() to return the task to @tawa … Implement the task yourself and return the result." | "Return your result to your caller. If you need reconnaissance, call task() only for @explore or @general, then return." |
| 22 | `src/core/agent-data.ts:292` | review variant, "Do not use task() to return the task to @tawa" | same replacement with "run the review" |
| 23 | `src/core/agent-data.ts:322` | design variant | same replacement with "run the design" |
| 24 | `src/core/agent-data.ts:350` | design variant, second copy | "Return your result to your caller. You are invoked directly — run the design and return the result. If you need reconnaissance, call task() only for @explore, then return." |
| 25 | `src/core/agent-data.ts:379` | documentation variant | "Return your result to your caller. You are invoked directly — run the documentation and return the result. If you need reconnaissance, call task() only for @explore, then return." |
| 26 | `src/core/agent-data.ts:179-183` | "Implement the task yourself via edit/bash … Implement the task yourself with the execution tools … return the unfinished item to the dispatcher @tawa" | "Return your result to your caller. Execute the task with the execution tools. If you need reconnaissance, call task() only for @explore or @general, then return." |
| 27 | `en.json:473` | "⛔ @tawa is not allowed to use this tool. Dispatch only — use @analyst or another agent." | "⛔ @tawa is not allowed to use this tool. Dispatch with task() instead." |
| 28 | `en.json:132` | "consider routing the task to another agent" | "consider a narrower task or a later retry" |
| 29 | `src/tools/override.ts:73` | "Use override(handoffId: …, to: \"@dev\") to redirect instead." | "Use override(handoffId: …, to: <a registered agent>) to redirect instead." |
| 30 | `src/context/managers/AgentManager.ts:492-501` | "Execute the task yourself … return the result or the incomplete item to the dispatcher @tawa" | "Return your result to your caller. Execute the task with your available tools; if you need reconnaissance, call task() only for @explore or @general where your role allows it." |

Rows 15-17 were outside revision 2's inventory. Row 15 hardcodes `@dev`, the same unreachable-target
defect the deleted-agent guard fixed; row 16 repeats it on the preference path; row 17 is the last
"complete the task yourself" sentence inside the translation tables. Row 18 is not a new message: it
is the Arabic side of row 12, which P0 updated in English only, and the parity check compares key
sets and placeholder shapes, so the drift passes silently.

Rows 19-26 and 30 carry the same erasure into every session's role prompt. They are not i18n
strings, they are agent instructions: every agent is told to "complete the task yourself" and not
to return the task to tawa. In routed mode that directly contradicts the return path this plan
exists to state. They are the largest remaining surface, and they are why the P0 exit criterion
says "no message" rather than "no guard message". Three of the eight role prompts (`:223`, `:262`,
and the dev block at `:179-183`) use the variants "Complete the analysis yourself", "Implement the
task yourself", and "Implement the task yourself via edit/bash", which is why the gate scans a
phrase list rather than one sentence.

All of rows 15-30 belong to P0's scope. Rows 15-18 and 27-29 are one-line string edits; rows 19-26
and 30 change eight role prompts plus the shared `AgentManager` template and are reviewed separately
as P0b so the diff stays readable, but they ship in the same commit series and the exit criterion
covers both.

Message 6 is the one revision 1 missed. Messages 2 and 8 no longer advertise a generic handoff
path; the proof assertions that pinned the old wording were updated in the same commit.

Message 10 replaced a template variable, so `en.json:556` and `ar.json:556` changed together in P0. If the
team prefers to avoid touching the translation tables, the guard can return a literal instead; the
trade-off is one untranslated string.

---

## 7. Implementation phases

| Phase | Content | Exit criterion | Rollback |
| --- | --- | --- | --- |
| P0 | Rewrite messages 1-18 and 27-29; no new state | `prove-guard-routing` stays green; no message names a role-blind or unreachable target; message 6 is gone from every normal-session path; no string under `src/i18n` or `src/tools` contains any phrase from the erasure list ("the task yourself", "yourself and return", "complete the analysis yourself") | revert the commit |
| P0b | Rewrite the eight role prompts and the `AgentManager` template, rows 19-26 and 30 | the same erasure scan applied to `src/core/agent-data.ts` and `src/context/managers/AgentManager.ts`, whose roles allow `@explore` only where `TASK_PERMISSIONS` does | revert the commit |
| P1 | Add `routing` and the prompt ring to `PipelineState`, classify by content, inherit on a ring hit or a sentinel-only message, latch only a ring-derived dispatch record, keep `preferredAgent` for the turn that wrote it, wire both maps into all three reset sites, migrate the three guards in 4.6, and rewrite `prove-guard-routing.ts:97-108` to seed a record | a two-session concurrency proof shows no bleed for messages and for permissions; a dispatch prompt that quotes tawa keeps its normal parent's mode; a root message that quotes tawa classifies as routed; a `dispatch` record never blocks tools; a REROUTE preference is honoured for the rest of its turn and cleared by the next user message; a routing-only session is evicted by the sweep | record absent = normal mode |
| P2 | Inject the report-path clause and its trailing sentinel from an effect beside `commitCallDepthEffect`, and record the pre-injection prompt in the ring | the clause appears once, only in routed mode, contains no standalone tawa token, trips neither detector, and the emitted prompt ends with the sentinel | clause off |
| P3 | Probe the host and record the R2 decision: lineage is available through `session.created.parentID`, the `subagent` tool requires `prompt`, and `input.agent` is the running agent | decision recorded in 10.1 and 10.3 and in the Section 11 probes; no code change; `prove-report-path` stays green | n/a |

P0 is valuable on its own and should land first. It fixes the death-by-substitution pattern even if
P1 and P2 are never built.

P0 also removes the generic handoff invitation from messages 2 and 8; `prove-guard-routing.ts` was
updated in the same change, so the file and the assertions land together.

Commit split for the current tree, in this order:

| Commit | Content | Why it cannot be split |
| --- | --- | --- |
| C1 | `src/utils/name-utils.ts`, `src/utils/opencode-config.ts`, `scripts/prove-e02.ts`, `scripts/prove-first-boot-seed.ts`, `scripts/shared-parity.json`, `docs/SHARED-PARITY.md`, and the depth note hunk of `TRIAGE.md` | the guard-routing proof asserts `normalizeToolName("subagent") === "task"` (`prove-guard-routing.ts:49`), which only `name-utils.ts` provides; the live-config assertions are skipped when `opencode.json` is absent, so the alias is the real dependency. C1 is otherwise self-contained |
| C2 | messages 1-18 and 27-29 across six source files, rows 19-26 and 30 in `agent-data.ts` and `AgentManager.ts`, `shared/task-targets.ts`, `prove-guard-routing.ts`, the three gate registrations, the regenerated reachability baseline, and every generated number in the docs | the proof, its registrations, and the counted numbers are one atomic step; the baseline is a full regeneration (378 to 379 files) and the new file is counted |
| C3 | this plan and the token-burn dossier | documentation only |

The generated numbers live in five files with twelve `generated:` markers — `AGENTS.md` (1),
`README.md` (1, the skills table), `TRIAGE.md` (2), `docs/validation.md` (6, including the derived
shard and stage timings) and `docs/portable-context-handoff.md` (2). Nine of the twelve move when a
proof file is added; `README.md`'s `skills-table`, `fast-proof-steps`, and `smoke-proof-steps` in
`docs/validation.md` do not. Two files also carry the proof count as plain text: `docs/validation.md:13`
(175) and `docs/release-notes-0.1.0.md` (lines 136 and 138). Both move with the generated numbers. `TRIAGE.md` carries
both a depth note and a count, so it is split by hunk, not by file.

The reachability baseline is not explained by `task-targets.ts` alone: its line count moves by 357
while the new file holds 13 lines, so the baseline is a wholesale regeneration against the current
tree. It still belongs to C2 because the file count (378 to 379) can only match once the new file
exists.

---

## 8. Proof plan

A new `scripts/prove-report-path.ts`, registered in `scripts/gate-manifest.json`,
`scripts/proof-shards.json`, and the pinned catalog. Assertions:

1. A routed root `task` prompt carries exactly one sentinel, on its last line. The same prompt
   dispatched from a normal root carries none.
2. Re-dispatching the same routed prompt in the same session keeps exactly one sentinel.
3. Two concurrent sessions, one routed and one normal, do not exchange modes. A normal session
   whose first message is prefix-identical to a tawa ring entry but lacks the sentinel does not
   inherit; a normal session whose first message ends with a hand-typed sentinel does inherit, and
   the hit is logged.
4. `task(target: "@tawa")` is refused in both modes.
5. `handoff(to: "@tawa")` is refused in both modes.
6. Every **guidance** message produced for a normal session is free of the substring `tawa`.
   Prohibition messages may name it. The proof first asserts the scanned set is non-empty and holds
   a named witness, then pins the exclusion set as equality against a committed prohibition-class
   allow-list with a fixed digest, so a new leak cannot be added to the list silently and an empty
   scan cannot pass. That pin is review protection, not a runtime gate.
7. The new `routing` map and the ring are listed in all three hand-enumerated sites
   (`PipelineState.ts:165-171` collect, `:179-189` evict, `:228-238` `resetAll`). A session
   reachable only through `routing` is evicted once the stale set exceeds `MAX_SESSIONS`, the map
   holds no session the sweep has dropped, and `resetAll` leaves both maps empty.
8. At depth 3, the message still says "caller" and names no agent.
9. With one seeded `tawa` record, the injection effect is reached exactly once for `task` and zero
   times for `handoff`; the handoff recipient is told to complete with `result:`. Moving the
   `task` branch onto the handoff path fails the zero-count half.
10. The emitted clause is rejected by both detectors:
    `TAWA_MENTION_REGEX.test(clause) === false` and `EXPLICIT_DISPATCH_REGEX.test(clause) === false`.
11. The P0 assertions in `prove-guard-routing.ts:1-96` still pass, and the executed assertion count
    equals the committed number: 43 when `opencode.json` is present and 41 when it is absent,
    because the two live-config assertions sit inside an existence check (`:52-59`). A silently
    dropped assertion fails the proof through the count. The two
    global-read blocks at `:97-108` are rewritten in P1, not P0, because they seed the flags the
    migrated guards no longer read.
12. `classifyContent(content)` is a pure exported function and unit-proven: `@tawa` plus a dispatch
    verb yields `tawa`; a dispatch verb without tawa yields `explicit`; a plain message yields
    `normal`. It takes no agent argument, so the 2.5 defect cannot reappear inside it.
13. `resolveRouting(sessionID, content, state)` is unit-proven: a ring hit inherits the parent mode
    with `latched: true` and leaves the entry in place; a second sibling session inherits from the
    same entry; a tawa-mode ring hit without the sentinel does not inherit; a sentinel-only hit
    records `tawa` with `latched: false` for that message; a ring-derived dispatch record survives a
    plain follow-up; a sentinel-only record does not; a classified record does not latch;
    `preferredAgent` is honoured in its own turn and cleared by the next user message.
14. A ring entry matches when the child prompt is the stored prompt plus the clause, including a
    stored prompt of 32-40 characters; a 31-character prompt is never stored and falls back to the
    sentinel.
15. A message in another session does not inherit after the entry's ten-minute TTL expires, and the
    expired entry is removed on the next write or match. A later message in a session that already
    has a record does not inherit from the ring. A live entry evicted by the 64-entry bound is a
    logged miss, not a silent one.
16. No string under `src/i18n`, `src/tools`, `src/core/agent-data.ts`, or
    `src/context/managers/AgentManager.ts` contains any phrase from the erasure list ("the task
    yourself", "yourself and return", "complete the analysis yourself"), and no role prompt under
    `src/core/agent-data.ts` or `src/context/managers/AgentManager.ts` names `@tawa` as a return
    target.
17. Every changed i18n key exists in both tables with identical placeholders. Row 18 requires a
    real Arabic translation of the new sentence, not a copy of the English text. Its value is pinned
    as a SHA-256 digest carried by the proof, because a phrase scan cannot see an Arabic drift and
    AGENTS.md forbids Arabic literals in `.ts`; the digest pins drift only, so the commit that lands
    row 18 also records a native-reader review of the translation.
18. One differential case over three record shapes across six assertions: `{mode: "tawa", source: "classified"}` blocks
    `edit` in an analyst session at depth 0 and allows it in a tawa session; `{mode: "tawa",
    source: "dispatch"}` allows both; `{mode: "normal", source: "classified"}` allows both. Removing
    the `source` check or the `isTawaAgent` exemption fails one half, so the case cannot pass with
    the migration absent.

Items 6, 10, 12-15, and 18 encode K10, the clause constraint, the fail-safe, and the 2.5 finding.
Without them the constraint is documentation, not a gate.

---

## 9. Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| A normal user message mentions tawa in passing and flips the mode | medium | classification is per message and per session; the event is logged; a mention in a root message is the definition of routed mode |
| A child prompt that quotes `tawa` reclassifies the child | low | the ring identifies a dispatch prompt before its text is classified, so a quoted mention inherits the parent's mode instead |
| A user types the sentinel by hand | low | it is honoured only on that session's first message, is logged, and is not latched; that message's own dispatches carry the clause, and their children latch through the ring, so the blast radius is the typed session and its descendants, not concurrent siblings |
| A file name such as `plan-report-path-to-tawa.md` matches the bare-tawa branch of the regex | medium | accepted and unchanged from today: `TAWA_MENTION_REGEX` already matches bare `tawa`, and this plan does not widen it |
| A child inherits routed mode and loses `edit`, `write`, and `bash` | high before `source` was added | the record carries `source`, and the enforcement guard blocks only `classified` records at depth 0 |
| A child prompt matches neither the ring nor the sentinel and names tawa in its body | medium | the double miss is logged as a defect; the normalized match plus the trailing sentinel make it unlikely, and the child keeps its prompt text as the instruction |
| The ring is empty after a restart, so inheritance misses | medium | the trailing sentinel is the cold-start fallback; the closing sentence still carries the instruction as text |
| The child prompt never reaches `chat.message` at all | medium | the closing sentence carries the instruction, and the guard addressee stays constant |
| A sibling session sends a message identical to a stored dispatch prompt | low | entries expire after ten minutes, inheritance applies only to a session's first user message, and every hit is logged |
| A stored prompt is too short and matches too broadly | low | prompts shorter than 32 characters are not stored; the sentinel carries inheritance instead |
| The clause is ignored by the child | medium | it is advisory by design; the tool result still returns |
| Prompt growth per dispatch | low | about 40 tokens plus the sentinel, one per dispatch |
| The routing record grows without bound | high before wiring, low after | list `routing` in `PipelineState.ts:165-171` and `:179-189`, then prove a routing-only session is evicted; until both loops change, the map is unowned |
| The ring is not swept, so expired entries hold slots and can evict a live entry | low | entries are purged on every write and match, the ring holds 64, and an eviction inside the ten-minute window is a logged miss rather than a silent one |
| The sweep evicts a live session mid-tree and drops its `preferredAgent` | low | accepted consequence: the ring can re-inherit routing for a child, but a preference is not re-derivable; the D7 decision records the trade-off |
| The global flags and the record disagree | medium | after P1 the three guards in 4.6 read only the record; a proof asserts the migration |
| The child cannot prove it relays the clause | high | accepted; depth 2-3 depends on the instruction text, not on enforcement |

---

## 10. Decisions (revision 7)

Every question below stayed open through revision 6. A five-agent ballot closed all eight items;
the tally is written per item, with a unanimous item shown as A x 5. The decisions are the design
record; 10.1 and 10.3 carry the isolated evidence.

| Ballot | Question | Decision | Vote |
| --- | --- | --- | --- |
| D3 | Is "caller" acceptable as the only addressee in guard text, given that the plugin cannot print the caller's name? | Keep "caller" everywhere. `input.agent` is the running agent, so naming it would tell a child to return to itself. | A x 3, B x 2 |
| D7 | Should direct routing to a single non-tawa agent count as routed mode? | No. A direct route stays a direct route and never injects the clause or the sentinel. Implemented in P1. | A x 5 |
| D7 | Should `preferredAgent` expire on the next user message, or persist until a new override? | The next user message, which is today's reset at `message-updated.ts:133`. Persisting would make a one-turn override permanent and let a stale preference shadow a later classification. Implemented in P1. | A x 5 |
| D4 | Should the clause be compressed further? | No. Keep the current 190-character, 35-word clause (about 40 tokens) plus the sentinel. Compression saved a few tokens and cost the addressee wording that the tests in 10.1 depend on. | A x 5 |
| D1 | If the host exposes a parent session id, should the sentinel become a fallback and lineage the channel, or the reverse? | The sentinel stays the channel (R1); R2 is not implemented. Lineage is available, but K10 forbids returning or re-dispatching to `@tawa`, so lineage would buy a better log line, not a legal route. | A x 4, B x 1 |
| D7 | Which hook is authoritative for clearing the record: `sweepStaleSessions` alone, or a dispose hook at `hooks-registration.ts:448-454`? | `sweepStaleSessions` alone, plus the ring purge on write and `resetAll`. A dispose hook fires per host session teardown and cannot be ordered against the sweep. Implemented in P1. | A x 5 |
| D5 | Is a handoff-specific completion message enough, or should `handoff` gain a `result` push to `from` in a later change? | The completion message is enough. `completeHandoff` stays completion-result-only, with no push to `from` (`handoff-service.ts:472-508`). | A x 5 |
| D6 | Ring size: 64 entries is a guess. What is the realistic concurrent-dispatch ceiling in a routed tree? | 64 stays. The ceiling is 5 parallel copies x depth 3 = 15 live dispatches, so 64 leaves headroom for diagnostics without a purge on every write. | A x 5 |

### 10.1 The addressee, tested

Policy A (kept): `Return your result to your caller so it can decide the next step.`

Policy B (rejected): `Return your result to tester so it can decide the next step.`

The isolated probe spawned a `tawa` session, dispatched once to `tester`, and had the child
attempt a self-dispatch. The child session ran as `tester`; its parent ran as `tawa`. The guard
that fired named `tester`, the running agent. Policy B would put a child's own name in every
non-tawa session, which is false in the one case the message exists for. Policy A stays true
without reading lineage.

### 10.2 Containment, ratified

Revision 6 found that the host prefixes a native subagent prompt with its own preamble, so a
prefix match on the recorded prompt can never fire. Revision 7 ratifies the revision 6 fix:
`matchPromptRing` normalizes whitespace and case and matches by containment (`includes`), and a
`tawa`-mode entry still requires the sentinel. No further change.

### 10.3 Lineage versus the sentinel

The ballot's minority position was to make lineage the channel and keep the sentinel as a
fallback. It is recorded because the schema supports it and a later owner may lift K10. Until
then, reading `session.created.parentID` would add a subscription the design does not need and a
second source of truth for the same fact.

R3 and R5 are not ballot items. R3 shares R2's K10 block and is discussed in Section 5. R5 is an
implementation gap, not a decision: the host key exists, `record` ignores it, and the R5 probe
receipt records the runtime evidence.

---

## 11. Runtime probes

These are facts the tree cannot answer and that change the design. Revision 5 removed the gate
that revision 2 wanted to probe: the two questions about `input.agent` are answered by
`setup.ts:259` and by the per-session registration at `setup.ts:708-711`, and the design no longer
reads the field. Revision 7 ran the two probes that were still open; both receipts are under
`docs/experiments/receipts/`.

| Probe | Result | Consequence |
| --- | --- | --- |
| Does a child task prompt reach `chat.message` at all? | Yes. The P2 trial found the host prefixes the dispatcher's prompt with `You are a subagent spawned by another session.` The P3 trial reconfirms it: the routed child's stored first user message carries the clause and one trailing sentinel. | Inheritance fires; the ring match is containment, not a prefix match |
| Is `completeHandoff` ever followed by a push to `from` outside this service? | No. `handoff-service.ts:472-508` ends at the completion record, and decision D5 keeps it that way. | Handoff stays excluded from the clause |
| Does the host emit `session.created` with a parent id? | Yes. `parentID` is optional on the event (`@opencode/schema/dist/event-manifest.d.ts:277-330`, `session.d.ts:36`), and `setup.ts:766` already subscribes to raw events. | §2.4's original premise was wrong; decision D1 still keeps R2 out because K10 binds |
| Which `task` arg (`prompt`, `desc`, `description`) becomes the child's user message? | `prompt`. It is a required host argument: a dispatch that carries only `description` fails with `Invalid arguments for tool "subagent": prompt: Missing key` and no child session is created. `description` is a label and is never promoted to the delivered text. The effect still appends to whichever key it finds, so `description` is mutated for hosts and shims that read it. | Mutate all three by precedence (4.3); the delivered prompt is the one that must carry the clause and the sentinel exactly once |

Answered during review, no longer open:

| Question | Answer in this tree |
| --- | --- |
| Does a user-role message ever carry `input.agent`? | No: the bridge forwards it for the assistant role only (`setup.ts:259`) |
| Can `ctx.sessionId` stand in for the host session? | No: it is local and synthetic (`session-manager.ts:44-46`). Tools receive the real key separately as `ToolContext.sessionID` (`src/tool.ts:5`, `src/v2/adapters.ts:84`), which R5 would need and `record` ignores |
| Does `input.agent` name the dispatcher? | No: it names the running agent. The isolated probe in 10.1 shows a `tester` child under a `tawa` parent, and the guard that fired named `tester` |

---

## 12. Change log from revision 1

| # | Change | Found by |
| --- | --- | --- |
| 1 | Added `dispatch-guards.ts:149` to the inventory; it is the loudest live K10 violation | mimo, pickle, deepseek, glm |
| 2 | Added the root-turn gate at `message-updated.ts:589` instead of leaving it in the risk table | glm |
| 3 | The clause no longer contains the word tawa; `TAWA_MENTION_REGEX` matches bare `tawa` too | pickle, deepseek, beam, glm |
| 4 | `handoff` excluded from the clause; `completeHandoff` does not push to `from` | mimo, pickle, deepseek |
| 5 | The generic handoff invitation is removed from messages 2 and 8 (it promised a path `handoffSameRole` may close), and the two assertions in `prove-guard-routing.ts` are rewritten in the same commit | owner review, 2026-11-05 |
| 6 | Proof 7 scoped to guidance messages, with an explicit exclusion list | deepseek |
| 7 | Routing state moved into `PipelineState`; the guard migration checklist is explicit | deepseek, beam, glm |
| 8 | Citations corrected: `:191`, `:80`, `src/validation.ts:84-124`, `tool-execute.ts:587`, 26 call sites versus 41 or 43 executed assertions | mimo, deepseek, glm |
| 9 | Sweep wiring stated explicitly: the map is not pruned automatically, and `pendingAgentLocks` is the live precedent of a map that is evicted but never collected | mechanical audit, 2026-11-05 |
| 10 | The root-turn gate is removed: `setup.ts:259` forwards `input.agent` for the assistant role only, so `isRootUserMessage` is true for every user message. Routing is classified by content instead | deepseek, verified in the tree |
| 11 | Inheritance through the marker: a prompt ending with `[report-path]` writes `tawa` for the child session, so depth 2-3 no longer depends on text alone. Superseded by rows 18-19 | deepseek |
| 12 | R5 corrected: there is no host session key; `ctx.sessionId` is local and synthetic (`session-manager.ts:44-46`) | deepseek, pickle |
| 13 | Messages 15-18 added: `override.ts:35`, `override.ts:145`, `handoffSameRole`, and the Arabic drift at `ar.json:241` | mimo, pickle, deepseek, beam |
| 14 | The commit split is stated as C1/C2/C3, with the reachability baseline and the count cluster in C2 | glm, mimo |
| 15 | Proof items 13-16 added: no routing read of `input.agent`, marker inheritance, the English erasure phrase, and i18n parity | deepseek, mimo |
| 16 | Inheritance does not narrow permissions: `tawaRoutingEnforcementGuard` is depth-0 only (`resource-guards.ts:85`) | owner verification |
| 17 | The record carries `source` (`classified` or `dispatch`), and the enforcement guard blocks `classified` only; `callDepth` is per session and every child starts at zero, so a child that inherited `tawa` would otherwise lose `edit`, `write`, and `bash` | pickle, verified in the tree |
| 18 | The prompt ring is required, not optional: it is the only content-based way to tell a child prompt from a root message | pickle, deepseek |
| 19 | The clause ends with a sentinel line. Revision 3 wrote the tag first and tested `endsWith`, so neither inheritance nor idempotence could ever fire | pickle |
| 20 | A `dispatch` record latches; revision 3 recomputed it per message and lost depth-2 emission on a follow-up | pickle |
| 21 | Rows 19-23 added: `src/core/agent-data.ts` tells every agent to "complete the task yourself" and not to return the task to tawa, in every session. Expanded by row 30 | pickle, verified in the tree |
| 22 | Commit split corrected: the C1 dependency is the `subagent` alias, the live-config assertions are conditional, and the count surface is nine markers in four files plus derived timings. Superseded by row 32 | pickle, verified in the tree |
| 23 | Proof items 13-17 rewritten to be testable; item 16 now names the Arabic drift the parity proof cannot see | pickle |
| 24 | P2 insertion point named as `taskToolAuthorizationGuard`. Superseded by row 25 | pickle |
| 25 | P2 insertion point corrected: the clause is injected from an effect beside `commitCallDepthEffect` (`validation-pipeline.ts:133`), because `taskToolAuthorizationGuard` returns `null` at `:157` for tawa and `:172-183` sits inside the general-only branch | deepseek, verified in the tree |
| 26 | Clause rewritten: "If you dispatch further" trips `EXPLICIT_DISPATCH_REGEX` and would have blocked `edit`, `write`, and `bash` in every child | deepseek, verified in the tree |
| 27 | Record schema gained the `explicit` mode and the sticky `preferredAgent` field; §4.6 maps all three guards | deepseek, pickle |
| 28 | `classified` records never latch, stated once in 4.1 and aligned with §10 Q3 | deepseek |
| 29 | Ring lookup is a prompt-prefix match; the dispatcher session is stored for diagnostics only. Ten-minute TTL, no consume (parallel siblings), first-message-only inheritance, 32-character minimum | deepseek, mimo |
| 30 | Rows 19-26 and 30: `agent-data.ts:223` and `:262` added, the dev block at `:179-183` and `AgentManager.ts:492-501` inventoried, and the replacement permits `@explore`/`@general` reconnaissance instead of forbidding all dispatch | deepseek, verified in the tree |
| 31 | Proof items rewritten with positive witnesses; the old item 11 dropped as subsumed by 18 and the list renumbered; `classifyContent` and `resolveRouting` split; clause-regex, ring-collision, and override-precedence proofs added | deepseek |
| 32 | §2 relabelled as pre-P0 state; §2.4 records the post-hoc `experimental.idle` channel; count surface corrected to twelve markers in five files, nine of which move | deepseek, verified in the tree |
| 33 | The migrated `tawaRoutingEnforcementGuard` keeps `isTawaAgent` and the `edit`/`write`/`bash` filter, so a tawa root does not block itself at depth 0 | mimo, verified in the tree |
| 34 | The P2 effect is registered only in `VALIDATION_PIPELINE`: `isTawaRelated` routes every `task` there (`validation-pipeline.ts:245`), so `ESSENTIAL_STAGES` never sees a dispatch | mimo, verified in the tree |
| 35 | Rows 24-25 narrowed to `@explore`: `TASK_PERMISSIONS` gives `designer` and `doc` only `["explore"]` (`security-policy.ts:97-108`), and `prove-guard-routing.ts:106-108` already pins that distinction | mimo, verified in the tree |
| 36 | Ring consume-once removed: parallel siblings must both inherit. Inheritance is first-message-only with a TTL and a log line; proof 15 and the risk rows updated | mimo, verified in the tree |
| 37 | Proof 6 pinned as set equality; row 11 citation restored to `:214` in the pre-P0 file (the working tree shifts it to `:216` after P0); depth range corrected to `:233-249`; the override record shape is stated explicitly | mimo, verified in the tree |
| 38 | Ring entries with mode `tawa` are honoured only when the sentinel is also present; a prefix match alone cannot latch routed mode in a normal session | glm |
| 39 | §4.5 states the miss path: a child that matches neither the ring nor the sentinel falls back to classification, with the clause as text | glm |
| 40 | Proof 3 covers ring collision and the hand-typed sentinel; proof 6 labels the exclusion pin as review protection rather than a runtime gate | glm |
| 41 | Appendix B corrected: the token-burn dossier's message rule is K5, not D9, and its "unrelated change set" note at `:152` is superseded | glm |
| 42 | Ring matching normalizes whitespace and case; a tawa-mode hit needs the sentinel; every other hit inherits `normal`, so a child never carries `direct` or `explicit` | pickle |
| 43 | The sentinel-only record is per message and does not latch; only a ring-derived `dispatch` record latches | pickle |
| 44 | §4.5 states the double-miss consequence accurately: a child that matches neither source and names tawa is treated as a routed root and keeps the block for that turn, which is normally its only user turn | pickle |
| 45 | The unmanaged-actor shortcut before the P2 effect is documented: such a dispatch gets no clause and no ring entry | pickle |
| 46 | `desc` may be an array; the clause is appended per element with one ring entry and one sentinel each | pickle |
| 47 | Proof 13 covers the sentinel-only non-latch and the tawa-ring-without-sentinel miss; proof 16 extended to `AgentManager.ts` | pickle |
| 48 | Rows 26 and 30 added for the dev block at `agent-data.ts:179-182` and the shared template at `AgentManager.ts:492-497`; Appendix A updated | pickle |
| 49 | Proof 9 made differential: one injection count for `task` and a zero count for `handoff`, so it fails if the branch moves | pickle |
| 50 | Proof 17 pins row 18's Arabic value by SHA-256 digest, because a phrase scan cannot see an Arabic drift and `.ts` may not carry Arabic | pickle |
| 51 | Proofs 18 and 19 folded into one differential case over four seeded records, with a negative half for each condition | pickle, beam |
| 52 | Ring eviction and `preferredAgent` eviction stated as accepted, logged consequences in §9; proof 15 asserts purge on write and match | pickle |
| 53 | The record gained `latched`: `source` alone cannot separate a ring hit (latches) from a sentinel-only hit (per message) | deepseek |
| 54 | `preferredAgent` lifetime corrected to today's one-turn reset: honoured through the writing turn, cleared by the next user message, so an override does not become permanent | deepseek, verified in the tree |
| 55 | The injection effect's field mapping is stated: `prompt` first, then `desc`, then `description`, matching the precedent at `dispatch-guards.ts:178` | deepseek, verified in the tree |
| 56 | `resetAll` (`PipelineState.ts:228-238`) added as the third mandatory sweep edit | deepseek, verified in the tree |
| 57 | Proofs 6 and 11 made falsifiable: a non-empty witness plus a fixed-digest allow-list, and an executed-assertion count check | deepseek |
| 58 | P0b ranges extended to `agent-data.ts:179-183` and `AgentManager.ts:492-501`, so the trailing `@tawa` sentences are covered | deepseek, verified in the tree |
| 59 | §9 states the hand-typed sentinel's real blast radius: the typed session and its descendants, not only one message | deepseek |
| 60 | The record write is placed after both detectors (`:614`, `:615`), and `directAgent`'s write and null reset are stated | deepseek, verified in the tree |
| 61 | §4.5 qualifies the ring-without-sentinel case before claiming tools stay available | deepseek |
| 62 | Proof 7 extends to `resetAll`; proof 16 adds a no-`@tawa` role-prompt assertion; proof 17 labels the digest a drift pin and requires a real translation | deepseek |
| 63 | "Depth assertions" renamed to live-config assertions (`prove-guard-routing.ts:52-59`) | deepseek, verified in the tree |
| 64 | Count surface corrected again to twelve markers in five files: `README.md`'s `skills-table` was missing, and `docs/validation.md` carries six, not five | pickle, verified in the tree |
| 65 | Final citation pass: `preferredAgent` wording aligned in §7 with the one-turn rule; `dispatch-guards.ts:178/179` split; `resetAll` range `:228-238`; unmanaged-actor range `:219-243`; `:133` reset; message 10 moved to past tense; executed-assertion count corrected | pickle, verified in the tree |
| 66 | Section 2 and the applied Section 6 rows re-cited to HEAD; rows 7-8 replaced with the real pre-P0 sentence ("cannot use task(). Distribution is via @tawa only." at `:155/:157` and `:159/:161`), which revision 5 had misquoted; Appendix A declared working-tree; proof 18's record count corrected | deepseek, verified in the tree |
| 67 | Row 2's Current text restored to the real pre-P0 sentence at `:75`; row 14 moved to pre-P0 `:22` with its real sentence; §2.2 now lists ten messages, including `:75`; the count surface includes `docs/validation.md:13` as plain text | deepseek, verified in the tree |
| 68 | Citation audit against both trees: row 7 corrected to pre-P0 `:155/:157`; the circuit-breaker guard restored to pre-P0 `:187-202`; §2.5's depth check set to pre-P0 `:84`; §4.1's depth read set to working-tree `:37`; §4.3's prompt mutation re-cited to working-tree `:178-181` inside `:172-183`; Appendix A's circuit-breaker, prompt, and depth rows re-read from the working tree, and its substitute-agent label renamed to guard message sites | deepseek, verified in the tree |
| 69 | Revision 7 closes all eight ballot items in §10: D3 A x 3 / B x 2, D1 A x 4 / B x 1, all others A x 5 | five-agent ballot, 2026-11-05 |
| 70 | §2.4 corrected: `session.created.parentID` exists and `setup.ts:766` subscribes to raw events; R2 stays out because K10 binds, not because lineage is missing | deepseek, verified against the host schema |
| 71 | §7 P3 is a recorded decision, not a code phase; the exit criterion is the decision plus a green proof | ballot D1 |
| 72 | §10.1 records the addressee probe: a `tester` child under a `tawa` parent, the guard naming the running agent, and policy B rejected | isolated P3 trial, 2026-11-05 |
| 73 | §11 records the argument probe: `prompt` is required, a `description`-only dispatch is refused before a child exists, and `description` is never promoted to the delivered text | isolated P3 trial, 2026-11-05 |
| 74 | §10.2 ratifies revision 6's normalized containment and keeps the sentinel requirement on a tawa-mode ring hit | ballot D2 |
| 75 | R5 rationale corrected: `ToolContext.sessionID` is a host key, so R5 is an implementation gap (`record` ignores the key, the schema has no session field, the root needs lineage) and not an owner decision. The P3 row now cites 10.1 and 10.3, §10.3 lists R3/R5 as non-ballot items, and §11 separates `ctx.sessionId` from the host key | five-agent review, `eval-4f55d759`, R5 probe receipt |

Every claim added in revision 5 was re-read in this tree before it was accepted. The review behind
revision 2 recorded only two evaluations for five agents; revisions 3-5 findings that could not be
reproduced from the source were dropped rather than cited.

Revision 1 also called "handoff has no return path" a consensus. It was not: three reviewers said
no return path, two said the host guarantees it. Reading `handoff-service.ts:472-510` settles it in
favour of the first three.

---

## Appendix A — Code map

Line numbers are read from the working tree at revision 5, which is the tree an implementer edits.
Section 2 and the applied rows of Section 6 use pre-P0 (HEAD) lines instead, because their "Current"
column quotes pre-P0 text; the two bases differ by the P0 shifts.

| Concern | File | Lines |
| --- | --- | --- |
| Tawa invocation block | `src/hooks/guards/dispatch-guards.ts` | 53-81, message at 80 |
| Guard message sites | `src/hooks/guards/dispatch-guards.ts` | 39, 108, 121, 134, 149, 163, 169, 191, 216 |
| Circuit-breaker fallback | `src/hooks/guards/dispatch-guards.ts` | 196-204, call at 200; text at `en.json:556` |
| Prompt mutation precedent | `src/hooks/guards/dispatch-guards.ts` | 172-183 |
| Depth semantics | `src/hooks/guards/dispatch-guards.ts` | 30-42, 235-251 |
| Root-like exemption | `src/hooks/guards/dispatch-guards.ts` | 57, 142, 157 |
| Handoff tool block | `src/tools/handoff.ts` | 762-764 |
| Handoff redirect block | `src/services/handoff-service.ts` | 675-676 |
| Handoff completion | `src/services/handoff-service.ts` | 472-510 |
| Handoff refusal text | `src/i18n/en.json` | 241 |
| Routing flags | `src/context-class.ts` | 125-127 |
| Global context proxy | `src/bootstrap/hooks-registration.ts` | 189-206, dispose 448-454 |
| Flag reset and write site | `src/hooks/message-updated.ts` | 131-139, 614 |
| Root-turn gate (ask channel only, not routing) | `src/hooks/message-updated.ts` | 589 |
| Chat-message bridge and agent forwarding | `src/v2/setup.ts` | 232-259, registration 708-711 |
| Local session id | `src/context/session-manager.ts` | 44-46 |
| Residual erasure messages | `src/tools/override.ts` | 35, 73, 145 |
| Role prompts that erase the return path | `src/core/agent-data.ts` | 179-183, 216, 223, 262, 292, 322, 350, 379 |
| Shared role-prompt template that erases the return path | `src/context/managers/AgentManager.ts` | 492-501 |
| Clause injection effect (P2) | `src/hooks/validation-pipeline.ts` | 133, beside `commitCallDepthEffect` |
| Prompt ring and routing map | `src/hooks/PipelineState.ts` | 16-29, sweep 165-189 |
| Explicit and direct detection | `src/hooks/message-updated.ts` | 131-170 |
| Post-hoc idle channel | `src/v2/setup.ts` | 720-725 |
| Same-role refusal | `src/i18n/en.json`, `src/i18n/ar.json` | 238 |
| Arabic mirror of the handoff refusal | `src/i18n/ar.json` | 241 |
| Depth-0 exemption | `src/hooks/guards/resource-guards.ts` | 85 |
| Mention regex | `src/hooks/message-updated.ts` | 53 |
| Direct routing write sites | `src/hooks/message-updated.ts`, `src/tools/override.ts` | 161, 147 |
| Guard global reads | `src/hooks/guards/resource-guards.ts` | 21, 83-90, 95, 101 |
| Current agent helper | `src/hooks/guards/shared/normalize.ts` | 28 |
| Role resolution | `src/utils/agent.ts` | 26-40 |
| Target helper | `src/hooks/guards/shared/task-targets.ts` | 9-13 |
| Task tool set | `src/security-policy.ts` | 14 |
| Breaker failure recording | `src/hooks/tool-execute.ts` | 587 |
| Per-session state and sweep | `src/hooks/PipelineState.ts` | 16-29, 142, 165-171, 179-189 |
| Handoff schema | `src/validation.ts` | 84-124 |

## Appendix B — Relationship to the token-burn plan

`docs/plan-token-burn-control.md` states the message rule as K5 (`plan-token-burn-control.md:28`)
and mentions the uncommitted guard-message change set at `:152`, where it calls that set unrelated
and asks for it to be committed first. This plan supersedes both notes: the message rewrite is P0
here, not an unrelated change, and it is the prerequisite for the token-burn work rather than the
other way round.

The two documents share one conclusion: a guard that answers every block with "use another agent"
is a fan-out driver. The token-burn plan bounds the resulting burn with a ledger; this plan
removes the instruction that creates the branch in the first place.

Read K5 in the token-burn dossier together with K10 here:

- K5: a failure message names only targets the caller can actually reach.
- K10: a failure message directs the report to tawa only in routed mode.

Together they say: name what can be called, and name where the result goes, but never confuse the
two.
