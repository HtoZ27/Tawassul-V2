import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyDbLane,
  isDesktopSidecarDbPath,
  isSharedDbPath,
  isolatedDbPathFor,
} from "../src/bootstrap/db-isolation.ts";
import { buildHealthTool } from "../src/tools/tawa/health.ts";

let passed = 0;

function check(condition: unknown, name: string): void {
  if (!condition) {
    console.error(`PROOF FAIL: ${name}`);
    process.exitCode = 1;
    throw new Error(name);
  }
  passed += 1;
  console.log(`ok ${name}`);
}

const home = homedir();
const sidecarDir = join(home, ".local", "share", "opencode", "tawassul-v2");
const sidecar = join(sidecarDir, "opencode.db");
const sidecarSibling = join(home, ".local", "share", "opencode", "tawassul-v2-backup", "opencode.db");
const shared = join(home, ".local", "share", "opencode", "opencode.db");
const sharedDesktop = join(home, ".local", "share", "opencode", "opencode-desktop.db");
const isolated = join(home, ".local", "share", "opencode-projects", "0123456789abcdef", "opencode.db");
const isolatedSibling = join(home, ".local", "share", "opencode-projects-old", "0123456789abcdef", "opencode.db");
const custom = join(tmpdir(), "tawassul-e46-custom", "opencode.db");

check(classifyDbLane(undefined) === "unset", "an unset OPENCODE_DB is the unset lane");
check(classifyDbLane("") === "unset", "an empty OPENCODE_DB is the unset lane");
check(classifyDbLane("   ") === "unset", "a blank OPENCODE_DB is the unset lane");
check(classifyDbLane(sidecar) === "desktop-sidecar", "the desktop sidecar DB is its own lane");
check(classifyDbLane(`  ${sidecar}  `) === "desktop-sidecar", "the sidecar lane tolerates surrounding whitespace");
check(classifyDbLane(shared) === "shared", "the shared opencode.db stays the shared lane");
check(classifyDbLane(sharedDesktop) === "shared", "the shared desktop DB stays the shared lane");
check(classifyDbLane(isolated) === "isolated", "a keyed opencode-projects DB is the isolated lane");
check(classifyDbLane(custom) === "custom", "an arbitrary DB path is the custom lane");

check(isSharedDbPath(shared), "the shared DB classifier still matches the shared DB");
check(isSharedDbPath(sidecar) === false, "the sidecar DB is not the shared DB");
check(isDesktopSidecarDbPath(sidecar), "the sidecar classifier matches the sidecar DB");
check(isDesktopSidecarDbPath(sidecarDir), "the sidecar classifier matches its base directory");
check(isDesktopSidecarDbPath(sidecarSibling) === false, "a sibling prefix is not the sidecar lane");
check(classifyDbLane(sidecarSibling) === "custom", "a sidecar sibling prefix falls back to custom");
check(classifyDbLane(isolatedSibling) === "custom", "an isolated sibling prefix falls back to custom");

const keyDir = mkdtempSync(join(tmpdir(), "tawassul-e46-"));
const keyFile = join(keyDir, ".tawassul-hmac-key");
writeFileSync(keyFile, Buffer.alloc(32, 7));
const previousKeyDir = process.env.TAWASSUL_HMAC_KEY_DIR;
const previousDb = process.env.OPENCODE_DB;
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;

const stateDir = join(homedir(), "Desktop", "Tawassul V2");
const ctx = {
  stateDir,
  scope: "project",
  timerManager: { activeCount: 3 },
  statePath: () => join(stateDir, ".opencode", "tawassul-state.json"),
} as never;
const health = buildHealthTool(ctx, {
  measureLag: async () => 4,
  rssMb: () => 120,
  pendingFlushes: () => 0,
});

async function healthWith(dbPath: string | undefined): Promise<string> {
  if (dbPath === undefined) delete process.env.OPENCODE_DB;
  else process.env.OPENCODE_DB = dbPath;
  const result = (await health.execute({}, {} as never)) as { output: string };
  return result.output;
}

const sidecarOutput = await healthWith(sidecar);
check(sidecarOutput.includes("- DB: isolated"), "health reports the sidecar DB as isolated");
check(sidecarOutput.includes("- DB lane: desktop-sidecar"), "health names the desktop sidecar lane");
check(sidecarOutput.includes("- DB matches isolation: yes"), "health treats the sidecar as matching isolation");

const sharedOutput = await healthWith(shared);
check(sharedOutput.includes("- DB: shared"), "health reports the shared DB as shared");
check(sharedOutput.includes("- DB lane: shared"), "health names the shared lane");
check(sharedOutput.includes("- DB matches isolation: no"), "health flags the shared DB against the keyed path");

const expectedDb = isolatedDbPathFor(stateDir, keyFile);
check(expectedDb !== null, "the temp HMAC key yields a keyed DB path");
const isolatedOutput = await healthWith(expectedDb ?? undefined);
check(isolatedOutput.includes("- DB lane: isolated"), "health names the keyed isolated lane");
check(isolatedOutput.includes("- DB matches isolation: yes"), "health matches the HMAC-keyed DB path");

const customOutput = await healthWith(custom);
check(customOutput.includes("- DB lane: custom"), "health names the custom lane");
check(customOutput.includes("- DB: isolated"), "a custom DB path still counts as isolated from the shared DB");
check(customOutput.includes("- DB matches isolation: no"), "a custom DB path does not match the keyed path");

const unsetOutput = await healthWith(undefined);
check(unsetOutput.includes("- DB: shared"), "an unset DB falls back to the shared label");
check(unsetOutput.includes("- DB lane: unset"), "health names the unset lane");
check(unsetOutput.includes("- DB matches isolation: unknown"), "an unset DB leaves the match unknown");

if (previousDb === undefined) delete process.env.OPENCODE_DB;
else process.env.OPENCODE_DB = previousDb;
if (previousKeyDir === undefined) delete process.env.TAWASSUL_HMAC_KEY_DIR;
else process.env.TAWASSUL_HMAC_KEY_DIR = previousKeyDir;
rmSync(keyDir, { recursive: true, force: true });

assert.equal(passed, 31);
console.log(`PROOF PASS: the DB lane is classified truthfully (${passed} assertions)`);
