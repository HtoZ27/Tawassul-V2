import "./proof-log-isolate.ts";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const srcRoot = join(repo, "src");
const entry = join(srcRoot, "index.ts");
const artifactPath = join(repo, "docs", "experiments", "baselines", "2026-11-01-reachability.json");
const write = process.argv.includes("--write");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const codeFiles = walk(srcRoot).filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"));
const assetFiles = walk(srcRoot).filter((path) => path.endsWith(".json"));
const known = new Set([...codeFiles, ...assetFiles]);
const code = new Map<string, string>();
for (const path of codeFiles) code.set(path, readFileSync(path, "utf-8"));

const specifier = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
const dynamicImport = /import\s*\(\s*["']([^"']+)["']/g;

function resolveSpecifier(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(from), spec);
  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ];
  for (const candidate of candidates) {
    if (known.has(candidate) || existsSync(candidate)) return candidate;
  }
  return null;
}

const edges = new Map<string, string[]>();
const unresolved: Array<{ file: string; spec: string }> = [];
let dynamicEdges = 0;
for (const [file, text] of code) {
  const out: string[] = [];
  for (const match of text.matchAll(specifier)) {
    const spec = match[1] ?? "";
    const target = resolveSpecifier(file, spec);
    if (target) out.push(target);
    else if (spec.startsWith(".")) unresolved.push({ file, spec });
  }
  dynamicEdges += [...text.matchAll(dynamicImport)].length;
  edges.set(file, [...new Set(out)]);
}

if (!existsSync(entry)) fail("the plugin entry src/index.ts does not exist");
const reachable = new Set<string>();
const stack = [entry];
while (stack.length > 0) {
  const current = stack.pop() as string;
  if (reachable.has(current)) continue;
  reachable.add(current);
  for (const next of edges.get(current) ?? []) stack.push(next);
}

const nonBlank = (text: string): number => text.split("\n").filter((line) => line.trim().length > 0).length;
const totalLoc = [...code.values()].reduce((sum, text) => sum + nonBlank(text), 0);
const reachableLoc = [...reachable]
  .filter((path) => code.has(path))
  .reduce((sum, path) => sum + nonBlank(code.get(path) as string), 0);
const reachableCode = [...reachable].filter((path) => code.has(path));
const shareFiles = reachableCode.length / codeFiles.length;
const shareLoc = reachableLoc / totalLoc;

const byArea: Record<string, number> = {};
for (const path of reachableCode) {
  const area = relative(srcRoot, path).split("/")[0] ?? "src";
  byArea[area] = (byArea[area] ?? 0) + 1;
}

const measured = {
  date: "2026-11-01",
  entry: "src/index.ts",
  totalFiles: codeFiles.length,
  reachableFiles: reachableCode.length,
  totalLoc,
  reachableLoc,
  shareFiles: Number(shareFiles.toFixed(4)),
  shareLoc: Number(shareLoc.toFixed(4)),
  dynamicEdges,
  byArea: Object.fromEntries(Object.entries(byArea).sort(([a], [b]) => a.localeCompare(b))),
};

assert(unresolved.length === 0, `every relative import resolves to a known file (${unresolved.length} unresolved)`);
assert(reachable.has(entry), "the plugin entry is reachable from itself");
assert(
  reachableCode.some((path) => path.endsWith(join("bootstrap", "plugin-init.ts"))),
  "the boot path is reachable",
);
assert(
  reachableCode.some((path) => path.endsWith(join("bootstrap", "tool-registry.ts"))),
  "the tool registry is reachable",
);
assert(shareFiles >= 0.9, `a normal session reaches at least 90 percent of src files (${(shareFiles * 100).toFixed(1)})`);
assert(shareLoc >= 0.9, `a normal session reaches at least 90 percent of src lines (${(shareLoc * 100).toFixed(1)})`);
assert(dynamicEdges > 0, `dynamic imports are counted rather than ignored (${dynamicEdges})`);

if (write) {
  writeFileSync(artifactPath, `${JSON.stringify(measured, null, 2)}\n`);
  console.log(`reachability: wrote ${relative(repo, artifactPath)}`);
}

assert(existsSync(artifactPath), "the measured audit is recorded under docs/experiments/baselines");
if (existsSync(artifactPath)) {
  const recorded = JSON.parse(readFileSync(artifactPath, "utf-8")) as typeof measured;
  assert(recorded.date === "2026-11-01", "the recorded audit carries its date");
  assert(recorded.entry === "src/index.ts", "the recorded audit names the entry");
  assert(
    Math.abs(recorded.shareFiles - shareFiles) <= 0.02,
    "the recorded file share matches the fresh measurement",
  );
  assert(
    Math.abs(recorded.shareLoc - shareLoc) <= 0.02,
    "the recorded line share matches the fresh measurement",
  );
  assert(recorded.totalFiles === codeFiles.length, "the recorded file count matches the tree");
}

console.log(
  `PROOF PASS: the reachability audit measures ${reachableCode.length}/${codeFiles.length} files and ${((reachableLoc / totalLoc) * 100).toFixed(1)}% of lines (${passed} assertions)`,
);
