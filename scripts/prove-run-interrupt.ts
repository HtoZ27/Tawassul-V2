import "./proof-log-isolate.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TawassulContext } from "../src/context-class.ts";
import { HandoffService } from "../src/services/handoff-service.ts";
import { HealthTracker } from "../src/services/agent-health.ts";
import { CircuitBreaker } from "../src/services/circuit-breaker.ts";
import { createMessageUpdatedHook } from "../src/hooks/message-updated.ts";
import type { MessageUpdatedContext } from "../src/hooks/message-updated-types.ts";
import { mapV2EventToV1 } from "../src/v2/event-adapter.ts";
import { noteExperimentalIdle } from "../src/v2/setup.ts";
import type { HandoffEntry } from "../src/context/types.ts";
import {
  CONTINUITY_CACHE_MAX,
  CONTINUITY_DEBOUNCE_MS,
  CONTINUITY_HEARTBEAT_MS,
  CONTINUITY_STALE_MS,
  classifyOwner,
  clearOwner,
  configureContinuity,
  continuityIoStats,
  heartbeatActive,
  heartbeatTick,
  parseLinuxBootTime,
  parseLinuxStat,
  parseMacBootTime,
  parseMacStart,
  parseMacState,
  parseWindowsDate,
  probeIdentity,
  resetContinuityIoStats,
  selfIdentity,
  selfKey,
  snapshotOwners,
  stampOwner,
  stopHeartbeat,
  touch,
} from "../src/services/continuity/owner.ts";
import type { IdentityFacts, OwnerRecord } from "../src/services/continuity/owner.ts";
import {
  detectInterrupted,
  detectionCacheSize,
  noteIdle,
  resetContinuity,
} from "../src/services/continuity/detect.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

function eq(actual: unknown, expected: unknown, name: string): void {
  const short = (value: unknown): string => {
    const text = String(value);
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  };
  assert(Object.is(actual, expected), `${name} (${short(actual)}/${short(expected)})`);
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "tawassul-run-interrupt-"));

function project(name: string): string {
  const dir = join(work, name);
  mkdirSync(join(dir, ".opencode", "agents"), { recursive: true });
  copyFileSync(join(repo, ".opencode", "agents", "dev.md"), join(dir, ".opencode", "agents", "dev.md"));
  return dir;
}

function ownersPath(base: string): string {
  return join(base, ".opencode", "continuity", "owners.json");
}

function writeOwners(base: string, records: Record<string, OwnerRecord>): void {
  mkdirSync(dirname(ownersPath(base)), { recursive: true });
  writeFileSync(ownersPath(base), JSON.stringify(records));
}

function readOwners(base: string): Record<string, OwnerRecord> {
  return JSON.parse(readFileSync(ownersPath(base), "utf8")) as Record<string, OwnerRecord>;
}

function mustRecord(base: string, id: string): OwnerRecord {
  const found = readOwners(base)[id];
  if (!found) fail(`missing owner record ${id}`);
  return found;
}

function handoff(id: string, status: HandoffEntry["status"] = "accepted"): HandoffEntry {
  return {
    id,
    from: "@tawa",
    to: "dev",
    task: `probe ${id}`,
    context: `the continuity probe observes ${id} across a host restart`,
    files: [],
    timestamp: new Date().toISOString(),
    status,
  };
}

function record(pid: number, startedAt: number, bootId: string, heartbeatAt: string, sessionId = "ses_probe"): OwnerRecord {
  return { pid, startedAt, bootId, heartbeatAt, sessionId };
}

function waitExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
  });
}

function readLine(stream: NodeJS.ReadableStream | null): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stream) {
      reject(new Error("missing stream"));
      return;
    }
    let buffer = "";
    const onData = (chunk: Buffer | string) => {
      buffer += String(chunk);
      const index = buffer.indexOf("\n");
      if (index < 0) return;
      cleanup();
      resolve(buffer.slice(0, index).trim());
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      stream.off("data", onData);
      stream.off("error", onError);
    };
    stream.on("data", onData);
    stream.on("error", onError);
  });
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", reject);
  });
  const pid = child.pid;
  if (!pid) throw new Error("the victim process has no pid");
  await waitExit(child);
  return pid;
}

const running: ChildProcess[] = [];

async function main(): Promise<void> {
  const linuxStat =
    "4242 (node) Z 1 4242 4242 0 -1 4194560 100 0 0 0 10 0 0 0 20 0 7 0 987654 123456 789 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0";
  const parsedStat = parseLinuxStat(linuxStat, 4242);
  assert(parsedStat !== null, "the Linux parser accepts a golden /proc stat line");
  eq(parsedStat?.startedAt, 987654, "the Linux parser reads field 22 as the process start time");
  eq(parsedStat?.processState, "Z", "the Linux parser reads field 3 as the process state");
  assert(parseLinuxStat("4242 (node) Z 1", 4242) === null, "a truncated /proc stat line is unparsable");
  assert(parseLinuxStat(linuxStat, 9999) === null, "the Linux parser rejects a stat line for another pid");
  eq(parseLinuxBootTime("cpu 1 2 3\nbtime 1699999999\nprocesses 100"), "1699999999", "the Linux boot parser reads btime");
  assert(parseLinuxBootTime("cpu 1 2 3") === null, "a missing btime is unparsable");

  const macStart = "Tue Nov  4 10:11:12 2026";
  eq(parseMacStart(macStart), Date.parse(macStart), "the macOS start parser reads ps lstart");
  assert(parseMacStart("not a date") === null, "an unparsable macOS start is rejected");
  eq(
    parseMacBootTime("{ sec = 1699999999, usec = 0 } Tue Nov  4 10:11:12 2026"),
    "1699999999",
    "the macOS boot parser reads the sysctl seconds",
  );
  assert(parseMacBootTime("no boot time") === null, "a missing macOS boot time is unparsable");
  eq(parseMacState("Z+"), "Z", "the macOS state parser reads a zombie");
  eq(parseMacState("S"), "S", "the macOS state parser reads a sleeping process");
  assert(parseMacState("") === null, "an empty macOS state is unparsable");

  const windows = "2026-11-04T10:11:12.1234567-05:00";
  eq(parseWindowsDate(windows), Date.parse("2026-11-04T10:11:12.123-05:00"), "the Windows parser reads CIM dates");
  eq(parseWindowsDate("2026-11-04 10:11:12"), Date.parse("2026-11-04T10:11:12Z"), "the Windows parser accepts a space separator");
  assert(parseWindowsDate("2026-11-04T10:11:12.1234567") !== null, "the Windows parser defaults a missing zone to UTC");
  assert(parseWindowsDate("04/11/2026") === null, "an unparsable Windows date is rejected");

  const boot = "1699999999";
  const base = record(5000, 700, boot, new Date().toISOString());
  eq(classifyOwner(base, null).state, "unknown", "an unavailable backend yields unknown");
  eq(classifyOwner(base, { alive: false, startedAt: 0, bootId: boot, processState: null }).state, "interrupted", "a dead pid is interrupted");
  eq(
    classifyOwner(base, { alive: false, startedAt: 0, bootId: boot, processState: null }).reason,
    "gone",
    "a dead pid records the gone reason",
  );
  eq(
    classifyOwner(base, { alive: true, startedAt: 700, bootId: boot, processState: "Z" }).reason,
    "zombie",
    "a zombie owner records the zombie reason",
  );
  eq(
    classifyOwner(record(5000, 700, "1699999900", base.heartbeatAt), {
      alive: true,
      startedAt: 700,
      bootId: boot,
      processState: "S",
    }).reason,
    "rebooted",
    "a changed boot id records the rebooted reason",
  );
  eq(
    classifyOwner(record(5000, 600, boot, base.heartbeatAt), {
      alive: true,
      startedAt: 700,
      bootId: boot,
      processState: "S",
    }).reason,
    "gone",
    "a reused pid with a different start time is gone",
  );
  const oldAt = new Date(Date.now() - CONTINUITY_STALE_MS - 60_000).toISOString();
  eq(
    classifyOwner(record(5000, 700, boot, oldAt), {
      alive: true,
      startedAt: 700,
      bootId: boot,
      processState: "S",
    }).state,
    "stale",
    "a live owner with an old heartbeat is stale, never interrupted",
  );
  eq(
    classifyOwner(record(5000, 700, boot, new Date().toISOString()), {
      alive: true,
      startedAt: 700,
      bootId: boot,
      processState: "S",
    }).state,
    "live",
    "a live owner with a fresh heartbeat is live",
  );
  assert(CONTINUITY_HEARTBEAT_MS === 60_000, "the heartbeat interval is 60 s");
  assert(CONTINUITY_DEBOUNCE_MS === 60_000, "the detection debounce is 60 s");
  assert(CONTINUITY_STALE_MS === 30 * 60_000, "the stale threshold is 30 minutes");

  const keyDir = join(work, "keys");
  mkdirSync(keyDir, { recursive: true });
  writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
  process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
  process.env.XDG_DATA_HOME = join(work, "data");
  process.env.TAWASSUL_CONTINUITY = "1";
  delete process.env.TAWASSUL_CONTEXT_HANDOFF;

  const killDir = project("kill");
  resetContinuity();
  configureContinuity({ baseDir: killDir });
  const victim = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  running.push(victim);
  await new Promise<void>((resolve, reject) => {
    victim.once("spawn", () => resolve());
    victim.once("error", reject);
  });
  const victimPid = victim.pid;
  if (!victimPid) throw new Error("the SIGKILL victim has no pid");
  const victimFacts = await probeIdentity(victimPid);
  assert(victimFacts !== null && victimFacts.alive, "the live backend sees the victim process");
  const killHandoff = handoff("H-KILL");
  writeOwners(killDir, {
    "H-KILL": record(victimPid, victimFacts?.startedAt ?? 0, victimFacts?.bootId ?? "", new Date().toISOString(), "ses_kill"),
  });
  victim.kill("SIGKILL");
  await waitExit(victim);
  const beforeKillCheck = readFileSync(ownersPath(killDir), "utf8");
  const killResult = await detectInterrupted([killHandoff], { force: true });
  assert(killResult.ran, "the SIGKILL detection runs");
  eq(killHandoff.runState, "interrupted", "a SIGKILLed handoff is interrupted");
  eq(killHandoff.interruptedReason, "gone", "a SIGKILLed handoff records the gone reason");
  assert(
    typeof killHandoff.interruptedAt === "string" && !Number.isNaN(Date.parse(killHandoff.interruptedAt)),
    "a SIGKILLed handoff records the interruption time",
  );
  eq(readFileSync(ownersPath(killDir), "utf8"), beforeKillCheck, "the probe path adds zero owner writes");
  eq(continuityIoStats().writes, 0, "the probe path performs zero owner writes");
  assert(killResult.interrupted.includes("H-KILL"), "the detection result lists the interrupted handoff");

  const zombieDir = project("zombie");
  resetContinuity();
  configureContinuity({ baseDir: zombieDir });
  if (process.platform !== "win32") {
    const script = [
      "import os, sys, time",
      "pid = os.fork()",
      "if pid == 0:",
      "    os._exit(0)",
      "sys.stdout.write(str(pid) + chr(10))",
      "sys.stdout.flush()",
      "time.sleep(120)",
    ].join("\n");
    const parent = spawn("python3", ["-c", script], { stdio: ["ignore", "pipe", "ignore"] });
    running.push(parent);
    const zombiePid = Number(await readLine(parent.stdout));
    assert(Number.isInteger(zombiePid) && zombiePid > 0, "the zombie fixture reports its child pid");
    const becameZombie = await waitFor(async () => (await probeIdentity(zombiePid))?.processState === "Z");
    assert(becameZombie, "the live backend observes the zombie state");
    const zombieFacts = await probeIdentity(zombiePid);
    assert(zombieFacts !== null && zombieFacts.alive, "a zombie still counts as an existing process");
    const zombieHandoff = handoff("H-ZOMBIE");
    writeOwners(zombieDir, {
      "H-ZOMBIE": record(zombiePid, zombieFacts?.startedAt ?? 0, zombieFacts?.bootId ?? "", new Date().toISOString()),
    });
    const zombieResult = await detectInterrupted([zombieHandoff], { force: true });
    eq(zombieHandoff.runState, "interrupted", "a zombie owner is interrupted");
    eq(zombieHandoff.interruptedReason, "zombie", "a zombie owner records the zombie reason");
    assert(zombieResult.interrupted.includes("H-ZOMBIE"), "the detection result lists the zombie handoff");
    parent.kill("SIGKILL");
    await waitExit(parent);
  } else {
    const zombieHandoff = handoff("H-ZOMBIE");
    writeOwners(zombieDir, { "H-ZOMBIE": record(6001, 700, boot, new Date().toISOString()) });
    const zombieResult = await detectInterrupted([zombieHandoff], {
      force: true,
      probe: async () => ({ alive: true, startedAt: 700, bootId: boot, processState: "Z" }),
    });
    eq(zombieHandoff.runState, "interrupted", "a zombie owner is interrupted");
    eq(zombieHandoff.interruptedReason, "zombie", "a zombie owner records the zombie reason");
    assert(zombieResult.interrupted.includes("H-ZOMBIE"), "the detection result lists the zombie handoff");
  }

  const unknownDir = project("unknown");
  resetContinuity();
  configureContinuity({ baseDir: unknownDir });
  const unknownHandoff = handoff("H-UNKNOWN");
  writeOwners(unknownDir, { "H-UNKNOWN": record(6100, 700, boot, new Date().toISOString()) });
  const unknownResult = await detectInterrupted([unknownHandoff], { force: true, probe: async () => null });
  eq(unknownHandoff.runState, undefined, "an unavailable backend sets no run state");
  eq(unknownHandoff.interruptedAt, undefined, "an unavailable backend sets no interruption time");
  eq(unknownHandoff.interruptedReason, undefined, "an unavailable backend sets no interruption reason");
  assert(unknownResult.unknown.includes("H-UNKNOWN"), "an unavailable backend is reported as unknown");
  const rebootDir = project("reboot");
  resetContinuity();
  configureContinuity({ baseDir: rebootDir });
  const rebootHandoff = handoff("H-REBOOT");
  writeOwners(rebootDir, { "H-REBOOT": record(6200, 700, "1699999900", new Date().toISOString()) });
  await detectInterrupted([rebootHandoff], {
    force: true,
    probe: async () => ({ alive: true, startedAt: 700, bootId: boot, processState: "S" }),
  });
  eq(rebootHandoff.runState, "interrupted", "a rebooted owner is interrupted");
  eq(rebootHandoff.interruptedReason, "rebooted", "a rebooted owner records the rebooted reason");
  const staleDir = project("stale");
  resetContinuity();
  configureContinuity({ baseDir: staleDir });
  const staleHandoff = handoff("H-STALE");
  const oldHeartbeat = new Date(Date.now() - CONTINUITY_STALE_MS - 1).toISOString();
  writeOwners(staleDir, { "H-STALE": record(6300, 700, boot, oldHeartbeat) });
  await detectInterrupted([staleHandoff], {
    force: true,
    probe: async () => ({ alive: true, startedAt: 700, bootId: boot, processState: "S" }),
  });
  eq(staleHandoff.runState, "stale", "a live owner with an old heartbeat is stale");
  eq(staleHandoff.interruptedAt, undefined, "a stale owner is never marked interrupted");
  eq(staleHandoff.interruptedReason, undefined, "a stale owner records no interruption reason");

  const heartbeatDir = project("heartbeat");
  resetContinuity();
  stopHeartbeat();
  const beatHandoff = handoff("H-BEAT");
  const heartbeatHandoffs = new Map<string, HandoffEntry>([[beatHandoff.id, beatHandoff]]);
  configureContinuity({ baseDir: heartbeatDir, handoffs: () => heartbeatHandoffs.values() });
  assert(await stampOwner(beatHandoff, "ses_beat"), "the accept stamp writes an owner record");
  assert(heartbeatActive(), "the accept stamp starts the heartbeat interval");
  eq(beatHandoff.runState, "live", "the accept stamp marks the run live");
  eq(beatHandoff.ownerPid, process.pid, "the accept stamp records the current pid");
  eq(mustRecord(heartbeatDir, "H-BEAT").sessionId, "ses_beat", "the owner record carries the session id");
  const t0 = Date.parse(mustRecord(heartbeatDir, "H-BEAT").heartbeatAt);
  const t31 = t0 + CONTINUITY_STALE_MS + 60_000;
  eq(await heartbeatTick(t31), 1, "one heartbeat tick refreshes the single self-owned record");
  const tickedRecord = mustRecord(heartbeatDir, "H-BEAT");
  eq(tickedRecord.heartbeatAt, new Date(t31).toISOString(), "the heartbeat moves heartbeatAt past the stale window");
  eq(beatHandoff.heartbeatAt, new Date(t31).toISOString(), "the heartbeat mirrors heartbeatAt onto the handoff");
  eq(beatHandoff.runState, "live", "the heartbeat keeps the mirrored run state live");
  const selfFacts = await probeIdentity(process.pid);
  eq(classifyOwner(tickedRecord, selfFacts, t31).state, "live", "a run longer than 30 minutes stays live with a refreshed heartbeat");
  const ownRecord = readOwners(heartbeatDir);
  const otherHeartbeat = new Date(Date.now() - CONTINUITY_STALE_MS - 1).toISOString();
  writeOwners(heartbeatDir, {
    ...ownRecord,
    "H-OTHER": record(process.ppid, 1, boot, otherHeartbeat, "ses_other"),
  });
  await heartbeatTick(t31 + CONTINUITY_HEARTBEAT_MS);
  eq(mustRecord(heartbeatDir, "H-OTHER").heartbeatAt, otherHeartbeat, "a record owned by another live pid is not refreshed");
  eq(mustRecord(heartbeatDir, "H-BEAT").heartbeatAt, new Date(t31 + CONTINUITY_HEARTBEAT_MS).toISOString(), "the self-owned record advances while another pid is present");
  resetContinuityIoStats();
  const concurrentAt = t31 + 2 * CONTINUITY_HEARTBEAT_MS;
  const ticks = await Promise.allSettled([
    heartbeatTick(concurrentAt),
    heartbeatTick(concurrentAt),
    heartbeatTick(concurrentAt),
    heartbeatTick(concurrentAt),
    heartbeatTick(concurrentAt),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const concurrentWrites = continuityIoStats().writes;
  assert(ticks.every((entry) => entry.status === "fulfilled"), "concurrent heartbeat ticks all settle");
  assert(concurrentWrites >= 1 && concurrentWrites <= 2, `five concurrent ticks coalesce into one write and one queued rewrite (${concurrentWrites})`);
  eq(await touch(beatHandoff, concurrentAt + 1_000), true, "touch refreshes a self-owned record");
  eq(mustRecord(heartbeatDir, "H-BEAT").heartbeatAt, new Date(concurrentAt + 1_000).toISOString(), "touch writes the new heartbeat");
  eq(await clearOwner("H-BEAT"), true, "clearOwner removes the self-owned record");
  assert(!("H-BEAT" in readOwners(heartbeatDir)), "the cleared record is absent from owners.json");
  await clearOwner("H-OTHER");
  assert(!heartbeatActive(), "clearing the last self-owned record stops the heartbeat interval");

  const serviceDir = project("service");
  resetContinuity();
  configureContinuity({ baseDir: serviceDir });
  const ctx = new TawassulContext(serviceDir);
  ctx.ensureConfig();
  const service = new HandoffService(ctx, new HealthTracker(), new CircuitBreaker());
  try {
    const accepted = handoff("H-ACC", "pending");
    accepted.from = "@tawa";
    ctx.handoffs.set(accepted.id, accepted);
    const hookCtx = {
      directory: serviceDir,
      detectedMode: "build",
      handoffs: ctx.handoffs,
      records: [],
      seenAgents: new Map<string, Set<string>>(),
      onboardedAgents: new Set<string>(),
      agentModelMap: {} as Record<string, string>,
      config: {},
      saveState: async () => undefined,
      recordHandoffAccepted: () => undefined,
      updateLastActive: () => undefined,
    } as unknown as MessageUpdatedContext;
    const hook = createMessageUpdatedHook(hookCtx);
    const output = { message: { role: "assistant" }, parts: [{ type: "text", text: "accepted" }] };
    await hook({ sessionID: "ses_accept", agent: "dev", messageID: "msg_accept" }, output);
    eq(accepted.status, "accepted", "the v2 message hook accepts the pending handoff");
    eq(accepted.acknowledgedBy, "dev", "the accept transition records the acknowledging agent");
    eq(accepted.ownerPid, process.pid, "the accept transition stamps the owner pid");
    eq(accepted.runState, "live", "the accept transition marks the run live");
    const acceptRecord = (await snapshotOwners())["H-ACC"];
    assert(acceptRecord !== undefined, "the accept transition writes the owner record");
    eq(acceptRecord?.sessionId, "ses_accept", "the owner record carries the accepting session");
    assert(heartbeatActive(), "the accept transition starts the heartbeat");

    const completed = await service.completeHandoff("H-ACC", "dev");
    assert(completed.success, "the recipient completes the accepted handoff");
    eq(accepted.status, "completed", "the completed handoff reaches its terminal status");
    eq(accepted.runState, undefined, "the terminal transition clears runState");
    eq(accepted.interruptedAt, undefined, "the terminal transition clears interruptedAt");
    eq(accepted.interruptedReason, undefined, "the terminal transition clears interruptedReason");
    eq(accepted.ownerPid, process.pid, "the terminal transition keeps the historical owner pid");
    assert(!("H-ACC" in (await snapshotOwners())), "the terminal transition removes the owner record");
    assert(!heartbeatActive(), "the terminal transition stops the heartbeat interval");

    const cancelled = handoff("H-CAN");
    ctx.handoffs.set(cancelled.id, cancelled);
    assert(await stampOwner(cancelled, "ses_cancel"), "the cancel fixture starts with an owner record");
    const cancelledResult = await service.cancelHandoff("H-CAN", "@tawa");
    assert(cancelledResult.success, "the sender cancels the running handoff");
    eq(cancelled.status, "cancelled", "the cancelled handoff reaches its terminal status");
    eq(cancelled.runState, undefined, "cancellation clears runState");
    assert(!("H-CAN" in (await snapshotOwners())), "cancellation removes the owner record");
    assert(!heartbeatActive(), "cancellation stops the heartbeat interval");

    const undone = handoff("H-UND", "completed");
    ctx.handoffs.set(undone.id, undone);
    assert(await stampOwner(undone, "ses_undo"), "the undo fixture starts with an owner record");
    const undoneResult = await service.undoHandoff("H-UND", "@tawa");
    assert(undoneResult.success, "the sender reverts the completed handoff");
    eq(undone.status, "pending", "the reverted handoff is pending again");
    eq(undone.runState, undefined, "undo clears runState");
    eq(undone.resumedAt, undefined, "undo clears resumedAt");
    assert(!("H-UND" in (await snapshotOwners())), "undo removes the owner record");
    assert(!heartbeatActive(), "undo stops the heartbeat interval");
  } finally {
    await ctx.lifecycleManager.destroy();
  }

  const idleDir = project("idle");
  resetContinuity();
  const idleHandoffs = new Map<string, HandoffEntry>();
  configureContinuity({ baseDir: idleDir, handoffs: () => idleHandoffs.values() });
  const idleOne = handoff("H-IDLE1");
  const idleTwo = handoff("H-IDLE2");
  const expOne = handoff("H-EXP1");
  const expTwo = handoff("H-EXP2");
  const deadOne = await deadPid();
  const deadTwo = await deadPid();
  const deadThree = await deadPid();
  const deadFour = await deadPid();
  idleHandoffs.set(idleOne.id, idleOne);
  const idleBoot = (await selfIdentity())?.bootId ?? "";
  writeOwners(idleDir, {
    "H-IDLE1": record(deadOne, 1, idleBoot, new Date().toISOString()),
    "H-IDLE2": record(deadTwo, 1, idleBoot, new Date().toISOString()),
  });
  const idleKey = selfKey(await selfIdentity());
  assert(/^\d+:\d+:\d+$/.test(idleKey), `the debounce key is pid:startedAt:bootId (${idleKey})`);
  mapV2EventToV1({ type: "session.idle", data: { sessionID: "ses_idle" } });
  const adapterRan = await waitFor(() => idleOne.runState === "interrupted");
  assert(adapterRan, "the v2 session.idle adapter runs interrupted detection");
  eq(idleOne.interruptedReason, "gone", "the adapter detection records the gone reason");
  idleHandoffs.set(idleTwo.id, idleTwo);
  mapV2EventToV1({ type: "session.idle", data: { sessionID: "ses_idle" } });
  await new Promise((resolve) => setTimeout(resolve, 300));
  eq(idleTwo.runState, undefined, "a second idle event inside 60 s is debounced");
  const lateIdle = await noteIdle(Date.now() + CONTINUITY_DEBOUNCE_MS + 1_000);
  assert(lateIdle !== null && lateIdle.ran, "idle detection runs again after the 60 s debounce window");
  eq(idleTwo.runState, "interrupted", "the post-debounce idle run observes the second handoff");
  const bootAfterIdle = await detectInterrupted(undefined, { at: Date.now() + 2 * CONTINUITY_DEBOUNCE_MS + 2_000 });
  assert(bootAfterIdle.ran, "boot-style detection runs after the idle debounce window");
  const idleDebounced = await noteIdle(Date.now() + 2 * CONTINUITY_DEBOUNCE_MS + 30_000);
  eq(idleDebounced, null, "boot and idle share the same debounce key");
  resetContinuity();
  const expHandoffs = new Map<string, HandoffEntry>();
  configureContinuity({ baseDir: idleDir, handoffs: () => expHandoffs.values() });
  expHandoffs.set(expOne.id, expOne);
  writeOwners(idleDir, {
    "H-EXP1": record(deadThree, 1, idleBoot, new Date().toISOString()),
    "H-EXP2": record(deadFour, 1, idleBoot, new Date().toISOString()),
  });
  noteExperimentalIdle({ sessionID: "ses_exp", background: [] });
  const expRan = await waitFor(() => expOne.runState === "interrupted");
  assert(expRan, "the experimental.idle registration runs interrupted detection");
  expHandoffs.set(expTwo.id, expTwo);
  noteExperimentalIdle({ sessionID: "ses_exp", background: [] });
  await new Promise((resolve) => setTimeout(resolve, 300));
  eq(expTwo.runState, undefined, "a second experimental.idle event inside 60 s is debounced");

  const cacheDir = project("cache");
  resetContinuity();
  stopHeartbeat();
  const cacheHandoffs = new Map<string, HandoffEntry>();
  const cacheRecords: Record<string, OwnerRecord> = {};
  const cacheEntries: HandoffEntry[] = [];
  let cacheFlushes = 0;
  for (let index = 0; index < CONTINUITY_CACHE_MAX; index += 1) {
    const entry = handoff(`H-CACHE${index}`);
    cacheEntries.push(entry);
    cacheHandoffs.set(entry.id, entry);
    cacheRecords[entry.id] = record(100000 + index, 1, "cache-boot", new Date().toISOString());
  }
  configureContinuity({ baseDir: cacheDir, handoffs: () => cacheHandoffs.values(), flush: async () => { cacheFlushes += 1; } });
  writeOwners(cacheDir, cacheRecords);
  let cacheProbes = 0;
  const cacheFacts = async (_pid: number): Promise<IdentityFacts> => {
    cacheProbes += 1;
    return {
      alive: true,
      startedAt: 1,
      bootId: "cache-boot",
      processState: "S",
    };
  };
  resetContinuityIoStats();
  cacheProbes = 0;
  const cacheBefore = readFileSync(ownersPath(cacheDir), "utf8");
  const firstCacheRun = await detectInterrupted(cacheEntries, { force: true, probe: cacheFacts });
  eq(firstCacheRun.live, CONTINUITY_CACHE_MAX, "the cache run marks every fresh owner live");
  eq(detectionCacheSize(), CONTINUITY_CACHE_MAX, "the probe cache holds one entry per distinct key");
  eq(cacheProbes, CONTINUITY_CACHE_MAX, "the first run probes each distinct key once");
  eq(continuityIoStats().reads, 1, "one detection reads owners.json once");
  eq(cacheFlushes, 1, "a detection that changes run state flushes once");
  resetContinuityIoStats();
  cacheProbes = 0;
  cacheFlushes = 0;
  await detectInterrupted(cacheEntries, { force: true, at: Date.now() + 1_000, probe: cacheFacts });
  eq(cacheProbes, 0, "a second run inside the debounce window reuses every cached probe");
  eq(cacheFlushes, 0, "an unchanged detection run performs no state flush");
  eq(readFileSync(ownersPath(cacheDir), "utf8"), cacheBefore, "detection leaves owners.json byte-identical");
  const extra = handoff("H-CACHE-EXTRA");
  cacheEntries.push(extra);
  cacheHandoffs.set(extra.id, extra);
  const extraRecords = { ...cacheRecords, "H-CACHE-EXTRA": record(200000, 1, "cache-boot", new Date().toISOString()) };
  writeOwners(cacheDir, extraRecords);
  resetContinuityIoStats();
  cacheProbes = 0;
  await detectInterrupted(cacheEntries, { force: true, at: Date.now() + 2_000, probe: cacheFacts });
  eq(detectionCacheSize(), CONTINUITY_CACHE_MAX, "the probe cache stays at its 64-entry cap");
  eq(cacheProbes, 1, "a new key at the cap is probed once");
  eq(readFileSync(ownersPath(cacheDir), "utf8"), JSON.stringify(extraRecords), "detection leaves owners.json byte-identical");
  eq(continuityIoStats().writes, 0, "detection performs zero owner writes");

  console.log(`PROOF PASS: interrupted-run detection is cross-platform, debounced and write-free (${passed} assertions)`);
}

try {
  await main();
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  for (const child of running) {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
  resetContinuity();
  delete process.env.TAWASSUL_CONTINUITY;
  delete process.env.TAWASSUL_HMAC_KEY_DIR;
  delete process.env.XDG_DATA_HOME;
  rmSync(work, { recursive: true, force: true });
}
