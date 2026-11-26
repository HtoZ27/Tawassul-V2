import "./proof-log-isolate.ts";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateManager } from "../src/context/managers/StateManager.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed += 1;
  console.log(`ok ${name}`);
}

const gc = (globalThis as { Bun?: { gc?: (force?: boolean) => void } }).Bun?.gc;
if (typeof gc !== "function") fail("Bun.gc is unavailable; run this proof with bun");
console.log(`runtime: bun ${(globalThis as { Bun?: { version?: string } }).Bun?.version ?? "unknown"}`);

const work = mkdtempSync(join(tmpdir(), "tawassul-state-release-"));
const keyDir = join(work, "keys");
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });

process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
process.env.XDG_CONFIG_HOME = join(work, "config");
process.env.XDG_DATA_HOME = join(work, "data");
process.env.XDG_STATE_HOME = join(work, "state");
process.env.XDG_CACHE_HOME = join(work, "cache");
process.env.OPENCODE_DB = join(work, "opencode.db");
delete process.env.TAWASSUL_ISOLATED;

const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function collect(refs: Array<WeakRef<object>>): Promise<boolean[]> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const canary = new WeakRef({});
    gc!(true);
    for (let spin = 0; spin < 4; spin += 1) await turn();
    if (canary.deref() === undefined) return refs.map((ref) => ref.deref() !== undefined);
  }
  fail("the GC canary did not clear within the retry budget");
}

function makeDetachedPair(): { manager: WeakRef<object>; sentinel: WeakRef<object> } {
  const sentinel = { path: join(work, "detached.json") };
  const manager = new StateManager(join(work, "detached"), () => sentinel.path);
  const managerRef = new WeakRef<object>(manager);
  const sentinelRef = new WeakRef<object>(sentinel);
  manager.detach();
  manager.detach();
  return { manager: managerRef, sentinel: sentinelRef };
}

function makeThrowingPair(): { manager: WeakRef<object>; sentinel: WeakRef<object> } {
  const sentinel = { path: join(work, "throwing.json") };
  const failure = new Error("path capture failed");
  const manager = new StateManager(join(work, "throwing"), () => {
    void sentinel.path;
    throw failure;
  });
  const managerRef = new WeakRef<object>(manager);
  const sentinelRef = new WeakRef<object>(sentinel);
  manager.detach();
  return { manager: managerRef, sentinel: sentinelRef };
}

try {
  const negativeSentinel = { path: join(work, "negative.json") };
  let negativeManager: StateManager | undefined = new StateManager(
    join(work, "negative"),
    () => negativeSentinel.path,
  );
  const negativeManagerRef = new WeakRef<object>(negativeManager);
  const negativeSentinelRef = new WeakRef<object>(negativeSentinel);
  negativeManager = undefined;

  const negative = await collect([negativeManagerRef, negativeSentinelRef]);
  assert(negative[0] === true, "the negative control keeps the manager alive through the static set");
  assert(negative[1] === true, "the negative control keeps the path sentinel alive through the closure");

  const detached = makeDetachedPair();
  const cleared = await collect([detached.manager, detached.sentinel]);
  assert(cleared[0] === false, "detach releases the manager from the static set");
  assert(cleared[1] === false, "detach releases the original path closure sentinel");

  const frozenDir = join(work, "frozen");
  mkdirSync(frozenDir, { recursive: true });
  const frozenPath = join(frozenDir, "state.json");
  const frozen = new StateManager(frozenDir, () => frozenPath);
  frozen.detach();
  frozen.detach();
  const revision = await frozen.getDiskRevision();
  assert(revision === 0, "getDiskRevision uses the frozen path after detach");
  await frozen.saveWithRevision({ records: [] }, 0);
  const loaded = await frozen.tryLoadFile(frozenPath);
  assert(loaded !== null, "a late save and load roundtrip succeeds on the frozen path");
  assert(
    (loaded?._meta as { revision?: number } | undefined)?.revision === 1,
    "the late save writes the expected revision",
  );
  await frozen.releaseLock();

  const throwing = new StateManager(join(work, "throwing"), () => {
    throw new Error("path capture failed");
  });
  let detachThrew = false;
  try {
    throwing.detach();
  } catch {
    detachThrew = true;
  }
  assert(!detachThrew, "detach never rethrows when path capture fails");
  let lateReadRejected = false;
  try {
    await throwing.getDiskRevision();
  } catch {
    lateReadRejected = true;
  }
  assert(lateReadRejected, "a late read fails loudly when path capture failed");

  const throwingPair = makeThrowingPair();
  const throwingCleared = await collect([throwingPair.manager, throwingPair.sentinel]);
  assert(throwingCleared[0] === false, "detach on a failing path still removes the manager root");
  console.log(
    "residual: after a throw JSC may conservatively keep the throwing closure scope; the manager root is collected, so the closure is unreachable from plugin state",
  );

  const lockDir = join(work, "lock");
  const lockPath = join(lockDir, "state.json");
  const first = new StateManager(lockDir, () => lockPath);
  const firstAcquired = await first.acquireStateLock("proof-first");
  assert(firstAcquired, "the first manager acquires the state lock");
  await first.releaseLock();
  const second = new StateManager(lockDir, () => lockPath);
  const secondAcquired = await second.acquireStateLock("proof-second");
  assert(secondAcquired, "a second manager acquires the same lock after releaseLock");
  await first.releaseLock();
  const third = new StateManager(lockDir, () => lockPath);
  const blocked = await third.acquireStateLock("proof-third");
  assert(!blocked, "a repeated releaseLock on the first manager does not release the second owner");
  await second.releaseLock();
  const thirdAcquired = await third.acquireStateLock("proof-third");
  assert(thirdAcquired, "the third manager acquires after the real owner releases");
  await third.releaseLock();
  console.log("residual: heartbeat renewal over 20 s is not asserted; owner mismatch is covered by file-lock internals");

  console.log(`PROOF PASS: detach breaks both StateManager pins and releaseLock frees the lock (${passed} assertions)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
