import "./proof-log-isolate.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOST_AUDITED,
  HOST_FLOOR,
  compareHostVersions,
  hostFloorProblem,
  isBelowHostFloor,
  parseHostVersion,
} from "../src/core/host-floor.ts";
import { getInitReady, initPlugin } from "../src/bootstrap/plugin-init.ts";
import { createV2Setup } from "../src/v2/setup.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed += 1;
  console.log(`ok ${name}`);
}

const root = mkdtempSync(join(tmpdir(), "tawassul-host-floor-"));
const saved = {
  state: process.env.TAWASSUL_V2_STATE_DIR,
  config: process.env.XDG_CONFIG_HOME,
  data: process.env.XDG_DATA_HOME,
  home: process.env.HOME,
};
process.env.TAWASSUL_V2_STATE_DIR = join(root, "state");
process.env.XDG_CONFIG_HOME = join(root, "config");
process.env.XDG_DATA_HOME = join(root, "data");

try {
  assert(HOST_FLOOR === "2.3.0", "the shared floor is 2.3.0");
  assert(HOST_AUDITED === "2.4.1", "the audited host is 2.4.1");
  assert(parseHostVersion("2.2.1")?.join(".") === "2.2.1", "a plain version parses");
  assert(parseHostVersion("v2.2.1")?.join(".") === "2.2.1", "a v-prefixed version parses");
  assert(parseHostVersion("2.2.1-experimental")?.join(".") === "2.2.1", "a prerelease suffix parses");
  assert(parseHostVersion("2.2") === undefined, "a two-part version is not accepted");
  assert(parseHostVersion("unknown") === undefined, "a non-version is not accepted");
  assert(parseHostVersion(undefined) === undefined, "a missing version is not parsed");
  assert(compareHostVersions("2.2.0", "2.2.1") < 0, "2.2.0 compares below 2.2.1");
  assert(compareHostVersions("2.2.1", "2.2.1") === 0, "2.2.1 compares equal");
  assert(compareHostVersions("2.2.2", "2.2.1") > 0, "2.2.2 compares above 2.2.1");
  assert(isBelowHostFloor("2.2.9"), "2.2.9 is below the floor");
  assert(!isBelowHostFloor("2.3.0"), "2.3.0 meets the floor");
  assert(!isBelowHostFloor("3.0.0"), "a newer major meets the floor");
  assert(!isBelowHostFloor(undefined), "an unreported version is not below the floor");
  assert(hostFloorProblem("2.1.4")?.includes("2.3.0") === true, "2.1.4 is refused with the floor in the message");
  assert(hostFloorProblem("2.2.9")?.includes("2.3.0") === true, "2.2.9 is refused with the floor in the message");
  assert(hostFloorProblem("2.3.0") === undefined, "2.3.0 is accepted");
  assert(hostFloorProblem("2.3.1") === undefined, "a newer patch is accepted");
  assert(hostFloorProblem("3.0.0") === undefined, "a newer major is accepted in untested mode");
  assert(hostFloorProblem(undefined) === undefined, "an unreported version is not refused");

  const refused = initPlugin({
    client: {},
    directory: join(root, "project"),
    worktree: join(root, "project"),
    hostVersion: "2.2.0",
  } as never);
  assert(refused.tool === undefined, "a below-floor init registers no tools");
  const probe = getInitReady(refused);
  assert(typeof probe === "function", "a below-floor init exposes its readiness probe");
  const readiness = await probe?.();
  assert(readiness?.ready === false, "a below-floor init is not ready");
  assert(readiness?.error?.message.includes("2.3.0") === true, "the refusal names the floor");
  assert(typeof refused.dispose === "function", "a below-floor init has a safe dispose");
  await refused.dispose?.();

  let called = false;
  const setup = createV2Setup({
    init: (() => {
      called = true;
      return {};
    }) as never,
  });
  const dispose = await setup({
    session: {},
    tool: {},
    app: { version: "2.2.0" },
    location: { directory: join(root, "project") },
  } as never);
  assert(called === false, "a below-floor v2 setup never calls the plugin init");
  assert(typeof dispose === "function", "a below-floor v2 setup returns a safe dispose");
  await dispose();

  console.log(`PROOF PASS: host floor ${HOST_FLOOR} is enforced at both entry paths (${passed} assertions)`);
} finally {
  if (saved.state === undefined) delete process.env.TAWASSUL_V2_STATE_DIR;
  else process.env.TAWASSUL_V2_STATE_DIR = saved.state;
  if (saved.config === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = saved.config;
  if (saved.data === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = saved.data;
  if (saved.home === undefined) delete process.env.HOME;
  else process.env.HOME = saved.home;
  rmSync(root, { recursive: true, force: true });
}
