import "./proof-log-isolate.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { AutoSaveManager } from "../src/services/auto-save-manager.ts";
import { HandoffLedger } from "../src/services/handoff-ledger.ts";
import { TimelineStore } from "../src/services/timeline-store.ts";
import { BackgroundCoordinator } from "../src/services/background-coordinator/coordinator.ts";
import { StateManager } from "../src/context/managers/StateManager.ts";
import {
  clearQuietModeForce,
  forceQuietMode,
  isFilesystemRoot,
  isHomeProject,
  quietModeEnabled,
  quietModeForceReason,
  quietValue,
  QUIET_SAVE_DEBOUNCE_MS,
} from "../src/utils/quiet.ts";
import type { TimerManagerLike } from "../src/types/timer-types.ts";
import { hostCandidates } from "./install-global.ts";

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

function fakeTimers(): { timers: TimerManagerLike; delays: number[] } {
  const delays: number[] = [];
  const timers = {
    setTimeout: (_fn: (...args: unknown[]) => void, ms: number) => {
      delays.push(ms);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    setInterval: (_fn: (...args: unknown[]) => void, ms: number) => {
      delays.push(ms);
      return 2 as unknown as ReturnType<typeof setInterval>;
    },
    clear: () => undefined,
  };
  return { timers, delays };
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

const work = mkdtempSync(join(tmpdir(), "tawassul-s033-"));
const previousQuiet = process.env.TAWASSUL_QUIET;
const previousIsolated = process.env.TAWASSUL_ISOLATED;
const previousPath = process.env.PATH;
const previousBin = process.env.OPENCODE_BIN;

try {
  delete process.env.TAWASSUL_QUIET;
  delete process.env.TAWASSUL_ISOLATED;
  clearQuietModeForce();

  assert(quietModeEnabled() === false, "quiet mode defaults to off");
  forceQuietMode("proof");
  assert(quietModeEnabled() === true, "a forced reason enables quiet mode");
  assert(quietModeForceReason() === "proof", "the forced reason is readable");
  process.env.TAWASSUL_QUIET = "0";
  assert(quietModeEnabled() === false, "an env opt-out outranks the forced reason");
  process.env.TAWASSUL_QUIET = "1";
  assert(quietModeEnabled() === true, "an env opt-in enables quiet mode");
  delete process.env.TAWASSUL_QUIET;
  clearQuietModeForce();
  assert(quietModeEnabled() === false, "clearing the force restores the default");
  assert(quietModeForceReason() === null, "clearing the force drops the reason");
  assert(isHomeProject(homedir()) === true, "the home directory is detected as a home project");
  assert(isHomeProject(join(work, "project")) === false, "a nested directory is not a home project");
  assert(isFilesystemRoot("/") === true, "the filesystem root is detected as a root project");
  assert(isFilesystemRoot(work) === false, "a temporary work directory is not a filesystem root");
  assert(quietValue("quiet", "normal") === "normal", "quietValue picks the normal value when quiet is off");
  forceQuietMode("proof");
  assert(quietValue("quiet", "normal") === "quiet", "quietValue picks the quiet value when quiet is on");
  clearQuietModeForce();

  const ledger = new HandoffLedger(join(work, "ledger-behind"));
  const entry = {
    type: "handoff_created" as const,
    handoffId: "H-1",
    from: "dev",
    to: "tester",
    task: "proof task",
  };
  ledger.append(entry);
  const ledgerPath = join(work, "ledger-behind", "handoff-ledger.jsonl");
  assert(!existsSync(ledgerPath), "the handoff ledger writes behind, not on append");
  await ledger.flush();
  assert(existsSync(ledgerPath), "an explicit flush writes the buffered entry");
  const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
  assert(lines.length === 1, "the flush writes one line per entry");
  assert(lines[0]?.includes('"handoffId":"H-1"') === true, "the flushed line carries the handoff id");
  await ledger.dispose();

  forceQuietMode("proof");
  const quietLedgerTimers = fakeTimers();
  const quietLedger = new HandoffLedger(join(work, "ledger-quiet"), quietLedgerTimers.timers);
  quietLedger.append(entry);
  assert(quietLedgerTimers.delays[0] === 25_000, "the quiet ledger flush waits 25 seconds");
  clearQuietModeForce();
  const normalLedgerTimers = fakeTimers();
  const normalLedger = new HandoffLedger(join(work, "ledger-normal"), normalLedgerTimers.timers);
  normalLedger.append(entry);
  assert(normalLedgerTimers.delays[0] === 5_000, "the normal ledger flush waits 5 seconds");
  await quietLedger.dispose();
  await normalLedger.dispose();

  const quietAutoTimers = fakeTimers();
  forceQuietMode("proof");
  const quietAuto = new AutoSaveManager(async () => undefined, quietAutoTimers.timers);
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    quietAuto.start();
    assert(quietAutoTimers.delays[0] === 25 * 60_000, "the quiet auto-save interval is 25 minutes");
    quietAuto.stop();
    clearQuietModeForce();
    const normalAutoTimers = fakeTimers();
    const normalAuto = new AutoSaveManager(async () => undefined, normalAutoTimers.timers);
    normalAuto.start();
    assert(normalAutoTimers.delays[0] === 15 * 60_000, "the normal auto-save interval is 15 minutes");
    normalAuto.stop();

    const coordinatorTimers = fakeTimers();
    Math.random = () => 0.5;
    const coordinator = new BackgroundCoordinator({ checkIntervalMs: 1000 }, coordinatorTimers.timers);
    coordinator.start();
    assert(coordinatorTimers.delays[0] === 1050, "the coordinator adds a 0-10% phase shift");
    coordinator.stop();
  } finally {
    Math.random = originalRandom;
    clearQuietModeForce();
  }

  forceQuietMode("proof");
  const quietTimelineTimers = fakeTimers();
  const quietTimeline = new TimelineStore(join(work, "timeline-quiet"), { timers: quietTimelineTimers.timers });
  quietTimeline.append({ type: "state_saved", summary: "quiet" });
  assert(quietTimelineTimers.delays[0] === 25_000, "the quiet timeline flush waits 25 seconds");
  await quietTimeline.dispose();
  clearQuietModeForce();
  const normalTimelineTimers = fakeTimers();
  const normalTimeline = new TimelineStore(join(work, "timeline-normal"), { timers: normalTimelineTimers.timers });
  normalTimeline.append({ type: "state_saved", summary: "normal" });
  assert(normalTimelineTimers.delays[0] === 5_000, "the normal timeline flush waits 5 seconds");
  await normalTimeline.dispose();

  forceQuietMode("proof");
  assert(quietValue(QUIET_SAVE_DEBOUNCE_MS, 100) === 10_000, "the quiet save debounce is 10 seconds");
  clearQuietModeForce();
  assert(quietValue(QUIET_SAVE_DEBOUNCE_MS, 100) === 100, "the normal save debounce is 100 milliseconds");
  const persistenceSource = readFileSync(join(repo, "src", "services", "state-persistence.ts"), "utf8");
  assert(
    persistenceSource.includes("quietValue(QUIET_SAVE_DEBOUNCE_MS, StatePersistence.BASE_DELAY)"),
    "the persistence save path uses the quiet debounce",
  );

  const dir = join(work, "state");
  mkdirSync(dir, { recursive: true });
  const statePath = join(dir, "tawassul-state.json");
  writeFileSync(statePath, "old-state", "utf8");
  const manager = new StateManager(dir, () => statePath);
  const goodRecord = {
    id: "R-1",
    type: "note",
    timestamp: new Date().toISOString(),
    agent: "dev",
    title: "kept",
    detail: "valid",
  };
  const badRecord = { id: "R-bad", type: "note" };
  const healed = await manager.validateBeforeSave(
    { records: [goodRecord, badRecord], handoffs: [] },
    statePath,
  );
  const healedRecords = healed.records as Array<{ id: string }>;
  assert(healedRecords.length === 1, "the save guard drops the whole invalid record");
  assert(healedRecords[0]?.id === "R-1", "the save guard keeps the valid record");
  assert(!JSON.stringify(healed).includes("R-bad"), "the save guard never keeps a partial record");
  const audit = manager.getQuarantineAudit();
  assert(audit.length === 1 && audit[0]?.droppedRecords === 1, "the save guard records a quarantine audit row");

  const quarantineFiles = () => readdirSync(dir).filter((name) => name.includes(".quarantine-"));
  assert(quarantineFiles().length === 1, "the quarantine copy is written once");
  await manager.validateBeforeSave({ records: [goodRecord, badRecord], handoffs: [] }, statePath);
  assert(quarantineFiles().length === 1, "the same path and mtime are copied once");
  utimesSync(statePath, new Date(Date.now() + 2000), new Date(Date.now() + 2000));
  await manager.validateBeforeSave({ records: [goodRecord, badRecord], handoffs: [] }, statePath);
  assert(quarantineFiles().length === 2, "a new mtime earns a new quarantine copy");

  const loggerPath = join(work, "logger", "tawassul.log");
  const loggerProbe = String.raw`
(async () => {
  const { logger } = await import("./src/utils/logger.ts");
  logger.info("stamp-proof-line");
  await new Promise((r) => setTimeout(r, 200));
  const fs = require("node:fs");
  const text = fs.readFileSync(process.env.TAWASSUL_LOG_FILE, "utf8");
  const ok = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[tawassul\] stamp-proof-line$/m.test(text);
  process.exit(ok ? 0 : 3);
})().catch((e) => { console.error(e); process.exit(4); });
`;
  const loggerRun = spawnSync(process.execPath, ["-e", loggerProbe], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, TAWASSUL_LOG_FILE: loggerPath },
  });
  assert(loggerRun.status === 0, "durable log lines carry an ISO stamp");

  writeFileSync(join(work, "fake-opencode"), "", "utf8");
  process.env.OPENCODE_BIN = join(work, "fake-opencode");
  const explicitCandidates = hostCandidates();
  assert(explicitCandidates[0] === resolve(join(work, "fake-opencode")), "the installer honours the explicit host binary");
  const pathDir = join(work, "bin");
  mkdirSync(pathDir, { recursive: true });
  writeFileSync(join(pathDir, "opencode"), "", "utf8");
  process.env.PATH = `${pathDir}${delimiter}${previousPath ?? ""}`;
  assert(hostCandidates().includes(join(pathDir, "opencode")), "the installer discovers a host on PATH");
  const installerSource = readFileSync(join(repo, "scripts", "install-global.ts"), "utf8");
  assert(installerSource.includes("export function hostCandidates"), "the host installer owns candidate discovery");
  assert(
    installerSource.includes("hostProbeCommand(bin, process.platform") &&
      installerSource.includes("shell: probe.shell"),
    "the host installer probes the host version through the platform probe",
  );
  assert(installerSource.includes("systemd") && installerSource.includes("cron"), "the host installer owns scheduling units");
  const pluginFiles = readdirSync(join(repo, "src"), { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => entry.endsWith(".ts"));
  const pluginDuty = pluginFiles.filter((file) => {
    const source = readFileSync(join(repo, "src", file), "utf8");
    return source.includes("install-global") || source.includes("systemd") || source.includes("opencode-v2-iso");
  });
  assert(pluginDuty.length === 0, "the plugin ships no launcher or installer duty");
} finally {
  if (previousQuiet === undefined) delete process.env.TAWASSUL_QUIET;
  else process.env.TAWASSUL_QUIET = previousQuiet;
  if (previousIsolated === undefined) delete process.env.TAWASSUL_ISOLATED;
  else process.env.TAWASSUL_ISOLATED = previousIsolated;
  if (previousPath === undefined) delete process.env.PATH;
  else process.env.PATH = previousPath;
  if (previousBin === undefined) delete process.env.OPENCODE_BIN;
  else process.env.OPENCODE_BIN = previousBin;
  clearQuietModeForce();
  rmSync(work, { recursive: true, force: true });
}

console.log(`PROOF PASS: S-033 cold-boot wave and host-installer boundary (${passed} assertions)`);
