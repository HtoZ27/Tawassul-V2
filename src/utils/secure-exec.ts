import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const ALLOWED_BINARIES = new Set(["rg", "git", "npm", "pnpm", "yarn", "npx"]);

const NPX_ALLOWED_PACKAGES = new Set([
  "vitest", "eslint", "prettier", "typescript", "c8",
]);

const SHELL_META_PATTERN = /[|;&$`(){}<>!\n]/;

const PKG_SAFE_SCRIPTS = new Set(["lint", "typecheck", "test", "build"]);

function validatePkgManager(binary: string, args: string[], bareScript = false): string | null {
  if (args[0] === "test") return null;
  if (bareScript && args.length >= 1 && PKG_SAFE_SCRIPTS.has(args[0] ?? "")) {
    if (args.slice(1).every((a) => a.startsWith("-"))) return null;
    return `${binary}: only flags may follow <script>`;
  }
  if (args[0] === "run" && args.length >= 2 && PKG_SAFE_SCRIPTS.has(args[1] ?? "")) {
    if (args.slice(2).every((a) => a.startsWith("-"))) return null;
    return `${binary}: only flags may follow run <script>`;
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

export async function secureExec(
  binary: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  if (!ALLOWED_BINARIES.has(binary)) {
    throw new Error(`Binary "${binary}" is not allowed`);
  }

  for (const arg of args) {
    if (SHELL_META_PATTERN.test(arg)) {
      throw new Error(`Shell metacharacters are not allowed in arguments: ${arg}`);
    }
  }

  const denied = validateArgs(binary, args);
  if (denied) {
    throw new Error(denied);
  }

  const result = await exec(binary, args, {
    timeout: options.timeout ?? 30000,
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
    cwd: options.cwd,
  });

  return { stdout: result.stdout, stderr: result.stderr };
}
