import { TAWASSUL_TOOL_NAMES } from "../../../tool-names.ts";
import { TAWASSUL_TOOL_ROLES } from "../../../role-matrix.ts";
import { normalizeToolName } from "../../../utils/name-utils.ts";


export const ALL_TAWASSUL_TOOLS = new Set(TAWASSUL_TOOL_NAMES);



export const PAUSE_BYPASS_TOOLS = new Set(["resume", "status"]);

export let MAX_CALL_DEPTH = 3;
export let MAX_TOTAL_TASKS = 25;
export const setMaxCallDepth = (n: number) => {
  if (n > 0) MAX_CALL_DEPTH = n;
};
export const setMaxTotalTasks = (n: number) => {
  if (n > 0) MAX_TOTAL_TASKS = n;
};

export function isTawassulTool(name: string): boolean {
  return ALL_TAWASSUL_TOOLS.has(normalizeToolName(name));
}

export const TAWASSUL_ROLES = Object.keys(TAWASSUL_TOOL_ROLES);


export const SHELL_TOOL_NAMES = new Set<string>(["bash", "shell"]);

export const CONSENT_TOOLS = new Set<string>(["bash", "shell", "delete", "kick"]);

export function isShellTool(name: string): boolean {
  return SHELL_TOOL_NAMES.has(normalizeToolName(name));
}

const PROTECTED_ROOTS = new Set([
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/home",
  "/lib",
  "/lib64",
  "/opt",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/srv",
  "/sys",
  "/usr",
  "/var",
]);

const SHELL_BINARIES = new Set(["bash", "sh", "zsh", "dash", "ksh", "fish"]);
const WRAPPERS = new Set(["sudo", "doas", "env", "nohup", "time", "command", "exec", "busybox", "xargs"]);
const MAX_COMMAND_DEPTH = 3;
const TOKEN_PATTERN = /([^\s"']+)|"((?:[^"\\]|\\.)*)"|'([^']*)'/g;

function tokenize(segment: string): string[] {
  const out: string[] = [];
  TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(segment)) !== null) {
    out.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return out;
}

function unwrap(tokens: string[]): { list: string[]; privileged: boolean } {
  const list = [...tokens];
  let privileged = false;
  let changed = true;
  while (changed && list.length > 0) {
    changed = false;
    const head = list[0]!.toLowerCase();
    if (head === "sudo" || head === "doas") privileged = true;
    if (head === "timeout") {
      list.shift();
      changed = true;
      while (list[0]?.startsWith("-")) list.shift();
      if (list[0] && /^\d+(?:\.\d+)?[smhd]?$/u.test(list[0]!)) list.shift();
      continue;
    }
    if (WRAPPERS.has(head)) {
      list.shift();
      changed = true;
      while (list[0]?.startsWith("-")) list.shift();
      continue;
    }
    while (list.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(list[0]!)) {
      list.shift();
      changed = true;
    }
  }
  return { list, privileged };
}

function baseName(token: string): string {
  const bare = token.replace(/^\\+/u, "");
  const parts = bare.split("/");
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

function normalizeAbsolute(value: string): string {
  if (!value.startsWith("/")) return value;
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0) parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function isProtectedTarget(raw: string): boolean {
  let value = raw.trim();
  if (!value) return false;
  if (/^~(\/|$)/u.test(value)) return true;
  if (/^\$\{?HOME\}?(\/|$)/u.test(value)) return true;
  value = value.replace(/\/\*+$/u, "/").replace(/\/+$/u, "");
  value = normalizeAbsolute(value);
  if (value === "" || value === "/") return true;
  for (const root of PROTECTED_ROOTS) {
    if (root === "/") continue;
    if (root === "/home") {
      if (value === "/home" || /^\/home\/[^/]+$/u.test(value)) return true;
      continue;
    }
    if (value === root || value.startsWith(`${root}/`)) return true;
  }
  return false;
}

function hasShortFlag(flags: string[], letters: string): boolean {
  const wanted = letters.toLowerCase();
  return flags.some(
    (flag) =>
      /^-[A-Za-z]+$/u.test(flag) &&
      [...wanted].some((letter) => flag.toLowerCase().includes(letter)),
  );
}

function hasLongFlag(flags: string[], name: string): boolean {
  const wanted = `--${name.toLowerCase()}`;
  return flags.some((flag) => {
    const lower = flag.toLowerCase();
    return lower === wanted || lower.startsWith(`${wanted}=`);
  });
}

function splitSegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|&\n]/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function analyzeSegment(segment: string, depth: number): boolean {
  const { list, privileged } = unwrap(tokenize(segment));
  if (list.length === 0) return false;
  if (privileged) return true;
  const base = baseName(list[0]!);
  const rest = list.slice(1);
  const flags = rest.filter((token) => token.startsWith("-"));
  const args = rest.filter((token) => !token.startsWith("-"));

  if (base === "rm") {
    const recursive = hasShortFlag(flags, "rR") || hasLongFlag(flags, "recursive");
    const force = hasShortFlag(flags, "f") || hasLongFlag(flags, "force");
    return recursive && force && args.some(isProtectedTarget);
  }
  if (base === "shred") return args.length > 0;
  if (base === "truncate") return args.length > 0;
  if (base === "wipefs" || base === "fdisk" || base === "parted" || base.startsWith("mkfs")) return true;
  if (base === "dd") return rest.some((token) => token.startsWith("if="));
  if (base === "chmod" || base === "chown" || base === "chgrp") {
    return hasShortFlag(flags, "R") || hasLongFlag(flags, "recursive") ? args.some(isProtectedTarget) : false;
  }
  if (base === "mv" || base === "rmdir") return args.some(isProtectedTarget);
  if (base === "find") {
    const destructive = rest.includes("-delete") || rest.some((token) => token === "-exec" || token === "-execdir");
    return destructive && args.some(isProtectedTarget);
  }
  if (base === "git" && args[0] === "clean") {
    return hasShortFlag(flags, "f") && args.slice(1).some(isProtectedTarget);
  }
  if (SHELL_BINARIES.has(base)) {
    const index = rest.findIndex(
      (token) => token === "--command" || /^-[A-Za-z]*c[A-Za-z]*$/u.test(token),
    );
    const nested = index >= 0 ? rest[index + 1] : undefined;
    if (nested && depth < MAX_COMMAND_DEPTH) return analyzeCommand(nested, depth + 1);
    return false;
  }
  return false;
}

function analyzeCommand(command: string, depth: number): boolean {
  if (!command || depth > MAX_COMMAND_DEPTH) return false;
  if (/:\(\)\s*\{/u.test(command)) return true;
  const segments = splitSegments(command);
  const heads = segments.map((segment) => baseName(unwrap(tokenize(segment)).list[0] ?? ""));
  for (let index = 0; index < heads.length - 1; index += 1) {
    const head = heads[index];
    if (head !== "curl" && head !== "wget" && head !== "fetch") continue;
    if (SHELL_BINARIES.has(heads[index + 1]!)) return true;
  }
  return segments.some((segment) => analyzeSegment(segment, depth));
}

export function isDangerousCommand(command: string): boolean {
  return analyzeCommand(command, 0);
}

export function requiresConsent(inputTool: string, args: Record<string, unknown>): boolean {
  const tool = normalizeToolName(inputTool);
  if (!CONSENT_TOOLS.has(tool)) return false;
  if (tool === "delete" || tool === "kick") return true;
  if (isShellTool(tool)) {
    const command = typeof args?.command === "string" ? args.command : "";
    return isDangerousCommand(command);
  }
  return false;
}
