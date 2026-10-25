import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

function walk(dir: string, suffix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, suffix));
    else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(suffix)) out.push(full);
  }
  return out;
}

const rel = (file: string): string => relative(repo, file).split("\\").join("/");
const text = (file: string): string => readFileSync(file, "utf-8");

const srcDir = join(repo, "src");
const srcFiles = walk(srcDir, ".ts");
assert(srcFiles.length > 0, "source tree is present");

const v1PathHits = srcFiles.filter((file) => /Desktop\/tawassyl|\.\.\/tawassyl|from\s+["']tawassyl/.test(text(file)));
assert(v1PathHits.length === 0, `shipped source has no v1 tree reference (found ${v1PathHits.map(rel).join(", ") || "none"})`);

const legacyHits = srcFiles.filter((file) => /tawassyl/i.test(text(file)));
assert(
  legacyHits.length === 1 && rel(legacyHits[0] ?? "") === "src/utils/state-paths.ts",
  `legacy state name is confined to state-paths.ts (found ${legacyHits.map(rel).join(", ") || "none"})`,
);

const statePaths = text(join(srcDir, "utils", "state-paths.ts"));
assert(statePaths.includes('LEGACY_STATE_DIR_NAME = "tawassyl"'), "legacy state directory is named explicitly");
const primaryCheck = statePaths.indexOf("existsSync(primary)");
const legacyCheck = statePaths.indexOf("legacyStatePath(fileName)");
assert(primaryCheck !== -1 && legacyCheck !== -1 && primaryCheck < legacyCheck, "state reads prefer the v2 path and fall back only when it is absent");

const pkg = JSON.parse(text(join(repo, "package.json"))) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const deps = Object.entries({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
assert(
  deps.every(([name, version]) => !/tawassyl/i.test(name) && !/tawassyl/i.test(version)),
  "package manifest has no v1 dependency",
);

const build = text(join(repo, "build-v2.mjs"));
assert(build.includes('join(".opencode", "plugin")'), "build targets the local host plugin directory");
assert(build.includes('"tawassul.js"'), "build emits the host plugin entry");
assert(!/tawassyl/i.test(build), "build has no v1 reference");

const launcher = text(join(repo, "scripts", "opencode-v2-iso.sh"));
assert(launcher.includes('GUARD="$V2_REPO/scripts/guard-db-generation.sh"'), "launcher uses the local guard");
assert(!/tawassyl/i.test(launcher), "launcher has no v1 reference");

const foreignRef = /Desktop\/tawassyl|\.\.\/tawassyl|plugins\/tawassul\//;
const transferTools = new Set(["scripts/check-shared-anchors.mjs", "scripts/port-from-v1.mjs"]);
const scriptFiles = [...walk(join(repo, "scripts"), ".ts"), ...walk(join(repo, "scripts"), ".sh")];
const scriptHits = scriptFiles.filter((file) => !transferTools.has(rel(file)) && foreignRef.test(text(file)));
assert(
  scriptHits.length === 0,
  `shipped scripts have no v1 tree reference (found ${scriptHits.map(rel).join(", ") || "none"})`,
);

for (const bundle of ["dist/index.js", ".opencode/plugin/tawassul.js"]) {
  const bundlePath = join(repo, bundle);
  if (!existsSync(bundlePath)) continue;
  assert(!foreignRef.test(text(bundlePath)), `${bundle} has no v1 tree reference`);
}

const configCandidates = [join(repo, "opencode.json"), join(repo, ".opencode", "opencode.json")].filter(existsSync);
assert(configCandidates.length > 0, "a host config is present");
for (const configPath of configCandidates) {
  const parsed = JSON.parse(text(configPath)) as Record<string, unknown>;
  const pluginEntries = Array.isArray(parsed.plugin) ? parsed.plugin : [];
  assert(
    !pluginEntries.some((entry) => typeof entry === "string" && /tawassul/i.test(entry)),
    `${rel(configPath)} has no tawassul plugin entry`,
  );
  const mcp = parsed.mcp;
  assert(
    !mcp || typeof mcp !== "object" || !("tawassul" in (mcp as Record<string, unknown>)),
    `${rel(configPath)} has no tawassul mcp entry`,
  );
}

const bundles: string[] = [];
function walkAll(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkAll(full);
    else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name === "tawassul.js") bundles.push(rel(full));
  }
}
walkAll(repo);
assert(
  bundles.length === 1 && bundles[0] === ".opencode/plugin/tawassul.js",
  `exactly one host plugin entry exists (found ${bundles.join(", ") || "none"})`,
);

console.log("PROOF PASS: v2 runs without the v1 tree and ships one host entry");
