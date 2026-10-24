import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
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
const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf-8")) as {
  scripts?: Record<string, string>;
};
const scripts = pkg.scripts ?? {};
const proofFiles = readdirSync(join(repo, "scripts"))
  .filter((f) => f.startsWith("prove-") && f.endsWith(".ts"))
  .sort();
const proveScripts = Object.entries(scripts).filter(([name]) => name.startsWith("prove:"));
const ci = scripts["ci"] ?? "";
const ciParts = ci.split("&&").map((p) => p.trim()).filter(Boolean);
const ciProves = ciParts.filter((p) => p.startsWith("npm run prove:")).map((p) => p.slice("npm run ".length));

assert(proofFiles.length >= 25, `proof catalog has at least 25 files (found ${proofFiles.length})`);

const referenced = new Map<string, string[]>();
for (const [name, cmd] of proveScripts) {
  const match = /scripts\/(prove-[^ ]+\.ts)/.exec(cmd);
  assert(match !== null, `${name} names a proof file`);
  if (!match) continue;
  const file = match[1] ?? "";
  assert(file.length > 0, `${name} names a proof file`);
  assert(existsSync(join(repo, "scripts", file)), `${name} proof file exists`);
  const list = referenced.get(file) ?? [];
  list.push(name);
  referenced.set(file, list);
}

for (const file of proofFiles) {
  const names = referenced.get(file) ?? [];
  assert(names.length === 1, `${file} is referenced by exactly one prove: script (found ${names.length})`);
  const name = names[0];
  if (name) assert(ciProves.includes(name), `${name} is wired into ci`);
}

for (const part of ciParts) {
  if (!part.startsWith("npm run ")) continue;
  const target = part.slice("npm run ".length).split(" ")[0] ?? "";
  assert(target.length > 0 && typeof scripts[target] === "string", `ci target ${target} exists`);
}

assert(ciProves.length >= 25, `ci runs at least 25 proofs (found ${ciProves.length})`);
assert(ciParts.includes("npm run smoke:release"), "ci runs the release smoke gate");
assert(ciParts.includes("npm run verify"), "ci starts from verify");

console.log(`PROOF PASS: ${proofFiles.length} proofs wired into one ci gate`);
