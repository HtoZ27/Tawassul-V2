import { claimCoexistence, isCoexistenceOwner, releaseCoexistence } from "../src/core/install-scope.ts";

const KEY = Symbol.for("tawassul.v2.setup");

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

function resetSeat(): void {
  delete (globalThis as Record<symbol, unknown>)[KEY];
}

resetSeat();
assert(claimCoexistence("project", "/ws/a/entry", "/ws/a").shouldRegister === true, "workspace A registers");
assert(claimCoexistence("project", "/ws/b/entry", "/ws/b").shouldRegister === true, "workspace B registers independently");
assert(isCoexistenceOwner("project", "/ws/a/entry", "/ws/a") === true, "A stays owner");
assert(isCoexistenceOwner("project", "/ws/b/entry", "/ws/b") === true, "B stays owner");
assert((globalThis as Record<symbol, unknown>)[KEY] instanceof Map, "registry is a per-workspace Map");

resetSeat();
assert(claimCoexistence("global", "/cfg/global", "/ws/a").shouldRegister === true, "global claims workspace A");
assert(claimCoexistence("project", "/ws/a/project", "/ws/a").shouldRegister === true, "project supersedes global in A");
assert(isCoexistenceOwner("global", "/cfg/global", "/ws/a") === false, "superseded global is inert in A");
assert(isCoexistenceOwner("project", "/ws/a/project", "/ws/a") === true, "project owns A");
assert(claimCoexistence("global", "/cfg/global", "/ws/a").shouldRegister === false, "global cannot reclaim A");

resetSeat();
assert(claimCoexistence("project", "/ws/a/first", "/ws/a").shouldRegister === true, "first same-scope copy owns A");
const dup = claimCoexistence("project", "/ws/a/second", "/ws/a");
assert(dup.shouldRegister === false && (dup.reason ?? "").includes("/ws/a"), "distinct same-scope copy yields with workspace reason");
assert(isCoexistenceOwner("project", "/ws/a/second", "/ws/a") === false, "losing copy is not owner");

resetSeat();
assert(claimCoexistence("project", "/same", "/ws/a").shouldRegister === true, "same-copy claim one");
assert(claimCoexistence("project", "/same", "/ws/a").shouldRegister === true, "same-copy claim two is idempotent");
releaseCoexistence("project", "/same", "/ws/a");
assert(isCoexistenceOwner("project", "/same", "/ws/a") === true, "first release keeps live sibling");
releaseCoexistence("project", "/same", "/ws/a");
assert(isCoexistenceOwner("project", "/same", "/ws/a") === false, "last release drops the seat");
assert((globalThis as Record<symbol, unknown>)[KEY] === undefined, "empty registry removes the global key");

resetSeat();
claimCoexistence("project", "/a/entry", "/ws/a");
claimCoexistence("project", "/b/entry", "/ws/b");
releaseCoexistence("project", "/a/entry", "/ws/a");
assert(isCoexistenceOwner("project", "/a/entry", "/ws/a") === false, "released workspace A is free");
assert(isCoexistenceOwner("project", "/b/entry", "/ws/b") === true, "workspace B survives A's release");

resetSeat();
const store = globalThis as Record<symbol, unknown>;
store[KEY] = { scope: "project", pid: process.pid, token: "/legacy", refs: 1 };
assert(claimCoexistence("project", "/new", "/ws/a").shouldRegister === true, "legacy plain-entry seat is discarded");
assert(store[KEY] instanceof Map && isCoexistenceOwner("project", "/new", "/ws/a") === true, "fresh registry owns the workspace");

resetSeat();
assert(claimCoexistence("project", "/default/entry").shouldRegister === true, "default directory claim works");
assert(isCoexistenceOwner("project", "/default/entry") === true, "default directory owner works");
assert(claimCoexistence("project", "/default/other").shouldRegister === false, "default directory dedups distinct copies");
releaseCoexistence("project", "/default/entry");
assert(store[KEY] === undefined, "default directory release clears the registry");

resetSeat();
console.log("PROOF PASS: s038 per-workspace D4 coexistence ownership");
