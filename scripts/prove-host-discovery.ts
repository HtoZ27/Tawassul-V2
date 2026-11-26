import "./proof-log-isolate.ts";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const ROOT = mkdtempSync(join(tmpdir(), "tawassul-host-discovery-"));
const HOME = join(ROOT, "home");

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

function fakeHost(path: string, version: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `#!/bin/sh\necho ${version}\n`);
  chmodSync(path, 0o755);
  return path;
}

try {
  const pathA = join(ROOT, "path-a");
  const pathB = join(ROOT, "path-b");
  mkdirSync(pathA, { recursive: true });
  mkdirSync(pathB, { recursive: true });
  const unixHost = fakeHost(join(pathA, "opencode"), "2.2.0");
  const cmdHost = fakeHost(join(pathA, "opencode.cmd"), "2.2.0");
  const exeHost = fakeHost(join(pathB, "opencode.exe"), "2.2.0");

  const macDesktop = join(HOME, "Library", "Application Support", "ai.opencode.desktop", "cli", "2.2.0");
  const macHost = fakeHost(join(macDesktop, "opencode-cli"), "2.2.0");
  const localAppData = join(ROOT, "local-app-data");
  const winDesktop = join(localAppData, "ai.opencode.desktop", "cli", "2.2.0");
  const winHost = fakeHost(join(winDesktop, "opencode-cli.exe"), "2.2.0");
  const winResources = join(localAppData, "Programs", "ai.opencode.desktop", "resources");
  const winResourcesHost = fakeHost(join(winResources, "opencode-cli.exe"), "2.2.0");
  const programFiles = join(ROOT, "program-files");
  const programFilesHost = fakeHost(
    join(programFiles, "ai.opencode.desktop", "resources", "opencode-cli.exe"),
    "2.2.0",
  );

  process.env.HOME = HOME;
  process.env.LOCALAPPDATA = localAppData;
  process.env.ProgramFiles = programFiles;
  process.env.PATH = [pathA, pathB, pathA].join(delimiter);
  delete process.env.OPENCODE_BIN;

  const mod = await import("../scripts/install-global.ts");
  const candidates = mod.hostCandidates();
  assert(candidates.includes(unixHost), "a bare opencode on PATH is a candidate");
  assert(candidates.includes(cmdHost), "an opencode.cmd on PATH is a candidate");
  assert(candidates.includes(exeHost), "an opencode.exe on PATH is a candidate");
  assert(candidates.includes(macHost), "the macOS Desktop CLI location is a candidate");
  assert(candidates.includes(winHost), "the LOCALAPPDATA Desktop CLI location is a candidate");
  assert(candidates.includes(winResourcesHost), "the Windows Desktop resources sidecar is a candidate");
  assert(candidates.includes(programFilesHost), "a machine-wide Desktop resources sidecar is a candidate");
  assert(
    candidates.filter((candidate) => candidate === join(pathA, "opencode")).length === 1,
    "duplicate PATH entries are de-duplicated",
  );
  assert(
    candidates.filter((candidate) => candidate.startsWith(pathA)).length === 3,
    "every executable suffix is probed on the first PATH entry",
  );
  assert(
    candidates.filter((candidate) => candidate.includes(`a${delimiter}b`)).length === 0,
    "PATH is split by the platform delimiter",
  );

  const found = mod.hosts();
  const versions = found.filter((host) => host.version === "2.2.0");
  assert(versions.length === 7, `all seven fake hosts are readable (found ${versions.length})`);
  assert(
    !versions.some((host) => host.bin.endsWith("missing-opencode")),
    "a candidate without an executable is not a host",
  );

  console.log(`PROOF PASS: host discovery probes PATH suffixes, both Desktop layouts, and de-duplicates entries (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
