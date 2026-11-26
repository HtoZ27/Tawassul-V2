import "./proof-log-isolate.ts";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const DOCTOR = join(REPO, "scripts", "doctor-v2.sh");
const ROOT = mkdtempSync(join(tmpdir(), "tawassul-desktop-scan-"));
const HOME = join(ROOT, "home");

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

function seed(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

const V2_ENTRY = [
  "const tawassul = {",
  '  id: "tawassul",',
  "  server: () => ({}),",
  "  setup: () => () => undefined,",
  "};",
  "export default Plugin.define(tawassul);",
  "",
].join("\n");

const V1_ENTRY = [
  "const tawassul = {",
  '  id: "tawassul",',
  "  server: () => ({}),",
  "};",
  "export default tawassul;",
  "",
].join("\n");

const DUAL_ENTRY = [
  "const tawassul = {",
  '  id: "tawassul",',
  "  server: () => ({}),",
  "  setup: () => () => undefined,",
  "};",
  "export default tawassul;",
  "",
].join("\n");

function scan(args: string[], env: NodeJS.ProcessEnv = {}): { code: number; out: string } {
  const result = spawnSync("bash", [DOCTOR, "--scan-desktop", ...args], {
    env: { ...process.env, HOME, ...env },
    encoding: "utf-8",
  });
  return {
    code: result.status ?? -1,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

try {
  const CLEAN = join(ROOT, "clean-root");
  const cleanDir = join(CLEAN, "clean-project");
  const cleanEntry = seed(join(cleanDir, ".opencode", "plugin", "tawassul.js"), V2_ENTRY);
  seed(join(cleanDir, ".opencode", "plugins", "ignored", "dist", "index.js"), V1_ENTRY);
  const spaceDir = join(CLEAN, "clean project");
  seed(join(spaceDir, ".opencode", "plugins", "tawassul.js"), V2_ENTRY);
  const retiredDir = join(CLEAN, "retired-project");
  const retiredEntry = seed(
    join(retiredDir, ".opencode", "plugins", "tawassul", "index.ts.retired-20261025"),
    V1_ENTRY,
  );
  const disabledEntry = seed(join(retiredDir, ".opencode", "plugin", "tawassul.js.disabled"), V1_ENTRY);
  const unknownDir = join(CLEAN, "unknown-project");
  const unknownEntry = seed(join(unknownDir, ".opencode", "plugin", "other.ts"), 'export default { name: "other" };\n');
  mkdirSync(join(CLEAN, "empty-project"), { recursive: true });
  writeFileSync(join(CLEAN, "empty-project", "readme.txt"), "no plugin entries\n");

  const cleanHash = sha256(cleanEntry);
  const fromEnv = scan([], { TAWASSUL_DESKTOP_SCAN_ROOT: CLEAN });
  assert(fromEnv.code === 0, "a clean desktop scan exits 0");
  assert(fromEnv.out.includes(`scan: root=${CLEAN}`), "the scan honors TAWASSUL_DESKTOP_SCAN_ROOT");
  assert(
    fromEnv.out.includes(`workspace ${cleanDir}: entries=1 v2=1 v1=0 dual=0 unknown=0 retired=0`),
    "a v2 entry is classified once per workspace",
  );
  assert(
    fromEnv.out.includes(`workspace ${spaceDir}: entries=1 v2=1 v1=0 dual=0 unknown=0 retired=0`),
    "a workspace path with a space is scanned",
  );
  assert(
    fromEnv.out.includes(`workspace ${unknownDir}: entries=1 v2=0 v1=0 dual=0 unknown=1 retired=0`),
    "an unclassified entry is counted as unknown",
  );
  assert(fromEnv.out.includes("WARN  unclassified plugin entry:"), "an unclassified entry warns");
  assert(fromEnv.out.includes(unknownEntry), "the unclassified warning names the entry");
  assert(fromEnv.out.includes(`retired plugin entry: ${retiredEntry}`), "a retired package entry is reported");
  assert(fromEnv.out.includes(`retired plugin entry: ${disabledEntry}`), "a disabled flat entry is reported");
  assert(
    fromEnv.out.includes(`workspace ${retiredDir}: entries=0 v2=0 v1=0 dual=0 unknown=0 retired=2`),
    "retired entries are excluded from the active count",
  );
  assert(
    fromEnv.out.includes(
      `scan: root=${CLEAN} workspaces=4 active=3 v2=2 v1=0 dual=0 unknown=1 retired=2`,
    ),
    "the scan total counts workspaces, active entries, and retired entries",
  );
  assert(!fromEnv.out.includes(join(cleanDir, ".opencode", "plugins", "ignored")), "a nested dist entry is ignored");
  assert(!fromEnv.out.includes(`workspace ${join(CLEAN, "empty-project")}`), "a workspace without plugin dirs is skipped");
  assert(!fromEnv.out.includes("== project =="), "the scan early-exits before the project section");
  assert(fromEnv.out.includes("retired-20261025"), "the scan reports the H-09 retired rename");
  assert(sha256(cleanEntry) === cleanHash, "the scan leaves the plugin entry byte-identical");

  const SELF = join(ROOT, "self-root");
  seed(join(SELF, ".opencode", "plugin", "tawassul.js"), V2_ENTRY);
  const selfRun = scan([SELF]);
  assert(selfRun.code === 0, "the scan accepts the root itself as a workspace");
  assert(selfRun.out.includes(`workspace ${SELF}: entries=1`), "the root workspace is counted");

  const V1 = join(ROOT, "v1-root");
  const v1Entry = seed(join(V1, "v1-project", ".opencode", "plugins", "legacy", "index.ts"), V1_ENTRY);
  const v1Run = scan([V1]);
  assert(v1Run.code === 1, "a v1-only entry fails the scan");
  assert(v1Run.out.includes(`FAIL  v1-only plugin entry: ${v1Entry}`), "the v1-only failure names the entry");
  assert(v1Run.out.includes("workspaces=1 active=1 v2=0 v1=1 dual=0 unknown=0 retired=0"), "the v1-only count is recorded");

  const DUAL = join(ROOT, "dual-root");
  const dualEntry = seed(join(DUAL, "dual-project", ".opencode", "plugin", "bridge.ts"), DUAL_ENTRY);
  const dualRun = scan([DUAL]);
  assert(dualRun.code === 1, "a dual v1/v2 entry fails the scan");
  assert(dualRun.out.includes(`FAIL  dual v1/v2 plugin entry: ${dualEntry}`), "the dual failure names the entry");
  assert(dualRun.out.includes("workspaces=1 active=1 v2=0 v1=0 dual=1 unknown=0 retired=0"), "the dual count is recorded");

  const missing = join(ROOT, "missing-root");
  const missingRun = scan([missing]);
  assert(missingRun.code === 0, "a missing scan root is not a failure");
  assert(missingRun.out.includes(`scan root missing: ${missing}`), "a missing scan root is reported");

  console.log(`PROOF PASS: the desktop scan classifies v2, v1-only, dual, unknown, and retired entries across workspaces (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
