# Continuity — Implementation Plan (rev. 8)

Status: A0 + A + B; not implemented
Scope: Tawassul V2, `src/` tree only
Supersedes: rev. 7, which still carried three estimates where measurements were available: B's schema cost, B's description cost, and the claim that the missing description bytes might block the package.

rev. 3 defined three packages. Package C (the Continuity Brief) is removed. Packages A0, A and B are kept.

A0 and A touch no prompt. **B is not free: it adds argument schema to two existing tools, and that weight is permanent.** The measured cost is in §1.2 — 337 bytes of schema, invisible to every gate — and is not hidden behind "byte-neutral".

rev. 8 closes the three open questions rev. 7 left: B's schema cost is **337 B, measured** (§1.2), B's description cost is **+16 B, measured**, and B is therefore **not blocked** (§8.4). Along the way it found that `prove-context-diet` never measures the schema payload at all — it prints a frozen literal — and that the frozen figure has drifted by 10,220 bytes.

This revision was produced by five independent reviews of rev. 6: one reject, four approve-with-fixes. Four defects were reported by three or more reviewers separately, which is why they are treated as certain rather than probable. The corrections are recorded in Appendix C and Appendix D, not quietly patched, because the pattern of the last four revisions has been that plausible-looking justifications fail and only measurement survives.

---

## 0. What this delivers

| ID | Deliverable | Effect when disabled |
|---|---|---|
| A0 | `HandoffEntrySchema` stops discarding 11 fields the type already carries, 10 of which are written | none — state parses identically, minus the silent loss |
| A | A handoff whose owning process is gone is labelled `interrupted` at the next boot instead of looking alive forever | **zero reads, zero writes** — every call site is gated (§7.2) |
| B | `handoff(resumeInterrupted)` to reopen an interrupted handoff; `record(search)` to find past records | none — both refuse to act when the feature is off |

A0 has effect regardless of the flag, because it repairs a data-loss bug that exists today. That is why it is specified and gated separately (§2, §12).

**Not delivered:** any prompt injection, any automatic resume, any memory retrieval, any new tool.

---

## 1. Safety contract

### 1.1 A0 and A

A satisfies all five:

1. No byte added to any tool description or schema.
2. No byte added to the prompt at any turn.
3. No behaviour change while the feature is disabled.
4. Reversible by reverting one commit.
5. `npm run verify` passes with no baseline edit.

A0 satisfies 1, 2, 4 and 5 but deliberately **not** 3: it repairs a live data-loss bug, so its behaviour changes on every installation whether the flag is on or off.

Claim 3 is only true because of §7.2. In rev. 6 the accept-site stamp ran unconditionally, which meant a `/proc` read and three new persisted fields on every accepted handoff with the feature off — a direct contradiction of this contract, found independently by three reviewers.

### 1.2 B — the honest exception

B satisfies 3, 4 and 5 but **not** 1 or 2: it adds tool arguments, and those schemas ship in every request; it also adds 16 bytes of description text (§8.4), which is itself part of the request.

Measured, not estimated — every figure below is `JSON.stringify` byte length of the schema the plugin actually publishes, collected from a live isolated boot:

| Addition | `.describe()` text | Schema bytes |
|---|---|---|
| `record`: `search` (`string`) | `Substring over title and detail` | 75 |
| `record`: `limit` (plain `integer`, no bounds) | `Max hits (default 20)` | 65 |
| `handoff`: `resumeInterrupted` (`string`) | `Interrupted handoff ID to reopen (e.g. H-001)` | 100 |
| `handoff`: `checkpoint.unverified` (`string[]`) | `What is not yet verified` | 97 |
| **Total** | | **337 B ≈ 85 tokens, every request, forever** |

`limit` is a plain `integer` and not `number().min(1).max(20)` for two reasons: the bounded form costs 98 B instead of 65 (+33 B), and a schema bound rejects at the tool boundary where a silent clamp at the writer is both cheaper and kinder. Same rule as `unverified` (§8.2).

**Nothing in the gate measures this.** `prove-context-diet.ts:152` interpolates `baseline.schemaPayload.bytes` — the frozen number, 13,868 — and prints it with the word "unchanged". It is a literal, not a measurement. A live collection today returns **24,088** bytes for the same 44 tools, so the frozen record has been stale by 10,220 bytes and no assertion noticed. The 337 B above is therefore invisible to CI: it passes silently, which is exactly why it is stated here rather than implied to be free.

It is the reason B is a separate package.

---

## 2. A0 — repair the pre-existing schema drift

`src/validation.ts:74-95` `HandoffEntrySchema` omits **11 fields** that exist on `HandoffEntry` (`src/context/types.ts:42-81`). Because `validateStateData` returns `StateSchema.safeParse(data)` and the loader consumes `validation.sanitized` (`StateManager.ts:490-499` → `:651-654`), zod strips them on every reload. After the first save that follows a restart they are gone from disk too, because `collectStateData` serialises the already-stripped memory.

| Field | Type | Written by | Read by |
|---|---|---|---|
| `senderErrorCleared` | `boolean` | `handoff-service.ts:39,41` | undo after restart (`:46-47`, `:501-504`) |
| `sourceDiscussionId` | `string` | `handoff-entry.ts:34`, `discussion-logic.ts:563`, `plugin-init.ts:844` | rename rekey (`state-persistence.ts:427-429`) |
| `implementer` | `AgentModelRef` | `handoff.ts:692` | `compareAgentModels` |
| `reviewer` | `AgentModelRef` | `handoff.ts:693` | `compareAgentModels` |
| `sessionId` | `string` | `handoff.ts:694` | — write-only today |
| `turn` | `number` | `handoff.ts:695` | — write-only today |
| `reroutedModel` | `string` | `handoff.ts:696` | — write-only today |
| `acknowledgedBy` | `string` | `message-updated.ts:308` | `RECEIPT_SIGNED` emit (`:320-331`) |
| `acknowledgedAt` | `string` | `message-updated.ts:309` | same |
| `acceptanceCriteria` | `string[]` | `message-updated.ts:310` | same |
| `credentialScope` | `"inherit" \| "isolated"` | **nothing** | **nothing — dead field** |

### 2.1 What A0 actually buys, stated without inflation

Two corrections to earlier drafts, both caught in review:

- **`credentialScope` is dead.** It occurs exactly once in the tree — the type declaration at `src/context/types.ts:59` — with no writer and no reader. An earlier draft called it a security fix; that was false. It is carried below only for completeness.
- **`compareAgentModels` takes two arguments, not five.** `implementer` and `reviewer` (`src/services/model-refs.ts:32-40`). And its only caller, `reviewerIndependenceFails` (`:42-47`), has **no production call site** — it is referenced only by `scripts/prove-dispatch-model.ts` and `scripts/prove-review-independence-retro.ts`. So no handoff is "judged on missing evidence" today; the check exists and is unenforced.

What remains is still worth a commit, and it is honest: three of the fields are consumed by live code — the receipt trio emitted at accept, the error-clear marker read by undo after a restart, and the discussion id read by the rename rekey. The rest is fidelity: a record that stops silently deleting what it wrote.

The same defect exists one array over: `RecordEntrySchema` (`src/validation.ts:31-42`) strips `provenance` and `decision_kind`, both actively written (`record.ts:112`, `discussion-logic.ts:632`, `event-integrations.ts:273`, `hooks-registration.ts:240`). It is **out of scope here** and should get its own change, but a reviewer reading this plan deserves to know the repair is not unique to handoffs.

### 2.2 Infallible, not merely optional

`.optional()` still rejects `null`, wrong types and out-of-range enum members, and any rejection deletes the whole handoff: `sanitizeStateData` filters element by element on `schema.safeParse(e).success` (`StateManager.ts:509-522`). **Optional is not the safety property. Infallible is.**

```ts
const lenient = <T extends z.ZodTypeAny>(s: T) => s.optional().catch(undefined);

const AgentModelRefSchema = lenient(
  z.object({ providerID: z.string(), modelID: z.string() }),
);
```

Inside `HandoffEntrySchema`, every added field is wrapped:

```ts
senderErrorCleared: lenient(z.boolean()),
sourceDiscussionId: lenient(z.string()),
credentialScope: lenient(z.string()),
implementer: AgentModelRefSchema,
reviewer: AgentModelRefSchema,
sessionId: lenient(z.string()),
turn: lenient(z.number()),
acceptanceCriteria: lenient(z.array(z.string())),
acknowledgedBy: lenient(z.string()),
acknowledgedAt: lenient(z.string()),
reroutedModel: lenient(z.string()),
```

`.catch(undefined)` converts a parse failure into `undefined` instead of a rejection, so a bad value costs **one field**, never one handoff. `credentialScope` is `z.string()` and not a closed enum for the same reason: a value written by a future build that adds a third scope must not delete the handoff when that build is rolled back.

The governing rule for every new field is: **no field may be capable of failing the handoff parse.** "No `.max()`" was the earlier, incomplete version of this rule — it covered only length overflow.

`zod` is pinned at `^4.1.8` (`package.json:174`), where `.catch()` exists. Runtime semantics under that pin are **unverified by review** and must be confirmed by the hostile fixture before merge (§10).

### 2.3 The dry-run, corrected

An earlier draft made "run `validateStateData` over the live state file and assert `droppedHandoffs === 0`" the A0 gate. That assertion **cannot detect the bug**: zod strips unknown keys rather than rejecting them, so a handoff carrying `implementer` today parses successfully with the field removed and `droppedHandoffs` stays 0 on an unfixed build. It passes before the change and after it.

It also cannot be a pinned proof: every gate proof isolates state into a temporary tree (`prove-context-diet.ts:65-74`, `prove-c03.ts:92-99`), so a proof run reads an empty directory.

The manual pre-merge check is therefore a **field-presence diff**:

1. Read the live state file.
2. Record, per handoff, which of the 11 fields are present on disk.
3. Run the new schema over the same payload.
4. Assert that every field present before is still present after, and that no handoff disappeared.

That check fails on an unfixed build, which is the property the old one lacked. It stays manual and local; the regression guard is the hostile fixture in §10.

---

## 3. A — data model

`src/context/types.ts`:

```ts
export type Checkpoint = {
  completed: string[];
  remaining: string[];
  filesChanged: string[];
  decisions: { title: string; detail: string }[];
  currentStep?: string;
  nextAction?: string;
  unverified?: string[];
};

export type HandoffEntry = {
  owner?: { pid: number; startedAt: number; btime?: number };
  heartbeatAt?: number;
  ownerAlive?: boolean;
  interrupted?: boolean;
  interruptedAt?: number;
  interruptedReason?: "gone" | "zombie" | "reboot" | "reused";
  stale?: boolean;
  staleAt?: number;
};
```

**Eight new fields** on `HandoffEntry`; the existing ones are untouched. `btime` is nested inside `owner` because it is part of a process's identity and is meaningless on its own.

Three deliberate placements:

- **Step data on `Checkpoint`** — `currentStep`, `nextAction`, `unverified` describe the work.
- **Run data on `HandoffEntry`** — owner, heartbeat, liveness and flags describe the process.
- **`currentStep` has no writer in A0 or A.** It exists only so B can return it. If B is dropped, drop the field with it rather than shipping another dead one.

`checkpoint` is optional (`src/tools/handoff.ts:231-246,687`), so an owner stored there could never be stamped for a checkpoint-less handoff.

`src/validation.ts` mirrors both, every field wrapped in `lenient` (§2.2).

---

## 4. A — liveness module

### 4.1 The trap this module exists to avoid

A dead process **does not** return an error that means "unknown". It returns `ENOENT`, because `/proc/<pid>` ceases to exist when the process is reaped:

```
readFileSync("/proc/999999/stat") -> throws ENOENT
```

Treating `ENOENT` as "cannot tell, fail open to alive" inverts the feature: no crashed handoff would ever be marked `interrupted`, which is the only thing Package A delivers. `ENOENT` under a mounted `/proc` is **proof of death**, not absence of evidence.

The outcomes must therefore be separated, not collapsed into a boolean plus `undefined`:

| Observation | Meaning |
|---|---|
| `/proc` not mounted (macOS, sandbox) | `unknown` — never act |
| `EACCES` on `/proc/<pid>` | `unknown` — never act |
| `ENOENT` under a mounted `/proc` | **dead** |
| `/proc/<pid>/stat` state is `Z`/`X` | **dead** (zombie or dying) |
| `btime` differs from the stamped one | **dead** (pid predates this boot) |
| same `btime`, same field 22, live state | alive |

```ts
export type Probe =
  | { alive: true }
  | { alive: false; reason: "gone" | "zombie" | "reboot" | "reused" }
  | "unknown";

export type StatRead = { state: string; startTicks: number } | "gone" | "unknown";

const DEAD_STATES = new Set(["Z", "X", "x"]);

export function readStat(pid: number): StatRead {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const tail = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
    const ticks = Number(tail[19]);
    if (!Number.isFinite(ticks)) return "unknown";
    return { state: tail[0], startTicks: ticks };
  } catch (e) {
    return (e as { code?: string }).code === "ENOENT" ? "gone" : "unknown";
  }
}

let procMounted: boolean | undefined;
export function hasProc(): boolean {
  if (procMounted === undefined) {
    try { readFileSync("/proc/self/stat", "utf8"); procMounted = true; }
    catch { procMounted = false; }
  }
  return procMounted;
}

let cachedBtime: number | undefined;
export function bootTime(): number | undefined {
  if (cachedBtime !== undefined) return cachedBtime;
  try {
    const line = readFileSync("/proc/stat", "utf8").split("\n").find((l) => l.startsWith("btime "));
    const n = line ? Number(line.slice(6)) : Number.NaN;
    if (Number.isFinite(n)) cachedBtime = n;
  } catch {}
  return cachedBtime;
}
```

Verified on this host: `readFileSync("/proc/999999/stat")` throws `ENOENT`; for a live process, post-`)` index `0` is field 3 (`state`) and index `19` is field 22 (`starttime`).

`btime` closes the pid-reuse-across-reboot hole: after a reboot the tick counter restarts, so a recycled pid can coincidentally carry the same starttime. It is a 1-second-resolution epoch read once and stable for the life of a boot. It is optional in the record — a handoff stamped where `/proc` is unavailable carries none, and the comparison is skipped rather than guessed.

### 4.2 The probe

```ts
export function probeOwner(
  owner: { pid: number; startedAt: number; btime?: number },
  read: (pid: number) => StatRead = readStat,
): Probe {
  if (!hasProc()) return "unknown";

  const stat = read(owner.pid);
  if (stat === "unknown") return "unknown";
  if (stat === "gone") return { alive: false, reason: "gone" };
  if (DEAD_STATES.has(stat.state)) return { alive: false, reason: "zombie" };

  const now = bootTime();
  if (owner.btime !== undefined && now !== undefined && now !== owner.btime) {
    return { alive: false, reason: "reboot" };
  }
  if (stat.startTicks !== owner.startedAt) return { alive: false, reason: "reused" };
  return { alive: true };
}
```

The reader is an explicit parameter, not a hidden import, so the proofs can drive zombies, reboots and recycled pids without forging a process table.

**There is deliberately no `pid === process.pid` shortcut.** Rev. 5 had one, and it was wrong: one host process owns both sides of every handoff, so the shortcut is the *common* path, not an edge case. A container entrypoint is PID 1 in every incarnation, and a supervised service can restart onto its old pid. Returning `alive` without reading `startedAt` there would make `interrupted` unreachable for exactly the deployments that need it.

### 4.3 Stamp, clear, touch

```ts
export function stampOwner(h: HandoffEntry): void {
  const self = readStat(process.pid);
  if (self === "gone" || self === "unknown") {
    delete h.owner;
    delete h.ownerAlive;
    delete h.heartbeatAt;
    return;
  }
  h.owner = { pid: process.pid, startedAt: self.startTicks, btime: bootTime() };
  h.ownerAlive = true;
  h.heartbeatAt = Date.now();
}

export function clearOwner(h: HandoffEntry): void {
  delete h.owner;
  delete h.ownerAlive;
  delete h.heartbeatAt;
}

export function clearRunFlags(h: HandoffEntry): void {
  delete h.interrupted;
  delete h.interruptedAt;
  delete h.interruptedReason;
  delete h.stale;
  delete h.staleAt;
}

export function touch(h: HandoffEntry): void {
  h.heartbeatAt = Date.now();
}
```

`stampOwner` writes **no owner at all** when `/proc` is unreadable — `0` is a legitimate tick value (a process started at boot), so storing it as a fallback would manufacture evidence instead of failing open.

`touch` mutates memory only and **never calls `saveState()`**: `saveState` → `persistThrough` → `doSave("awaited")` writes the entire state and cancels the pending debounce (`state-persistence.ts:657-702`).

`owner.ts` is ~140 lines including the module-level caches.

---

## 5. A — call sites and the gating rule

Nine sites. Each already persists, so the added calls contribute **zero** writes — with one deliberate exception, `resumeInterrupted`, which is a new transition and does its own.

| Site | File:line | Action | Gated |
|---|---|---|---|
| `pending` → `accepted` | `message-updated.ts:306` | `stampOwner(h)` | **yes** |
| → `completed` | `handoff-service.ts:26` | `touch(h)` + `clearRunFlags(h)` | no |
| → `cancelled` | `handoff-service.ts:199` | `clearRunFlags(h)` | no |
| → `closed` (rescue) | `handoff-service.ts:554` | `clearRunFlags(h)` | no |
| `undo` → `pending` | `handoff-service.ts:498` | `clearRunFlags(h)` + `clearOwner(h)` | no |
| fallback complete | `handoff.ts:268` | `clearRunFlags(h)` | no |
| fallback close | `handoff.ts:378` | `clearRunFlags(h)` | no |
| fallback undo | `handoff.ts:461` | `clearRunFlags(h)` + `clearOwner(h)` | no |
| `resumeInterrupted` (B) | `handoff-service.ts` | `stampOwner(h)` + `clearRunFlags(h)` | **yes** |

The last three rows are the `ctx.handoffService`-absent branches. `service-factory.ts:229` always provides the service in production, so they are unreachable there — but they set the same statuses, and a future host without the service would otherwise leak flags. They cost one `delete` each.

### 5.1 Why only `stampOwner` is gated

`stampOwner` is the only call that **reads** (`/proc/self/stat`) and the only one that **creates** fields. With the feature off it must not run; that is §1.1 claim 3 and the DoD's "zero reads".

The `clear*` calls are pure `delete`s. They run on transitions that already call `saveState()`, so they add no write, and a `delete` on an absent key is a no-op. Leaving them ungated also means a flag left by an earlier enabled run is cleaned up the next time its handoff reaches a terminal state, even if the feature is off by then.

### 5.2 Why the stamp belongs at accept, not at create

Ownership begins when an agent takes the work, not when it is queued. Stamping at create would mean covering every insertion path, and there are **seven**:

`handoff.ts:416` (rescue), `handoff.ts:715` (create), `handoff.ts:817` (parallel copies), `plugin-init.ts:848` (discussion callback), `tool-registry.ts:205` (fasttrack), `service-factory.ts:701` (availability dispatch), `service-factory.ts:764` (parallel dispatcher).

(`tool-registry.ts:216` and `:229` are not creation sites — they re-insert the same entries after a `handoffs.clear()` at `:214-217` and `:227-230`.)

Any one missed becomes a handoff that detection skips forever — exactly the failure Package A claims to remove. Stamping at the single accept transition covers all seven: every path above produces a `pending` entry, and `h.status = "accepted"` has exactly one site in the tree (`message-updated.ts:306`).

A `pending` handoff with no owner is not a gap. It was never started, so `resumeInterruptedSagas()` already owns that case. `interrupted` means *taken and then abandoned*, and only accept can establish "taken".

---

## 6. A — detection

### 6.1 The guard must be positive, never an early return

`plugin-init.ts` is one async closure that ends at `:885`; every `return` inside it abandons initialization. The existing `if (initAbortController.signal.aborted) return` at `:775`, `:792` and `:832` exists precisely because of that. A bare `if (!continuityEnabled) return` at the insertion point would skip `buildToolRegistry` (`:796`), `createHooks` (`:811`), `initAutoSweep` (`:855`) and `initResolved = true` (`:860`).

The consequence is not a timeout: `initPromise` would resolve cleanly, `ensureReady` would return `{ready:false}` immediately (`:915-917`), and every stateful tool would throw "not found after init" (`:955`), while the three stateless tools would return "init pending". With continuity defaulting to off, this would happen on **every installation that never opted in**.

Two rules follow:

1. The detection body lives in `src/services/continuity/detect.ts`. Every `return` is inside that function.
2. The call site is a positive guard that owns no control flow:

```ts
if (continuityEnabled()) {
  try {
    await detectInterrupted(tawaCtx, { heartbeatStaleMs });
  } catch (e) {
    logger.warn("[tawassul] continuity detection skipped:", (e as Error)?.message ?? e);
  }
}
```

### 6.2 Where exactly

Insert **after the whole `try`/`catch`**, which ends at `:787` — the `try` opens at `:779`, its clauses close at `:784`, and the catch runs `:785-787`. Not inside it: inside the branch, the `else if (tawaCtx.handoffService)` fallback at `:782-783` would skip detection, and any failure would be logged under the existing message `"P2.3: saga resume skipped"` (`:786`), pointing the next reader at the wrong subsystem.

Detection must run **after** `resumeInterruptedSagas()` for a second reason: the saga resume mutates the same object identity that `tawaCtx.handoffs` holds (`handoff-service.ts:300`, `:310`; `buildCompletionEffects` at `:24-31`), so a handoff completed during boot is already terminal by the time the loop reads it.

### 6.3 The loop

```ts
const TERMINAL = new Set(["completed", "cancelled", "closed"]);

export async function detectInterrupted(
  ctx: TawassulContext,
  opts: { heartbeatStaleMs: number },
): Promise<void> {
  const memo = new Map<string, Probe>();
  let changed = false;
  const now = Date.now();

  for (const h of ctx.handoffs.values()) {
    if (TERMINAL.has(h.status)) {
      if (h.interrupted || h.stale) { clearRunFlags(h); changed = true; }
      continue;
    }
    if (!h.owner) continue;

    const key = `${h.owner.pid}:${h.owner.startedAt}:${h.owner.btime ?? 0}`;
    let probe = memo.get(key);
    if (probe === undefined) { probe = probeOwner(h.owner); memo.set(key, probe); }
    if (probe === "unknown") continue;

    if (h.ownerAlive !== probe.alive) { h.ownerAlive = probe.alive; changed = true; }

    if (!probe.alive) {
      if (h.interrupted !== true || h.interruptedReason !== probe.reason) {
        h.interrupted = true;
        h.interruptedAt = now;
        h.interruptedReason = probe.reason;
        changed = true;
      }
      if (h.stale) { h.stale = false; delete h.staleAt; changed = true; }
      continue;
    }

    if (h.interrupted) {
      delete h.interrupted;
      delete h.interruptedAt;
      delete h.interruptedReason;
      changed = true;
    }
    if (now - (h.heartbeatAt ?? now) >= opts.heartbeatStaleMs) {
      if (!h.stale) { h.stale = true; h.staleAt = now; changed = true; }
    } else if (h.stale) {
      h.stale = false;
      delete h.staleAt;
      changed = true;
    }
  }

  if (changed) await ctx.saveState();
}
```

`ctx.saveState()` is the real symbol (`src/context-class.ts:486`). A bare `saveState()` does not exist in `plugin-init.ts`.

### 6.4 Four invariants

1. **`interrupted` requires a definitive dead probe.** Only `{ alive: false }` sets it. `"unknown"` — no `/proc`, `EACCES`, unparseable stat — neither sets nor clears, so a host without `/proc` can never manufacture an interruption. Staleness never sets it either: a live process with an old heartbeat is `stale`, because `touch` fires only on handoff actions and one long turn is not evidence of death. `heartbeatAt ?? now` keeps a just-stamped handoff from being flagged the instant it exists.
2. **A live probe clears `interrupted`.** This closes the hole where `undo` re-stamps an owner while the flag survives. Without it, `resumeInterrupted`'s precondition could hold on a handoff that is being actively worked on.
3. **Terminal statuses clear the flags**, in the loop and in the transition paths of §5.
4. **At most one `saveState()`**, and only when a field actually changed.

### 6.5 Cost, stated as a bound

Reads equal the number of **distinct owner keys** among non-terminal handoffs, not the number of handoffs. Duplicate keys collapse through the memo. The worst case is `min(distinct owners, maxHandoffs)` — `MAX_HANDOFFS_DEFAULT = 2000`, configurable higher. The bound is not constant, and the proof measures it at the cap rather than asserting a constant.

### 6.6 Concurrent boots

Two processes booting against one state file both run detection and both call `saveState()`. The second write hits `RevisionConflictError` and rebases through `unionByKey`, which keeps the entry with the later `timestamp` (`state-persistence.ts:264-274`; conflict handling at `:897`). Detection does not touch `timestamp`, so the first writer's entry wins and the second writer's flags are discarded.

Both writers observe the same `/proc`, so divergence is limited to `interruptedAt`/`staleAt`. That is accepted, not fixed: bumping `timestamp` on a flag change would make the last observation win, but only if `timestamp` is not also used as creation order — which this plan does not verify and does not need to.

### 6.7 Stated limitations

- A process that dies **after** boot is detected at the next boot, not immediately. No timer is allowed.
- A process that is alive but permanently wedged is `stale`, never `interrupted`. Recovery stays with `handoff(rescue)` and `@analyst`.
- A handoff **accepted while the feature was off** carries no owner and is invisible to detection until it is undone and re-accepted. This is the unavoidable cost of gating the stamp, and it is the reason enabling the feature is not retroactive.
- `MAX_HANDOFFS_DEFAULT = 2000` truncates oldest-first on load and save (`constants.ts:23`, `StateManager.ts:837-852`), so an owner pointer does not outlive the cap either.

---

## 7. A — config and the gating mechanism

### 7.1 Shape

`src/context/types.ts` and `src/context/config-schema.ts`:

```ts
continuity?: {
  enabled?: boolean;
  heartbeatStaleMs?: number;
};
```

```ts
let cfg = { enabled: false, heartbeatStaleMs: 259_200_000 };

export function configureContinuity(next: Partial<typeof cfg>): void {
  cfg = { ...cfg, ...next };
}

export function continuityEnabled(): boolean {
  return cfg.enabled;
}

export function resolveContinuity(config: TawassulConfig): Partial<typeof cfg> {
  const env = process.env.TAWASSUL_CONTINUITY;
  const enabled =
    env === "0" ? false
    : env === "1" ? true
    : (config.continuity?.enabled ?? false);
  return { enabled, heartbeatStaleMs: config.continuity?.heartbeatStaleMs ?? 259_200_000 };
}
```

### 7.2 One resolution, one gate

`configureContinuity(resolveContinuity(...))` is called **once**, immediately before the detection call at `:787`. That is before `buildToolRegistry` (`:796`), so the `handoff` tool built afterwards already sees the resolved flag.

Every gated site in §5 then reads `continuityEnabled()` rather than re-parsing config. The flag is module-level for the same reason the repo's existing `setAdaptiveBudget` / `setProjectScale` are: it is resolved once at boot and read on a hot path where re-reading config would be wasteful.

Default `false`. Env wins over config in both directions, so `TAWASSUL_CONTINUITY=0` disables a config-enabled run and `=1` enables a config-disabled one.

---

## 8. B — resume and search

**B requires `continuityEnabled()`.** Without that gate, a flag stamped by an earlier enabled run would still be readable in a disabled run, and `resumeInterrupted` could reopen a handoff whose owner is alive. Rev. 6 had that hole.

### 8.1 `handoff(resumeInterrupted)`

Named `resumeInterrupted`, not `resume`: a `resume` tool already exists (`src/tool-names.ts:28`, `src/tools/system-controls.ts:114`) and controls the workflow pause state.

- Argument: `resumeInterrupted: string` — handoff ID.
- Preconditions: `continuityEnabled()`; `interrupted === true`; status in `pending`, `accepted`, or `paused` (**including `accepted`** — that is the crash case).
- Authorization: caller is `h.from` or `analyst` (mirrors `handoff-service.ts:488`).
- Effect: `clearRunFlags(h)`, `stampOwner(h)`, status → `pending`, append one `fix` record, one `saveState()`, return `{ nextAction, remaining, filesChanged, unverified }`.
- Not interrupted → error string, **no write**. Terminal status → refused. `stale` → refused; stale is a live owner and `rescue` is the verb for it.

`clearRunFlags` is named rather than spelled out because the earlier list omitted `interruptedReason` while the proof asserted it cleared.

Precedence table (also to be created as `docs/continuity-detection.md`, since no such file exists today):

| Action | Scope |
|---|---|
| `handoff(resumeInterrupted)` | rescues an interrupted handoff |
| `handoff(rescue)` | force-reassigns a stalled handoff to another agent |
| `thread.continue` | moves a session to a successor with a context pack |
| `task_control.revive` | resumes a child subagent |
| `resume` tool | resumes the workflow pause state |

`resume` re-queues to `pending`, so the next inbound message re-accepts the handoff and re-stamps it. The resume is not "hold until touched".

### 8.2 `unverified[]` has a writer

`checkpoint` is **create-only**, by contract and by implementation: the tool description says so at `src/tools/handoff.ts:213`, and the `completeHandoff` branch reads only `args.result` at `:260` — `args.checkpoint` is never consulted there.

- `handoff(create)` accepts optional `unverified: string[]` inside the existing `checkpoint` argument, clipped to 5 at write time. The same object is reused for `parallelCopies` (`handoff.ts:807`), so copies inherit it.
- `handoff(resumeInterrupted)` may append, clipped to 5.
- `completeHandoff` does **not** accept it.

The field is declared without `.max(5)`. A `.max` would reject at the tool boundary before the writer's clip ever runs; the cap is a product rule enforced at the edge.

### 8.3 `record(search)`

- `search: string` — case-folded substring over `title + detail`. Max 20 hits, ranked by severity then recency.
- `limit?: number` — default 20, max 20.

No `scope` argument: `services?.goalStore` exists on the registry object (`tool-registry.ts:201`) but not on `TawassulContext` (`context-class.ts:139-148`), so a `project` scope needs plumbing with no proven consumer.

Cost: O(n) over the record list — 5000 by default (`constants.ts:22`), configurable to 10000 (`config-schema.ts:10`). Zero disk.

### 8.4 Description bytes — the real gate

`measureDescriptionText` counts `description` bytes only (`src/v2/adapters.ts:65-75`). Two separate constraints apply:

1. `grown.length === 0` (`prove-context-diet.ts:124-128`) — per tool, against the **pre-diet** frozen baseline.
2. `measured.bytes <= TARGET_BYTES` (`prove-context-diet.ts:104-108`) — the whole surface. Measured live: **16,147 against a cap of 16,213 — 66 bytes of headroom.** This is the binding constraint.

Because the baseline is pre-diet, check 1 cannot fire for these two tools at any plausible edit:

| Tool | Live | Frozen | Slack before check 1 trips |
|---|---|---|---|
| `handoff` | 1,122 | 2,675 | 1,553 |
| `record` | 529 | 866 | 337 |

Only the 66 bytes matter.

Rev. 6 pointed the `record` offset at `record.ts:38-40`, which are **argument** `.describe()` lines. Those are outside the measured surface, so compressing them reclaims zero description bytes. That citation was wrong.

**Measured, not estimated.** The following edit is the actual proposed text; the deltas are byte counts of the joined description strings, checked against the live values above:

| Tool | Change | Bytes |
|---|---|---|
| `handoff` | add `• resumeInterrupted — Required: resumeInterrupted (handoff ID); reopens an interrupted handoff.` (+ its newline) | +100 |
| `handoff` | `parallelCopies creates N copies … same task; each completes independently, results shown side by side.` → `parallelCopies — N copies … same task; results side by side.` | −40 |
| `handoff` | `Optional: result (summary of what was accomplished).` → `Optional: result (summary).` | −25 |
| `handoff` | `reverts an accepted handoff back to pending.` → `reverts accepted to pending.` | −16 |
| `handoff` | `checkpoint (create only, when your context runs low)` → `checkpoint (create only, low context)` | −15 |
| **`handoff` net** | 1,122 → 1,126 | **+4** |
| `record` | add `SEARCH: record(search: "text") → matches in title/detail, max 20` (+ blank line) | +68 |
| `record` | `READ-BACK (write-only gap fix): record(get: "R-001") → one record by id; record(list: true) → all session records` → `READ-BACK: record(get: "R-001") → one by id; record(list: true) → all` | −44 |
| `record` | `To DELETE a record: record(delete: "R-001")` → `DELETE: record(delete: "R-001")` | −12 |
| **`record` net** | 529 → 541 | **+12** |
| **Surface** | 16,147 → **16,163** | **+16, leaving 50 bytes** |

So B is **not blocked**. Rev. 7 said it might be, because it carried estimates of ~120 B and ~45 B that summed to a bill ten times the actual one. With the offsets taken inside the description text, the whole package costs 16 bytes against 66 available.

`prove-constraint-retention` is a second gate on this text: `handoff` and `record` are fixture tools, and 103 phrases are pinned across the 11 fixture tools — 18 of them in `handoff`, 5 in `record` (`prove-constraint-retention.ts:75-102`, assertion `:149-160`). Every pinned phrase survives the edit above; that was checked phrase by phrase, not assumed. In particular `N copies to N different agents with the same task`, `completeHandoff (the handoff ID)`, `undo (the handoff ID)`, the four `RULES:` phrases, `DO NOT mix actions in one call` and `record(delete: "R-001")` are all preserved, and none of the offsets touches the `never search plugin files` / `MCP server` scope hints.

The plan of record: these two edits ship **with** B, in the same commit, and `prove-context-diet` plus `prove-constraint-retention` are both named gates in §12. If an implementation drifts from this text and the surface exceeds 16,213, the correct response is to cut inside the description, not to raise `TARGET_BYTES`.

---

## 9. Files touched

| File | Package | Change | Risk |
|---|---|---|---|
| `src/validation.ts` | A0, A | 11 fields + `AgentModelRefSchema` + `lenient`; mirror `Checkpoint` +3 and `HandoffEntry` +8 | low — every field is infallible (§2.2) |
| `src/context/types.ts` | A | `Checkpoint` +3, `HandoffEntry` +8, `TawassulConfig.continuity` | none |
| `src/context/config-schema.ts` | A | `continuity` block | none |
| `src/services/continuity/owner.ts` | A | **NEW** ~140 lines | low |
| `src/services/continuity/detect.ts` | A | **NEW** ~50 lines | low |
| `src/hooks/message-updated.ts` | A | gated `stampOwner(h)` at `:306` | medium — a hook file |
| `src/services/handoff-service.ts` | A, B | `touch` + `clearRunFlags` on terminal transitions (`:26`, `:199`, `:554`), `clearOwner` on undo (`:498`); resume transition + authorization | medium |
| `src/tools/handoff.ts` | A, B | `clearRunFlags` in the three fallback branches; `resumeInterrupted` action; `unverified` in the create checkpoint; the description edits in §8.4 | medium |
| `src/bootstrap/plugin-init.ts` | A | `configureContinuity` + guarded `detectInterrupted` after `:787` | medium — one wrong `return` disables the plugin (§6.1) |
| `src/tools/record.ts` | B | `search`, `limit`, and the description edits in §8.4 | low |
| `src/i18n/*.json` | A, B | ~10 keys (A needs none — it logs through `logger`; B needs ~10) | none |
| `docs/continuity-detection.md` | B | **NEW** — the precedence table | none |

Two source files added. No hook is **added** — one existing hook gains a gated call. No tool is added, and `src/services/context-pack/*` is untouched.

`message-updated.ts` is the one entry on a hot path. The added work is one `/proc/self/stat` read per *accepted* handoff, and only when the feature is on: the loop `continue`s on every status other than `pending` (`:305`).

---

## 10. Proofs

Two new. 153 → 155.

### `scripts/prove-run-interrupt.ts` (Package A0 + A)

`probeOwner` takes an injectable reader (§4.2), so every failure mode is drivable without forging a real process table. The hostile-fixture half runs first and does not need the flag.

1. **`ENOENT` under a mounted `/proc` is death.** A child stamps an owner, `SIGKILL`s itself and is reaped; detection marks the handoff `interrupted === true`, `interruptedReason === "gone"`. This is the regression test for the defect that made rev. 5 inert.
2. A **zombie** owner (`state === "Z"`, starttime matching) is `interrupted`, reason `"zombie"`.
3. Same boot, pid alive, different `startedAt` → `interrupted`, reason `"reused"`.
4. Different `btime` with a matching pid and tick → `interrupted`, reason `"reboot"`.
5. `/proc` unavailable (reader returns `"unknown"`) → **neither flag**. Fail open.
6. A live owner with an old `heartbeatAt` → `stale === true`, `interrupted === false`.
7. A freshly stamped handoff → neither flag, `ownerAlive === true`.
8. A terminal status carrying both flags → both cleared, `changed` reported.
9. A handoff created but never accepted has **no** `owner` and is skipped.
10. `touch()` produces zero `saveState()` calls.
11. Read count equals the number of distinct `pid:startedAt:btime` keys, including at `MAX_HANDOFFS_DEFAULT = 2000` entries with one owner.
12. **Hostile fixture.** A handoff carrying `turn: "3"`, `acceptanceCriteria: [null]`, `implementer: 42` and `null` in every optional field parses with `droppedHandoffs === 0`; each of those becomes `undefined`, while `credentialScope: "bogus"` **survives as the string `"bogus"`** — it is `z.string()`, not an enum, by design (§2.2). This is also where the runtime semantics of `.optional().catch(undefined)` under `zod ^4.1.8` are confirmed or the package is stopped.
13. **Round-trip.** All 11 A0 fields and all continuity fields survive `validateStateData` → write → reload. Strings are compared only on values `sanitizePersistedStrings` does not rewrite (`state-persistence.ts:562-597`).

The field-presence dry-run (§2.3) is **not** in this list: a proof cannot reach the real state file.

### `scripts/prove-record-search.ts` (Package B)

1. `record(search)` returns ranked hits, `limit` respected, hard cap 20.
2. No match → empty output, no write.
3. `ctx.records.length` unchanged after any search.
4. Search cost is asserted as an **operation count**, not wall-clock: at most one `toLowerCase` and one `includes` per record over 5000 records. Wall-clock is printed as INFO only, because a millisecond bound on a shared runner is a flake.
5. `resumeInterrupted` on a non-interrupted handoff writes nothing.
6. `resumeInterrupted` on a terminal handoff is refused.
7. `resumeInterrupted` on a **stale** handoff is refused.
8. `resumeInterrupted` with continuity disabled is refused.
9. Authorization: a non-owner non-analyst is refused.
10. `resumeInterrupted` clears all four flags including `interruptedReason`, and re-stamps the owner.
11. `unverified` written above 5 entries is clipped to 5 and the handoff still survives `validateStateData`.

### Registration

- Add both files to `PINNED_PROOF_FILES` (`prove-proof-catalog.ts:70`).
- `PINNED_PROOF_STEPS`: **153 → 154** in the A0+A change, **154 → 155** in the B change. The catalog asserts exact equality every run (`:229`, asserted `:268`), so a single "→155" edit would go red at the intermediate commit.
- Add steps to `scripts/gate-manifest.json` under `proofs` (exactly one owner per step, `:240-243`).
- Assign the new steps in `scripts/proof-shards.json`; assignment is mandatory (`:280-283`), and the shard estimates must stay inside the 10% band (`:290-293`).
- Run `bun scripts/generate-proof-count.ts` (the fast gate runs it with `--check`).
- **Regenerate the reachability baseline.** `docs/experiments/baselines/2026-11-01-reachability.json` pins `totalFiles: 361`, and `prove-reachability-audit.ts:144` asserts exact equality against a walk of `src/**.ts`. Adding two files breaks it. Run `bun scripts/prove-reachability-audit.ts --write` and confirm the file/LOC shares stay inside their ±0.02 tolerances.

---

## 11. Budget

| Metric | A0 | A | B |
|---|---|---|---|
| plugin init | 0 | one map pass + one `/proc` read per distinct owner key (§6.5) | 0 |
| new state writes | 0 | 0, plus at most one on a flag change | 1 per explicit resume |
| prompt bytes | 0 | 0 | +16 description bytes, absorbed inside the 66 B headroom (§8.4) |
| **request bytes** | **0** | **0** | **+337 B schema (§1.2) + 16 B description = 353 B ≈ 88 tokens, permanent, and unmeasured by any gate** |
| tool count | 44 | 44 | 44 |
| tool arguments | unchanged | unchanged | +3 top-level (`search`, `limit`, `resumeInterrupted`), +1 nested (`checkpoint.unverified`) |
| first-turn latency | 0 | nonzero on a flag-change boot — one full state write inside `initPromise` | 0 |
| reads/writes while disabled | 0 | **0** — every read site is gated (§7.2) | **0** — the action refuses |

Boot gate unchanged: `prove-boot-budget` asserts one boot under 2000 ms and computes no p95; this plan claims no p95.

This adds no persistent index, so it does not violate "no boot-time indexing". It reads the existing handoff map and the kernel's process table; nothing new is stored for lookup.

---

## 12. Rollout

| Step | Ships | Gate |
|---|---|---|
| 1 | A0 — schema repair | field-presence dry-run (§2.3) + hostile fixture green |
| 2 | A — pointer and detection, `enabled = false` | `npm run verify` + `prove-run-interrupt` + 154 pinned steps + 44 tools still registered with continuity disabled |
| 3 | B — resume and search | `npm run verify` + `prove-record-search` + `prove-context-diet` green at ≤ 16,213 B (+16 expected, §8.4) + `prove-constraint-retention` green + 155 |

Step 1's hostile fixture lives in `prove-run-interrupt.ts`, which lands in step 2. To keep step 1 independently gated, the fixture is written **as the first test in that file**, and step 1 may land with the proof file present and only the fixture enabled — or steps 1 and 2 may simply share a commit. The plan does not pretend step 1 has a gate that does not exist at the moment it lands.

Step 2's third gate is not ceremonial. The guard in §6.1 is exactly the kind of change that passes a unit test and bricks the host, so the rollout asserts registration itself.

---

## 13. Risks

| Risk | Package | Mitigation |
|---|---|---|
| A0 validation drops a handoff | A0 | every new field is `lenient`; hostile fixture; field-presence dry-run |
| A bad value silently becomes `undefined` instead of being reported | A0 | accepted trade: one field lost is better than one handoff lost; the fixture pins the behaviour |
| `ENOENT` read as "unknown" and the feature goes inert | A | explicit `"gone"` classification; proof 1 |
| Zombie owner looks alive | A | field-3 state check; proof 2 |
| PID reuse hides a real interruption | A | raw field 22; no `pid === process.pid` shortcut |
| Tick collision across a reboot | A | `btime` must match; proof 4 |
| False interrupt on a live owner | A | `interrupted` requires a definitive dead probe; `"unknown"` never acts |
| Un-clearable flag | A | detection after the saga resume; a live probe clears it; terminal transitions clear it |
| Writes or reads with the feature off | A | `stampOwner` gated at both sites; clears are no-op deletes on writes that already happen |
| Resume reopens a live handoff | B | `resumeInterrupted` requires `continuityEnabled()` and `interrupted === true`; refuses `stale` |
| Resume acts on a flag from an earlier enabled run | B | gated on `continuityEnabled()`; §8 introduction |
| A stray `return` aborts plugin init | A | positive guard + extracted function; §6.1; rollout asserts 44 tools |
| Detection failure logged as "saga resume skipped" | A | its own `try`/`catch` and message (§6.2) |
| Fields silently dropped on reload | A | `lenient` on every field; round-trip assertion |
| Full state rewrite per tool call | A | `touch` never calls `saveState` |
| Post-boot death undetected until restart | A | stated limitation (§6.7) |
| Wedged owner never becomes `interrupted` | A | `stale` only; recovery via `handoff(rescue)` |
| Handoffs accepted while disabled stay invisible | A | stated limitation (§6.7); enabling is not retroactive |
| Concurrent boot rebase reverts a stamp | A | accepted and stated (§6.6) |
| `MAX_HANDOFFS_DEFAULT` truncation | A | stated (§6.7); no change to the cap |
| Description growth fails CI | B | offset inside the description text (§8.4); measured +16 B against 66 B of `TARGET_BYTES` headroom, leaving 50 |
| Offset deletes a pinned phrase | B | `prove-constraint-retention` is a named gate; all 23 `handoff`+`record` phrases were checked against the proposed text |
| Permanent request-byte growth | B | stated in §1.2 (337 B), and deliberately not hidden: no gate measures it |
| `resume` name collision | B | action is `resumeInterrupted`; precedence table |
| `unverified` overflow | B | clip at the writer; no `.max` at the schema |
| New files break the reachability baseline | A | regenerate with `--write`; verify shares stay in tolerance |

---

## 14. Definition of done

**A0** — the hostile fixture parses with `droppedHandoffs === 0`; wrong-typed and null fields become `undefined`; `credentialScope: "bogus"` survives verbatim; the field-presence dry-run over the live state shows no field lost and no handoff dropped.

**A** — a `SIGKILL`ed handoff is `interrupted` with reason `"gone"`; a zombie and a rebooted owner are also `interrupted`; a live owner with an old heartbeat is `stale`, never `interrupted`; `/proc` absence produces neither flag; zero extra state writes; read count equals distinct owner keys at the cap.

**B** — `SIGKILL` → `resumeInterrupted` → complete, end to end; a non-interrupted resume writes nothing; a stale resume and a disabled resume are refused; a non-owner is refused; `unverified` clipped to 5 and the handoff survives reload; the description surface measures **16,163** and `prove-constraint-retention` is green.

**All** — `npm run verify` green, 155 proofs, shards rebalanced, reachability baseline regenerated, 44 tools unchanged (`prove-tool-name-hash` green, no tripwire regeneration), and with continuity disabled: zero reads, zero writes, 44 tools still registered. The permanent bill is 353 request bytes and it is stated, not implied.

---

## Appendix A — what was removed from rev. 3, and why

| Removed | Why |
|---|---|
| Continuity Brief, `composeBrief`, `brief.ts` | touches the prompt on two paths; needs its own redesign |
| `briefInjected` map and `markBriefInjected` | delivery machinery for the brief |
| `message-updated.ts`, `session.ts`, `message-updated-types.ts`, `hooks-registration.ts` edits | all existed to carry the brief |
| `prove-continuity-brief`, `prove-brief-once` | proofs for the removed feature |
| `continuity.briefMaxBytes` config | config for the removed feature |

Not deferred inside this plan — out of scope. A separate plan would have to justify them on their own risk.

---

## Appendix B — why this is worth shipping

The repository cannot currently distinguish "this handoff is being worked on" from "the process that owned it is dead": `heartbeat-monitor.ts` keeps its state in memory only, so interruption is undetectable across a restart.

A0 stops ten actively written fields from silently vanishing on every reload — three of them consumed by live code (the acceptance receipt, the error-clear marker read by undo, the discussion id read by the rename rekey). (`credentialScope`, the eleventh, is dead in the tree; an earlier draft wrongly called it a security fix.)

A adds the only fact needed after a crash: who owned the work, and whether that process is still the same process. It costs one `/proc` read per distinct owner at boot and writes nothing unless something changed.

B turns that fact into an action, and adds keyword recall over the records that already exist. It costs 353 bytes in every request — 337 of schema, 16 of description — which is the only permanent price in this plan, and the one no gate would have caught.

---

## Appendix C — rev. 6 defects closed in rev. 7

| # | rev. 6 defect | Reported by | Closed by |
|---|---|---|---|
| 1 | `stampOwner` ran unconditionally, breaking "disabled = zero reads" | pickle, deepseek, mimo | §5.1, §7.2 |
| 2 | "Five fields feed `compareAgentModels`" — it takes two, and has no production caller | all four | §2.1 |
| 3 | `record` byte offset named argument `.describe()` lines, which are outside the gate | pickle, deepseek, glm, mimo | §8.4 |
| 4 | `resumeInterrupted` could act on a flag stamped by an earlier enabled run | glm | §8 introduction, proof 8 |
| 5 | The dry-run could not detect the drift it guarded (`droppedHandoffs` passes on an unfixed build) | deepseek | §2.3 |
| 6 | Proof 12 asserted `credentialScope` becomes `undefined`; it is `z.string()` and survives | deepseek, mimo | proof 12 |
| 7 | Creation-site list was six and wrong; there are seven, two listed entries were re-inserts | mimo | §5.2 |
| 8 | `handoffService`-absent fallbacks never cleared flags | pickle, deepseek, mimo | §5 rows 6-8 |
| 9 | `HandoffEntry` gains eight fields, not nine; two line estimates disagreed; anchor was `:784` | deepseek, mimo | §3, §4.3, §6.2 |
| 10 | Proof 4 asserted a wall-clock bound — a flake | deepseek, mimo | proof 4 |
| 11 | New files invalidate the reachability baseline | mimo (lens round) | §10 registration |
| 12 | `currentStep` had no writer and no reader | deepseek | §3 |
| 13 | §8.1's effect list omitted `interruptedReason` | deepseek, mimo | §8.1 |
| 14 | `ensureReady` would time out — it returns `{ready:false}` immediately | mimo | §6.1 |
| 15 | `unverified` needed an explicit no-`.max` note | deepseek | §8.2 |
| 16 | `docs/continuity-detection.md` was cited as if it existed | pickle | §8.1, §9 |

---

## Appendix D — the rev. 8 measurement pass

Rev. 7 left three things as estimates — B's schema bytes, B's description bytes, and whether the description text could absorb the latter — plus one verification it never ran: that the pinned phrases survive the cuts. All four are settled here. One item remains **open and unchanged**: the runtime semantics of `.optional().catch(undefined)` under `zod ^4.1.8`, which only the hostile fixture can confirm (§2.2, §10 proof 12).

| Question | rev. 7 answer | rev. 8 answer | How |
|---|---|---|---|
| What does B add to the published schema? | "~330–450 B" | **337 B** | live isolated boot → `collectToolSchemas` → `measureSchemaPayload`; marginal cost of each of the four properties, as `JSON.stringify` bytes |
| What does B add to the description text? | "~120 B" and "~45 B" | **+16 B** | the proposed strings, byte-counted, and reconciled with the live 1,122 / 529 |
| Is that description growth affordable? | "66 B of headroom; B may be blocked" | **yes — 50 B left** | 16,147 + 16 ≤ 16,213 |
| Do the pinned phrases survive the cuts? | unverified | **all 23 do** | each fixture phrase matched against the proposed normalized text |
| Does `.optional().catch(undefined)` behave as assumed? | unverified | **still unverified** | needs the zod 4.1.8 runtime; proof 12 is the gate |

Two things were found while measuring, and both are stated in the body rather than buried here:

1. **`prove-context-diet` never measures the schema payload.** `:152` interpolates `baseline.schemaPayload.bytes` and appends the word "unchanged". A live collection of the same 44 tools today returns **24,088** bytes, not the frozen 13,868 — a 10,220-byte drift that has never been asserted because the comparison does not exist. B's 337 bytes join that blind spot. This is a pre-existing gap, out of scope for this plan, but the plan no longer implies the schema is watched.
2. **The description gate is real and does bite.** `measured.bytes <= TARGET_BYTES` measures live text, and a live run reported `16147 <= 16213`. Only 66 bytes separate B from a red build, which is why §8.4 now specifies the exact replacement strings rather than an intention to "compress something".

The measurement itself is not committed: it is a two-file boot harness under `/tmp`, and the numbers it produced are reproduced here so a reviewer can re-derive them without trusting this document. Reproducing B's schema cost requires only that the four properties be added with the `.describe()` strings in §1.2.
