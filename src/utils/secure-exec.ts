import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  defaultSpawnContext,
  findExecutable,
  hasScript,
  resolveSpawnPlan,
  type Runner,
  type SpawnContext,
} from "./package-manager.ts";

const exec = promisify(execFile);

const ALLOWED_BINARIES = new Set(["rg", "git", "npm", "pnpm", "yarn", "npx", "bun"]);

const NPX_ALLOWED_PACKAGES = new Set([
  "vitest", "eslint", "prettier", "typescript", "c8",
]);

const SHELL_META_PATTERN = /[|;&$`(){}<>!\n]/;

export const PKG_SAFE_SCRIPTS = new Set(["lint", "typecheck", "test", "build"]);

const DENIED_SCRIPT_FLAGS = new Set([
  "--require", "-r", "--import", "--loader", "--preload", "--exec",
  "-e", "--eval", "--print", "-p", "--cwd", "--filter", "--env-file",
  "--shell", "--bun", "--node-options", "--script-shell",
  "--experimental-loader", "--inspect", "--inspect-brk", "--inspect-wait",
  "--inspect-port", "--conditions",
]);

function flagName(arg: string): string {
  const index = arg.indexOf("=");
  return index === -1 ? arg : arg.slice(0, index);
}

function validateScriptTail(args: string[]): string | null {
  for (const arg of args) {
    if (!arg.startsWith("-")) return "only flags may follow the script name";
    const name = flagName(arg);
    if (DENIED_SCRIPT_FLAGS.has(name)) {
      return `flag ${name} is not allowed after a package script`;
    }
    if (/^-[rep]/.test(arg) && !arg.startsWith("--")) {
      return `flag ${name} is not allowed after a package script`;
    }
  }
  return null;
}

function validateBun(args: string[]): string | null {
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) return null;
  if (args[0] === "test") return "bun: use run test instead of test";
  if (args[0] !== "run" || args.length < 2) {
    return "bun: only run <lint|typecheck|test|build> and --version are allowed";
  }
  const script = args[1] ?? "";
  if (!PKG_SAFE_SCRIPTS.has(script)) {
    return "bun: only run <lint|typecheck|test|build> is allowed";
  }
  return validateScriptTail(args.slice(2));
}

function validatePkgManager(binary: string, args: string[], bareScript = false): string | null {
  if (args[0] === "test" && !bareScript) return validateScriptTail(args.slice(1));
  if (bareScript && args.length >= 1 && PKG_SAFE_SCRIPTS.has(args[0] ?? "")) {
    return validateScriptTail(args.slice(1));
  }
  if (args[0] === "run" && args.length >= 2 && PKG_SAFE_SCRIPTS.has(args[1] ?? "")) {
    return validateScriptTail(args.slice(2));
  }
  return `${binary}: only run <lint|typecheck|test|build> and test are allowed`;
}

function validateArgs(binary: string, args: string[]): string | null {
  switch (binary) {
    case "rg":
      if (args.some(a => a === "-r" || (/^-r[^-]/).test(a) || a.startsWith("--exec") || a === "-exec" || a.startsWith("--replace") || a.startsWith("--pre"))) {
        return `rg: -r/--exec/--replace/--pre is forbidden`;
      }
      return null;

    case "git":
      if (args[0] !== "diff") {
        return `git: only diff is allowed`;
      }
      {
        const SAFE = new Set(["--stat", "--name-only", "--name-status", "--check", "--shortstat", "--no-color", "-p", "--cached", "--staged"]);
        for (let i = 1; i < args.length; i++) {
          const a = args[i] ?? "";
          if (a === "--") continue;
          if (/^-U\d*$/.test(a) || /^--unified=\d+$/.test(a)) continue;
          if (a.startsWith("-") && !SAFE.has(a)) {
            return `git diff: flag ${a} is forbidden (display flags + paths only)`;
          }
        }
      }
      return null;

    case "npm":
      return validatePkgManager("npm", args);

    case "pnpm":
      return validatePkgManager("pnpm", args, true);

    case "yarn":
      return validatePkgManager("yarn", args, true);

    case "bun":
      return validateBun(args);

    case "npx": {
      if (!args.includes("--no-install")) {
        return "npx: --no-install is required (online install forbidden)";
      }
      const pkg = args.find(a => !a.startsWith("-"));
      if (pkg && !NPX_ALLOWED_PACKAGES.has(pkg)) {
        return `npx: package "${pkg}" is not in the allowed list`;
      }
      return null;
    }

    default:
      return `binary "${binary}" is not in the allowed list`;
  }
}

function packageScriptName(binary: string, args: string[]): string | undefined {
  if (binary === "bun") {
    return args[0] === "run" && args.length >= 2 ? args[1] : undefined;
  }
  if (binary === "npm") {
    if (args[0] === "test") return "test";
    return args[0] === "run" && args.length >= 2 ? args[1] : undefined;
  }
  if (binary === "pnpm" || binary === "yarn") {
    if (args[0] === "run" && args.length >= 2) return args[1];
    return args.length >= 1 && PKG_SAFE_SCRIPTS.has(args[0] ?? "") ? args[0] : undefined;
  }
  return undefined;
}

export type VersionSpawner = (exe: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>;

const defaultVersionSpawner: VersionSpawner = async (exe, args, env) => {
  const result = await exec(exe, args, { timeout: 5000, windowsHide: true, env });
  return result.stdout;
};

export async function probeBunVersion(
  exe: string,
  spawner: VersionSpawner = defaultVersionSpawner,
): Promise<boolean> {
  try {
    const stdout = await spawner(exe, ["--version"], { ...process.env, BUN_BE_BUN: "1" });
    return /^\d+\.\d+\.\d+/.test(stdout.trim());
  } catch {
    return false;
  }
}

let hostBunProbe: Promise<string | null> | undefined;

export function probeHostBun(): Promise<string | null> {
  if (!hostBunProbe) {
    hostBunProbe = (async () => {
      const exe = process.execPath;
      return (await probeBunVersion(exe)) ? exe : null;
    })();
  }
  return hostBunProbe;
}

function childEnvironment(hostBun: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (hostBun) {
    env.BUN_BE_BUN = "1";
  } else {
    delete env.BUN_BE_BUN;
  }
  return env;
}

export function runnerEnvironment(runner: Runner): NodeJS.ProcessEnv {
  return childEnvironment(runner.kind === "host-bun");
}

interface ResolvedBinary {
  exe: string;
  env: NodeJS.ProcessEnv;
}

function binaryNotFound(message: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = "ENOENT";
  return error;
}

async function resolveBinary(binary: string, context: SpawnContext): Promise<ResolvedBinary> {
  if (binary === "bun") {
    const pathExe = findExecutable("bun", context);
    if (pathExe) return { exe: pathExe, env: childEnvironment(false) };
    const hostExe = await probeHostBun();
    if (hostExe) return { exe: hostExe, env: childEnvironment(true) };
    throw binaryNotFound("bun is not available on PATH and the host binary is not a Bun runtime");
  }
  const exe = findExecutable(binary, context);
  if (!exe) throw binaryNotFound(`${binary} is not available on PATH`);
  return { exe, env: childEnvironment(false) };
}

interface ExecOptions {
  timeout?: number;
  maxBuffer?: number;
  cwd?: string;
  projectRoot?: string;
}

export function assertShellSafe(args: string[]): void {
  for (const arg of args) {
    if (SHELL_META_PATTERN.test(arg)) {
      throw new Error(`Shell metacharacters are not allowed in arguments: ${arg}`);
    }
  }
}

async function executeResolved(
  exe: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  options: ExecOptions,
): Promise<{ stdout: string; stderr: string }> {
  const plan = resolveSpawnPlan(exe, args, defaultSpawnContext(options.projectRoot ?? options.cwd));
  if (plan.shell) assertShellSafe(args);
  const result = await exec(plan.command, plan.args, {
    timeout: options.timeout ?? 30000,
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
    cwd: options.cwd,
    env,
    windowsVerbatimArguments: plan.windowsVerbatimArguments,
    windowsHide: plan.windowsHide,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function runPackageScript(
  runner: Runner,
  script: string,
  options: { cwd: string; timeout?: number; maxBuffer?: number; projectRoot?: string },
): Promise<{ stdout: string; stderr: string }> {
  if (!PKG_SAFE_SCRIPTS.has(script)) {
    throw new Error(`script "${script}" is not allowed`);
  }
  if (!hasScript(options.cwd, script)) {
    throw new Error(`script "${script}" is not defined in package.json`);
  }
  const env = runnerEnvironment(runner);
  return executeResolved(runner.exe, ["run", script], env, options);
}

export async function secureExec(
  binary: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  if (!ALLOWED_BINARIES.has(binary)) {
    throw new Error(`Binary "${binary}" is not allowed`);
  }

  const denied = validateArgs(binary, args);
  if (denied) {
    throw new Error(denied);
  }

  const script = packageScriptName(binary, args);
  if (script !== undefined) {
    if (!options.cwd) {
      throw new Error(`a cwd is required to run package script "${script}"`);
    }
    if (!hasScript(options.cwd, script)) {
      throw new Error(`script "${script}" is not defined in package.json`);
    }
  }

  const { exe, env } = await resolveBinary(binary, defaultSpawnContext(options.cwd));
  return executeResolved(exe, args, env, options);
}
