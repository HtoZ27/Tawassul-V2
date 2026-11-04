# Portable Context Handoff — Implementation Plan

Status: REVISION 7 — 2026-10-30. REVISION 7 removes the role restriction:
`thread` is available to every agent. The transport decision from REVISION 6
stands after the independent isolated re-run on host 2.2.2 (section 10): the
`context` hook carries the persistent layer, `prompt({ text, files })` carries
the transfer, and `synthetic` is not used for injection. One unit, no phases.
Implemented in full; 15 feature proofs pass across the fast, proofs and smoke
gates, with the release-path eval stage kept separate.
Repository: `<workspace>`
Scope rule: one unit. No phases, no MVPs, no per-agent slices.

Delivery is complete only when all three paths work together: agent to agent,
model to model, and continuation of an earlier thread. A partial delivery is a
failed delivery.

---

## 1. Contract

1. Accounting is isolated: `1 token = 1 UTF-8 byte`, measured with
   `Buffer.byteLength(s, "utf8")`. Never reuse the 0.25/0.4 factors and never
   `SESSION_HARD_CEILING_TOKENS = 90k`. Never slice text by byte; selection
   operates on whole messages only, so no codepoint is split.
2. `W` resolves from `ctx.model.list().data[].limit.context`, then the pricing
   table, then 128000. The list envelope is `{ location, data }`; read `data`.
   Measured on 2.2.2: a provider declared in `opencode.json` appears in the list
   with its configured `limit.context` (a 128000 declaration was returned as
   128000), so provider-declared limits do reach the plugin. The open caveat
   (#56023) is the top-level `models[]` override path only; treat a model that
   is absent from `data` as unknown. Treat any value below 128000 as unknown and
   fall back to 128000; never trust a limit above what the pricing table
   confirms.
3. `reserve = min(max(16000, floor(W / 4)), floor(W / 2))`.
4. `room = W - reserve - requestBytes`; `budget = min(64000, room)`. If
   `budget < 1024` the request overflows. No ambiguous `clamp` form.
5. A pack is at most 64000 bytes on disk in total: 2048 bytes of envelope and at
   most 61952 bytes of selected text. The 64KB limit is internal policy. The
   host `instructions.entry` cap is 262144 bytes
   (`MaxValueBytes = 256 * 1024` in `@opencode/schema/dist/instruction-entry.js:20`),
   but instruction entries are not used for pack content.
6. The first request is pinned only when it fits next to the current
   request; the current request is never truncated.
   Attachments are never copied into a pack, but they are charged to
   `requestBytes` at 8192 for an image and 4096 for any other attachment. On
   the transfer path they are replayed as `prompt.files`, so no attachment is
   lost.
7. Outbound history is rewritten only on measured overflow. A provider change
   alone never justifies discarding history.
8. Turn-boundary integrity: never split a tool call from its tool result, never
   touch the last message, never inject when the array ends in a tool result.
   This rule governs the `context` hook, which is the only injection path.
   An injected message must be
   `{ role: "user", content: [{ type: "text", text }] }`. A string `content`
   aborts the request with `E.content.map is not a function`.
9. Packs are content addressed: the filename is the digest. Writes go through
   `atomicWriteFile` from `src/infra/disk-utils.ts:8` (tmp 0600, fsync, rename,
   directory fsync, no `.bak` siblings). The digest is verified on every read.
10. Injection is idempotent by digest, and the check is O(1). The hook cache is
    warmed outside the handler with `{ sessionID, digest, message, alreadyPresent }`.
    `alreadyPresent` is decided once at warm time, by looking for the digest in
    the session's stored messages; when the host cannot read history, the pack's
    `transferredTo` list is the fallback. It is never decided per request. A
    transferred successor whose history no longer carries the digest returns to
    `alreadyPresent: false` on the next refresh, so compaction cannot erase the
    pack. The handler appends the cached message only when `alreadyPresent` is
    false, no `revoked` tombstone exists and the message is not already in this
    request's array. There is no message id, no cross-session collision and no
    `Session.SyntheticConflictError`, because the pack is never stored as a host
    message.
11. An HMAC claim binds the pack, the target `sessionID`, the agent, the
    `handoffId`, the `parentID`, the worktree directory, `issuedAt`, `expiresAt`
    and a `nonce`. The claim is minted with the existing HMAC key file; no new
    secret. Minting must refuse the sentinel key.
12. Sanitization chain: `sanitizeOutput`, then `escapeGoalText`, then
    `wrapUntrusted`. Pack content is data, never instructions, and the envelope
    states this explicitly.
13. Any failure fails closed to the checkpoint text plus an explicit
    "pack unavailable" notice.
14. One kill switch: `innovations.contextHandoff.enabled = false` or
    `TAWASSUL_CONTEXT_HANDOFF=0`. The key is added to `config-schema.ts` and
    `context/types.ts`. `src/bootstrap/plugin-init.ts` remembers the loaded
    config, so the event, failure, warm-up and tool paths honor the switch after
    boot; the env var overrides the config in both directions.
15. Retention: 200 packs, 50MB total, 14 days. Garbage collection order:
    reference liveness from persisted state, then age, then bytes, then count.
16. The system never selects, suggests or switches a model or an agent. See
    section 7.
17. Two transports, and neither is `synthetic`:
    - The persistent layer is the `context` hook. It appends the prebuilt
      message `{ role: "user", content: [{ type: "text", text }] }` to
      `messages` on every request and never stores it. It is passive, it does
      not trigger a model turn, and it survives compaction by construction
      because there is nothing stored to lose.
    - The transfer is `ctx.session.prompt({ sessionID, text, files })` on the
      successor session, with the pack attached as a file. It is a normal turn
      by design, and it needs no persistence.
    No pack content goes into `instructions.entry`: that is an instruction
    channel and would violate item 12. `ctx.session.context({ sessionID })` is
    eventually consistent and is not a verification channel for injection.
18. Automatic pack on terminal failure is write-only: no `session.prompt()`,
    no new session, no re-submission. It runs on `session.step.failed` with a
    terminal error class and records `retryAfterMs` as "not before".
19. Pack storage is `$XDG_DATA_HOME/tawassul/context-packs/<workspace-hash>/`
    with `packs/`, `ledger.jsonl` and `lock`. Not `stateDir`, not `.opencode`,
    not tmpdir. The workspace hash is `sha256(realpath(worktree)).slice(0, 16)`.
20. Cross-process writes and GC take an exclusive `lock` file in the pack root
    (create with `wx`, stale after 30s, owner PID recorded). The in-memory
    `HandoffService._withLock` is not a substitute.
21. The injection hook is O(1): no filesystem call, no HMAC verification, no
    sanitization, no digest computation, no `ctx.session.*` call, and no
    serialization inside the handler. The rendered message is built once when
    the pack is written and cached by `sessionID + digest`. Budget: p95 handler
    time at or below 2 ms with a 64000-byte pack. Any read or verify in the hook
    is a defect, not a tuning choice.
22. The pack bytes are part of every subsequent request, because both transports
    carry them. That token cost is inherent and is charged once per request by
    the host, not by the plugin. It is the only unavoidable cost of the design.

---

## 2. Execution order

Transport note: the decision is made. The persistent layer is the `context`
hook (passive, no stored message, no model turn); the transfer is
`prompt({ text, files })` on the successor session. `synthetic` and
re-injection are rejected designs (section 6).

Runtime path A, handoff and continuation:

1. `src/tools/thread.ts` — `continue` resolves the source session and
   worktree, read-only.
2. `src/tools/handoff.ts:750` — the tool writes `ctx.handoffs` directly, so the
   pack write goes through `attachPackToHandoff`, which calls `createPack` and
   takes the pack `lock`: accounting, selection, render, `store.write`, then
   state save.
3. `src/hooks/message-updated.ts:340` — `acceptHandoffs` at `:297` activates the
   pack for the session: render once, cache by `sessionID + digest`, and suppress
   checkpoint bullets when a live pack exists. It does not call `synthetic` and
   does not write a message. Without a pack it emits the bullets plus the failure
   notice.
4. The `context` hook reads the cache and appends the rendered message. Warm-up,
   activation, transfer, compaction, revocation and failure are recorded in
   `ledger.jsonl`, which outlives the packs and is capped at 5000 lines with
   rotation. The handler itself never writes.

Runtime path B, outbound overflow:

5. `src/v2/setup.ts:562` — the `context` hook is registered unconditionally. It
   runs `runChatMessageBridge` first when a `chat.message` hook exists, then
   `handleContextEvent`, which appends the cached pack synchronously. It never
   creates a session and never prompts.
6. The transfer is owned by `src/tools/thread.ts:49` (`continue`), not by the
   hook. It reads the source history through `src/v2/session-bridge.ts:18`,
   measures with `planOutbound`, and returns a within-budget answer without
   touching history when `budget >= 1024`.
7. On measured overflow, `transferOverflow` calls
   `ctx.session.create({ title, model?, agent?, metadata })` on the model and
   agent the caller chose, writes the pack from the retained tail under the
   successor's 64000-byte cap, then calls
   `ctx.session.prompt({ sessionID, text, files, delivery })` once. `files` are
   the current request's attachments plus the pack file. The prompt shape is
   flat; the nested `prompt: { text, files }` form is the session.prompt hook
   payload and fails with `Missing key at ["text"]`. Attachments are replayed,
   not copied. Never `fork`. This is a fresh session, not a re-submission into a
   failed one.
8. The source message array is never mutated, and the source checkout is never
   written (`prove:thread-tool` asserts both). `markPackTransferred` records the
   successor in the pack record and the index before the transfer is reported.

Runtime path C, compaction:

9. Subscribe to `session.compaction.ended` through `ctx.event.subscribe` and
   record the event. No re-injection is needed: the hook re-appends the pack from
   the cache on the next request, so compaction cannot remove it. The cache is
   warmed outside the request path — at activation, at plugin setup for every
   session with a live pack, and again on `session.compaction.ended`. A handler
   cache miss therefore means the pack was revoked or collected: the handler
   returns without appending and never touches the disk (contract item 21).

Runtime path D, cancellation and retention:

10. Cancel before injection: unlink the pack, clear the field, append the ledger
    entry.
11. Cancel or undo after injection: keep the pack, write a `revoked` tombstone.
12. Rescue: the pack stays readable by the successor.
13. Garbage collection: write the tombstone before any unlink.

Disk write order:

`src/tool-names.ts`, `src/v2/types.ts`, `src/context/types.ts`,
`src/validation.ts`, `src/context/config-schema.ts` (the state version stays 5;
the new handoff fields are optional), `src/services/context-pack/*`, the hooks,
`src/v2/session-bridge.ts`, `src/tools/thread.ts`, `src/tools/index.ts`,
`src/bootstrap/*`, the scripts, the docs.

---

## 2.1 Activation, revocation and roles

Index ownership: `createPack` writes the pack file and the ledger entry only.
The session index (`sessions.json`) is written by `activatePack` and
`markPackTransferred`. A pack that is created and never activated carries no
index entry, so garbage collection treats it by age, bytes and count.

One active pack per session: `warmInjection` deletes every other digest cached
for that session before inserting the new one. A session therefore never holds
two warm packs, and an outbound transfer replaces the cache rather than adding
to it.

Activation is idempotent by digest: activating the same digest again keeps the
original `activatedAt` and does not duplicate anything. Activating a different
digest replaces the index entry and the warm cache. A pack that is revoked or
expired is refused (`readPackRecord` is called without `allowRevoked` or
`allowExpired`), so a tombstoned digest can never be injected again. The hook
drops a stale cache entry on any activation failure.

`thread pack` is idempotent for a live pack: packing the same handoff, or the
same session without a handoff, returns the stored digest and does not rebuild
the pack or duplicate the preview block in `entry.context`. The preview is
stripped before a new block is appended, and it is stripped when the pack is
revoked.

Revocation has two states:

- Before injection (never warmed, never transferred, not in the injection
  cache) the revocation is destructive: it deletes the pack file and requires
  `confirm: true`. Without the confirmation the tool reports what would happen
  and changes nothing. `removed: true` is returned only when the unlink
  succeeded or the file was already gone (`ENOENT`); any other unlink failure
  is reported as `removed: false` with an explicit `error`.
- After injection (warmed, transferred or currently cached) the revocation is
  additive: it writes the tombstone, retains the index entry with
  `revoked: true`, and stamps `revokedAt` into the pack record. The record
  marker keeps the digest refused even if a later activation replaces the
  session's index entry. It needs no confirmation and the file stays readable
  for audit.

A revoked digest is never activated or injected again, but `list` and `read`
still show it so the audit trail is inspectable.

Roles: `thread` is available to every agent, including read-only roles and host
agents outside the Tawassul roster. It creates sessions on the `continue` path
and can delete pack files on the `revoke` path; availability is not role-gated,
so those effects are documented explicitly. No retired v1 precedent exists for
sharing persistent pack state with read-only roles.

---

## 3. Files

| File | Change |
|---|---|
| `src/services/context-pack/{types,accounting,select,render,store,claim,hook,outbound,lock,index}.ts` | Ten new modules |
| `src/tools/thread.ts` and `src/tools/index.ts` | `list`, `read`, `continue`, `pack`, `revoke`; `continue` runs the transfer through the bridge |
| `src/v2/session-bridge.ts` | One active bridge over `ctx.session` and `ctx.model.list`; installed at setup, cleared at cleanup |
| `src/tool-names.ts` | 44th tool (`task_control`) |
| `src/utils/permission-rules.ts:44` and `src/scripts/gen-opencode-config.ts:358` | The permission key is derived automatically from `TAWASSUL_TOOL_NAMES`; no separate literal |
| `src/tools/handoff.ts:750` | Build the pack and preview 2KB in `entry.context`; `attachPackToHandoff` writes through `createPack`, which takes the pack lock |
| `src/hooks/message-updated.ts:340` | Pack activation and checkpoint-bullet suppression; no message write |
| `src/v2/setup.ts:283,367,562,575` | Failure and compaction events, bridge install plus warm-up, unconditional context hook (chat bridge then injection), retry veto |
| `src/v2/event-adapter.ts` | Translate `session.step.failed` and `session.compaction.ended` |
| `src/v2/types.ts:61` | Widen `V2Session`: `create`, `prompt({ sessionID, text, files?, delivery? })`, `context({ sessionID })`, `wait({ sessionID })`, `model.list()`. No `synthetic`, `export`, `import`, `fork`, `switchModel`, `switchAgent` |
| `src/context/types.ts:36` | `contextPackId`, `contextPackDigest`, `contextPackActivatedAt`, `parentID` |
| `src/context/config-schema.ts:100` and `src/context/types.ts:134` | `innovations.contextHandoff.enabled` |
| `src/context/constants.ts:7` | No `STATE_VERSION` bump (stays 5); the four pack fields are additive and optional |
| `src/validation.ts:91` | `.optional()` for the new fields, otherwise `safeParse` strips them silently |
| `src/bootstrap/{tool-registry,service-factory,plugin-init}.ts` | Registration; `plugin-init` remembers the loaded config for the runtime kill switch |
| `scripts/release-smoke.sh:124,146,177,178,193,197,199`, `scripts/prove-e27.ts:40`, `scripts/prove-independence-boot.ts:144`, `scripts/prove-global-boot.ts:224,225,267,268,292,293,313` | Tool count 42 to 43. Sixteen lines across four files, not eleven |
| `scripts/gate-manifest.json` | <!-- generated:proof-steps -->156<!-- /generated --> proofs-stage steps; <!-- generated:proof-files -->159<!-- /generated --> proof files across the three stages |
| `package.json`, `ISSUES.md`, `.opencode/feature-index.json` | Scripts, issue record, index |

---

## 4. Proofs

| Proof | Invariant |
|---|---|
| `prove:context-accounting` | 1 equals 1 byte, `Buffer.byteLength`, Arabic and CJK text stay intact |
| `prove:context-selection` | First request pinned, current request whole, turn boundaries intact |
| `prove:context-budget` | Reserve and budget never go negative at W=96k and W=8k; `room` and overflow boundary |
| `prove:context-store` | Atomic write, 0600, dir fsync, digest on read, 64000 total, 2048/61952 split, GC order, record tombstones |
| `prove:context-claim` | HMAC rejects on any bound field, refuses the sentinel key, enforces `expiresAt` |
| `prove:context-inject` | Hook appends `{ role: "user", content: [{ type: "text", text }] }`, dedupes by digest, tombstone blocks, no double injection with checkpoint |
| `prove:context-transport` | The persistent layer is the hook and stores nothing; the transfer is a flat `prompt({ sessionID, text, files })`; no `synthetic` call; no `instructions.entry` write |
| `prove:context-hook-latency` | p95 handler time at or below 2 ms with a 64000-byte pack; zero filesystem, crypto or session calls inside the handler |
| `prove:context-hook-idempotent` | One active digest per session, exactly one append per request, and the pack survives compaction without re-injection |
| `prove:thread-tool` | Five actions, digest validation, idempotent pack, revoke confirmation, read truncation, and no mutation of the source checkout |
| `prove:model-switch` | No rewrite without measured overflow; overflow uses `create` then a flat `prompt({ sessionID, text, files })`, never `fork` |
| `prove:context-bridge` | Splice not reassignment, no second bridge entry, dedupe does not swallow the injection |
| `prove:context-revalidate` | `session.compaction.ended` is recorded and does not re-inject; a transferred pack that survived stays put and one that vanished returns once |
| `prove:context-failure-pack` | Write-only on `session.step.failed`; no prompt, no new session; `retryAfterMs` recorded |
| `prove:context-kill-switch` | Config key and env var both disable every path |
| `prove:context-sanitize` | Chain order, envelope delimiters, no instruction text escapes |

Then `npm run verify` and `gate:smoke`.

---

## 5. Risks

| Severity | Risk | Mitigation |
|---|---|---|
| Critical | Tool count drift across 16 lines in four files plus the manifest | Single source of truth, grep every `\b42\b` under `scripts/` |
| Critical | `setup.ts:502` blocks hook registration | Registered unconditionally; `prove:context-bridge` covers a plugin with no `chat.message` hook |
| Critical | The bridge mutates in place and dedupes | Splice only, run after it, never re-enter |
| Critical | `tools/handoff.ts:750` writes `ctx.handoffs` without a pack lock | `attachPackToHandoff` writes through `createPack`, which takes the pack lock |
| Critical | Sentinel HMAC key is public and returned in isolation | Refuse to mint, fail closed |
| High | Double injection: checkpoint plus pack | Suppress bullets when a live pack exists |
| High | Reserve and cap collision produces a negative budget | `room` and `budget` formula with an explicit overflow boundary |
| High | UTF-8 split mid-codepoint | Measure by bytes, select by message |
| High | A new HMAC secret breaks the existing contract | Reuse the existing key file |
| High | Claim replay across worktrees | Bind directory, `issuedAt`, `expiresAt`, `nonce` |
| High | Model limit override does not reach plugins (#56023) | Treat sub-128000 limits as unknown |
| High | Quota error misclassified as auth/JSON (#50352) | Tolerate multiple error types, never one literal |
| High | Pack content treated as instructions | Hook appends a data message; no `instructions.entry` |
| High | Blind re-injection from the pre-summary hook | Rejected: the hook re-applies per request, nothing is stored |
| High | `synthetic` costs a model turn and compaction deletes it (measured) | Rejected: `synthetic` is not an injection path |
| High | Hook work grows with pack size or session age | O(1) cache lookup; `prove:context-hook-latency` enforces the 2 ms budget |
| High | A slow hook delays every agent turn (v1 regression) | No filesystem, crypto, sanitization or `ctx.session.*` inside the handler |
| Medium | Garbage collection erases the tombstone with the pack | Tombstones live in the jsonl ledger |
| Medium | Reference to a missing pack | Fail closed, warn, quarantine |
| Medium | `fork` reintroduces the overflow | `create` only |
| Medium | Plugin silently unloaded after double config reload (#60229) | Health check plus persisted lock |
| Medium | Rejected compaction truncates history and clears undo (#57553) | Never mutate the source session |
| Medium | Unbounded recent context in compaction (#60391) | Pack size fixed by us, not by host |
| Medium | Ledger grows without bound | 5000 lines plus rotation |
| Low | GC during a write window | Pack-directory lock, skip live tmp siblings |
| Low | Downgrade strips new fields silently | The fields are additive and optional; an older reader drops them on the next save. Documented here; no migration is written because v2 is the only runnable plugin |

---

## 6. Rejected designs, recorded so they are not proposed again

- Splitting the feature into phases, MVPs or per-agent slices. Rejected by the
  owner. Do not re-propose.
- `FALLBACK_CHAINS` as an input to this feature, as a decision, as a suggestion,
  or as display order. Rejected by the owner.
- Any automatic model or agent switch on provider death.
- Any list of candidate models presented by the system.
- A new HMAC secret.
- Pack storage in raw `stateDir`, in `.opencode`, or in tmpdir.
- Auto-retry past the built-in attempt cap. The cap is a hard limit the plugin
  cannot raise (#60122, #54862); #59448 (env-tunable) is not merged. Retry
  past the cap is impossible on 2.2.x.
- Re-submission into the same session after a terminal failure. It duplicates
  user messages and drops attachments (#60122). A fresh `create` plus
  `prompt({ text, files })` is a different operation and is allowed.
- Pack content in `instructions.entry`. It is an instruction channel and
  violates contract item 12; it also has no provenance in the context hook
  (#60008).
- Re-injection from `experimental.session.compacting`. It runs before the
  summary and cannot observe a vanished message.
- Seeding a new session from the summary only. Compaction retains a recent tail
  verbatim; the tail must be included (#40578).
- `synthetic` as the injection transport. Measured on 2.2.2: it stores a host
  message, the host answers it with a full model turn, and compaction deletes
  it (17 messages down to 2). Keeping the pack alive therefore means one extra
  turn after every compaction, forever. Rejected after the transport decision in
  section 10.
- A re-injection engine, an injection ledger keyed by message id, a tombstone
  ledger, and `sha256(sessionID + "\0" + digest)` id derivation. All four exist
  only to serve persistent `synthetic` injection, so they fall with it.
- Scheduling any write, read, verify or `ctx.session.*` call inside the
  `context` hook. The hook is on the critical path of every request; anything
  beyond a cache lookup reintroduces the v1 slowness (contract item 21).

---

## 7. Provider death — settled 2026-10-30

1. **Transport.** Two layers, neither of them `synthetic` (contract 17). The
   persistent layer is the `context` hook, which appends the rendered pack and
   stores nothing, so compaction cannot remove it. The transfer is a flat
   `prompt({ sessionID, text, files })` on the successor session. The hook is
   O(1) and holds no I/O (contract 21). `instructions.entry` is not used for pack
   content (#60008), and the resume path (#58572) is covered because the hook
   runs on every assembly, including a resumed one.
2. **Retry policy.** The retry hook is terminal-only: it vetoes retries for
   quota and provider-death classes and sets no retry. It never attempts to
   extend the built-in cap, which is impossible (#60122, #54862). The cap is
   version dependent (upstream cites five and ten attempts); treat it as
   unverified for 2.2.2.
3. **Automatic pack on terminal failure.** Optional, write-only. Triggered on
   `session.step.failed` whose `error.type` is a terminal class. No
   `session.prompt()`, no new session, no re-submission. `retryAfterMs` is
   recorded as "not before" instead of a blind delay.
4. **Host floor.** `>=2.2.1 <3.0.0`. Version 2.2.2 ships no change relevant to
   this feature: the SDK differs only in `host-apis.d.ts`, and neither #54862
   nor #47685 is fixed. Keep 2.2.1.

Terminal error classes: `provider.free-limit`, `provider.quota`,
`provider.go-limit`, `provider.chatgpt-limit`, `provider.budget-limit`,
`provider.model-budget-limit`, `provider.auth`, `provider.no-route`, plus HTTP
402 and the OpenAI billing codes (`insufficient_quota`,
`billing_hard_limit_reached`, `billing_not_active`, `account_deactivated`) and
Google `QuotaFailure`. Classification must not depend on a single `type`
string, because quota errors surface as `Authentication` or `not valid JSON`
(#50352).

Constraint that survives any future decision: the system does not choose, rank
or suggest a model. Choosing the model belongs to the owner.

---

## 8. Upstream evidence (GitHub, 2026-10-30)

| # | Title | State | Relevance |
|---|---|---|---|
| #60122 | plugins: session retry hook cannot outlast the built-in attempt cap | closed (dup) | Hard cap confirmed; workaround defects documented |
| #54862 | call the session.retry hook when built-in retries run out | open | Canonical request for cap extension |
| #59448 | make the model retry budget configurable via env | open (PR) | 10 attempts, <=10s, ~84s; not in 2.2.2 |
| #47685 | exhausted provider budgets are retried | open | Quota classified from prose; 402 and billing codes missed |
| #50352 | quota limit surfaced as not valid JSON / Authentication | open | Error classification must be tolerant |
| #60008 | expose instruction provenance in the context hook | open | No provenance for instruction entries |
| #58572 | awaited preflight hook before context assembly | open | Resume path bypasses `session.prompt` |
| #57214 | hook before the host stores synthetic text | open | `synthetic()` bypasses the prompt hook |
| #56023 | config models[].limit override does not reach plugins | closed | 200000 fallback for custom models |
| #60229 | rapid double config reload leaves plugins unloaded | open | Hooks can be silently dead |
| #60391 | compaction keeps unbounded recent context | open | Pack size fixed by us |
| #57553 | rejected compaction truncates history and clears undo | open | Never mutate the source session |
| #40578 | feat(session): add /handoff command | closed (stale) | Prior art: include retained tail, reuse canonical serializer, describe "what to do next" |
| #44798 | session hits context limit with no continuation handoff | closed | Demand evidence |
| #48991 | configurable model fallback on transient errors | open | Confirms no fallback exists upstream |
| #43324 | per-provider quota-aware auto-retry | open | Adjacent, not shipped |

---

## 9. Anchors corrected in this revision

- `src/v2/setup.ts:495` -> `502` (gate) and `504` (registration).
- `src/services/free-limit.ts:26-32` -> `30-35`; `:194` -> `:218`.
- `src/bootstrap/plugin-init.ts:1001-1017` -> `1089-1105`.
- `src/v2/types.ts:58` -> `61` (`V2Session`).
- `src/scripts/gen-opencode-config.ts:357` -> `358`.
- `src/hooks/session.ts:257` is the hook entry; the digest is at `:299`.
- `src/v2/setup.ts:508` is a `catch`, not a registration site.
- `scripts/release-smoke.sh`: 124, 146, 177, 178, 193, 197, 199.
- Tool-count sites: 16 lines across four files, not eleven.
- `instructions.entry` cap is 262144 bytes; 64KB is internal policy.
- `atomicWriteFile` does a directory fsync at `src/infra/disk-utils.ts:58`.
- `export`, `import`, and `fork` are not on `ctx.session`; `switchModel` and
  `switchAgent` are (`SessionDomain` picks both). Do not widen `V2Session` with
  the absent methods.
- `wait` takes `{ sessionID }`, not a bare id (`Expected object` otherwise).

### Implementation anchors (final, 2026-10-30)

- `src/v2/setup.ts:283` `handlePackEvent`; `:367` bridge install and warm-up;
  `:562` unconditional context hook (chat bridge then injection); `:575` retry
  veto.
- `src/v2/session-bridge.ts:18` `installSessionBridge`.
- `src/tools/thread.ts:66` `buildThreadTool`; `transferOverflow` lives in
  `src/services/context-pack/outbound.ts:86`.
- `src/tools/handoff.ts:750` `attachPackToHandoff`.
- `src/hooks/message-updated.ts:340` `activatePack` plus bullet suppression.
- `src/bootstrap/plugin-init.ts:512` `setContextHandoffConfig(tawaCtx.config)`.
- `src/services/context-pack/index.ts:169` `createPack` (takes the lock),
  `:231` `activatePack`, `:349` `revokePack`.
- `src/services/context-pack/hook.ts:106` `handleContextEvent` (synchronous,
  cache only).

---

## 10. Independent re-run — 2026-10-30

Environment: host 2.2.2, the repository's `@opencode/plugin` 2.2.1, isolated
`HOME`, `XDG_*` and `OPENCODE_DB`, a local OpenAI-compatible provider.
Artifacts: `/tmp/opencode/reverify/RESULTS.md`, plus the raw request bodies in
`/tmp/opencode/reverify/results/`. The repository was not touched.

### Measured and confirmed

| Claim | Evidence |
|---|---|
| `synthetic({ sessionID, id, text, metadata })` returns `type: "synthetic"`, `delivery: "steer"` | run 1, message visible in the `context` hook |
| Message ids are globally unique | same id in another session: `Session.SyntheticConflictError`, also across two runs sharing one DB |
| Compaction removes the pack | 17 messages including the pack before, 2 messages (`compaction`, `idle`) after |
| `session.compaction.ended` carries `{ sessionID, reason, model, text, cost, tokens }` | run 2 |
| Retry hook fires with `attempt: 2`, `provider.rate-limit`, and a veto stops retries | one provider hit only |
| `session.step.failed` carries `assistantMessageID` and `error.response.body`/`error.retryAfterMs` | run 1 |
| Attachments are replayed as inline text (`Attached file: …`) | provider body |
| The prompt shape is flat; the nested form fails | `Missing key at ["text"]` |
| `model`, `delivery` and the id shapes are schema-checked | three distinct `SchemaError`s |
| Awaiting `prompt` inside `setup()` freezes the host | rc=124, zero provider requests |

### Measured and refuted

| Revision 3 claim | Measurement |
|---|---|
| `model.list()` hides custom models and returns only eight opencode models | nine models, including the `opencode.json` provider at its declared 128000 limit |
| Providers declared in `opencode.json` never produce (`UnsupportedPackageError`) | the provider produced every request in four runs |
| `context()` returns an empty array | empty only immediately after `synthetic`, populated on the next read |

### New constraints

1. A `context`-hook message must be
   `{ role: "user", content: [{ type: "text", text }] }`; a string `content`
   aborts the request with `E.content.map is not a function`.
2. `synthetic` called from inside the `context` hook does not deadlock.
3. `context()` needs a short settle before it reflects a just-issued `synthetic`.

### Transport decision — settled 2026-10-30

Three transports were measured on 2.2.2 before the decision:

| Transport | Passive (no extra turn) | Survives compaction | Visible in the transcript | Cost |
|---|---|---|---|---|
| `synthetic` | no, the host answers it with a turn | no, compaction deletes it | yes | one turn per injection and per re-injection |
| `context` hook append | yes | yes, it is re-applied per request and never stored | no | pack bytes on every request |
| `prompt({ text, files })` | no, it is a normal turn | no, and it does not need to | yes | one turn per handoff |

Decision: **the `context` hook carries the persistent layer, and
`prompt({ text, files })` carries the transfer. `synthetic` is not used
anywhere.**

The reasoning is the measurement, not a preference. `synthetic` is stored, so
compaction removes it, so keeping a pack alive needs re-injection after every
compaction, and each write costs a full model turn. The hook has none of those
properties: it re-applies the rendered pack per request, survives compaction by
construction, never stores a message and never schedules a turn. The transfer is
already a turn by definition, so a one-shot `prompt` with the pack attached is
the honest shape for it.

Consequences, applied throughout this revision:

1. Deleted from the design: `inject.ts`, message-id derivation, conflict
   handling, the re-injection engine, the injection ledger keyed by message id,
   and the tombstone ledger.
2. Kept: atomic storage, accounting, selection, sanitization, the HMAC claim,
   the `thread` tool, `lock`, the kill switch, the retry hook and the
   terminal-failure pack.
3. Accepted loss: the pack is not visible in the transcript, because the host
   does not report injected provenance (#60008).
4. Preserved: all three delivery paths — agent to agent, model to model, and
   continuation of an earlier thread. The continuation path creates a successor
   session and prompts it with the summary plus the retained tail, so the hook
   re-applies the pack from its first request onward. When the transfer already
   carried the pack, the warm-time `alreadyPresent` check suppresses the append,
   so the pack is never delivered twice to the same successor.

A requirement of "passive, persistent and survives compaction" is satisfiable
only by the hook. A requirement of "visible in the transcript" forces a stored
message and therefore costs a turn. No transport satisfies both on this host;
the owner chose not to pay the turn.