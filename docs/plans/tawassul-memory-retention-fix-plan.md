# Tawassul V2 — Memory Retention Fix Plan

Status: implemented; isolated proofs green, live slope measurement pending
Date: 2026-11-25
Scope: two independent retention paths in the OpenCode 2.4.1 host and in Tawassul V2

## 1. Evidence

- Host 2.4.1 retains a registered tool's `execute` closure after plugin `dispose()`. The registration handle is collected and the tool disappears from `ctx.tool.list()`, but the handler, payload and plugin instance remain alive at a later module evaluation.
- Hook-only and no-registration probes are released. A tool-only probe retains the handler, payload and instance.
- A clean build with no probes leaks: one reload of seven workspaces raised host RSS from 830.8 MB to 1384.9 MB. Forced-GC slope is about 182 MB per two reloads across seven workspaces, about 26 MB per workspace per reload.
- `StateManager._instances` is a static Set; `src/context/managers/StateManager.ts:106` adds every instance and no delete exists. `statePathFn` at `src/context-class.ts:452` closes over `this`. `LifecycleController.destroy()` never removes the instance.
- A static scan of module-level `static` collections and top-level `Set`/`Map` values found no third unconditional holder of the context graph on the reload path. A few maps hold bounded data objects (roster trust, parked messages, tree cache); `activePluginInstances` (`src/bootstrap/plugin-init.ts:419-425,1185`) holds `disposeInstance` closures that capture `ctx`/`tawaCtx`, but it is cleared at the start of `disposeInstance` (`:1149`) and on supersede (`:549`). An instance unloaded without dispose remains covered by risk 8.
- The measured `plugin dispose` step reached 4975 ms, close to the 5 s cleanup ceiling.

## 2. Root causes

### R1 — StateManager pin

`StateManager` pins every context through a process-wide static set and a `statePathFn` closure over `this`. This path leaks even when no tool is registered.

### R2 — Host tool closure retention

Every tool `execute` closes over `ctx`, `def`, `askFactory` and `validator`. `def` itself closes over `tawaCtx`, `tools` and `isActiveOwner`. The host retains one `execute` closure per tool after dispose, so the whole instance graph stays reachable.

Both causes pin the same graph. Fixing only one leaves the other in place.

## 3. Decision

Adopt the following two-part design:

1. `StateManager.detach()` synchronously removes the instance from the static set and replaces `statePathFn` with a closure over a plain string path. The pin is broken immediately, while late saves still target the last valid path. `releaseLock()` releases the filesystem lock later, at the end of teardown.
2. A per-registration `ToolSlot` is bound into `execute` with `Function.prototype.bind`. The host-retained closure captures only the bound function and the slot. On dispose the slot is emptied synchronously, so the retained closure cannot reach `ctx`, `def`, `askFactory` or `validator`.

This is the B+ direction (ctx-free execute plus eviction on dispose) with two changes:

- No process-wide registry. Each registration owns its slot, so there is no key collision, sweep or cross-workspace identity problem.
- The second leak is fixed as well.

### Why not a global registry

A `Map<generationId, RuntimeState>` can provide the same release guarantee, but adds global mutable state, keying, sweeps and a second retention path if dispose is missed. The per-registration slot is smaller and has no shared identity. `execute.before` hooks do not need routing because probes show they are released after dispose.

## 4. Design

### 4.1 StateManager detach and lock release

```ts
private released = false;

detach(): void {
  if (this.released) return;
  try {
    const path = this.statePathFn();
    this.statePathFn = () => path;
  } catch (e) {
    logger.debug("[tawassul] StateManager detach: path capture failed:", e);
  } finally {
    this.released = true;
    StateManager._instances.delete(this);
  }
}

async releaseLock(): Promise<void> {
  await this.resetLock();
}
```

- `detach()` is synchronous and always removes the static Set entry, even if `statePathFn()` throws. The try/finally keeps the pin-breaking step unconditional; the catch is non-silent, so `prove-disclosure.ts` sees a debug catch, not an empty one, and the pinned silent-catch count in `StateManager.ts` stays at 11.
- If path capture succeeds, the replacement closure captures only a string, so `StateManager` can still serve a late save without keeping `TawassulContext` alive. If it throws, the instance is still removed from `_instances` and a late save fails loudly instead of retaining the context.
- `detach()` never rethrows, so the `ContextClass` constructor catch can call it before rethrowing the original error without masking that error.
- While `releaseLock()` is pending, `StateManager` itself remains alive through the promise, but `TawassulContext` is no longer reachable from it.
- `releaseLock()` runs at the end of teardown, after saves and timers, so the filesystem lock is not released early.
- On the synchronous `isConfigDisabled()` path, `detach()` runs and `releaseLock()` is scheduled with `void`.
- `detach()` is idempotent.
- `resetGlobalLock()` no longer iterates detached instances; this is teardown-only and intended.

### 4.2 ToolSlot and slot state

```ts
export type ToolSlot = {
  live: boolean;
  name: string;
  ctx?: V2Context;
  def?: ToolDefinition;
  validator?: z.ZodType<Record<string, unknown>> | null;
  askFactory?: AskFactory;
};

export type ToolSlotState = {
  closed: boolean;
  slots: ToolSlot[];
};

export class ToolDisposedError extends Error {
  readonly code = "TOOL_DISPOSED";
  constructor(name: string) {
    super(`Tool "${name}" is no longer available: plugin instance disposed`);
    this.name = "ToolDisposedError";
  }
}

export async function executeV2Tool(
  slot: ToolSlot,
  args: Record<string, unknown>,
  context: V2ToolContext,
): Promise<unknown> {
  const ctx = slot.ctx;
  const def = slot.def;
  const validator = slot.validator;
  const askFactory = slot.askFactory;
  const name = slot.name;
  if (!slot.live || !ctx || !def) throw new ToolDisposedError(name);
  const v1Context = buildV1ToolContext(ctx, context, askFactory);
  if (validator) {
    const parsed = validator.safeParse(args ?? {});
    if (!parsed.success) {
      throw new Error(`Invalid input for tool "${name}": ${formatIssues(parsed.error)}`);
    }
    return toV2Result(await def.execute(parsed.data, v1Context));
  }
  return toV2Result(await def.execute(args, v1Context));
}

export function closeToolSlots(state: ToolSlotState): void {
  state.closed = true;
  for (const slot of state.slots) {
    slot.live = false;
    slot.ctx = undefined;
    slot.def = undefined;
    slot.validator = undefined;
    slot.askFactory = undefined;
  }
  state.slots.length = 0;
}
```

- `ToolSlot.validator` is typed `z.ZodType<Record<string, unknown>> | null` because `makeV2Tool` produces `ZodObject<...> | null` at `src/v2/adapters.ts:153`; without `| null` strict mode rejects the slot assignment with TS2322. `safeParse` narrows `parsed.data` without an `any` cast.

`makeV2Tool` gains an optional sixth parameter `slotState?: ToolSlotState`:

```ts
if (slotState?.closed) {
  return {
    name,
    description: def.description,
    input: schema && Object.keys(schema).length > 0 ? schema : EMPTY_INPUT_SCHEMA,
    options: { codemode: false },
    execute: executeV2Tool.bind(undefined, { live: false, name }),
  };
}
const slot: ToolSlot = { live: true, name, ctx, def, validator, askFactory };
slotState?.slots.push(slot);
return {
  name,
  description: def.description,
  input: schema && Object.keys(schema).length > 0 ? schema : EMPTY_INPUT_SCHEMA,
  options: { codemode: false },
  execute: executeV2Tool.bind(undefined, slot),
};
```

- A slot created after close is born dead and carries no `ctx`, `def` or `askFactory`.
- `bind` stores the slot in `[[BoundArguments]]` and does not carry the `makeV2Tool` activation record.
- The transform callback and the `reload` path also check the closed flag before re-registering.

### 4.3 Disposal ordering

In `runCleanup`, in the same synchronous turn:

```ts
disposed = true;
closeToolSlots(toolSlotState);
relayAbort.abort();
```

- `closeToolSlots` runs before any `await`, so an abandoned cleanup step cannot skip it.
- Tool unregistration stays in the existing `registered` loop. Moving it would break `scripts/prove-cleanup-bound.ts:157,162` and `scripts/prove-e38.ts:266,311`, which require reload-end before tool-dispose.
- Closing the slots is sufficient to make every routed call fail closed with `ToolDisposedError` until the host unregisters the tools.
- On tool registration failure, `closeToolSlots(toolSlotState)` runs in the catch block.

### 4.4 Setup wiring

- Import `closeToolSlots` from `./adapters.ts` and `ToolSlotState` with a separate `import type`; `verbatimModuleSyntax: true` rejects a value import that carries a type (TS1484). The `.js` extension also resolves, but `setup.ts` uses `.ts` throughout.
- Declare `const toolSlotState: ToolSlotState = { closed: false, slots: [] };` before the tool registration block.
- Hoist `let toolRegistration: { dispose: () => unknown } | undefined;` above the tool-registration `try`; the current `const` is block-scoped at `setup.ts:762`, so a post-registration catch cannot reference it. Assign it inside the `try`.
- Pass it as the sixth argument at the existing call site: `makeV2Tool(ctx, name, def, schemas.get(name), askFactory, toolSlotState)`.
- Add `if (toolSlotState.closed) return;` at the top of the `ctx.tool.transform` callback. `ctx.tool.reload()` re-applies the stored callbacks, so the same guard covers a post-close reload; `setup.ts` has no separate re-registration.
- Call `closeToolSlots(toolSlotState)` immediately after `disposed = true` in `runCleanup` and in the tool-registration catch block.
- Wrap the post-registration setup body in `try/catch`; on throw, call `closeToolSlots(toolSlotState)` and `await toolRegistration?.dispose()` before rethrowing, so a late setup failure cannot leave live slots. The catch is non-silent (cleanup plus rethrow), so the `prove-disclosure` silent-catch census is unchanged.
- The early init paths at `plugin-init.ts:494-501` run before any slot exists, so there is nothing to close there.
- The `ContextClass` constructor catch skips the trailing `mark("context:ctor:end")`/`measure(...)` on failure; `plugin-init.ts:612` is also skipped. This is an unmeasured failure path, not a behavior regression.

## 5. File changes

| File | Change |
| --- | --- |
| `src/context/managers/StateManager.ts` | Add `released` flag, synchronous total `detach()` (try/finally plus a non-silent debug catch), async `releaseLock()`. |
| `src/services/lifecycle-controller.ts` | Call `detach()` at the top of `destroy()`; call `releaseLock()` in a `try/finally` around the body. |
| `src/bootstrap/plugin-init.ts` | Call `detach()` synchronously in the `isConfigDisabled()` path and at the top of `disposeInstance()`; when `hooks` is absent, schedule `void releaseLock()` so cleanup does not depend on the setup cleanup closure. |
| `src/context-class.ts` | After `StateManager` is created, wrap the remainder of the constructor in `try/catch`; on throw, call `_stateManager?.detach()` and rethrow. The catch is non-silent, so the `prove-disclosure` census is unchanged. |
| `src/v2/adapters.ts` | Add `ToolSlot`, `ToolSlotState`, `ToolDisposedError`, `executeV2Tool`, `closeToolSlots`; extend `makeV2Tool`. |
| `src/v2/setup.ts` | Create `toolSlotState`, pass it to `makeV2Tool`, guard the transform callback and `reload`, close it synchronously in `runCleanup`; keep `toolRegistration` in the existing `registered` order. |
| `scripts/prove-state-manager-release.ts` | New proof: negative control plus detach and lock release. |
| `scripts/prove-v2-tool-retention.ts` | New proof: host-held execute, stale call, in-flight call, two instances. |
| `scripts/prove-reload-live.ts` | Extended for tool slot lifecycle coverage. |
| `scripts/prove-proof-catalog.ts` | Update `PINNED_PROOF_FILES` 193 -> 195 and `PINNED_PROOF_STEPS` 190 -> 192. |
| `scripts/generate-proof-count.ts` | Regenerate markers. |
| `AGENTS.md`, `TRIAGE.md`, `docs/validation.md`, `docs/portable-context-handoff.md` | Generated proof-count markers. `README.md` is listed by the generator but carries only the skills table, so it has no proof-count marker to refresh. |
| `scripts/gate-manifest.json` and `scripts/proof-shards.json` | Register two proofs, insert the names into the sorted `PINNED_PROOF_FILES` list (compared with `JSON.stringify` at `prove-proof-catalog.ts:274`), rebalance shards under the `max <= 1.1 * mean` rule enforced at `prove-proof-catalog.ts:329`, and update `totalEstimateMs`. The gate budget is `TOTAL_TIMEOUT_MS = 1_800_000` and `STEP_TIMEOUT_MS = 240_000` (`scripts/gate.ts:68-69`), not a 900 s budget. |
| `package.json` | Optional: add `prove:state-manager-release` and `prove:v2-tool-retention` scripts for local runs; the gate uses `gate-manifest.json`, so this is not required for `verify`. |
| `scripts/prove-dispose-bounded.ts`, `scripts/prove-e17.ts`, `scripts/prove-cleanup-bound.ts`, `scripts/prove-e38.ts`, `scripts/prove-disclosure.ts` | Verify the teardown order, the `makeV2Tool` contract, the cleanup bound, the reload-end/tool-dispose order, and the unchanged silent-catch count. |

## 6. Semantics

- A call after dispose throws `ToolDisposedError`, not `TypeError`.
- A call already in flight captures `ctx`, `def`, `validator` and `askFactory` synchronously at entry and completes safely.
- `execute.before` permissions are unchanged. The deny list still sees `agent` and `sessionID`.
- A call that passes `execute.before` just before close and reaches `execute` after close fails with `ToolDisposedError`. This is an accepted teardown-only regression; the slots close before any await, so the failure is deterministic regardless of when the host unregisters the tools.
- A call that reaches `execute.before` after close may fail earlier in the host hook with the init-not-ready error; the `ToolDisposedError` guarantee starts at the tool `execute` stage.
- In-flight tool calls complete from local references. Background tasks that hold their own references are out of scope; the slot guarantees stale-call behavior only.
- The 44 tool names, descriptions, schemas and `options.codemode = false` are unchanged.
- `initPlugin` is synchronous, so the early-disable path uses `detach()` without `await`; lock release is scheduled separately.
- If tool registration fails after partial registration, the slots are closed and any partially registered tool fails with `ToolDisposedError` for the rest of that setup; this is intentional fail-closed.
- Eviction is defined relative to the cleanup closure. A supersede path that calls `previousDispose` without the cleanup closure is out of scope and tracked as a follow-up.
- The design assumes the host does not retain the setup's returned cleanup closure; the hook-only probe supports this. A retained cleanup closure would pin `plugin.tawaCtx` directly, which no slot can release.

## 7. Proofs

### 7.1 StateManager detach

Child process with forced GC:

1. Create a `StateManager` with a temporary directory and a `statePathFn` that closes over a sentinel.
2. Keep `WeakRef` handles to the manager and the sentinel.
3. Negative control: drop strong references without `detach()`, force GC, observe that the references survive because `_instances` still holds the manager.
4. Create a second manager, call `detach()`, drop strong references including the local reference to the original `statePathFn` closure, force GC across multiple passes, observe that the manager, the context-like sentinel, and the path-closure sentinel are all cleared; verify the frozen path only through the public `getDiskRevision()`/`saveWithRevision()` surface, never by reading the private `statePathFn` field.
5. After `detach()`, call `getDiskRevision()` and a save/load roundtrip; assert both target the frozen original path and never an empty path. Pre-create a 32-byte key and set `TAWASSUL_HMAC_KEY_DIR` as in `prove-reload-live.ts:50-58` for determinism; a fresh process also auto-creates a key, but a detect-only cache (`resetHmacKeyCache`) makes `tryLoadFile` return `null`. No save-path guard is added; this is the documented late-save behavior.
6. Run one manager whose `statePathFn` throws: assert `detach()` never rethrows, the manager is still removed from the static set (its `WeakRef` clears), a late `getDiskRevision()` rejects loudly, and a second `detach()` is a no-op. Do not assert the throwing closure's sentinel: JavaScriptCore can conservatively retain a throwing frame's scope after a cross-frame throw. That retention is engine-level noise, not a plugin-rooted reference: the manager root is collected, so the closure is unreachable from plugin state. Record this as a residual in the proof output.
7. Call `detach()` twice on the non-throwing manager and assert idempotence; call `releaseLock()` afterwards and assert a second manager can acquire the same lock immediately, proving the heartbeat stopped.
8. After the second manager acquires, call `releaseLock()` on the first manager again and assert a third manager cannot acquire the lock; then release the second manager and assert the third one acquires. This is the deterministic form of the owner-mismatch test: an already released first manager must not stop the new owner's heartbeat. Do not assert heartbeat expiry advancing from outside `file-lock` internals; record the renewal window as a residual.

### 7.2 Tool retention

Child process with forced GC:

1. Build a slot whose `def.execute` closes over a sentinel.
2. Bind `executeV2Tool` to the slot and hold only the bound function, simulating the host.
3. Negative control: without `closeToolSlots`, force GC, assert the references survive.
4. Call `closeToolSlots`, force GC, assert the context, definition, and sentinel weak references are cleared while the bound function is still held.
5. Call the bound function and assert `ToolDisposedError`.
6. Start a call that awaits a gate, close the slots mid-call, release the gate, assert the call completes with its result.
7. Create two separate `ToolSlotState` instances, close one, assert a slot from the other still executes; `closeToolSlots` closes a whole state, so a single state cannot prove partial close.
8. Create a slot through a closed `ToolSlotState` and assert it is born dead with no `ctx`.
9. This proof covers the tool `execute` stage only; the host-level `execute.before` path is covered by existing init-readiness behavior and is not part of the deterministic slot guarantee.

### 7.3 Integration

- The deterministic WeakRef gate lives in `scripts/prove-v2-tool-retention.ts`: it holds only the bound `execute`, proves `ctx`, `def`, and the sentinel survive without close, then clears after `closeToolSlots`. It drops the V1 definition, context, and sentinel locals by construction and runs a GC canary in one isolated Bun process.
- Extend `prove-reload-live.ts` with the integrated behavioral assertion: keep a `retained` V2 definition from the fake host registry, call the cleanup closure without awaiting it, and assert the retained tool rejects with `ToolDisposedError` before the cleanup promise settles.
- Do not run a WeakRef assertion in `prove-reload-live.ts`: `hooks` and `tools` retain every V1 definition, so a naive assertion is vacuous without dropping those locals, and `WeakRef.deref()` keeps targets alive until the end of the current job.
- Add a negative control without dispose in the dedicated proof.
- Verify synchronous close behaviorally: call the cleanup closure without awaiting it, then immediately call a retained tool `execute` and assert it rejects with `ToolDisposedError` before the cleanup promise settles. No new export is added.
- Register the new proofs in the catalog and gate manifest, and update the generated counts.

### 7.4 GC mechanism

- No existing proof uses `--expose-gc`, `Bun.gc` or `WeakRef`; every gate proof runs through `bun` (`scripts/gate-manifest.json` and `scripts/gate.ts`), not Node.
- Bun is built on JavaScriptCore, so `Bun.gc(true)` is the correct lever for these proofs. Node/V8 is used only by the static gate scripts; a GC proof must not assume Node. If a proof is ever run under Node, it needs `--expose-gc` and `global.gc()`, and the proof must fail explicitly when that hook is absent.
- E-66 already recorded a `Bun.gc(true)` module-eval probe in the live host (`ISSUES.md`), so the measured host path and the proofs share the Bun runtime.
- Use `Bun.gc(true)` followed by a bounded retry loop across macrotask turns; run at least three passes with allocation churn between passes, because one pass is not reliable for generational promotion in JavaScriptCore.
- Drop every local strong reference before each pass, including the original `statePathFn` closure; otherwise both the positive and negative controls can be wrong.
- Require a canary `WeakRef` to clear; if the canary survives after the retry budget, fail explicitly, do not skip.
- The retry loop has an explicit timeout that fails the proof with diagnostics; it never skips or marks the proof green on a GC timeout.
- Record the Bun version in the proof output.
- `WeakRef.deref()` keeps the target alive until the end of the current job, so the retry loop must yield between attempts.

## 8. Measurement

1. Restart the host for a clean baseline (`npm run host:refresh -- --restart`).
2. Build and verify the global artifact (`npm run build`, `npm run verify:global`), then record RSS and `heapUsed` after three reloads across seven workspaces.
3. Primary acceptance is deterministic: the host-held `execute` proof clears `WeakRef(ctx)` and `WeakRef(def)`.
4. Secondary acceptance: post-GC `process.memoryUsage().heapUsed` slope over three reloads is at most 5 MiB per seven-workspace reload cycle, compared with the current ~182 MB per two reloads. Measure after a forced GC before each sample, and compute the slope as `(sample3 - sample1) / 2`, matching the E-66 method. Use the same temporary module-eval probe documented in E-66 (not committed) to force GC; it calls `Bun.gc(true)`, matching the live Bun host. If the host is ever Node-based, the probe must use `--expose-gc` plus `global.gc()` and fail when the hook is absent. Do not add permanent diagnostics. Read RSS from external `ps`. Report RSS separately.
5. Re-run the N3 window only after the slope is flat. Record the result honestly.
6. Update E-66 in `ISSUES.md` with the before and after numbers.

## 9. Risks

1. Filesystem lock orphaned if `detach()` runs but `releaseLock()` is skipped. Mitigation: `detach()` at the top, `releaseLock()` in a `try/finally` at the end, and `void releaseLock()` on the early-disable path. `releaseFSLock` swallows all errors (`src/infra/file-lock.ts:359-404`), so `releaseLock()` does not reject in practice. The lock is not held between saves: each save acquires it and `releaseFSLock` stops the heartbeat when it releases (`src/infra/file-lock.ts:405-407`). The real orphan case is a hung `flushSaves`: `doSave` awaits `_saveCompletionPromise` without a bound (`src/services/state-persistence.ts:874-877`), the 5 s cleanup bound abandons the step but does not cancel `destroy()`, so the `finally` never runs. A live pid keeps the owner check true even past the TTL (`src/infra/file-lock.ts:339-351`), so that workspace cannot save until process exit. This plan does not fix the hang; it is recorded as a residual.
2. A pending save after `detach()` still writes to the captured path. Mitigation: the path is a plain string when capture succeeds and saves remain valid. The only new catch is the non-silent detach catch; it does not change the silent-catch census.
3. `destroy()` exceeds the 5 s cleanup ceiling and is abandoned. Mitigation: the pin is broken synchronously by `detach()`; tool slots close synchronously. The step is abandoned, not cancelled: if `destroy()` is stuck in `flushSaves`, the lock release in its `finally` does not run either (see risk 1).
4. A host `reload` re-applies the stored transform after close. Mitigation: `ToolSlotState.closed` is checked at the top of the transform callback, which is the callback `ctx.tool.reload()` re-runs; `setup.ts` has no second registration site.
5. Background tasks that hold their own references can outlive dispose; the slot only guarantees stale-call behavior. Mitigation: the integration proof drops relay/background controls and measures residual retention; add generation leases only if evidence shows retention.
6. RSS does not fall even when objects are released. Mitigation: weak-reference proof is the acceptance gate; heap slope is secondary; RSS is reported separately.
7. A supersede path that bypasses the cleanup closure leaves the old transform callback registered, so the callback's captures (`wrapped`, `askFactory`) and its live slots stay reachable. Mitigation: acceptance is defined on the cleanup closure; a follow-up passes `closeToolSlots` into `disposeInstance` and disposes the transform registration, or empties the captured `wrapped` holder, on supersede.
8. A workspace unloaded without dispose and without a later setup for the same directory remains pinned until process exit; `activePluginInstances` (`src/bootstrap/plugin-init.ts:423-425`) retains the `disposeInstance` closure until then. The measured reload path calls dispose; this limitation is documented rather than covered.
9. A constructor failure after `StateManager` creation leaves the instance in `_instances` because `tawaCtx` is never assigned. Mitigation: `ContextClass` wraps the post-`StateManager` constructor body and calls `_stateManager?.detach()` before rethrowing; `detach()` is total and always deletes the static entry, so it cannot mask the original error.

## 10. Rejected alternatives

| Alternative | Reason |
| --- | --- |
| Global `RuntimeRegistry` keyed by generation | Equivalent release guarantee but adds global state, keys, sweeps and a second retention path; does not fix R1; the process-wide generation counter risks collisions across seven parallel workspaces. |
| WeakRef payload | No guaranteed strong owner during a live call; GC timing is nondeterministic. |
| FinalizationRegistry | Cannot fire while a strong map holds the target; production timing nondeterminism. |
| Single generic tool or codemode-only surface | Breaks 44 tool names, schemas and per-tool permissions. |
| Lazy or on-demand registration | Does not break retention; the host still holds the definition. |
| Host patch only | Correct long-term fix, but outside this repository and not a blocker for the local guard. |

## 11. Acceptance criteria

1. Negative control survives without `detach()`; weak references clear with `detach()`.
2. Host-held `execute` cannot keep `ctx` or `def` alive after the cleanup closure and forced GC.
3. Stale calls throw `ToolDisposedError`; in-flight calls complete.
4. Two instances do not interfere; seven workspaces do not cross-release.
5. A slot created after close is born dead and captures no context.
6. 44 tools and schemas unchanged; all existing proofs, the two new proofs, the fast gate and the global verification are green.
7. The deterministic weak-reference proof is the acceptance gate. The three-reload post-GC `heapUsed` slope is diagnostic: at most 5 MiB per seven-workspace cycle using `(sample3 - sample1) / 2`; a larger residual blocks acceptance until a third leak is proven and fixed or the user explicitly accepts it.

## 12. Rollback

- Revert `StateManager.detach()` and `releaseLock()` and their call sites.
- Revert the `ToolSlot` path and restore the original `makeV2Tool` execute closure.
- Remove the two new proofs, catalog entries, gate-manifest entries, proof-shard rebalance and generated markers.
- No data migration and no state format change.

## 13. Implementation record

- `npm run verify` is green: fast gate (16 steps) and both builds complete.
- `scripts/prove-state-manager-release.ts` passes 14 assertions in an isolated Bun process: the negative control survives, `detach()` clears the manager and the original path-closure sentinel, a failing path never rethrows and still removes the manager root, a frozen path survives a late save/load, and `releaseLock()` does not release a later owner's lock.
- `scripts/prove-v2-tool-retention.ts` passes 15 assertions in an isolated Bun process: the negative control keeps `ctx`, `def`, and the sentinel alive; `closeToolSlots` clears all three while the host-held `execute` stays bound; stale calls throw `ToolDisposedError`; in-flight calls complete; separate states do not interfere; a slot created after close is born dead.
- `scripts/prove-reload-live.ts` passes the integrated assertion: a tool retained from the fake host registry rejects with `ToolDisposedError` before the cleanup promise settles.
- `scripts/prove-dropped-persist.ts` passes 13 assertions and now also asserts that `destroy()` detaches once and releases the lock once across repeated calls.
- Proof shards 2, 3, and 4 pass in full (49, 49, and 50 steps). Before the crontab ownership fix, shard 1 passed 43 of 44 steps because `global-install` failed on this machine with an unreadable crontab spool (`crontab -l` prints `crontabs/htoz/: fopen: Permission denied`); after that fix landed, shard 1 passes 44 of 44. The A/B refusal path is a product gap, not only an environment effect; it is tracked and repaired by `docs/plans/tawassul-crontab-ownership-fix-plan.md`.
- The live three-reload `heapUsed` slope from §8 was measured on 2026-11-27 (see the final bullet); it remains the diagnostic acceptance step and is not claimed as met.
- The isolated measurement lab (`/tmp/opencode/lab/memory-lab.ts`, Bun 1.3.14, `Bun.gc(true)`, isolated XDG/DB/HMAC key) passes 20/20 assertions:
  - the negative control holds 300 StateManagers and shows 2658 KiB retained; detaching them releases all but 216 KiB;
  - 300 StateManager create/detach cycles retain 3 KiB with a -0.02 KiB/iteration slope;
  - 300 tool-slot create/close cycles retain 144 KiB with a 0.33 KiB/iteration slope, and a host-held stale execute throws `ToolDisposedError`;
  - 200 throwing-detach cycles have a 0.07 KiB/iteration slope;
  - 50 lock acquire/release cycles all acquire in 41 ms;
  - an in-flight tool call completes after `closeToolSlots`;
  - 12 full `TawassulContext` create/destroy cycles retain 861 KiB with a 62.83 KiB/iteration slope. A destroy-only instance stays reachable, but the plugin-dispose proxy (`stateManager.detach()` + `agentManager.stopRefresh()` + `destroy()`) collects every instance across 8 cycles (final heap 1511 KiB below the warmed baseline, slope 25.86 KiB/iteration). The live host reload remains the only missing measurement; these numbers are component and context proxies.
- Live measurement (2026-11-27, probe removed afterwards): three `host:refresh` reloads with a 60 s post-eval heap probe gave 428.5 -> 489.8 -> 558.8 MB heap (+61.3 and +69.0 MB) and 1004 -> 1081 -> 1183 MB RSS. The slope is still positive, so the §8 acceptance target is not met and no success is claimed. That probe had no GC canary, no clean restart baseline, and sampled process-wide heap, so it is not admissible as acceptance evidence. In a separate in-repo experiment the callback-indirection fix was applied on top of HEAD: all targeted proofs and `gate:fast` passed (no breakage), but a strict-canary proof with an 8 MiB tool payload measured 0.00 MiB pinned after cleanup on unmodified HEAD, and its WeakRef case passed 5/5 on unmodified HEAD. The fix was therefore reverted; no host-retained callback leak was demonstrated. The first fix remains proven. No further code change is made without in-repo proof.
