import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  classifyDbLane,
  isDesktopSidecarDbPath,
  isSharedDbPath,
  isolatedDbPathFor,
} from "../src/bootstrap/db-isolation.ts";
import { buildHealthTool } from "../src/tools/tawa/health.ts";
import { TAWASSUL_TOOL_NAMES } from "../src/tool-names.ts";

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
const dataRoot = process.env.XDG_DATA_HOME?.trim() ? resolve(process.env.XDG_DATA_HOME.trim()) : join(home, ".local", "share");
const sidecarDir = join(dataRoot, "opencode", "tawassul-v2");
const sidecar = join(sidecarDir, "opencode.db");
const sidecarSibling = join(dataRoot, "opencode", "tawassul-v2-backup", "opencode.db");
const shared = join(dataRoot, "opencode", "opencode.db");
const sharedDesktop = join(dataRoot, "opencode", "opencode-desktop.db");
const isolated = join(dataRoot, "opencode-projects", "0123456789abcdef", "opencode.db");
const isolatedSibling = join(dataRoot, "opencode-projects-old", "0123456789abcdef", "opencode.db");
const custom = join(tmpdir(), "tawassul-e46-custom", "opencode.db");

check(classifyDbLane(undefined) === "unset", "an unset OPENCODE_DB is the unset lane");
check(classifyDbLane("") === "unset", "an empty OPENCODE_DB is the unset lane");
check(classifyDbLane("   ") === "unset", "a blank OPENCODE_DB is the unset lane");
check(classifyDbLane(sidecar) === "desktop-sidecar", "the desktop sidecar DB is its own lane");
check(classifyDbLane(`  ${sidecar}  `) === "desktop-sidecar", "the sidecar lane tolerates surrounding whitespace");
check(classifyDbLane(shared) === "host-default", "the shared opencode.db is the host-default lane");
check(classifyDbLane(sharedDesktop) === "host-default", "the shared desktop DB is the host-default lane");
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
  persistDir: stateDir,
  scope: "project",
  timerManager: { activeCount: 3 },
  statePath: () => join(stateDir, ".opencode", "tawassul-state.json"),
} as never;
const health = buildHealthTool(ctx, {
  measureLag: async () => 4,
  rssMb: () => 120,
  pendingFlushes: () => 0,
});

check(TAWASSUL_TOOL_NAMES.includes("health"), "health is a registered tawa tool name");
check(health.description.includes("Report plugin health"), "the standalone health tool describes its purpose");
check(
  readFileSync("src/bootstrap/tool-registry.ts", "utf8").includes("health: buildHealthTool(tawaCtx)"),
  "the tool registry wires health under the tawa namespace",
);

async function healthWith(dbPath: string | undefined): Promise<string> {
  if (dbPath === undefined) delete process.env.OPENCODE_DB;
  else process.env.OPENCODE_DB = dbPath;
  const result = (await health.execute({}, {} as never)) as { output: string };
  return result.output;
}

const sidecarOutput = await healthWith(sidecar);
check(sidecarOutput.includes("- DB lane: desktop-sidecar"), "health names the desktop sidecar lane");
check(sidecarOutput.includes("- Model failover:"), "health reports the model failover state");
check(sidecarOutput.includes("- DB isolated: yes"), "health counts the sidecar DB as isolated");

const sharedOutput = await healthWith(shared);
check(sharedOutput.includes("- DB lane: host-default"), "health names the host-default lane");
check(sharedOutput.includes("- DB isolated: no"), "health counts the host-default lane as not isolated");
check(sharedOutput.includes("- DB matches isolation: no"), "health flags the shared DB against the keyed path");

const expectedDb = isolatedDbPathFor(stateDir, keyFile);
check(expectedDb !== null, "the temp HMAC key yields a keyed DB path");
const isolatedOutput = await healthWith(expectedDb ?? undefined);
check(isolatedOutput.includes("- DB lane: isolated"), "health names the keyed isolated lane");
check(isolatedOutput.includes("- DB matches isolation: yes"), "health matches the HMAC-keyed DB path");

const customOutput = await healthWith(custom);
check(customOutput.includes("- DB lane: custom"), "health names the custom lane");
check(customOutput.includes("- DB isolated: yes"), "a custom DB path still counts as isolated from the shared DB");
check(customOutput.includes("- DB matches isolation: no"), "a custom DB path does not match the keyed path");

const unsetOutput = await healthWith(undefined);
check(unsetOutput.includes("- DB lane: host-default"), "an unset DB resolves to the host-default lane");
check(unsetOutput.includes("- DB path (host default): "), "an unset DB names the resolution source");
check(!unsetOutput.includes("- DB matches isolation"), "an unset DB omits the matches line (no isolation configured)");

if (previousDb === undefined) delete process.env.OPENCODE_DB;
else process.env.OPENCODE_DB = previousDb;
if (previousKeyDir === undefined) delete process.env.TAWASSUL_HMAC_KEY_DIR;
else process.env.TAWASSUL_HMAC_KEY_DIR = previousKeyDir;
rmSync(keyDir, { recursive: true, force: true });

assert.equal(passed, 34);
console.log(`PROOF PASS: the DB lane is classified truthfully (${passed} assertions)`);
