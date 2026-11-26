import "./proof-log-isolate.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TawassulContext } from "../src/context-class.ts";
import type { Checkpoint, HandoffEntry } from "../src/context/types.ts";
import type { ToolContext } from "../src/tool.ts";
import { HandoffService } from "../src/services/handoff-service.ts";
import { HealthTracker } from "../src/services/agent-health.ts";
import { CircuitBreaker } from "../src/services/circuit-breaker.ts";
import { buildHandoffTool } from "../src/tools/handoff.ts";
import { t } from "../src/translations.ts";
import { detectInterrupted, resetContinuity } from "../src/services/continuity/detect.ts";
import { configureContinuity, probeIdentity, snapshotOwners } from "../src/services/continuity/owner.ts";
import type { OwnerRecord } from "../src/services/continuity/owner.ts";

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

function eq<T>(actual: T, expected: T, name: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${name} (${JSON.stringify(actual)} === ${JSON.stringify(expected)})`,
  );
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "tawassul-continuity-resume-"));
const running: ChildProcess[] = [];

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

function readOwners(base: string): string {
  return readFileSync(ownersPath(base), "utf8");
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

function handoff(
  id: string,
  from: string,
  to: string,
  status: HandoffEntry["status"],
  checkpoint?: Checkpoint,
): HandoffEntry {
  return {
    id,
    from,
    to,
    task: `probe ${id} surviving a crash`,
    context: `a killed owner leaves ${id} interrupted for this proof`,
    files: ["src/a.ts"],
    timestamp: new Date().toISOString(),
    status,
    ...(checkpoint ? { checkpoint } : {}),
  };
}

function stateData(ctx: TawassulContext): Promise<Record<string, unknown> | null> {
  return ctx.stateManager.tryLoadFile(ctx.statePath());
}

async function main(): Promise<void> {
  try {
    const keyDir = join(work, "keys");
    mkdirSync(keyDir, { recursive: true });
    writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
    process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
    process.env.XDG_CONFIG_HOME = join(work, "config");
    process.env.XDG_DATA_HOME = join(work, "data");
    process.env.XDG_STATE_HOME = join(work, "state");
    process.env.XDG_CACHE_HOME = join(work, "cache");
    process.env.OPENCODE_DB = join(work, "opencode.db");
    process.env.TAWASSUL_CONTINUITY = "1";
    delete process.env.TAWASSUL_CONTEXT_HANDOFF;

    const dir = project("project");
    const ctx = new TawassulContext(dir);
    ctx.ensureConfig();
    resetContinuity();
    configureContinuity({
      baseDir: dir,
      handoffs: () => ctx.handoffs.values(),
      flush: () => ctx.saveState(),
    });

    const target = handoff("H-100", "@tawa", "dev", "accepted", {
      completed: ["draft the report"],
      remaining: ["finish the report", "run the tests"],
      filesChanged: ["src/a.ts"],
      decisions: [{ title: "scope", detail: "keep the fix small" }],
      unverified: ["old doubt"],
    });
    ctx.handoffs.set(target.id, target);
    ctx.hoffSeq = 100;

    const victim = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    running.push(victim);
    await new Promise<void>((resolve, reject) => {
      victim.once("spawn", () => resolve());
      victim.once("error", reject);
    });
    const victimPid = victim.pid;
    if (!victimPid) throw new Error("the SIGKILL victim has no pid");
    const facts = await probeIdentity(victimPid);
    writeOwners(dir, {
      [target.id]: {
        pid: victimPid,
        startedAt: facts?.startedAt ?? 0,
        bootId: facts?.bootId ?? "",
        heartbeatAt: new Date().toISOString(),
        sessionId: "ses_crash",
      },
    });
    victim.kill("SIGKILL");
    await waitExit(victim);

    const detected = await detectInterrupted([target], { force: true });
    assert(detected.interrupted.includes(target.id), "detection lists the killed handoff");
    eq(target.runState, "interrupted", "the killed handoff is interrupted");
    eq(target.interruptedReason, "gone", "the killed handoff records the gone reason");

    const service = new HandoffService(ctx, new HealthTracker(), new CircuitBreaker());
    ctx.handoffService = service;
    const tool = buildHandoffTool(ctx);
    const toolContext = { agent: "@tawa", sessionID: "ses_resume" } as unknown as ToolContext;
    const recordsBefore = ctx.records.length;

    const resumed = (await tool.execute(
      {
        resumeInterrupted: target.id,
        checkpoint: {
          completed: [],
          remaining: [],
          filesChanged: [],
          decisions: [],
          unverified: ["resume note one", "resume note two"],
        },
      },
      toolContext,
    )) as { output: string; metadata?: Record<string, unknown> };

    assert(resumed.output.includes(t("handoffResumed", { id: target.id, agent: "@tawa" })), "the tool reports the resumed handoff");
    eq(target.status, "pending", "resume returns the handoff to pending");
    eq(target.runState, "live", "resume re-stamps a live owner");
    eq(target.interruptedAt, undefined, "resume clears the interruption time");
    eq(target.interruptedReason, undefined, "resume clears the interruption reason");
    assert(
      typeof target.resumedAt === "string" && !Number.isNaN(Date.parse(target.resumedAt)),
      "resume records when it happened",
    );
    eq(target.ownerPid, process.pid, "resume stamps the current process");
    const ownersAfterResume = await snapshotOwners();
    eq(ownersAfterResume[target.id]?.pid, process.pid, "the owner file now names the resuming process");
    eq(ctx.records.length, recordsBefore + 1, "resume appends exactly one record");
    const resumeRecord = ctx.records[ctx.records.length - 1];
    eq(resumeRecord?.type, "fix", "the resume record is a fix");
    eq(resumeRecord?.agent, "tawa", "the resume record names the resumer");
    assert(resumeRecord?.title.includes(target.id) === true, "the resume record names the handoff");
    eq(resumeRecord?.severity, "minor", "the resume record carries the minor severity");
    eq(resumed.metadata?.nextAction, "finish the report", "the tool returns the next action");
    eq(resumed.metadata?.remaining, ["finish the report", "run the tests"], "the tool returns the remaining work");
    eq(resumed.metadata?.filesChanged, ["src/a.ts"], "the tool returns the changed files");
    eq(
      resumed.metadata?.unverified,
      ["old doubt", "resume note one", "resume note two"],
      "the tool returns the appended unverified list",
    );

    const storedState = (await stateData(ctx)) as {
      handoffs?: Array<{ id?: string; status?: string; resumedAt?: string }>;
      records?: Array<{ id?: string }>;
    } | null;
    const stored = (storedState?.handoffs ?? []).find((entry) => entry.id === target.id);
    eq(stored?.status, "pending", "the resumed status reaches the state file");
    assert(typeof stored?.resumedAt === "string", "the state file carries the resume time");
    assert(
      (storedState?.records ?? []).some((entry) => entry.id === resumeRecord?.id),
      "the appended record reaches the state file",
    );

    const completed = await service.completeHandoff(target.id, "dev");
    assert(completed.success, "the resumed handoff can be completed");
    eq(target.status, "completed", "completion records the terminal status");
    const ownersAfterComplete = await snapshotOwners();
    eq(ownersAfterComplete[target.id], undefined, "completion clears the owner record");
    eq(target.runState, undefined, "completion clears the run state");
    eq(target.resumedAt, undefined, "completion clears the resume time");

    const clean = handoff("H-200", "@tawa", "dev", "pending");
    ctx.handoffs.set(clean.id, clean);
    const cleanOwners = readOwners(dir);
    const cleanRecords = ctx.records.length;
    const cleanResult = await service.resumeInterrupted(clean.id, "@tawa", "ses_resume");
    assert(!cleanResult.success, "a non-interrupted resume is refused");
    assert(cleanResult.message.includes("not interrupted"), "the refusal names the missing interruption");
    eq(clean.status, "pending", "a non-interrupted resume leaves the status");
    eq(clean.resumedAt, undefined, "a non-interrupted resume writes no resume time");
    eq(ctx.records.length, cleanRecords, "a non-interrupted resume writes no record");
    eq(readOwners(dir), cleanOwners, "a non-interrupted resume writes no owner file");

    const stale = handoff("H-300", "@tawa", "dev", "accepted");
    stale.runState = "stale";
    ctx.handoffs.set(stale.id, stale);
    const staleResult = await service.resumeInterrupted(stale.id, "@tawa", "ses_resume");
    assert(!staleResult.success, "a stale resume is refused");
    assert(staleResult.message.includes("stale"), "the stale refusal names the stale owner");
    eq(stale.status, "accepted", "a stale resume leaves the status");
    eq(stale.resumedAt, undefined, "a stale resume writes no resume time");

    const foreign = handoff("H-400", "@tawa", "dev", "accepted");
    foreign.runState = "interrupted";
    foreign.interruptedAt = new Date().toISOString();
    foreign.interruptedReason = "gone";
    ctx.handoffs.set(foreign.id, foreign);
    const foreignRecords = ctx.records.length;
    const foreignResult = await service.resumeInterrupted(foreign.id, "dev", "ses_resume");
    assert(!foreignResult.success, "a non-owner resume is refused");
    assert(foreignResult.message.includes("Only @tawa"), "the non-owner refusal names the owner");
    eq(foreign.status, "accepted", "a non-owner resume leaves the status");
    eq(foreign.runState, "interrupted", "a non-owner resume leaves the run state");
    eq(ctx.records.length, foreignRecords, "a non-owner resume writes no record");

    const terminal = handoff("H-500", "@tawa", "dev", "completed");
    terminal.runState = "interrupted";
    ctx.handoffs.set(terminal.id, terminal);
    const terminalResult = await service.resumeInterrupted(terminal.id, "@tawa", "ses_resume");
    assert(!terminalResult.success, "a terminal resume is refused");
    assert(terminalResult.message.includes("completed"), "the terminal refusal names the status");
    eq(terminal.status, "completed", "a terminal resume leaves the terminal status");

    const clip = handoff("H-600", "@tawa", "dev", "accepted", {
      completed: [],
      remaining: [],
      filesChanged: [],
      decisions: [],
      unverified: ["a", "b", "c"],
    });
    clip.runState = "interrupted";
    clip.interruptedAt = new Date().toISOString();
    clip.interruptedReason = "gone";
    ctx.handoffs.set(clip.id, clip);
    const clipped = await service.resumeInterrupted(clip.id, "@tawa", "ses_resume", ["d", "e", "f", "g"]);
    assert(clipped.success, "a resume with extra unverified entries succeeds");
    eq(clip.checkpoint?.unverified, ["a", "b", "c", "d", "e"], "resume clips the appended unverified list to five");

    process.env.TAWASSUL_CONTINUITY = "0";
    const disabledRecords = ctx.records.length;
    const disabledResult = await service.resumeInterrupted(foreign.id, "@tawa", "ses_resume");
    assert(!disabledResult.success, "a disabled resume is refused");
    assert(disabledResult.message.includes("disabled"), "the disabled refusal names the gate");
    eq(ctx.records.length, disabledRecords, "a disabled resume writes no record");
    eq(foreign.runState, "interrupted", "a disabled resume leaves the run state");
    const disabledTool = (await tool.execute({ resumeInterrupted: foreign.id }, toolContext)) as { output: string };
    eq(disabledTool.output, t("continuityDisabled"), "the tool refuses resume while continuity is disabled");
    process.env.TAWASSUL_CONTINUITY = "1";

    console.log(`PROOF PASS: an interrupted handoff resumes, refuses bad callers, and completes (${passed} assertions)`);
  } finally {
    for (const child of running) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    resetContinuity();
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
