import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TawassulContext } from "../src/context-class.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

type HubInternals = {
  _metrics?: { increment: (name: string, delta?: number) => void };
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  emit: (event: string, payload?: unknown) => void;
  stopDlqDrain: () => void;
};

const work = mkdtempSync(join(tmpdir(), "tawassul-e31-"));

async function main(): Promise<void> {
  const dir = join(work, "project");
  const ctx = new TawassulContext(dir);
  const hub = ctx.eventHub as unknown as HubInternals;

  assert(ctx.scope === "project", "a workspace context keeps its state inside the project");
  hub.on("PROOF_EVENT", () => {
    throw new Error("listener failed on purpose");
  });
  hub.emit("PROOF_EVENT", { payload: 1 });
  hub.stopDlqDrain();

  const snapshot = ctx.metricsCollector.snapshot();
  assert(
    (snapshot["counter.eventhub.dlq.added"] ?? 0) >= 1,
    "a failed listener is counted on the live collector",
  );

  const metricsPath = resolve(dir, "metrics.json");
  await ctx.metricsCollector.saveToDisk();
  assert(existsSync(metricsPath), "the live collector knows where to save its counters");
  const saved = JSON.parse(readFileSync(metricsPath, "utf8")) as Record<string, number>;
  assert(
    (saved["counter.eventhub.dlq.added"] ?? 0) >= 1,
    "the dead-letter counter reaches the metrics file",
  );
  assert(
    hub._metrics === ctx.metricsCollector,
    "the event hub increments the same collector the context exposes",
  );

  const other = new TawassulContext(join(work, "other"));
  const otherHub = other.eventHub as unknown as HubInternals;
  assert(otherHub._metrics === other.metricsCollector, "every context pairs its hub with its own collector");
  assert(other.metricsCollector !== ctx.metricsCollector, "two contexts never share one in-memory collector");
  assert(
    (other.metricsCollector.snapshot()["counter.eventhub.dlq.added"] ?? 0) === 0,
    "a second context inherits no dead-letter count",
  );
  otherHub.stopDlqDrain();
  await other.metricsCollector.saveToDisk().catch(() => undefined);
}

try {
  await main();
  console.log(`PROOF PASS: the event hub writes its counters to the live collector, which can persist them (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
