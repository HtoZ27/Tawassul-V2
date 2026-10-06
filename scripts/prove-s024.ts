import { mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TimelineStore } from "../src/services/timeline-store.ts";
import { ToolRunLog, NEVER_DEDUP_TOOLS } from "../src/services/tool-run-log.ts";
import { GoalStore } from "../src/services/goal-store.ts";
import { CostTransparencyTracker } from "../src/services/cost-transparency/tracker.ts";
import { UNATTRIBUTED_MODEL_ID } from "../src/services/cost-transparency/types.ts";
import { canonicalize, isSharedDbPath, isolatedDbPathFor } from "../src/bootstrap/db-isolation.ts";
import { writeIfChanged } from "../src/services/persist-utils.ts";
import { SessionObserver } from "../src/services/session-observer.ts";
import { parseUserReply } from "../src/services/ask-channel-parse.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
  console.log(`ok ${msg}`);
}

function nonEmptyLines(path: string): string[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "");
}

const root = mkdtempSync(join(tmpdir(), "s024-"));
try {
  const tlDir = join(root, "tl");
  const tl = new TimelineStore(tlDir, { flushIntervalMs: 3_600_000, maxFlushBuffer: 2 });
  tl.append({ type: "checkpoint", summary: "e1" });
  tl.append({ type: "checkpoint", summary: "e2" });
  tl.append({ type: "checkpoint", summary: "e3" });
  tl.append({ type: "checkpoint", summary: "e4" });
  const stats = tl.getFlushStats();
  assert(stats.buffered === 2, "flush buffer capped at maxFlushBuffer");
  assert(stats.dropped === 2, "overflow drops oldest with count");
  assert(typeof stats.consecutiveFailures === "number" && typeof stats.nextDelayMs === "number", "flush stats shape");
  await tl.dispose();
  assert(nonEmptyLines(join(tlDir, "timeline", "events.jsonl")).length === 2, "capped buffer flushes survivors");

  const metaDir = join(root, "tlmeta");
  const m = new TimelineStore(metaDir, { flushIntervalMs: 3_600_000 });
  m.append({ type: "checkpoint", summary: "m1" });
  await m.flush();
  const eventsPath = join(metaDir, "timeline", "events.jsonl");
  const metaPath = join(metaDir, "timeline", "timeline-meta.json");
  assert(nonEmptyLines(eventsPath).length === 1, "baseline line durable");
  rmSync(metaPath);
  mkdirSync(metaPath, { recursive: true });
  m.append({ type: "checkpoint", summary: "m2" });
  let threw = false;
  try {
    await m.flush();
  } catch {
    threw = true;
  }
  assert(threw, "meta-only failure surfaces");
  assert(nonEmptyLines(eventsPath).length === 2, "append durable despite meta failure");
  let threwAgain = false;
  try {
    await m.flush();
  } catch {
    threwAgain = true;
  }
  assert(threwAgain, "meta still failing retries meta only");
  assert(nonEmptyLines(eventsPath).length === 2, "no duplicate lines on meta-only retry");
  rmSync(metaPath, { recursive: true, force: true });
  await m.flush();
  assert(nonEmptyLines(eventsPath).length === 2, "recovery writes meta without re-append");
  assert(m.getFlushStats().consecutiveFailures === 0, "backoff resets on success");
  await m.dispose();

  assert(NEVER_DEDUP_TOOLS.has("delete"), "dedup set covers delete");
  assert(NEVER_DEDUP_TOOLS.has("kick"), "dedup set covers kick");
  assert(NEVER_DEDUP_TOOLS.has("addagent"), "dedup set covers addagent");
  assert(NEVER_DEDUP_TOOLS.has("handoff"), "dedup set covers handoff");
  const logDir = join(root, "trl");
  mkdirSync(join(logDir, ".opencode"), { recursive: true });
  const log = new ToolRunLog(logDir);
  log.record({ tool: "handoff", agent: "@a", sessionId: "s1", argsHash: "h", status: "success" });
  assert(log.findCrossSessionDuplicate("handoff", "h", Date.now()) === undefined, "handoff never deduped");
  const explicit = log.record({ tool: "bash", agent: "@a", sessionId: "s1", argsHash: "x", status: "error", turn: 99, input: { c: 1 } });
  assert(explicit.turn === 99, "explicit caller turn honored");
  const seq1 = log.record({ tool: "bash", agent: "@a", sessionId: "s2", argsHash: "y", status: "error", input: { c: 2 } });
  assert(seq1.turn === 1, "sequencing starts at one");
  for (let i = 0; i < 5; i++) {
    log.record({ tool: "bash", agent: "@a", sessionId: "s2", argsHash: `z${i}`, status: "error", input: { c: i } });
  }
  await log.save();
  const aged = log.entries.filter((e) => e.sessionId === "s2" && e.status === "error");
  assert(aged.filter((e) => e.input !== undefined).length === 4, "save path ages out stale failed inputs");
  assert(aged.filter((e) => e.input === undefined).length === 2, "recent failed inputs kept");

  const tracker = new CostTransparencyTracker();
  tracker.recordOperation(UNATTRIBUTED_MODEL_ID, 0, 0, { agentId: "@dev", estimated: true });
  const summaries = tracker.getAgentSummaries();
  const dev = summaries.find((s) => s.agent === "dev");
  assert(dev !== undefined && dev.estimatedTaskCount === 1, "summary carries estimate count");

  assert(canonicalize(join(root, "nope")) === join(root, "nope"), "canonicalize falls back on missing path");
  assert(isSharedDbPath(join("x", "opencode", "opencode.db")) === true, "shared db suffix detected");
  assert(isSharedDbPath(join("x", "opencode", "opencode-desktop.db")) === true, "desktop shared db detected");
  assert(isSharedDbPath(join(root, "custom.db")) === false, "custom path stays silent");
  assert(isolatedDbPathFor(root, join(root, "no-key")) === null, "isolated path null without key");
  const keyFile = join(root, "hmac-key");
  writeFileSync(keyFile, Buffer.alloc(32, 7));
  const iso = isolatedDbPathFor(root, keyFile);
  assert(iso !== null && iso.includes("opencode-projects") && iso.endsWith("opencode.db"), "isolated path keyed by canonical root");

  const wifPath = join(root, "wif.txt");
  assert((await writeIfChanged(wifPath, "a")) === true, "writeIfChanged writes missing file");
  assert((await writeIfChanged(wifPath, "a")) === false, "writeIfChanged skips identical content");

  const tornDir = join(root, "torn");
  mkdirSync(join(tornDir, "goals"), { recursive: true });
  writeFileSync(join(tornDir, "goals", "goals.jsonl"), '{"torn', "utf-8");
  const torn = new GoalStore(tornDir);
  await torn.ensureLoaded();
  assert((torn as unknown as { tornTailNeedsSep: boolean }).tornTailNeedsSep === true, "torn tail arms separator");
  writeFileSync(
    join(tornDir, "goals", "goals.jsonl"),
    JSON.stringify({ id: "G-1", seq: 1, title: "clean", status: "open" }) + "\n",
    "utf-8",
  );
  const torn2 = new GoalStore(tornDir);
  await torn2.ensureLoaded();
  assert((torn2 as unknown as { tornTailNeedsSep: boolean }).tornTailNeedsSep === false, "clean load resets separator");

  const timerCalls: string[] = [];
  const fakeTimers = {
    setInterval: (_fn: (...args: unknown[]) => void) => {
      timerCalls.push("set");
      return 42 as unknown as ReturnType<typeof setInterval>;
    },
    setTimeout: (_fn: (...args: unknown[]) => void) => 43 as unknown as ReturnType<typeof setTimeout>,
    clear: (_t: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>) => {
      timerCalls.push("clear");
    },
  };
  const obs = new SessionObserver(join(root, "obs.json"), fakeTimers);
  assert(timerCalls.filter((c) => c === "set").length === 2, "observer timers centrally registered");
  await obs.dispose();
  assert(timerCalls.filter((c) => c === "clear").length === 2, "observer timers centrally cleared");

  const confirm = { type: "confirm", default: false } as const;
  const arabicYes = String.fromCodePoint(0x0646, 0x0639, 0x0645);
  const arabicNo = String.fromCodePoint(0x0644, 0x0627);
  assert(parseUserReply(arabicYes, confirm) === true, "chat path honors Arabic approval");
  assert(parseUserReply(arabicNo, confirm) === false, "chat path honors Arabic denial");
  assert(parseUserReply("ok", confirm) === true, "chat path honors ok");
  assert(parseUserReply("please help me with the code", confirm) === undefined, "chat path ignores prose");
  const guardSrc = readFileSync("src/hooks/guards/consent-gate-guard.ts", "utf-8");
  assert(guardSrc.includes("isApprovalWord"), "host path shares approval vocabulary");
  const dbIsoSrc = readFileSync("src/bootstrap/db-isolation.ts", "utf-8");
  assert(!dbIsoSrc.includes("installationHealth"), "installer-coupled health stays unported");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("PROOF PASS: s024 audit-findings ports");
