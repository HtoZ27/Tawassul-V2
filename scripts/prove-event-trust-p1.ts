import "./proof-log-isolate.ts";
import { EventHub } from "../src/services/event-hub.ts";
import { TrustScoreCalculator } from "../src/services/trust-score/calculator.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function proveSlotSaturation(): Promise<void> {
  let slotTimeouts = 0;
  const hub = new EventHub<Record<string, unknown>>(undefined, {
    increment: (name: string) => {
      if (name === "eventhub.slotwait.timeout") slotTimeouts++;
    },
  });
  hub.on("stuck", () => new Promise<void>(() => {}));
  const started = Date.now();
  const occupants = Array.from({ length: 1000 }, () => hub.emitAndWait("stuck", {}, 2000));
  const waiters = Array.from({ length: 5 }, () => hub.emitAndWait("stuck", {}, 150));
  const calls = [...occupants, ...waiters];
  let guardTimer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<void>((resolve) => {
    guardTimer = setTimeout(() => resolve(), 25000);
  });
  await Promise.race([Promise.allSettled(calls), guard.then(() => fail("emitAndWait hung under saturation"))]);
  if (guardTimer) clearTimeout(guardTimer);
  const elapsed = Date.now() - started;
  if (slotTimeouts < 1) fail("no slot-wait timeout recorded under saturation");
  console.log(`slot-saturation ok (1005 emits settled in ${elapsed}ms, ${slotTimeouts} loud drops)`);
}

async function proveTrustReadStability(): Promise<void> {
  const calc = new TrustScoreCalculator();
  const components = {
    successRate: 0.9,
    avgResponseTimeMs: 1000,
    completedTasks: 10,
    errorCount: 1,
    avgOutputQuality: 0.8,
    helpRequests: 0,
    rollbackCount: 0,
    memoryHits: 5,
    memoryMisses: 1,
  };
  const first = calc.evaluate("dev", "dev", components);
  for (let i = 0; i < 20; i++) {
    const report = calc.getReport("dev");
    if (!report) fail("getReport returned null after evaluate");
    if (report!.overallScore !== first.overallScore) fail("repeated read changed the score");
  }
  const history = calc.getHistory("dev");
  if (history.length !== 1) fail(`repeated reads grew history to ${history.length}`);
  console.log("trust-read-stability ok (20 reads, history length 1)");
}

await proveSlotSaturation();
await proveTrustReadStability();
console.log("PROOF PASS: event slot deadline + trust read stability");
