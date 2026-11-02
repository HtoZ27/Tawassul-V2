# Continuity — Implementation Plan (rev. 6)

Status: A0 + A + B; not implemented
Scope: Tawassul V2, `src/` tree only
Supersedes: rev. 5 (which contained a liveness check that could never fire, a boot guard that would have disabled the plugin, and a false security claim about `credentialScope`)

rev. 3 defined three packages. Package C (the Continuity Brief) is removed. Packages A0, A and B are kept.

A0 and A touch no prompt. **B is not free: it adds argument schema to two existing tools, and that weight is permanent.** The exact cost is stated in §1.2 and is not hidden behind "byte-neutral".

rev. 6 is the first revision whose core detection logic was proven against a running kernel rather than reasoned about. The correction is recorded in §4.1 because the wrong version looked plausible and passed every internal consistency check.

---

## 0. What this delivers

| ID | Deliverable | Effect when disabled |
|---|---|---|
| A0 | `HandoffEntrySchema` stops discarding 11 fields the type already carries — 10 of which are actively written | none — state parses identically, minus the silent loss |
| A | A handoff whose owning process is gone is labelled `interrupted` at the next boot instead of looking alive forever | none |
| B | `handoff(resumeInterrupted)` to reopen an interrupted handoff; `record(search)` to find past records | none — both are opt-in calls |

With `continuity.enabled = false` (the default) detection does not run and nothing is written by it. A0 has effect regardless, because it repairs a data-loss bug that exists today.

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

A0 satisfies 1, 2, 4 and 5 but deliberately **not** 3: it repairs a data-loss bug that exists today, so its behaviour changes on every installation whether the feature is enabled or not. That is why A0 is specified and gated separately (§2, §12) rather than folded into A.

### 1.2 B — the honest exception

B satisfies 2, 3, 4, 5 but **not 1**: it adds tool arguments, and argument schemas ship in every request.

| Addition | Bytes per request |
|---|---|
| `record`: `search` string + `limit` number, with `.describe()` | ~150–200 |
| `handoff`: `resumeInterrupted` string + optional `unverified` array | ~180–250 |
| **Total** | **~330–450 B ≈ 85–115 tokens, every request, forever** |

`prove-context-diet.ts:152` treats `schemaPayload` as INFO-only, so this does not fail CI. It is still a real, permanent cost, and it is the reason B is a separate package rather than part of A.

B's description-text edits must be byte-neutral: `prove-context-diet.ts:124-128` asserts `grown.length === 0` for every tool against the frozen baseline, including `handoff`'s new bullet. §8.4 names the exact lines that pay for it, and states that B is blocked if the `handoff` description cannot yield ~120 B. Argument `.describe()` text and `schemaPayload` are the only parts outside that gate.

---

## 2. A0 — repair the pre-existing schema drift

`src/validation.ts:74-95` `HandoffEntrySchema` omits **11 fields** that exist on `HandoffEntry` (`src/context/types.ts:42-81`). Because `validateStateData` returns `StateSchema.safeParse(data)` and the loader consumes `validation.sanitized` (`StateManager.ts:490-499` → `:651-654`), zod strips them on every reload: they are written on every save and discarded on every load.

| Field | Type | Written by | What is lost |
|---|---|---|---|
| `implementer` | `AgentModelRef` | `handoff.ts:692` | reviewer-independence check loses its half |
| `reviewer` | `AgentModelRef` | `handoff.ts:693` | same |
| `sessionId` | `string` | `handoff.ts:694` | the handoff loses its originating session |
| `turn` | `number` | `handoff.ts:695` | turn attribution |
| `reroutedModel` | `string` | `handoff.ts:696` | routing history |
| `acknowledgedBy` | `string` | `message-updated.ts:309` | the receipt loses its signer |
| `acknowledgedAt` | `string` | `message-updated.ts:310` | the receipt timestamp |
| `acceptanceCriteria` | `string[]` | `message-updated.ts:311` | the agreed criteria |
| `senderErrorCleared` | `boolean` | `handoff-service.ts:501-504` | the error-clear marker resets |
| `sourceDiscussionId` | `string` | rekey path `state-persistence.ts:427-430` | relinking after a rekey |
| `credentialScope` | `"inherit" \| "isolated"` | **nothing** | **nothing — dead field** |

**Correction to an earlier draft of this plan.** It justified A0 by claiming `credentialScope: "isolated"` was lost across restarts and that credential isolation was therefore broken today. That was false. `credentialScope` occurs exactly once in the tree — the type declaration at `src/context/types.ts:59` — with no writer and no reader. It is carried below only for completeness, typed loosely, and it is **not** a security argument.

The real cost is the other ten. Five of them feed `compareAgentModels` (`src/services/model-refs.ts`), which cannot compare a ref that no longer exists, so reviewer independence is unevaluable for every handoff that survives a restart.

### 2.1 Infallible, not merely optional

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

The same wrapper applies to every continuity field in §3. The governing rule is no longer "no `.max()`" — that only ever covered length overflow. It is: **no new field may be capable of failing the handoff parse.**

`zod` is pinned at `^4.1.8` (`package.json:174`), where `.catch()` exists. If it is ever downgraded, `z.preprocess` restores the same property.

### 2.2 The dry-run, correctly classified

An earlier draft made "run `validateStateData` over the live state file and assert `droppedHandoffs === 0`" a pinned proof. It cannot be one: every gate proof isolates state into a temporary tree (`scripts/prove-context-diet.ts:65-74`, `scripts/prove-c03.ts:92-99`), so a proof run reads an empty directory and asserts nothing about the real file.

It stays as a **manual pre-merge check**, and it is no longer the safety property — §2.1 is. The regression guard is a committed hostile fixture instead, in §10.

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
  /* existing fields unchanged */
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

Three deliberate placements:

- **Step data on `Checkpoint`** — `currentStep`, `nextAction`, `unverified` describe the work.
- **Run data on `HandoffEntry`** — owner, heartbeat, liveness and flags describe the process.
- **`btime` inside `owner`**, not beside it — it is part of the identity of the process, meaningless on its own.

`checkpoint` is optional (`src/tools/handoff.ts:231-246,687`), so an owner stored there could never be stamped for a checkpoint-less handoff.

`src/validation.ts` mirrors both, every field wrapped in `lenient` (§2.1). No field may be able to fail the handoff parse — that is the rule, and it replaces the earlier "no `.max()`", which covered only one of the ways a field can fail.

---

## 4. A — liveness module

`src/services/continuity/owner.ts` (NEW, ~90 lines):

### 4.1 The trap this module exists to avoid

A dead process **does not** return an error that means "unknown". It returns `ENOENT`, because `/proc/<pid>` ceases to exist when the process is reaped:

```
readFileSync("/proc/999999/stat") -> throws ENOENT
```

Treating `ENOENT` as "cannot tell, fail open to alive" inverts the entire feature: no crashed handoff would ever be marked `interrupted`, which is the only thing Package A delivers. `ENOENT` under a mounted `/proc` is **proof of death**, not absence of evidence.

The three outcomes must therefore be separated, not collapsed into a boolean plus `undefined`:

| Observation | Meaning |
|---|---|
| `/proc` not mounted (macOS, sandbox) | `unknown` — never act |
| `EACCES` on `/proc/<pid>` | `unknown` — never act |
| `ENOENT` under a mounted `/proc` | **dead** |
| `/proc/<pid>/stat` state is `Z`/`X` | **dead** (zombie or dying) |
| `btime` differs from the stamped one | **dead** (pid predates this boot) |
| same `btime`, same field 22, live state | alive |

```ts
type Probe =
  | { alive: true }
  | { alive: false; reason: "gone" | "zombie" | "reboot" | "reused" }
  | "unknown";

const DEAD_STATES = new Set(["Z", "X", "x"]);

let procMounted: boolean | undefined;
function hasProc(): boolean {
  if (procMounted === undefined) {
    try { readFileSync("/proc/self/stat", "utf8"); procMounted = true; }
    catch { procMounted = false; }
  }
  return procMounted;
}

type StatRead = { state: string; startTicks: number } | "gone" | "unknown";

function readStat(pid: number): StatRead {
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
```

`btime` comes from the single `btime <seconds>` line in `/proc/stat`, read at most once per process and cached:

```ts
let cachedBtime: number | undefined;
function bootTime(): number | undefined {
  if (cachedBtime !== undefined) return cachedBtime;
  try {
    const line = readFileSync("/proc/stat", "utf8").split("\n").find((l) => l.startsWith("btime "));
    const n = line ? Number(line.slice(6)) : Number.NaN;
    if (Number.isFinite(n)) cachedBtime = n;
  } catch {}
  return cachedBtime;
}
```

### 4.2 The probe

```ts
export function probeOwner(owner: { pid: number; startedAt: number; btime?: number }): Probe {
  if (!hasProc()) return "unknown";

  const stat = readStat(owner.pid);
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

Notes:

- Parse from the **last `)`** — process names may contain spaces and parentheses. Verified: field 3 (`state`) is index `0` of the post-`)` split and field 22 (`starttime`) is index `19`.
- `startedAt` stores the **raw field 22 value** (clock ticks since boot). It is compared, never converted, so no `Sysconf(_SC_CLK_TCK)` and no `CLK_TCK` constant is required.
- **There is deliberately no `pid === process.pid` shortcut.** An earlier draft had one, and it was wrong: one host process owns both sides of every handoff, so the shortcut is the *common* path, not an edge case. A container entrypoint is PID 1 in every incarnation, and a supervised service can be restarted onto its old pid. Returning `alive` without reading `startedAt` there would make `interrupted` unreachable for exactly the long-lived deployments that need it. `readStat` works on the calling pid, so no special case is needed.
- `btime` closes the pid-reuse-across-reboot hole: after a reboot the tick counter restarts, so a recycled pid can coincidentally carry the same starttime. A differing `btime` is definitive. It is a 1-second-resolution epoch read once from `/proc/stat`, and it is stable for the life of a boot.
- `btime` is **optional** in the record. A handoff stamped on a host without `/proc` carries none, and the comparison is skipped rather than guessed.

```ts
export function stampOwner(h: HandoffEntry): void {
  const self = readStat(process.pid);
  if (self === "gone" || self === "unknown") {
    delete h.owner;
    h.ownerAlive = true;
    h.heartbeatAt = Date.now();
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

`stampOwner` sets `ownerAlive = true` so a handoff accepted in this process is never `undefined` downstream, and it writes **no owner at all** when `/proc` is unreadable — `0` is a legitimate tick value (a process started at boot), so storing it as a fallback would manufacture evidence instead of failing open.

`touch` mutates memory only and **never calls `saveState()`**: `saveState` → `persistThrough` → `doSave("awaited")` writes the entire state and cancels any pending debounce (`state-persistence.ts:657-702`).

---

## 5. A — call sites

Six, and only these. Every one already persists, so `stampOwner`/`touch`/`clearRunFlags` add **zero** writes.

| Site | File:line | Action |
|---|---|---|
| `pending` → `accepted` | `src/hooks/message-updated.ts:306` | `stampOwner(h)` |
| → `completed` | `src/services/handoff-service.ts:26` | `touch(h)` + `clearRunFlags(h)` |
| → `cancelled` | `src/services/handoff-service.ts:199` | `clearRunFlags(h)` |
| → `closed` (rescue) | `src/services/handoff-service.ts:554` | `clearRunFlags(h)` |
| `undo` → `pending` | `src/services/handoff-service.ts:498` | `clearRunFlags(h)` + `clearOwner(h)` |
| `resumeInterrupted` (Package B) | `src/services/handoff-service.ts` | `stampOwner(h)` + `clearRunFlags(h)` |

### Why the stamp belongs at accept, not at create

Ownership begins when an agent takes the work, not when the work is queued. Stamping at create would require covering every path that inserts a handoff, and there are six:

`handoff.ts:715` (create), `handoff.ts:817` (parallel copies), `handoff.ts:416` (rescue), `plugin-init.ts:848` (discussion callback), `tool-registry.ts:205` (fasttrack), `tool-registry.ts:216`/`:229` (bulk insert).

Any one missed becomes a handoff that detection skips forever — exactly the failure Package A claims to remove. Stamping at the single accept transition (`message-updated.ts:306`) covers all six, because every path above produces a `pending` entry and all of them reach `accepted` through that one loop.

A `pending` handoff with no owner is not a gap. It was never started, so `resumeInterruptedSagas()` already owns that case. `interrupted` means *taken and then abandoned*, and only accept can establish "taken".

Cost: one `/proc/self/stat` read per accepted handoff, in a hook that already awaits `saveState()` at `:335`. Not per message — the loop `continue`s on any status other than `pending` at `:307`.

`clearRunFlags` on every terminal transition is what keeps `interrupted` from outliving the work. Without it, a handoff marked `interrupted` at boot and completed later in the same session would carry a true flag until the next restart, because boot detection is the only other place that clears it.

No `session.idle`: the host event is `experimental.idle` (`src/v2/setup.ts:703`) and `src/tools/task-control.ts:47` documents that it may not fire.

---

## 6. A — detection

### 6.1 The guard must be positive, never an early return

`plugin-init.ts` is one async closure that ends at `:885`; every `return` inside it abandons initialization. The existing `if (initAbortController.signal.aborted) return` at `:775`, `:792` and `:832` exists precisely because of that. A bare `if (!continuityEnabled) return` at the insertion point would therefore skip `buildToolRegistry` (`:796`), `createHooks` (`:811`), `initAutoSweep` (`:855`) and `initResolved = true` (`:860`).

With continuity defaulting to disabled, that lands on **every installation that never opted in**: 44 tools and every hook would fail to register, `ensureReady` would time out (`initTimeoutMs = 30_000`, `:897`), and every tool call would throw "not found after init" (`:955`). The feature would disable the plugin it lives in.

Two rules follow:

1. The detection body lives in its own exported function, `detectInterrupted(ctx, opts)`, in `src/services/continuity/detect.ts`. Every `return` is inside that function.
2. The call site is a positive guard that owns no control flow:

```ts
if (continuityEnabled) {
  try {
    await detectInterrupted(tawaCtx, { heartbeatStaleMs });
  } catch (e) {
    logger.warn("[tawassul] continuity detection skipped:", (e as Error)?.message ?? e);
  }
}
```

### 6.2 Where exactly

Insert **after the whole `try`/`catch` that ends at `plugin-init.ts:784`** — not inside it. Inside the branch, the `else if (tawaCtx.handoffService)` fallback at `:782-783` would skip detection, and any failure would be logged under the existing message `"P2.3: saga resume skipped"` (`:786`), pointing the next reader at the wrong subsystem.

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

`ctx.saveState()` is the real symbol (`src/context-class.ts:486`). A bare `saveState()` does not exist in `plugin-init.ts` and would not typecheck.

### 6.4 Four invariants

1. **`interrupted` requires a definitive dead probe.** Only `{ alive: false }` sets it. `"unknown"` — no `/proc`, `EACCES`, unparseable stat — neither sets nor clears, so a host without `/proc` can never manufacture an interruption. Staleness never sets it either: a live process with an old heartbeat is `stale`, because `touch` fires only on handoff actions and one long turn is not evidence of death. `heartbeatAt ?? now` keeps a just-stamped handoff from being flagged the instant it exists.
2. **A live probe clears `interrupted`.** This closes the hole where `undo` re-stamps an owner while the flag survives: the next detection sees `alive`, and the flag goes. Without this line, `resumeInterrupted`'s precondition (`interrupted === true`) could hold on a handoff that is being actively worked on.
3. **Terminal statuses clear the flags**, in the loop and in the transition paths of §5, so no flag outlives the work that carried it.
4. **At most one `saveState()`**, and only when a field actually changed.

### 6.5 Cost, stated as a bound

Reads equal the number of **distinct owner keys** among non-terminal handoffs, not the number of handoffs. Duplicate keys collapse through the memo. The worst case is therefore `min(distinct owners, maxHandoffs)` — `MAX_HANDOFFS_DEFAULT = 2000`, configurable higher. The earlier claim "not 2000 reads" was true only for the typical case; the bound is not constant, and the proof records the measured cost at the cap rather than asserting a constant.

### 6.6 Concurrent boots

Two processes booting against one state file both run detection and both call `saveState()`. The second write hits `RevisionConflictError` and rebases through `unionByKey`, which keeps the entry with the later `timestamp` (`state-persistence.ts:264-274`, `:490-499`). Detection does not touch `timestamp`, so the first writer's entry wins and the second writer's flags are discarded.

Both writers observe the same `/proc`, so divergence is limited to `interruptedAt`/`staleAt`. That is accepted, not fixed: bumping `timestamp` on a flag change would make the last observation win, but only if `timestamp` is not also used as creation order — which this plan does not verify and does not need to.

### 6.7 Stated limitations

- A process that dies **after** boot is detected at the next boot, not immediately. No timer is allowed.
- A process that is alive but permanently wedged is `stale`, never `interrupted`. Recovery stays with `handoff(rescue)` and `@analyst`.
- When the feature is disabled, detection never runs, so flags written by an earlier enabled run are **not reaped**. They are inert — nothing reads them — but they stay on disk. This is the price of "disabled means zero work".

---

## 7. A — config

`src/context/types.ts` and `src/context/config-schema.ts`:

```ts
continuity?: {
  enabled?: boolean;
  heartbeatStaleMs?: number;
};
```

Resolution, as real TypeScript resolved at the call site:

```ts
function resolveContinuity(config: TawassulConfig): {
  enabled: boolean;
  heartbeatStaleMs: number;
} {
  const env = process.env.TAWASSUL_CONTINUITY;
  const enabled =
    env === "0" ? false
    : env === "1" ? true
    : (config.continuity?.enabled ?? false);
  const heartbeatStaleMs =
    config.continuity?.heartbeatStaleMs ?? 259_200_000;
  return { enabled, heartbeatStaleMs };
}
```

It is resolved **inside** the detection call, at `plugin-init.ts:784`. `tawaCtx` and its loaded config exist long before that point — `plugin-init.ts:721` and `:340` already read `configManager.config` — so no new boot ordering is introduced. The earlier draft wrote this as an untagged pseudo-expression in a fenced block; it would not have compiled.

Default `false`. `heartbeatStaleMs` default `259200000` (72 hours). Env wins over config in both directions, so `TAWASSUL_CONTINUITY=0` disables a config-enabled run and `=1` enables a config-disabled one — which is what makes the flag usable for a one-off verification without editing config.

---

## 8. B — resume and search

### 8.1 `handoff(resumeInterrupted)`

Named `resumeInterrupted`, not `resume`: a `resume` tool already exists (`src/tool-names.ts:28`, `src/tools/system-controls.ts:114`) and controls the workflow pause state.

- Argument: `resumeInterrupted: string` — handoff ID.
- Preconditions: `interrupted === true`; status in `pending`, `accepted`, or `paused` (**including `accepted`** — that is the crash case).
- Authorization: caller is `h.from` or `analyst` (mirrors `handoff-service.ts:488`).
- Effect: clear `interrupted`/`interruptedAt`/`stale`/`staleAt`, `stampOwner`, status → `pending`, append one `fix` record, return `{ nextAction, remaining, filesChanged, unverified }`.
- Not interrupted → error string, **no write**. Terminal status → refused.

Precedence table (also to be created as `docs/continuity-detection.md`, since no such file exists today):

| Action | Scope |
|---|---|
| `handoff(resumeInterrupted)` | rescues an interrupted handoff |
| `handoff(rescue)` | force-reassigns a stalled handoff to another agent |
| `thread.continue` | moves a session to a successor with a context pack |
| `task_control.revive` | resumes a child subagent |
| `resume` tool | resumes the workflow pause state |

### 8.2 `unverified[]` has a writer

`checkpoint` is **create-only**, by contract and by implementation: the tool description says so at `src/tools/handoff.ts:213`, and the `completeHandoff` branch reads only `args.result` at `:260` — `args.checkpoint` is never consulted there. An earlier draft claimed both branches accepted it and a proof depended on that; had it shipped, a caller passing `unverified` to `completeHandoff` would have received no error and no write.

So the writer is:

- `handoff(create)` accepts optional `unverified: string[]` inside the existing `checkpoint` argument, clipped to 5 at write time. The same `checkpoint` object is reused verbatim for `parallelCopies` (`handoff.ts:807`), so copies inherit it without extra wiring.
- `handoff(resumeInterrupted)` may append, clipped to 5.
- `completeHandoff` does **not** accept it. Appending at completion would need an explicit `args.checkpoint` read in that branch — a tool-surface change this package does not make.

Clipping belongs at the writer because the schema field is lenient (§2.1). A lenient field silently accepts anything; the cap is a product decision enforced at the edge, not a parse guard.

### 8.3 `record(search)`

- `search: string` — case-folded substring over `title + detail`. Max 20 hits, ranked by severity then recency.
- `limit?: number` — default 20, **max 20**.

No `scope` argument: `buildRecordTool(tawaCtx)` (`tool-registry.ts:159`) has no `goalStore` on `TawassulContext` (`context-class.ts:139-148`), so a `project` scope would need plumbing with no proven consumer.

Cost: O(n) over ≤ 5000 in-memory records, zero disk.

### 8.4 Description byte-neutrality

`measureDescriptionText` counts `description` bytes alone (`src/v2/adapters.ts:65-75`), and `prove-context-diet.ts:124-128` asserts `grown.length === 0` for **every** tool against the frozen baseline. Every added line must therefore be paid for inside the same description:

| Tool | Added text | Offset source |
|---|---|---|
| `handoff` | `resumeInterrupted` bullet, ~120 B | compress the existing action list at `src/tools/handoff.ts:201-216` |
| `record` | `search` line, ~45 B | compress the `get`/`list`/`delete` lines at `src/tools/record.ts:38-40` |

If ~120 B cannot be reclaimed from the `handoff` description without losing meaning, **B is blocked**. A description rebalance then becomes its own small design, not a line item here. This is written as a possibility because the `handoff` description is already dense, and pretending otherwise is how byte-budget plans fail at the gate.

Argument `.describe()` text and `schemaPayload` sit outside this gate (`prove-context-diet.ts:152`). That is why the *arguments* cost nothing against it and the *descriptions* cost everything.

---

## 9. Files touched

| File | Package | Change | Risk |
|---|---|---|---|
| `src/validation.ts` | A0, A | 11 fields + `AgentModelRefSchema` + `lenient` wrapper; mirror `Checkpoint` +3 and `HandoffEntry` +9 | low — every field is infallible (§2.1) |
| `src/context/types.ts` | A | `Checkpoint` +3, `HandoffEntry` +9, `TawassulConfig.continuity` | none |
| `src/context/config-schema.ts` | A | `continuity` block | none |
| `src/services/continuity/owner.ts` | A | **NEW** ~140 lines — probe, stamp, clear, touch | low |
| `src/services/continuity/detect.ts` | A | **NEW** ~50 lines — the boot loop | low |
| `src/hooks/message-updated.ts` | A | one `stampOwner(h)` in `acceptHandoffs` (`:306`) | medium — a hook file |
| `src/services/handoff-service.ts` | A, B | `touch` + `clearRunFlags` on terminal transitions (`:26`, `:199`, `:554`), `clearOwner` on undo (`:498`); resume transition + authorization | medium |
| `src/bootstrap/plugin-init.ts` | A | guarded `detectInterrupted` call after the saga try/catch (`:784`) | medium — one wrong `return` disables the plugin (§6.1) |
| `src/tools/handoff.ts` | B | `resumeInterrupted` action; `unverified` in the create checkpoint | medium |
| `src/tools/record.ts` | B | `search`, `limit` | low |
| `src/i18n/*.json` | A, B | ~14 keys (4 for A, ~10 for B) | none |

Two new files. No hook is **added** — one existing hook gains a single call. No tool is added, and `src/services/context-pack/*` is untouched.

`message-updated.ts` is the one entry that reaches a hot path. The added work is one `/proc/self/stat` read per *accepted* handoff, not per message: the loop `continue`s on every status other than `pending` (`:307`).

---

## 10. Proofs

Two new. 153 → 155.

### `scripts/prove-run-interrupt.ts` (Package A0 + A)

`probeOwner` takes an injectable stat reader (`probeOwner(owner, read = readStat)`) so the failure modes can be driven without forging a real process table.

1. **`ENOENT` under a mounted `/proc` is death.** A child stamps an owner, `SIGKILL`s itself and is reaped; detection marks the handoff `interrupted === true`, `interruptedReason === "gone"`. This is the regression test for the defect that made the first draft inert.
2. A **zombie** owner (`state === "Z"`, starttime still matching) is `interrupted`, reason `"zombie"`.
3. Same boot, pid alive, different `startedAt` → `interrupted`, reason `"reused"`.
4. Different `btime` with a matching pid and tick → `interrupted`, reason `"reboot"`.
5. `/proc` unavailable (reader returns `"unknown"` for everything) → **neither flag**. Fail open.
6. A live owner with an old `heartbeatAt` → `stale === true`, `interrupted === false`.
7. A freshly stamped handoff → neither flag, and `ownerAlive === true`.
8. A terminal status carrying both flags → both cleared, `changed` reported.
9. A handoff created but never accepted has **no** `owner` and is skipped — the accept-site stamping of §5, asserted from the other side.
10. `touch()` produces zero `saveState()` calls.
11. `/proc` read count equals the number of distinct `pid:startedAt:btime` keys, including at `MAX_HANDOFFS_DEFAULT = 2000` entries with one owner — the bound of §6.5, measured rather than asserted as a constant.
12. **Hostile fixture (A0's real guard).** A state payload whose handoff carries `credentialScope: "bogus"`, `turn: "3"`, `acceptanceCriteria: [null]`, `implementer: 42` and a `null` in every optional field parses with `droppedHandoffs === 0`; each bad field is `undefined` and every other field survives.
13. **Round-trip.** All 11 A0 fields and all continuity fields survive `validateStateData` → write → reload. Strings are compared only on values that `sanitizePersistedStrings` does not rewrite (`state-persistence.ts:562-597`); booleans and numbers are compared exactly.

The manual pre-merge dry-run over the live state file (§2.2) is **not** in this list, because a proof cannot reach the real state file.

### `scripts/prove-record-search.ts` (Package B)

1. `record(search)` returns ranked hits, `limit` respected, hard cap 20.
2. No match → empty output, no write.
3. `ctx.records.length` unchanged after any search.
4. Timing recorded; assert < 5 ms over 5000 records.
5. `resumeInterrupted` on a non-interrupted handoff writes nothing.
6. `resumeInterrupted` on a terminal handoff is refused.
7. `resumeInterrupted` on a **live but stale** handoff is refused — only `interrupted` qualifies.
8. Authorization: a non-owner non-analyst is refused.
9. `resumeInterrupted` clears `interrupted`/`interruptedReason`/`stale` and re-stamps the owner.
10. `unverified` written above 5 entries is clipped to 5 and the handoff still survives `validateStateData`.

### Registration

Add both files to `PINNED_PROOF_FILES`, update `PINNED_PROOF_STEPS` from 153 to 155 (`scripts/prove-proof-catalog.ts:229`, asserted at `:268`), add two steps to `scripts/gate-manifest.json` under `proofs`, run `bun scripts/generate-proof-count.ts`, and rebalance `scripts/proof-shards.json`.

---

## 11. Budget

| Metric | A0 | A | B |
|---|---|---|---|
| plugin init | 0 | + one map pass + one `/proc` read per distinct owner key (§6.5) | 0 |
| new state writes | 0 | 0, plus at most one on a flag change | 0 |
| prompt bytes | 0 | 0 | 0 (description edits are offset) |
| **request bytes** | **0** | **0** | **~330–450 B ≈ 85–115 tokens, permanent** |
| tool count | 44 | 44 | 44 |
| tool arguments | unchanged | unchanged | +4 |
| first-turn latency | 0 | nonzero on a flag-change boot — one full state write inside `initPromise` (invariant 4, §6.4) | 0 |

Boot gate unchanged: `prove-boot-budget` asserts one boot under 2000 ms and computes no p95; this plan claims no p95.

---

## 12. Rollout

| Step | Ships | Gate |
|---|---|---|
| 1 | A0 — schema repair | hostile fixture green (`droppedHandoffs === 0`) + manual dry-run over the live state |
| 2 | A — pointer and detection, `enabled = false` | `npm run verify` + `prove-run-interrupt` + 154 pinned steps + 44 tools still registered with continuity disabled |
| 3 | B — resume and search | `npm run verify` + `prove-record-search` + `prove-context-diet` green + 155 |

A0 and A share one pull request. B follows once A is green, because `resumeInterrupted` depends on the `interrupted` flag that A produces.

Step 2's third gate is not ceremonial. The guard in §6.1 is exactly the kind of change that passes a unit test and bricks the host, so the rollout asserts registration itself rather than trusting the review.

---

## 13. Risks

| Risk | Package | Mitigation |
|---|---|---|
| A0 validation drops a handoff | A0 | every new field is `lenient` (infallible); hostile fixture proves `droppedHandoffs === 0`; manual dry-run as a secondary signal |
| `ENOENT` read as "unknown" and the feature goes inert | A | explicit `"gone"` classification; proof 1 is the regression test |
| Zombie owner looks alive | A | field-3 state check; proof 2 |
| PID reuse hides a real interruption | A | compare raw field 22, not `pid`; no `pid === process.pid` shortcut |
| Tick collision across a reboot | A | `btime` must match; proof 4 |
| False interrupt on a live owner | A | `interrupted` requires a definitive dead probe; `"unknown"` never acts |
| Un-clearable flag | A | detection after the saga resume; a live probe clears it; terminal transitions clear it |
| Resume reopens a live handoff | B | `interrupted` is cleared whenever the probe says alive; `resumeInterrupted` refuses `stale` |
| A stray `return` aborts plugin init | A | positive guard + extracted function; §6.1 |
| Detection failure logged as "saga resume skipped" | A | its own `try`/`catch` and message (§6.2) |
| Fields silently dropped on reload | A | `lenient` on every field; round-trip assertion |
| Full state rewrite per tool call | A | `touch` never calls `saveState` |
| Post-boot death undetected until restart | A | stated limitation (§6.7); no timer by design |
| Wedged owner never becomes `interrupted` | A | `stale` only; recovery via `handoff(rescue)` |
| Disabled run leaves frozen flags on disk | A | inert, never read; stated in §6.7 |
| Concurrent boot rebase reverts a stamp | A | accepted and stated in §6.6 |
| `MAX_HANDOFFS_DEFAULT` truncation outlives the pointer | A | stated; no change to the cap |
| Description growth fails CI | B | offset table in §8.4; B is blocked if ~120 B cannot be reclaimed |
| Permanent request-byte growth | B | stated in §1.2; the price of the two verbs |
| `resume` name collision | B | action is `resumeInterrupted`; precedence table in §8.1 |
| `unverified` overflow | B | clip at the writer; the field is lenient, so the cap is a product rule |

---

## 14. Definition of done

**A0** — the hostile fixture parses with `droppedHandoffs === 0`; every bad value becomes `undefined` and every good field survives; the manual dry-run over the live state agrees.

**A** — a `SIGKILL`ed handoff is `interrupted` with reason `"gone"`; a zombie and a rebooted owner are also `interrupted`; a live owner with an old heartbeat is `stale`, never `interrupted`; `/proc` absence produces neither flag; zero extra state writes; read count equals distinct owner keys at the cap.

**B** — `SIGKILL` → `resumeInterrupted` → complete, end to end; a non-interrupted resume writes nothing; a stale resume is refused; a non-owner is refused; `unverified` clipped to 5 and the handoff survives reload.

**All** — `npm run verify` green, 155 proofs, shards rebalanced, 44 tools unchanged (`prove-tool-name-hash` green, no tripwire regeneration), `TAWASSUL_CONTINUITY=0` leaves zero reads and zero writes, and the plugin still registers 44 tools with continuity disabled — the guard of §6.1 is itself asserted.

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

A0 stops ten actively written fields from silently vanishing on every reload. Five of them feed reviewer-independence comparison, so today every handoff that survives a restart is judged on missing evidence; three more are the acceptance receipt — signer, timestamp and criteria — which the next restart erases. (`credentialScope`, the eleventh, is dead in the tree and is carried only for completeness; an earlier draft wrongly called it a security fix.)

A adds the only fact needed after a crash: who owned the work, and whether that process is still the same process. It costs one `/proc` read per distinct owner at boot and writes nothing unless something changed.

B turns that fact into an action, and adds keyword recall over the records that already exist. It costs ~400 bytes of argument schema in every request, which is the only permanent price in this plan.
