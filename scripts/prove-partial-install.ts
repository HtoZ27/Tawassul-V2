import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const WORK = mkdtempSync(join(tmpdir(), "tawassul-partial-install-"));
const HOME = join(WORK, "home");
const DATA = join(HOME, ".local", "share");
const GLOBAL = join(HOME, ".config", "opencode");
const BUNDLE = join(REPO, "dist", "global.js");

function isoEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME,
    XDG_CONFIG_HOME: join(HOME, ".config"),
    XDG_DATA_HOME: DATA,
    XDG_STATE_HOME: join(HOME, ".local", "state"),
    XDG_CACHE_HOME: join(HOME, ".cache"),
    TAWASSUL_OPENCODE_VERSION: "2.2.0",
    TAWASSUL_REGISTER_TRIGGERS: "off",
  };
  delete env.TAWASSUL_GLOBAL_DIR;
  delete env.TAWASSUL_SCOPE;
  delete env.OPENCODE_BIN;
  delete env.OPENCODE_DB;
  for (const [key, value] of Object.entries(extra)) env[key] = value;
  return env;
}

function runEntry(entry: string, args: string[], env: NodeJS.ProcessEnv): { code: number; out: string } {
  const result = spawnSync(process.execPath, [entry, ...args], { env, encoding: "utf-8", cwd: WORK });
  return { code: result.status ?? -1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function tawassulLines(out: string): string[] {
  return out.split("\n").filter((line) => line.includes("[tawassul]"));
}

const MODULE_COPY: Array<[string, string]> = [
  ["src/services/ast-service.ts", "src/services/ast-service.ts"],
  ["src/utils/logger.ts", "src/utils/logger.ts"],
  ["src/utils/state-paths.ts", "src/utils/state-paths.ts"],
  ["src/utils/path-resolver.ts", "src/utils/path-resolver.ts"],
];

try {
  assert(existsSync(BUNDLE), "dist/global.js exists (run npm run build first)");

  const COPY = join(WORK, "copy");
  for (const [from, dest] of MODULE_COPY) {
    mkdirSync(dirname(join(COPY, dest)), { recursive: true });
    copyFileSync(join(REPO, from), join(COPY, dest));
  }
  writeFileSync(
    join(COPY, "degraded.ts"),
    [
      'const { getAstService } = await import("./src/services/ast-service.ts");',
      "const svc = getAstService();",
      "await svc.init();",
      "await svc.init();",
      'await svc.getParser("typescript");',
      "await svc.init();",
      "await svc.getParser(\"typescript\");",
      'console.log("HARNESS DONE");',
      "",
    ].join("\n"),
  );

  const degraded = runEntry(join(COPY, "degraded.ts"), [], isoEnv());
  const degradedLines = tawassulLines(degraded.out);
  assert(degraded.out.includes("HARNESS DONE"), "the degraded harness runs to completion");
  assert(
    degradedLines.length === 1,
    `a bundle without tawassul-runtime/wasm yields exactly one tawassul line (got ${degradedLines.length})`,
  );
  assert(degradedLines[0]?.includes("tawassul-runtime/wasm") === true, "the single line names tawassul-runtime/wasm");
  assert(degradedLines[0]?.includes("npm run install:global") === true, "the single line names npm run install:global");
  assert(degradedLines[0]?.includes("astquery/depmap") === true, "the single line says which features are disabled");
  assert(degraded.out.includes("Aborted") === false, "the wasm root pre-check prevents emscripten abort noise");

  writeFileSync(
    join(WORK, "healthy.ts"),
    [
      `const { getAstService } = await import(${JSON.stringify(join(REPO, "src", "services", "ast-service.ts"))});`,
      "const svc = getAstService();",
      "await svc.init();",
      'const parser = await svc.getParser("typescript");',
      'console.log(`READY ${parser !== null}`);',
      "",
    ].join("\n"),
  );
  const healthy = runEntry(join(WORK, "healthy.ts"), [], isoEnv());
  assert(tawassulLines(healthy.out).length === 0, "the installed-lane layout with wasm present emits no warning");
  assert(healthy.out.includes("READY true"), "the AST lane still initializes when tawassul-runtime/wasm is present");

  writeFileSync(
    join(WORK, "selfcheck.ts"),
    [
      `const { passiveSelfCheck } = await import(${JSON.stringify(join(REPO, "src", "bootstrap", "plugin-init.ts"))});`,
      'const { resolve } = await import("node:path");',
      "const dir = process.argv[2]!;",
      'await passiveSelfCheck(dir, resolve(dir, ".opencode/plugins/tawassul"));',
      'console.log("SELFCHECK DONE");',
      "",
    ].join("\n"),
  );

  const freshProject = join(WORK, "project-fresh");
  mkdirSync(freshProject, { recursive: true });
  const fresh = runEntry(join(WORK, "selfcheck.ts"), [freshProject], isoEnv());
  assert(fresh.out.includes("SELFCHECK DONE"), "the self-check harness runs for a fresh project");
  assert(
    tawassulLines(fresh.out).length === 0,
    "a fresh project without a project plugin dir emits no self-check warning",
  );

  const brokenProject = join(WORK, "project-broken");
  mkdirSync(join(brokenProject, ".opencode", "plugins", "tawassul"), { recursive: true });
  const broken = runEntry(join(WORK, "selfcheck.ts"), [brokenProject], isoEnv());
  const brokenLines = tawassulLines(broken.out);
  assert(brokenLines.length === 1, "a present but unbuilt project plugin dir warns exactly once");
  assert(brokenLines[0]?.includes("npm run install:global") === true, "the dev-lane warning names the install command");
  assert(brokenLines[0]?.includes("build-v2.mjs") === false, "no user-facing line points at repo-only build commands");

  const okProject = join(WORK, "project-ok");
  mkdirSync(join(okProject, ".opencode", "plugins", "tawassul", "dist"), { recursive: true });
  mkdirSync(join(okProject, ".opencode", "node_modules"), { recursive: true });
  writeFileSync(join(okProject, ".opencode", "plugins", "tawassul", "dist", "index.js"), "export {};\n");
  const ok = runEntry(join(WORK, "selfcheck.ts"), [okProject], isoEnv());
  assert(tawassulLines(ok.out).length === 0, "a built project plugin dir emits no self-check warning");

  mkdirSync(GLOBAL, { recursive: true });
  writeFileSync(join(GLOBAL, "tawassul-runtime"), "a plain file occupies the runtime path\n");
  const refused = runEntry(join(REPO, "scripts", "install-global.ts"), ["--force"], isoEnv({ TAWASSUL_GLOBAL_DIR: GLOBAL }));
  assert(refused.code !== 0, "install refuses when the runtime path cannot be created");
  assert(refused.out.includes("cannot create the runtime layout"), "the refusal names the runtime creation failure");
  assert(refused.out.includes("refusing to write"), "the refusal states it will not write the bundle");
  assert(refused.out.includes(join(GLOBAL, "tawassul-runtime")), "the refusal names the blocked runtime path");
  assert(!existsSync(join(GLOBAL, "plugins", "tawassul.js")), "no bundle is written when the runtime cannot be created");

  const dry = runEntry(join(REPO, "scripts", "install-global.ts"), ["--dry-run"], isoEnv({ TAWASSUL_GLOBAL_DIR: GLOBAL }));
  assert(dry.code === 0, "a dry run still reports the plan under the blocked runtime path");
  assert(dry.out.includes("dry run"), "the dry run prints its plan lines");

  assert(readFileSync(BUNDLE, "utf-8").includes("tawassul-runtime/wasm is missing"), "the shipped bundle carries the collapsed warning text");

  const srcGrep = spawnSync(
    "/bin/bash",
    ["-c", `grep -rl "build-v2.mjs" ${JSON.stringify(join(REPO, "src"))} 2>/dev/null || true`],
    { encoding: "utf-8" },
  );
  assert((srcGrep.stdout ?? "").trim().length === 0, "no src file references the repo-only build-v2.mjs command");

  const launcherGrep = spawnSync(
    "/bin/bash",
    ["-c", `grep -rl "opencode-v2-iso" ${JSON.stringify(join(REPO, "src"))} 2>/dev/null || true`],
    { encoding: "utf-8" },
  );
  assert(
    (launcherGrep.stdout ?? "").trim().length === 0,
    "no src file references scripts/opencode-v2-iso.sh, so no user-facing warning can point at it (P7.2)",
  );
  assert(
    readFileSync(BUNDLE, "utf-8").includes("opencode-v2-iso") === false,
    "the shipped bundle carries no reference to the launcher script",
  );

  console.log(`PROOF PASS: ${passed} assertions`);
} finally {
  rmSync(WORK, { recursive: true, force: true });
}
