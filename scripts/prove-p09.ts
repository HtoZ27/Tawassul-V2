import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "tawassul-p09-"));
const fakeHome = join(work, "home");
mkdirSync(join(fakeHome, ".config", "tawassyl", "state"), { recursive: true });
mkdirSync(join(fakeHome, ".config", "tawassul", "state"), { recursive: true });
mkdirSync(join(work, "v2state"), { recursive: true });

const modules = {
  statePaths: pathToFileURL(join(repo, "src", "utils", "state-paths.ts")).href,
};

const childSource = [
  'import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";',
  'import { join } from "node:path";',
  `import { legacyFallbackFor, legacyStatePath, statePath, stateReadPath } from ${JSON.stringify(modules.statePaths)};`,
  "let passed = 0;",
  "function assert(cond, name) {",
  '  if (!cond) { console.error(`PROOF FAIL: ${name}`); process.exit(1); }',
  "  passed++;",
  '  console.log(`ok ${name}`);',
  "}",
  `const fakeHome = ${JSON.stringify(fakeHome)};`,
  `const work = ${JSON.stringify(work)};`,
  'const retiredDir = join(fakeHome, ".config", "tawassyl", "state");',
  'const routerDir = join(fakeHome, ".config", "tawassul", "state");',
  "mkdirSync(retiredDir, { recursive: true });",
  "mkdirSync(routerDir, { recursive: true });",
  'const fileName = "foo.json";',
  "const retired = join(retiredDir, fileName);",
  "const router = join(routerDir, fileName);",
  "const write = (path, content) => writeFileSync(path, content, \"utf8\");",
  "const setMtime = (path, seconds) => utimesSync(path, seconds, seconds);",
  "write(router, \"newer router state\");",
  "setMtime(router, 2000);",
  "write(retired, \"older retired state\");",
  "setMtime(retired, 1000);",
  'assert(legacyStatePath(fileName) === router, "the newer candidate wins over the retired directory");',
  'assert(stateReadPath(fileName) === router, "the read path follows the newer candidate");',
  "write(retired, \"newer retired state\");",
  "setMtime(retired, 3000);",
  'assert(legacyStatePath(fileName) === retired, "the retired directory wins only when it is newer");',
  'assert(stateReadPath(fileName) === retired, "the read path follows the actual newest candidate");',
  "setMtime(retired, 4000);",
  "setMtime(router, 4000);",
  'assert(legacyStatePath(fileName) === router, "an exact tie prefers the non-retired directory");',
  'assert(stateReadPath(fileName) === router, "the read path prefers the non-retired directory on a tie");',
  'process.env.TAWASSUL_V2_STATE_DIR = join(work, "v2state");',
  'assert(legacyFallbackFor(join(work, "v2state", fileName)) === router, "the fallback resolver follows the same newest candidate");',
  "delete process.env.TAWASSUL_V2_STATE_DIR;",
  "rmSync(router, { force: true });",
  'assert(legacyStatePath(fileName) === retired, "a single candidate is returned");',
  'assert(stateReadPath(fileName) === retired, "the read path accepts the only candidate");',
  "rmSync(retired, { force: true });",
  'assert(legacyStatePath(fileName) === retired, "with no candidate the documented default is returned");',
  'assert(stateReadPath(fileName) === statePath(fileName), "with no candidate the read path keeps the primary namespace");',
  'console.log(`PROOF PASS: the legacy fallback follows freshness and never prefers the retired tree (${passed} assertions)`);',
  "",
].join("\n");

const childPath = join(work, "child.ts");
writeFileSync(childPath, childSource, "utf8");

const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) env[key] = value;
}
env.HOME = fakeHome;
delete env.XDG_CONFIG_HOME;
delete env.TAWASSUL_V2_STATE_DIR;
delete env.TAWASSUL_V2_LEGACY_STATE_DIR;

try {
  const run = spawnSync("bun", [childPath], { encoding: "utf8", env, timeout: 120_000 });
  process.stdout.write(run.stdout ?? "");
  process.stderr.write(run.stderr ?? "");
  if (run.status !== 0) {
    console.error(`PROOF FAIL: the isolated child exited with ${String(run.status)}`);
    process.exitCode = 1;
  } else if (!(run.stdout ?? "").includes("PROOF PASS:")) {
    console.error("PROOF FAIL: the isolated child printed no pass line");
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
