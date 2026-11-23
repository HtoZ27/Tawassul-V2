import { createReadStream, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

type Sample = { n: number; p50: number; p95: number; max: number };

type ReadySample = {
  supersededAt: number;
  readyAt: number;
  deltaMs: number;
};

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function ms(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${value.toFixed(1)}ms`;
}

function stats(values: number[]): Sample | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 };
}

function fields(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of line.matchAll(/([A-Za-z][A-Za-z0-9_-]*)=([^\s{}]+)/g)) {
    if (match[1] && match[2]) out[match[1]] = match[2];
  }
  return out;
}

function isoAt(line: string): number | null {
  const parsed = Date.parse(line.slice(0, 24));
  return Number.isFinite(parsed) ? parsed : null;
}

async function eachLine(path: string, fn: (line: string) => void): Promise<void> {
  if (!existsSync(path)) return;
  const reader = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of reader) fn(line);
}

async function main(): Promise<void> {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(
      [
        "Usage: bun scripts/measure-generation-ready.ts [options]",
        "",
        "  --log PATH          Tawassul log path",
        "  --since DAYS        Log window in days; 0 disables the filter (default 30)",
        "  --json              Print one JSON document",
      ].join("\n"),
    );
    return;
  }
  const logPath =
    argValue("--log") ?? join(homedir(), ".local", "share", "tawassul-v2", "tawassul", "tawassul.log");
  const sinceRaw = argValue("--since");
  const sinceDays = sinceRaw === undefined ? 30 : Number(sinceRaw);
  const sinceMs = Number.isFinite(sinceDays) && sinceDays > 0 ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : 0;

  const supersedes: Array<{ at: number; directory: string }> = [];
  const completions: number[] = [];
  const initSync: Array<{ gen: number; pid: number; ms: number; cpuMs: number }> = [];
  await eachLine(logPath, (line) => {
    if (sinceMs > 0) {
      const at = isoAt(line);
      if (at !== null && at < sinceMs) return;
    }
    if (line.includes("v2 superseding the previous plugin instance")) {
      const at = isoAt(line);
      if (at === null) return;
      const marker = "previous plugin instance for ";
      const index = line.indexOf(marker);
      supersedes.push({ at, directory: index >= 0 ? line.slice(index + marker.length).trim() : "unknown" });
      return;
    }
    if (line.includes("Background init completed successfully")) {
      const at = isoAt(line);
      if (at !== null) completions.push(at);
      return;
    }
    if (line.includes("v2 init sync gen=")) {
      const f = fields(line);
      const gen = Number(f.gen);
      const pid = Number(f.pid);
      const elapsed = Number(f.ms);
      const cpu = Number(f.cpuMs);
      if (Number.isFinite(gen) && Number.isFinite(pid) && Number.isFinite(elapsed)) {
        initSync.push({ gen, pid, ms: elapsed, cpuMs: Number.isFinite(cpu) ? cpu : 0 });
      }
    }
  });

  const ready: ReadySample[] = [];
  const pending: number[] = [];
  for (let index = 0; index < supersedes.length; index += 1) {
    const current = supersedes[index];
    const next = supersedes[index + 1];
    if (!current) continue;
    const match = completions.find(
      (at) => at > current.at && (next === undefined || at < next.at),
    );
    if (match === undefined) {
      pending.push(current.at);
      continue;
    }
    ready.push({ supersededAt: current.at, readyAt: match, deltaMs: match - current.at });
  }

  const deltas = ready.map((row) => row.deltaMs);
  const syncDeltas = initSync.map((row) => row.ms);
  const document = {
    generatedAt: new Date().toISOString(),
    logPath,
    windowDays: sinceDays,
    supersedes: supersedes.length,
    completions: completions.length,
    pending: pending.length,
    ready,
    readyStats: stats(deltas),
    initSync,
    initSyncStats: stats(syncDeltas),
  };

  if (hasFlag("--json")) {
    console.log(JSON.stringify(document, null, 2));
    return;
  }

  console.log("== Second-generation ready (Tawassul log) ==");
  console.log(`log: ${logPath}`);
  console.log(`supersedes=${supersedes.length} completions=${completions.length} pending=${pending.length}`);
  if (ready.length === 0) {
    console.log("no supersede-to-ready pair in the window");
  } else {
    for (const row of ready.slice(-10)) {
      console.log(
        `  supersede=${new Date(row.supersededAt).toISOString()} ready=${new Date(row.readyAt).toISOString()} delta=${ms(row.deltaMs)}`,
      );
    }
    const summary = stats(deltas);
    if (summary) {
      const p95 = summary.n >= 20 ? ms(summary.p95) : "n/a (n<20)";
      console.log(`supersede -> ready: n=${summary.n} p50=${ms(summary.p50)} p95=${p95} max=${ms(summary.max)}`);
    }
  }
  if (syncDeltas.length > 0) {
    const summary = stats(syncDeltas);
    if (summary) {
      const p95 = summary.n >= 20 ? ms(summary.p95) : "n/a (n<20)";
      console.log(`init sync: n=${summary.n} p50=${ms(summary.p50)} p95=${p95} max=${ms(summary.max)}`);
    }
    console.log(`init sync by generation: ${initSync.map((row) => `gen=${row.gen} ${ms(row.ms)}`).join(", ")}`);
  }
}

await main();
