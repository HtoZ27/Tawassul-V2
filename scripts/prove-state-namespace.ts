import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { claimCoexistence, isCoexistenceOwner, releaseCoexistence } from "../src/core/install-scope.ts";
import { hmacReadFile } from "../src/services/persist-utils.ts";
import {
  HMAC_PREFIX,
  hmacSign,
  isHmacSigned,
  resetHmacKeyCache,
  unwrapWithHmac,
  wrapWithHmac,
} from "../src/utils/crypto.ts";
import { legacyStateDir, legacyStatePath, STATE_DIR_NAME, stateDir, statePath, stateReadPath, v2NamespaceRoot } from "../src/utils/state-paths.ts";
import { n2AutoLogPath } from "../src/hooks/n2-auto.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

const root = mkdtempSync(join(tmpdir(), "tawassul-v2-namespace-"));
const homeDir = join(root, "home");
const configHome = join(root, "config");
const profileHome = join(configHome, STATE_DIR_NAME);
const overrideDir = join(root, "override-state");
const keyDir = join(root, "keys");
const V1_SEAT = Symbol.for("tawassul.plugin.warmedup");
const V2_SEAT = Symbol.for("tawassul.v2.setup");
const legacyHome = join(homeDir, ".config", "tawassyl", "state");

try {
  delete process.env.TAWASSUL_V2_STATE_DIR;
  delete process.env.TAWASSUL_GLOBAL_DIR;
  delete process.env.TAWASSUL_ISOLATED;
  process.env.TAWASSUL_V2_LEGACY_STATE_DIR = legacyHome;
  process.env.XDG_CONFIG_HOME = configHome;
  mkdirSync(configHome, { recursive: true });
  mkdirSync(homeDir, { recursive: true });

  assert(stateDir() === resolve(configHome, "tawassul-v2", "state"), "default state dir is XDG tawassul-v2/state");
  assert(legacyStateDir() === resolve(legacyHome), "legacy state dir stays the v1 home path");
  assert(stateReadPath("absent.json") === statePath("absent.json"), "absent file resolves to the namespaced path");

  process.env.XDG_CONFIG_HOME = profileHome;
  assert(stateDir() === resolve(profileHome, "state"), "v2 profile home does not double-nest the state dir");
  process.env.XDG_CONFIG_HOME = configHome;

  assert(v2NamespaceRoot(join(root, "cache")) === join(root, "cache", STATE_DIR_NAME), "namespace root appends once");
  assert(v2NamespaceRoot(profileHome) === profileHome, "namespace root keeps an existing v2 profile");
  const dataHome = join(root, "data");
  process.env.XDG_DATA_HOME = join(dataHome, STATE_DIR_NAME);
  assert(n2AutoLogPath() === join(dataHome, STATE_DIR_NAME, "n2-auto.jsonl"), "N2 log does not double-nest under the profile");
  process.env.XDG_DATA_HOME = dataHome;
  assert(n2AutoLogPath() === join(dataHome, STATE_DIR_NAME, "n2-auto.jsonl"), "N2 log namespaces a plain data home");
  process.env.TAWASSUL_N2_LOG = join(root, "custom-n2.jsonl");
  assert(n2AutoLogPath() === join(root, "custom-n2.jsonl"), "N2 log override wins");
  delete process.env.TAWASSUL_N2_LOG;
  delete process.env.XDG_DATA_HOME;

  mkdirSync(legacyStateDir(), { recursive: true });
  writeFileSync(legacyStatePath("seed.json"), "legacy-seed", "utf-8");
  assert(stateReadPath("seed.json") === legacyStatePath("seed.json"), "legacy file is read when the namespaced file is absent");

  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(statePath("seed.json"), "new-seed", "utf-8");
  assert(stateReadPath("seed.json") === statePath("seed.json"), "namespaced file wins once it exists");
  assert(readFileSync(legacyStatePath("seed.json"), "utf-8") === "legacy-seed", "legacy file is never rewritten");

  process.env.TAWASSUL_V2_STATE_DIR = overrideDir;
  assert(stateDir() === resolve(overrideDir), "TAWASSUL_V2_STATE_DIR overrides the state dir");
  assert(statePath("x.json") === resolve(overrideDir, "x.json"), "override applies to every state file");
  delete process.env.TAWASSUL_V2_STATE_DIR;

  mkdirSync(keyDir, { recursive: true });
  const keyBytes = randomBytes(32);
  writeFileSync(join(keyDir, ".tawassul-hmac-key"), keyBytes, { mode: 0o600 });
  process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
  resetHmacKeyCache();

  const payload = JSON.stringify({ ok: true, marker: "namespace-proof" });
  const signature = hmacSign(payload);
  assert(/^[0-9a-f]{64}$/.test(signature), "hmacSign returns a 32-byte hex signature");
  const wrapped = wrapWithHmac(payload);
  assert(wrapped.startsWith(HMAC_PREFIX), "new writes use the v2 HMAC prefix");
  assert(HMAC_PREFIX === "TAWASSUL_V2_HMAC_V1:", "v2 HMAC prefix is TAWASSUL_V2_HMAC_V1");
  assert(unwrapWithHmac(wrapped) === payload, "v2-signed payload verifies");

  const signingFor = (prefix: string): string => {
    const legacySig = createHmac("sha256", keyBytes).update(payload, "utf-8").digest("hex");
    return `${prefix}${legacySig}:${payload}`;
  };
  const legacyWrapped = signingFor("TAWASSUL_HMAC_V1:");
  assert(isHmacSigned(legacyWrapped), "legacy prefix is recognized as signed");
  assert(unwrapWithHmac(legacyWrapped) === payload, "legacy TAWASSUL_HMAC_V1 payload still verifies");
  assert(unwrapWithHmac(signingFor("TAWASSULL_HMAC_V1:")) === payload, "oldest TAWASSULL_HMAC_V1 payload still verifies");

  const legacyFile = legacyStatePath("trust-scores.json");
  mkdirSync(legacyStateDir(), { recursive: true });
  writeFileSync(legacyFile, legacyWrapped, "utf-8");
  const legacyBefore = readFileSync(legacyFile, "utf-8");
  const read = await hmacReadFile<{ ok: boolean; marker: string }>(statePath("trust-scores.json"));
  assert(read?.ok === true && read?.marker === "namespace-proof", "hmacReadFile falls back to the legacy file");
  assert(!existsSync(statePath("trust-scores.json")), "legacy read does not materialize a namespaced file");
  assert(readFileSync(legacyFile, "utf-8") === legacyBefore, "legacy read does not modify the legacy file");

  writeFileSync(statePath("trust-scores.json"), wrapped, "utf-8");
  const namespaced = await hmacReadFile<{ marker: string }>(statePath("trust-scores.json"));
  assert(namespaced?.marker === "namespace-proof", "namespaced file is preferred after the first write");
  assert(readFileSync(legacyFile, "utf-8") === legacyBefore, "legacy file survives the namespaced write");

  delete (globalThis as Record<symbol, unknown>)[V2_SEAT];
  assert(!Object.prototype.hasOwnProperty.call(globalThis, V2_SEAT), "v2 seat registry starts empty");
  assert(claimCoexistence("project", "/ws/a/first", "/ws/a").shouldRegister === true, "first copy registers its workspace");
  assert(claimCoexistence("project", "/ws/a/second", "/ws/a").shouldRegister === false, "second copy yields in the same workspace");
  assert(isCoexistenceOwner("project", "/ws/a/first", "/ws/a") === true, "first copy stays the workspace owner");
  assert(isCoexistenceOwner("project", "/ws/a/second", "/ws/a") === false, "second copy never becomes owner");
  assert(claimCoexistence("project", "/ws/b/only", "/ws/b").shouldRegister === true, "a different workspace registers independently");
  releaseCoexistence("project", "/ws/a/first", "/ws/a");
  assert(isCoexistenceOwner("project", "/ws/a/first", "/ws/a") === false, "release drops the workspace seat");
  assert(claimCoexistence("project", "/ws/a/third", "/ws/a").shouldRegister === true, "released workspace accepts a new owner");

  const v1Registry = new Map<string, unknown>([["/ws/c", { scope: "global", pid: process.pid, token: "/v1/global", refs: 1 }]]);
  (globalThis as Record<symbol, unknown>)[V1_SEAT] = v1Registry;
  assert(claimCoexistence("project", "/ws/c/v2", "/ws/c").shouldRegister === true, "v2 ignores the v1 seat registry");
  assert(v1Registry.size === 1, "v1 seat registry is untouched by v2 claims");
  assert((globalThis as Record<symbol, unknown>)[V2_SEAT] instanceof Map, "v2 keeps its own seat registry");

  delete (globalThis as Record<symbol, unknown>)[V1_SEAT];
  delete (globalThis as Record<symbol, unknown>)[V2_SEAT];
  delete process.env.TAWASSUL_HMAC_KEY_DIR;
  delete process.env.TAWASSUL_V2_LEGACY_STATE_DIR;
  delete process.env.TAWASSUL_N2_LOG;
  delete process.env.XDG_DATA_HOME;
  delete process.env.XDG_CONFIG_HOME;

  console.log("PROOF PASS: v2 state namespace isolated from v1");
} finally {
  delete process.env.TAWASSUL_V2_LEGACY_STATE_DIR;
  rmSync(root, { recursive: true, force: true });
}
