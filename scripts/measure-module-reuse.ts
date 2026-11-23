import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { TOOL_COUNT } from "../src/generated/tool-tripwire.ts";
import { toolNameSetHash } from "../src/services/tool-tripwire.ts";

type Sample = { n: number; p50: number; p95: number; max: number };

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function numericArg(name: string, fallback: number): number {
  const raw = argValue(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ms(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  if (value >= 1) return `${value.toFixed(2)}ms`;
  return `${(value * 1000).toFixed(0)}us`;
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

function timed(run: () => unknown, iterations: number): number[] {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  return samples;
}

function loadSeconds(): number {
  const raw = argValue("--since");
  if (raw === undefined) return 30;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function main(): Promise<void> {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(
      [
        "Usage: bun scripts/measure-module-reuse.ts [options]",
        "",
        "  --log PATH          Tawassul log path",
        "  --since DAYS        Log window in days; 0 disables the filter (default 30)",
        "  --bundle-bytes N    Synthetic bundle size for the sha256 cost (default: dist size)",
        "  --json              Print one JSON document",
      ].join("\n"),
    );
    return;
  }
  const logPath =
    argValue("--log") ?? join(homedir(), ".local", "share", "tawassul-v2", "tawassul", "tawassul.log");
  const sinceDays = loadSeconds();
  const sinceMs = sinceDays > 0 ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : 0;
  const distPath = join(process.cwd(), "dist", "index.js");
  const bundleBytes = numericArg(
    "--bundle-bytes",
    existsSync(distPath) ? statSync(distPath).size : 2_830_000,
  );

  const moduleEvals = new Map<number, number>();
  const generationStarts = new Map<number, number>();
  const directSetups = new Map<number, number>();
  let moduleEvalLines = 0;
  let generationLines = 0;
  let directSetupLines = 0;
  await eachLine(logPath, (line) => {
    if (sinceMs > 0) {
      const at = isoAt(line);
      if (at !== null && at < sinceMs) return;
    }
    if (line.includes("v2 module eval pid=")) {
      const pid = Number(fields(line).pid);
      if (!Number.isFinite(pid)) return;
      moduleEvalLines += 1;
      moduleEvals.set(pid, (moduleEvals.get(pid) ?? 0) + 1);
      return;
    }
    if (line.includes("v2 setup gen=") && line.includes(" start")) {
      const f = fields(line);
      const pid = Number(f.pid);
      const gen = Number(f.gen);
      if (!Number.isFinite(pid)) return;
      if (gen === 0) {
        directSetupLines += 1;
        directSetups.set(pid, (directSetups.get(pid) ?? 0) + 1);
        return;
      }
      generationLines += 1;
      generationStarts.set(pid, (generationStarts.get(pid) ?? 0) + 1);
    }
  });

  const pids = [
    ...new Set([...moduleEvals.keys(), ...generationStarts.keys(), ...directSetups.keys()]),
  ].sort((a, b) => a - b);
  const perProcess = pids.map((pid) => {
    const evals = moduleEvals.get(pid) ?? 0;
    const generations = generationStarts.get(pid) ?? 0;
    return {
      pid,
      moduleEvals: evals,
      generations,
      directSetups: directSetups.get(pid) ?? 0,
      generationsPerEval: evals > 0 ? generations / evals : null,
    };
  });

  const names = Array.from({ length: TOOL_COUNT }, (_, index) => `tool_${index}`);
  const nameSetSamples = timed(() => toolNameSetHash(names), 200);
  const bundleBuffer = Buffer.alloc(bundleBytes, 7);
  const bundleSamples = timed(() => createHash("sha256").update(bundleBuffer).digest("hex"), 20);

  const nameSet = stats(nameSetSamples);
  const bundle = stats(bundleSamples);
  const lookupMemoized = nameSet?.p50 ?? null;
  const lookupCold = nameSet && bundle ? nameSet.p50 + bundle.p50 : null;
  const reuseValues = perProcess.flatMap((row) => (row.generationsPerEval === null ? [] : [row.generationsPerEval]));

  const document = {
    generatedAt: new Date().toISOString(),
    logPath,
    windowDays: sinceDays,
    moduleEvalLines,
    generationLines,
    directSetupLines,
    perProcess,
    reuse: stats(reuseValues),
    lookup: {
      nameSet: nameSet,
      bundleSha256: bundle,
      bundleBytes,
      memoizedP50Ms: lookupMemoized,
      coldP50Ms: lookupCold,
    },
  };

  if (hasFlag("--json")) {
    console.log(JSON.stringify(document, null, 2));
    return;
  }

  console.log("== Module reuse (Tawassul log) ==");
  console.log(`log: ${logPath}`);
  console.log(
    `module eval lines: ${moduleEvalLines}; generation starts: ${generationLines}; direct-setup lines: ${directSetupLines}`,
  );
  if (perProcess.length === 0) {
    console.log("no module eval or generation lines in the window");
  } else {
    for (const row of perProcess) {
      const ratio = row.generationsPerEval === null ? "-" : row.generationsPerEval.toFixed(2);
      console.log(
        `  pid=${row.pid} moduleEvals=${row.moduleEvals} generations=${row.generations} directSetups=${row.directSetups} perEval=${ratio}`,
      );
    }
    if (reuseValues.length > 0) {
      const summary = stats(reuseValues);
      if (summary) {
        const p95 = summary.n >= 20 ? ms(summary.p95) : "n/a (n<20)";
        console.log(
          `reuse factor: n=${summary.n} p50=${summary.p50.toFixed(2)} p95=${p95} max=${summary.max.toFixed(2)}`,
        );
      }
    }
  }

  console.log("");
  console.log("== Synthetic cache lookup cost ==");
  if (nameSet) console.log(`name-set hash (${TOOL_COUNT} tools): p50=${ms(nameSet.p50)} p95=${ms(nameSet.p95)}`);
  if (bundle) {
    console.log(`bundle sha256 (${bundleBytes} bytes): p50=${ms(bundle.p50)} p95=${ms(bundle.p95)}`);
  }
  if (lookupMemoized !== null) console.log(`memoized lookup estimate: p50=${ms(lookupMemoized)}`);
  if (lookupCold !== null) console.log(`cold lookup estimate: p50=${ms(lookupCold)}`);
  console.log("reference: the Phase 1 saving is 6.1-7.3 ms of wall time per unchanged generation");
}

await main();
