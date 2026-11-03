import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const roots = [
  { dir: repo, only: new Set(["install.sh"]) },
  { dir: join(repo, "scripts"), only: null },
  { dir: join(repo, "scripts", "release"), only: null },
];
const files = [];
for (const root of roots) {
  if (!existsSync(root.dir)) continue;
  for (const name of readdirSync(root.dir)) {
    if (!name.endsWith(".sh")) continue;
    if (root.only !== null && !root.only.has(name)) continue;
    files.push(join(root.dir, name));
  }
}
files.sort();

function usable(program) {
  if (program.includes("/") || program.includes("\\")) return existsSync(program);
  const probe = spawnSync(program, ["-c", "exit 0"], { stdio: "ignore", timeout: 20000 });
  return probe.status === 0;
}

function shellFromGit() {
  const probe = spawnSync("git", ["--exec-path"], { encoding: "utf8", timeout: 20000 });
  if (probe.status !== 0) return null;
  const execPath = (probe.stdout ?? "").trim();
  if (!execPath) return null;
  const root = dirname(dirname(dirname(execPath)));
  const candidate = join(root, "usr", "bin", "sh.exe");
  return existsSync(candidate) ? candidate : null;
}

const requested = (process.env.TAWASSUL_SHELL ?? "").trim();
const candidates = [];
if (requested) candidates.push(requested);
candidates.push("bash", "sh", "dash");
const derived = shellFromGit();
if (derived) candidates.push(derived);

const shell = candidates.find(usable);

if (!shell) {
  console.error(
    "check-shell-syntax: no POSIX shell found (tried bash, sh, dash, and Git's usr/bin/sh.exe); install bash or set TAWASSUL_SHELL",
  );
  process.exit(1);
}

let failures = 0;

for (const file of files) {
  const name = file.slice(repo.length + 1);
  const result = spawnSync(shell, ["-n", file], { encoding: "utf8", timeout: 120000 });
  if (result.error) {
    failures += 1;
    console.error(`check-shell-syntax: FAIL ${name}: ${result.error.message}`);
    continue;
  }
  if (result.status !== 0) {
    failures += 1;
    const detail = (result.stderr ?? "").trim();
    console.error(`check-shell-syntax: FAIL ${name}${detail === "" ? "" : `: ${detail}`}`);
  }
}

if (failures > 0) {
  console.error(`check-shell-syntax: ${failures} of ${files.length} file(s) failed via ${shell}`);
  process.exit(1);
}

console.log(`check-shell-syntax: ${files.length} file(s) ok via ${shell}`);
