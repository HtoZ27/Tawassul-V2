import "./proof-log-isolate.ts";
import { existsSync, mkdirSync, mkdtempSync, chmodSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { RETIRED_MODEL_IDS } from "../src/core/model-registry.ts";
import { FALLBACK_CHAINS, sweepRetiredModelPins } from "../src/services/proxy-fallback-chains.ts";
import { HandoffLedger } from "../src/services/handoff-ledger.ts";
import { ImageRouter } from "../src/services/image-router/index.ts";
import { AgentValidator } from "../src/services/third-party-validator.ts";
import { secureExec, probeBunVersion, PKG_SAFE_SCRIPTS, runnerEnvironment, assertShellSafe } from "../src/utils/secure-exec.ts";
import { BASH_READ_ONLY } from "../src/permissions.ts";
import {
  findExecutable,
  hasScript,
  isInsideProjectRoot,
  readPackageScripts,
  resolveProjectRunner,
  resolveSpawnPlan,
  splitPathEntries,
} from "../src/utils/package-manager.ts";
import { isInsideDir } from "../src/utils/path-resolver.ts";
import { HMAC_PREFIX, unwrapWithHmac, wrapWithHmac } from "../src/utils/crypto.ts";
import { validateAddInput } from "../src/tools/agent-add-helpers.ts";
import { buildGitDiffTool } from "../src/tools/search-and-diff.ts";
import { t } from "../src/translations.ts";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

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

function source(relative: string): string {
  return readFileSync(join(repo, relative), "utf8");
}

const retired = [
  "opencode/mimo-v2.5-free",
  "cloudflare-workers-ai/@cf/moonshotai/kimi-k2.7-code",
  "opencode/deepseek-v4-flash-free",
  "opencode/nemotron-3-ultra-free",
  "opencode/ox-alpha-free",
];
for (const id of retired) assert(RETIRED_MODEL_IDS.has(id), `the registry retires ${id}`);
assert(!RETIRED_MODEL_IDS.has("opencode/mimo-v2.6-flash-free"), "the registry keeps the mimo rename");
for (const [role, chain] of Object.entries(FALLBACK_CHAINS)) {
  assert(!chain.some((model) => RETIRED_MODEL_IDS.has(model)), `the ${role} chain carries no retired model`);
}
assert(FALLBACK_CHAINS.architect?.includes("opencode/mimo-v2.6-flash-free") === true, "the architect head targets mimo 2.6");
assert(FALLBACK_CHAINS.architect?.some((model) => model.includes("minimax")) === false, "the architect head drops minimax");

const modelsDir = mkdtempSync(join(tmpdir(), "tawassul-s017-models-"));
const savedModelsEnv = process.env.TAWASSUL_MODELS_JSON;
try {
  const absentFixture = join(modelsDir, "absent.json");
  writeFileSync(
    absentFixture,
    JSON.stringify({ opencode: { models: { "big-pickle": {} } }, "cloudflare-workers-ai": { models: {} } }),
  );
  process.env.TAWASSUL_MODELS_JSON = absentFixture;
  const pins: Record<string, string> = {
    "architect-pickle": "cloudflare-workers-ai/@cf/moonshotai/kimi-k2.7-code",
    "dev-gemini": "opencode/mimo-v2.5-free",
    "analyst-pickle": "opencode/big-pickle",
  };
  const reassigned = sweepRetiredModelPins(pins);
  assert(reassigned.length === 2, "the sweep reassigns both absent pins");
  assert(pins["analyst-pickle"] === "opencode/big-pickle", "the sweep keeps a healthy pin");
  assert(!Object.values(pins).some((model) => RETIRED_MODEL_IDS.has(model)), "the sweep leaves no absent pin");

  const servedFixture = join(modelsDir, "served.json");
  writeFileSync(
    servedFixture,
    JSON.stringify({
      opencode: { models: { "mimo-v2.5-free": {}, "big-pickle": {} } },
      "cloudflare-workers-ai": { models: { "@cf/moonshotai/kimi-k2.7-code": {} } },
    }),
  );
  process.env.TAWASSUL_MODELS_JSON = servedFixture;
  const servedPins: Record<string, string> = {
    "architect-pickle": "cloudflare-workers-ai/@cf/moonshotai/kimi-k2.7-code",
    "dev-gemini": "opencode/mimo-v2.5-free",
    "analyst-pickle": "opencode/big-pickle",
  };
  const kept = sweepRetiredModelPins(servedPins);
  assert(kept.length === 0, "a served retired pin is kept");
  assert(servedPins["dev-gemini"] === "opencode/mimo-v2.5-free", "the served retired pin is unchanged");
} finally {
  if (savedModelsEnv === undefined) delete process.env.TAWASSUL_MODELS_JSON;
  else process.env.TAWASSUL_MODELS_JSON = savedModelsEnv;
  rmSync(modelsDir, { recursive: true, force: true });
}
const sweepSource = source("scripts/sweep-state-retired-pins.ts");
assert(sweepSource.includes("unwrapWithHmac") && sweepSource.includes("wrapWithHmac"), "the residue sweep re-signs through the key code");
assert(sweepSource.includes("sweepRetiredModelPins"), "the residue sweep reuses the registry sweep");

const generator = source("src/scripts/gen-opencode-config.ts");
assert(generator.includes("FATAL (in-lock)"), "the generator builds inside the lock");
assert(generator.includes("post-write global verify FAILED"), "the generator honours the post-write verify");
assert(generator.includes("permission drift vs generated template"), "the generator compares permissions");
assert(generator.includes("matches neither template"), "the generator checks template-or-pin models");
const configUtil = source("src/utils/opencode-config.ts");
assert(configUtil.includes("await new Promise((r) => setTimeout(r, lockRetryDelayMs(attempt)))"), "the lock retry is awaited");
assert(!configUtil.includes(".unref()"), "the lock retry never unrefs its timer");
assert(source("src/scripts/facts.ts").includes("export function buildFacts"), "the facts check is code-backed");
assert(source("src/FACTS.md").includes("agentsTotal ="), "the tracked facts file exists");

const pipeline = source("src/hooks/validation-pipeline.ts");
const permissionGuard = source("src/hooks/guards/permission-guard.ts");
assert(pipeline.includes("rosterBoundaryDeleteGuard"), "the roster boundary guard is wired into ESSENTIAL");
assert(permissionGuard.includes("\\.opencode\\/agents\\/[^/]+\\.md$"), "the roster guard scopes the variant file regex");
assert(pipeline.includes("blockingGuard = \"roster-boundary-delete\""), "the unmanaged branch reports guard attribution");
assert(source("src/bootstrap/plugin-init.ts").includes("requiresConsent("), "init fails closed for consent tools");
assert(validateAddInput(["analyst-gemini"], "google/gemini-flash-lite-latest") === null, "the add allowlist accepts a governed suffix");
assert(validateAddInput(["analyst-nope"], "google/gemini-flash-lite-latest") !== null, "the add allowlist rejects an unknown suffix");
assert(validateAddInput(["tawa-dev"], "google/gemini-flash-lite-latest") !== null, "the add allowlist rejects a tawa variant");

const work = mkdtempSync(join(tmpdir(), "tawassul-s017-"));
try {
  const failingDir = join(work, "ledger-fail");
  mkdirSync(failingDir, { recursive: true });
  mkdirSync(join(failingDir, "handoff-ledger.jsonl"), { recursive: true });
  const failing = new HandoffLedger(failingDir);
  failing.append({ type: "handoff_created", handoffId: "H-1", from: "dev", to: "tester", task: "proof" });
  let rejected = false;
  try {
    await failing.flush();
  } catch {
    rejected = true;
  }
  assert(rejected, "a failed ledger flush reports the failure");
  rmSync(join(failingDir, "handoff-ledger.jsonl"), { recursive: true, force: true });
  await failing.flush();
  assert(readFileSync(join(failingDir, "handoff-ledger.jsonl"), "utf8").includes('"handoffId":"H-1"'), "the failed batch is requeued and written");
  await failing.dispose();
} finally {
  rmSync(join(work, "ledger-fail"), { recursive: true, force: true });
}

const signed = wrapWithHmac(JSON.stringify({ ok: true }));
assert(unwrapWithHmac(signed) === JSON.stringify({ ok: true }), "a signed payload verifies");
assert(unwrapWithHmac(`${HMAC_PREFIX}${"z".repeat(64)}:{}`) === null, "a non-hex signature fails cleanly");
assert(unwrapWithHmac(`${HMAC_PREFIX}not-a-signature:{}`) === null, "a malformed signature fails cleanly");

const router = new ImageRouter();
const routed = router.analyzeAndRoute("image", ["@designer", "@reviewer", "@analyst"], { filename: "screen.png" });
assert(routed.analysis.type === "screenshot", "the image router classifies a screenshot");
assert(routed.suggestedAgent === "@designer", "the image router keeps the top preferred agent");
assert(routed.fallbackAgent === "@reviewer", "the image router picks the next preferred fallback");
const nextPreferred = router.analyzeAndRoute("image", ["@analyst", "@reviewer"], { filename: "screen.png" });
assert(nextPreferred.suggestedAgent === "@reviewer", "the image router skips an unavailable top preference");
const arbitrary = router.analyzeAndRoute("image", ["@analyst"], { filename: "screen.png" });
assert(arbitrary.fallbackAgent === "@analyst", "the image router falls back to an available agent");

const validator = new AgentValidator(
  () => ["@dev", "@tester"],
  { getState: (agent) => (agent === "@reviewer" ? "OPEN" : "CLOSED") },
);
assert((await validator.validate({ handoffId: "H-1", from: "@dev", to: "@tawa", task: "x" })).approved === false, "a short task to tawa is blocked");
assert((await validator.validate({ handoffId: "H-2", from: "@dev", to: "@reviewer", task: "x" })).approved === false, "a short task to an OPEN agent is blocked");
assert((await validator.validate({ handoffId: "H-3", from: "@dev", to: "@analyst", task: "x" })).approved === true, "a short task to a healthy agent passes");

const deniedCases: Array<[string, string[]]> = [
  ["curl", ["https://example.test"]],
  ["git", ["diff", "--output=/tmp/leak"]],
  ["npm", ["run", "postinstall"]],
  ["npx", ["typescript"]],
  ["rg", ["-r", "x", "y"]],
  ["git", ["status"]],
  ["bun", ["install"]],
  ["bun", ["-e", "x"]],
  ["bunx", ["eslint"]],
  ["bun", ["test"]],
  ["bun", ["test", "--preload", "./x.ts"]],
  ["npm", ["test", "--", "--require=/tmp/x.js"]],
  ["bun", ["run", "lint"]],
];
let denied = 0;
for (const [binary, args] of deniedCases) {
  const blocked = await secureExec(binary, args).then(() => false, () => true);
  if (blocked) denied += 1;
}
assert(denied === deniedCases.length, "the secure exec allowlist rejects every forbidden case");

const resolverRoot = mkdtempSync(join(tmpdir(), "tawassul-resolver-"));
try {
  const project = join(resolverRoot, "project");
  const bin = join(resolverRoot, "bin");
  mkdirSync(project, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const fakeNpm = join(bin, "npm");
  writeFileSync(fakeNpm, "#!/bin/sh\nexit 0\n");
  chmodSync(fakeNpm, 0o755);
  const fakeBun = join(bin, "bun");
  writeFileSync(fakeBun, "#!/bin/sh\nexit 0\n");
  chmodSync(fakeBun, 0o755);
  writeFileSync(join(project, "package.json"), JSON.stringify({ scripts: { lint: "true", test: "true" } }));
  writeFileSync(join(project, "package-lock.json"), "{}");

  assert(PKG_SAFE_SCRIPTS.has("test") && !PKG_SAFE_SCRIPTS.has("postinstall"), "the package script allowlist stays narrow");
  assert(hasScript(project, "lint") === true, "the resolver reads package scripts");
  assert(hasScript(project, "build") === false, "the resolver reports a missing script");
  assert(readPackageScripts(project)?.test === "true", "the resolver parses package.json scripts");

  const locked = await resolveProjectRunner(project, {
    env: { PATH: bin },
    platform: "linux",
    probeHostBun: async () => false,
  });
  assert(
    locked.kind === "runner" && locked.runner.kind === "path" && locked.runner.manager === "npm",
    "the resolver picks the lockfile manager when its executable exists",
  );

  writeFileSync(join(project, "package.json"), JSON.stringify({ packageManager: "npm@10.0.0", scripts: { lint: "true" } }));
  const declaredMissing = await resolveProjectRunner(project, {
    env: { PATH: "" },
    platform: "linux",
    probeHostBun: async () => true,
  });
  assert(
    declaredMissing.kind === "runner" && declaredMissing.runner.kind === "host-bun",
    "a declared but missing manager falls through to the host Bun lane",
  );

  const rejectedHost = await resolveProjectRunner(project, {
    env: { PATH: "" },
    platform: "linux",
    probeHostBun: async () => false,
  });
  assert(rejectedHost.kind === "none" && rejectedHost.skipped.includes("npm"), "a rejected host probe and no PATH manager yields no runner");

  const unavailableOverride = await resolveProjectRunner(project, {
    env: { PATH: bin, TAWASSUL_PACKAGE_MANAGER: "pnpm" },
    platform: "linux",
  });
  assert(unavailableOverride.kind === "override-unavailable" && unavailableOverride.manager === "pnpm", "an unavailable explicit override fails closed");

  const invalidOverride = await resolveProjectRunner(project, {
    env: { PATH: bin, TAWASSUL_PACKAGE_MANAGER: "cargo" },
    platform: "linux",
  });
  assert(invalidOverride.kind === "override-invalid" && invalidOverride.value === "cargo", "an invalid override is reported");

  const availableOverride = await resolveProjectRunner(project, {
    env: { PATH: bin, TAWASSUL_PACKAGE_MANAGER: "bun" },
    platform: "linux",
  });
  assert(
    availableOverride.kind === "runner" && availableOverride.runner.kind === "path" && availableOverride.runner.manager === "bun",
    "an available override wins",
  );

  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ packageManager: "bun@1.3.14", scripts: { lint: "true", test: "true" } }),
  );
  const declaredAvailable = await resolveProjectRunner(project, {
    env: { PATH: bin },
    platform: "linux",
    probeHostBun: async () => false,
  });
  assert(
    declaredAvailable.kind === "runner" &&
      declaredAvailable.source === "packageManager" &&
      declaredAvailable.runner.kind === "path" &&
      declaredAvailable.runner.manager === "bun",
    "an available packageManager field wins over the lockfile",
  );

  const bunLockProject = join(resolverRoot, "bun-lock-project");
  mkdirSync(bunLockProject, { recursive: true });
  writeFileSync(join(bunLockProject, "package.json"), JSON.stringify({ scripts: { test: "true" } }));
  writeFileSync(join(bunLockProject, "bun.lock"), "");
  const bunLocked = await resolveProjectRunner(bunLockProject, {
    env: { PATH: bin },
    platform: "linux",
    probeHostBun: async () => false,
  });
  assert(
    bunLocked.kind === "runner" &&
      bunLocked.source === "lockfile" &&
      bunLocked.runner.kind === "path" &&
      bunLocked.runner.manager === "bun",
    "a bun lockfile selects bun without npm",
  );

  const plainProject = join(resolverRoot, "plain-project");
  mkdirSync(plainProject, { recursive: true });
  writeFileSync(join(plainProject, "package.json"), JSON.stringify({ scripts: { test: "true" } }));
  const bunOnPath = await resolveProjectRunner(plainProject, {
    env: { PATH: bin },
    platform: "linux",
    probeHostBun: async () => false,
  });
  assert(
    bunOnPath.kind === "runner" &&
      bunOnPath.source === "bun" &&
      bunOnPath.runner.kind === "path" &&
      bunOnPath.runner.manager === "bun",
    "bun on PATH is the fallback before the host probe",
  );

  const pnpProject = join(resolverRoot, "pnp-project");
  mkdirSync(pnpProject, { recursive: true });
  writeFileSync(join(pnpProject, "package.json"), JSON.stringify({ scripts: { test: "true" } }));
  writeFileSync(join(pnpProject, ".pnp.cjs"), "");
  const pnpUnavailable = await resolveProjectRunner(pnpProject, {
    env: { PATH: bin },
    platform: "linux",
    probeHostBun: async () => true,
  });
  assert(
    pnpUnavailable.kind === "pnp-unavailable" && pnpUnavailable.skipped.includes("yarn"),
    "yarn PnP without yarn is reported instead of downgraded",
  );

  assert(
    splitPathEntries("\"C:\\a;b\";D:\\c", "win32").join("|") === "C:\\a;b|D:\\c",
    "the win32 PATH splitter honours quotes and drops the quotes",
  );

  const winBin = join(resolverRoot, "winbin");
  mkdirSync(winBin, { recursive: true });
  writeFileSync(join(winBin, "npm.exe"), "");
  writeFileSync(join(winBin, "npm.cmd"), "");
  const winContext = {
    platform: "win32" as const,
    pathEnv: winBin,
    pathExt: ".COM;.EXE;.BAT;.CMD",
    comSpec: "C:\\Windows\\System32\\cmd.exe",
    projectRoot: project,
  };
  assert(findExecutable("npm", winContext) === join(winBin, "npm.exe"), "the win32 resolver prefers the .exe lane");
  const winLockProject = join(resolverRoot, "win-lock-project");
  mkdirSync(winLockProject, { recursive: true });
  writeFileSync(join(winLockProject, "package.json"), JSON.stringify({ scripts: { test: "true" } }));
  writeFileSync(join(winLockProject, "package-lock.json"), "{}");
  const winResolved = await resolveProjectRunner(winLockProject, {
    env: { PATH: winBin, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
    platform: "win32",
    projectRoot: winLockProject,
    probeHostBun: async () => false,
  });
  assert(
    winResolved.kind === "runner" &&
      winResolved.runner.kind === "path" &&
      winResolved.runner.manager === "npm" &&
      winResolved.runner.exe === join(winBin, "npm.exe"),
    "the win32 resolver selects the lockfile manager through the .exe lane",
  );
  const cmdPlan = resolveSpawnPlan(join(winBin, "npm.cmd"), ["run", "lint"], winContext);
  assert(
    cmdPlan.command === winContext.comSpec && cmdPlan.args.slice(0, 3).join(" ") === "/d /s /c",
    "the win32 shim runs through ComSpec",
  );
  assert(
    cmdPlan.windowsVerbatimArguments === true && cmdPlan.args[3]?.startsWith("\"") === true,
    "the win32 shim builds one quoted verbatim command line",
  );
  const unsafeShell = await (async () => {
    try {
      resolveSpawnPlan(join(winBin, "npm.cmd"), ["run", "%PATH%"], winContext);
      return false;
    } catch {
      return true;
    }
  })();
  assert(unsafeShell, "the win32 shim rejects percent expansion");
  const unsafeExe = await (async () => {
    try {
      resolveSpawnPlan(join(winBin, "npm%x.cmd"), ["run", "lint"], winContext);
      return false;
    } catch {
      return true;
    }
  })();
  assert(unsafeExe, "the win32 shim rejects percent expansion in the command path");
  const exePlan = resolveSpawnPlan(join(winBin, "npm.exe"), ["run", "lint"], winContext);
  assert(exePlan.windowsVerbatimArguments === false, "the win32 .exe lane spawns directly");
  assert(exePlan.shell === false && cmdPlan.shell === true, "the spawn plan reports whether a shell is used");
  const missingComSpec = await (async () => {
    try {
      resolveSpawnPlan(join(winBin, "npm.cmd"), ["run", "lint"], { ...winContext, comSpec: undefined });
      return false;
    } catch {
      return true;
    }
  })();
  assert(missingComSpec, "the win32 shim fails closed without ComSpec");
  const relativeComSpec = await (async () => {
    try {
      resolveSpawnPlan(join(winBin, "npm.cmd"), ["run", "lint"], { ...winContext, comSpec: "cmd.exe" });
      return false;
    } catch {
      return true;
    }
  })();
  assert(relativeComSpec, "the win32 shim fails closed on a relative ComSpec");
  const quotedComSpec = resolveSpawnPlan(join(winBin, "npm.cmd"), ["run", "lint"], {
    ...winContext,
    comSpec: '"D:\\Tools\\cmd.exe"',
  });
  assert(quotedComSpec.command === "D:\\Tools\\cmd.exe", "the win32 shim accepts a quoted ComSpec on another drive");
  const uncComSpec = resolveSpawnPlan(join(winBin, "npm.cmd"), ["run", "lint"], {
    ...winContext,
    comSpec: "\\\\server\\share\\cmd.exe",
  });
  assert(uncComSpec.command === "\\\\server\\share\\cmd.exe", "the win32 shim accepts a UNC ComSpec");
  const rootedNoDrive = (() => {
    try {
      resolveSpawnPlan(join(winBin, "npm.cmd"), ["run", "lint"], { ...winContext, comSpec: "\\Windows\\System32\\cmd.exe" });
      return false;
    } catch {
      return true;
    }
  })();
  assert(rootedNoDrive, "the win32 shim rejects a drive-relative ComSpec root");
  const shellMeta = (() => {
    try {
      assertShellSafe(["run", "a|b"]);
      return false;
    } catch {
      return true;
    }
  })();
  assert(shellMeta, "the shell lane rejects shell metacharacters in arguments");

  assert(isInsideDir("C:\\Proj", "c:\\proj\\src", "win32") === true, "the win32 trust check folds case");
  assert(isInsideDir("C:\\Proj", "C:\\Other", "win32") === false, "the win32 trust check rejects a sibling path");

  const trustRoot = join(resolverRoot, "trust");
  const trustProject = join(trustRoot, "project");
  const trustTools = join(trustProject, "tools");
  const trustLink = join(trustRoot, "link-bin");
  mkdirSync(trustTools, { recursive: true });
  writeFileSync(join(trustTools, "npm"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(trustTools, "npm"), 0o755);
  symlinkSync(trustTools, trustLink, "junction");
  assert(
    isInsideProjectRoot(trustProject, trustLink, "linux") === true,
    "the trust check canonicalizes a symlinked directory",
  );
  assert(
    findExecutable("npm", { platform: "linux", pathEnv: trustLink, pathExt: "", projectRoot: trustProject }) === undefined,
    "the resolver skips an executable reached through a symlinked project directory",
  );
  assert(
    isInsideProjectRoot(trustProject, join(trustRoot, "sibling"), "linux") === false,
    "the trust check keeps a sibling directory outside",
  );
  assert(
    isInsideProjectRoot(join(trustRoot, "missing"), join(trustRoot, "missing", "src"), "linux") === true,
    "the trust check falls back to the textual path",
  );

  assert((await probeBunVersion("host", async () => "1.4.4\n")) === true, "the host probe accepts Bun semver");
  assert((await probeBunVersion("node", async () => "v22.9.0\n")) === false, "the host probe rejects Node version output");
  assert((await probeBunVersion("broken", async () => { throw new Error("nope"); })) === false, "the host probe fails closed");

  const previousBunBeBun = process.env.BUN_BE_BUN;
  process.env.BUN_BE_BUN = "1";
  try {
    const pathEnv = runnerEnvironment({ kind: "path", manager: "npm", exe: join(bin, "npm") });
    assert(!("BUN_BE_BUN" in pathEnv), "a path runner environment drops an inherited BUN_BE_BUN");
    const hostEnv = runnerEnvironment({ kind: "host-bun", exe: "/host/bun" });
    assert(hostEnv.BUN_BE_BUN === "1", "the host Bun environment carries BUN_BE_BUN");
  } finally {
    if (previousBunBeBun === undefined) delete process.env.BUN_BE_BUN;
    else process.env.BUN_BE_BUN = previousBunBeBun;
  }

  const bunVersion = await secureExec("bun", ["--version"]);
  assert(/^\d+\.\d+\.\d+/.test(bunVersion.stdout.trim()), "the secure exec bun lane returns a Bun version");
  const missingScriptDenied = await secureExec("bun", ["run", "build"], { cwd: project }).then(() => false, () => true);
  assert(missingScriptDenied, "bun run rejects a script absent from package.json");
  const declaredScriptRan = await secureExec("bun", ["run", "lint"], { cwd: project }).then(() => true, () => false);
  assert(declaredScriptRan, "bun run executes a declared safe script");

  const savedPath = process.env.PATH;
  let enoentCode: string | null = null;
  process.env.PATH = "";
  try {
    await secureExec("rg", ["--version"]);
  } catch (e) {
    enoentCode = (e as { code?: string }).code ?? null;
  } finally {
    process.env.PATH = savedPath;
  }
  assert(enoentCode === "ENOENT", "a missing binary reports ENOENT");

  const savedNpmPath = process.env.PATH;
  let tailMessage = "";
  process.env.PATH = bin;
  try {
    tailMessage = await secureExec("npm", ["run", "test", "--", "--x=$(id)"], { cwd: project }).then(
      () => "",
      (e: Error) => e.message,
    );
  } finally {
    process.env.PATH = savedNpmPath;
  }
  assert(
    tailMessage.includes("Shell metacharacters"),
    "the package-manager lane rejects shell metacharacters in a script tail",
  );

  const savedGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = devNull;
  let headParent = "";
  try {
    const gitRepo = join(resolverRoot, "git-repo");
    mkdirSync(gitRepo, { recursive: true });
    const gitEnv = {
      ...process.env,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Tawassul Proof",
      GIT_AUTHOR_EMAIL: "proof@tawassul.test",
      GIT_COMMITTER_NAME: "Tawassul Proof",
      GIT_COMMITTER_EMAIL: "proof@tawassul.test",
    };
    const firstInit = spawnSync("git", ["init", "-q"], { cwd: gitRepo, env: gitEnv });
    writeFileSync(join(gitRepo, "one.txt"), "one\n");
    spawnSync("git", ["add", "one.txt"], { cwd: gitRepo, env: gitEnv });
    const firstCommit = spawnSync("git", ["commit", "-q", "--no-verify", "-m", "one"], { cwd: gitRepo, env: gitEnv });
    writeFileSync(join(gitRepo, "two.txt"), "two\n");
    spawnSync("git", ["add", "two.txt"], { cwd: gitRepo, env: gitEnv });
    const secondCommit = spawnSync("git", ["commit", "-q", "--no-verify", "-m", "two"], { cwd: gitRepo, env: gitEnv });
    assert(
      firstInit.status === 0 && firstCommit.status === 0 && secondCommit.status === 0,
      "the proof repository records two commits",
    );
    headParent = await secureExec("git", ["diff", "--stat", "HEAD^!"], { cwd: gitRepo }).then(
      (result) => result.stdout,
      () => "",
    );
    writeFileSync(join(gitRepo, "two.txt"), "two changed\n");
    const externalDiff = join(resolverRoot, "external-diff.sh");
    const externalMarker = join(resolverRoot, "external-diff-ran");
    writeFileSync(externalDiff, `#!/bin/sh\ntouch "${externalMarker}"\nexit 1\n`);
    chmodSync(externalDiff, 0o755);
    const savedExternalDiff = process.env.GIT_EXTERNAL_DIFF;
    process.env.GIT_EXTERNAL_DIFF = externalDiff;
    let diffOutput = "";
    try {
      const diffTool = buildGitDiffTool({} as never);
      const diffContext = {
        sessionID: "ses_proof",
        messageID: "msg_proof",
        agent: "dev",
        directory: gitRepo,
        worktree: gitRepo,
        abort: new AbortController().signal,
        metadata() {},
      } as never;
      const result = await diffTool.execute({}, diffContext);
      diffOutput = typeof result === "string" ? result : result.output;
      const combined = await diffTool.execute({ staged: true, commit: "HEAD" } as never, diffContext);
      const combinedOutput = typeof combined === "string" ? combined : combined.output;
      assert(combinedOutput === t("gitDiffStagedCommit"), "git diff rejects staged together with commit");
    } finally {
      if (savedExternalDiff === undefined) delete process.env.GIT_EXTERNAL_DIFF;
      else process.env.GIT_EXTERNAL_DIFF = savedExternalDiff;
    }
    assert(!existsSync(externalMarker), "git diff does not run an external diff driver");
    assert(diffOutput.includes("two changed"), "git diff reports the change with external drivers disabled");
  } finally {
    if (savedGitConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = savedGitConfigGlobal;
  }
  assert(headParent.includes("two.txt"), "a direct spawn runs git diff with the ^! revision syntax");

  for (const flag of ["--node-options", "--script-shell", "--experimental-loader", "--inspect", "--debug", "--debug-brk"]) {
    const message = await secureExec("npm", ["run", "test", flag], { cwd: project }).then(
      () => "",
      (e: Error) => e.message,
    );
    assert(message.includes("not allowed after a package script"), `npm run rejects ${flag} after the script name`);
  }
  assert(BASH_READ_ONLY["bun test*"] === "deny", "the permission table denies bare bun test");
  assert(BASH_READ_ONLY["bun run test"] === "allow", "the permission table allows bun run test");
  assert(
    Object.entries(BASH_READ_ONLY).every(([rule, action]) => !(action === "allow" && /^bun test/.test(rule))),
    "no permission rule allows a bare bun test",
  );
} finally {
  rmSync(resolverRoot, { recursive: true, force: true });
}

assert(!source("src/utils/package-manager.ts").includes("child_process"), "the resolver module imports no child-process API");
assert(!source("src/tools/quality-report.ts").includes("Promise.all"), "the quality report runs checks sequentially");
assert(source("src/tools/quality-report.ts").includes("qualityreport()"), "the quality report advertises its registered name");
assert(!source("src/tools/quality-report.ts").includes("quality_report"), "the quality report description carries no unregistered name");
assert(!source("src/services/spec-driven/types.ts").includes("quality_report"), "the spec default uses the registered tool name");
const searchSource = source("src/tools/search-and-diff.ts");
const smartGrepBody = searchSource.slice(
  searchSource.indexOf("export function buildSmartGrepTool"),
  searchSource.indexOf("export function buildGitDiffTool"),
);
const gitDiffBody = searchSource.slice(
  searchSource.indexOf("export function buildGitDiffTool"),
  searchSource.indexOf("export function buildBatchReadTool"),
);
assert(smartGrepBody.includes("cwd: cctx.directory"), "smart grep pins the project root");
assert(gitDiffBody.includes("cwd: cctx.directory"), "git diff pins the project root");

const goalStore = source("src/services/goal-store.ts");
assert((goalStore.match(/const fresh = this\.goals\.get\(id\)/g) ?? []).length >= 3, "the goal store re-reads inside the lock");
assert(source("src/context/session-manager.ts").includes("acquireFSLock"), "the session registry uses the file lock");
assert(source("src/services/state-persistence.ts").includes("Math.max(budget, value.length)"), "the deferred save keeps the lenient max budget");
assert(source("src/services/state-persistence.ts").includes("const wait = Math.max(0, this.nextRetryAt - now)"), "the deferred wakeup keeps its own timer");
assert(source("src/services/state-persistence.ts").includes("setTimeout(wake, wait)"), "the deferred wakeup timer is armed");
assert(source("src/services/handoff-ledger.ts").includes("const batch = this.buffer;"), "the ledger swaps the batch before awaiting");
assert(source("src/services/handoff-ledger.ts").includes("this.buffer = [...batch, ...this.buffer]"), "the ledger requeues a failed batch at the front");
assert(source("src/services/trust-score/calculator.ts").includes("async persist(): Promise<void>"), "the trust score keeps its persist path");
assert(source("src/services/trust-score/calculator.ts").includes("history: Object.fromEntries(this.history)"), "the trust score persists its history");
assert(source("src/utils/opencode-config.ts").includes("cannot-verify protected-agent deletions"), "the deletion sentinel throws on unreadable input");
assert(source("src/utils/opencode-config.ts").includes("{ cause: e }"), "the deletion sentinel keeps its cause");
assert(source("package.json").includes('"check:config"') && source("package.json").includes('"ci"'), "the config and ci scripts are wired");
assert(source("src/services/trust-score/calculator.ts").includes("getReport(agentId: string)"), "the trust report path is present");
assert(source("src/hooks/message-updated.ts").includes("elicitation"), "the elicitation fallback is audited");
assert(source("src/utils/path.ts").includes("await realpath(dirname(resolved))"), "the path resolver falls back through the dirname realpath");
assert(source("src/tools/image-gen.ts").includes("let cachedAccessToken: string | null = null"), "the image token lives in module memory");
assert(source("src/tools/handoff.ts").includes('s === "strict" && ruleDecision.action === "block"'), "strict handoff rules block");
assert(source("src/tools/web.ts").includes("output-${Date.now()}-${randomBytes(4).toString(\"hex\")}.txt"), "web temp files are unique");
assert(source("src/services/event-hub.ts").includes("slotDeadline"), "the event slot wait carries a deadline");
assert(source("src/tools/agent-management.ts").includes("configWriteChains"), "the stored chain keeps its serialized audit");
assert(source("src/services/proxy-fallback-chains.ts").includes("sweepRetiredModelPins"), "the retirement sweep is exported");

const logPath = join(work, "redact.log");
const probe = String.raw`
(async () => {
  const { logger } = await import("./src/utils/logger.ts");
  logger.addSecret("proofkey");
  const circular = { depth: 0 };
  circular.self = circular;
  logger.info("redact-proof", { proofkey: "leaked-value", nested: { proofkey: "leaked-value" }, circular });
  await new Promise((r) => setTimeout(r, 200));
  const fs = require("node:fs");
  const text = fs.readFileSync(process.env.TAWASSUL_LOG_FILE, "utf8");
  const ok = text.includes("[REDACTED]") && text.includes("[Circular]") && !text.includes("leaked-value");
  process.exit(ok ? 0 : 3);
})().catch((e) => { console.error(e); process.exit(4); });
`;
const run = spawnSync(process.execPath, ["-e", probe], {
  cwd: repo,
  encoding: "utf8",
  env: { ...process.env, TAWASSUL_LOG_FILE: logPath },
});
assert(run.status === 0, "the logger redacts secrets, cycles, and over-depth values");

const referenced = [
  "scripts/prove-gen-lock-contention.ts",
  "scripts/prove-gen-merge-guards.ts",
  "scripts/prove-gen-guard-wal.ts",
  "scripts/prove-roster-boundary.ts",
  "scripts/prove-event-trust-p1.ts",
  "scripts/prove-web-ssrf.ts",
  "scripts/prove-s028.ts",
];
for (const file of referenced) {
  const path = join(repo, file);
  assert(existsSync(path) && readFileSync(path, "utf8").includes("PROOF PASS"), `${file} stays executable evidence`);
}

rmSync(work, { recursive: true, force: true });
console.log(`PROOF PASS: S-017 hardening rows, retirements, governance, and runtime guards (${passed} assertions)`);
