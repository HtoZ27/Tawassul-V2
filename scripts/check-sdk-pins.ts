import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

let passed = 0;

function fail(msg: string): never {
  console.error(`CHECK FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function versionOf(value: unknown): string {
  const match = String(value ?? "").match(/\d+\.\d+\.\d+/);
  if (!match) fail(`cannot read a semantic version from ${JSON.stringify(value)}`);
  return match[0];
}

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type Lock = {
  packages?: Record<string, { version?: string }>;
};

type Registry = {
  auditedThrough?: string;
  releases?: Array<{ version?: string; hostContract?: string }>;
};

const rootManifest = readJson<Manifest>(join(REPO, "package.json"));
const opencodeManifest = readJson<Manifest>(join(REPO, ".opencode", "package.json"));
const rootLock = readJson<Lock>(join(REPO, "package-lock.json"));
const opencodeLock = readJson<Lock>(join(REPO, ".opencode", "package-lock.json"));
const registry = readJson<Registry>(join(REPO, "src", "upstream", "registry.json"));
const installer = readFileSync(join(REPO, "scripts", "install-global.ts"), "utf-8");
const smoke = readFileSync(join(REPO, "scripts", "release-smoke.sh"), "utf-8");
const doctor = readFileSync(join(REPO, "scripts", "doctor-v2.sh"), "utf-8");

const rootDeclared = versionOf(rootManifest.devDependencies?.["@opencode/plugin"]);
const opencodeDeclared = versionOf(opencodeManifest.dependencies?.["@opencode/plugin"]);
const lockKey = "node_modules/@opencode/plugin";
const rootLocked = versionOf(rootLock.packages?.[lockKey]?.version);
const opencodeLocked = versionOf(opencodeLock.packages?.[lockKey]?.version);

assert(rootDeclared === opencodeDeclared, `root and .opencode declare the same SDK minimum (${rootDeclared})`);
assert(rootLocked === rootDeclared, `the root lockfile pins the declared SDK (${rootLocked})`);
assert(opencodeLocked === opencodeDeclared, `the .opencode lockfile pins the declared SDK (${opencodeLocked})`);

for (const [label, path] of [
  ["root", join(REPO, "node_modules", "@opencode", "plugin", "package.json")],
  ["opencode", join(REPO, ".opencode", "node_modules", "@opencode", "plugin", "package.json")],
] as const) {
  if (!existsSync(path)) {
    console.log(`skip the ${label} installed SDK is absent in this checkout`);
    continue;
  }
  const installed = versionOf(readJson<{ version?: string }>(path).version);
  assert(installed === rootDeclared, `the ${label} installed SDK matches the pin (${installed})`);
}

const declaredRange = String(rootManifest.devDependencies?.["@opencode/plugin"] ?? "");
assert(
  !declaredRange.startsWith("^") || declaredRange.slice(1) === rootDeclared,
  "the root range is a caret on the pinned version",
);

const audited = versionOf(registry.auditedThrough);
const newest = (registry.releases ?? [])[0];
assert(audited === rootDeclared, `the registry auditedThrough matches the SDK pin (${audited})`);
assert(newest?.version === audited, `the newest registry release matches auditedThrough (${newest?.version ?? "missing"})`);
assert(
  newest?.hostContract === audited,
  `the newest hostContract matches the SDK pin (${newest?.hostContract ?? "missing"})`,
);

const installerMin = versionOf(installer.match(/const HOST_MIN = "([^"]+)"/)?.[1]);
const installerAudited = versionOf(installer.match(/const HOST_AUDITED = "([^"]+)"/)?.[1]);
const smokeMin = versionOf(smoke.match(/MIN_VERSION="([^"]+)"/)?.[1]);
const smokeAudited = versionOf(smoke.match(/AUDITED_VERSION="([^"]+)"/)?.[1]);
assert(installerMin === audited, `the installer host minimum matches the SDK pin (${installerMin})`);
assert(installerAudited === audited, `the installer audited host matches the SDK pin (${installerAudited})`);
assert(smokeMin === audited, `the smoke host minimum matches the SDK pin (${smokeMin})`);
assert(smokeAudited === audited, `the smoke audited host matches the SDK pin (${smokeAudited})`);
assert(
  doctor.includes(`v>=${audited} <3.0.0`),
  `the doctor names the same supported host range (v>=${audited} <3.0.0)`,
);

console.log(`CHECK PASS: the SDK pin agrees across manifests, lockfiles, installed packages, and the host range (${passed} assertions)`);
