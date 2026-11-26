import "./proof-log-isolate.ts";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hmacReadFile } from "../src/services/persist-utils.ts";
import { stateDir } from "../src/utils/state-paths.ts";

const work = mkdtempSync(join(tmpdir(), "tawassul-p08-"));

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

const envKeys = ["HOME", "XDG_CONFIG_HOME", "TAWASSUL_V2_STATE_DIR", "TAWASSUL_GLOBAL_DIR"] as const;
const savedEnv = new Map<string, string | undefined>();
for (const key of envKeys) savedEnv.set(key, process.env[key]);

const fakeHome = join(work, "home");
process.env.HOME = fakeHome;
process.env.XDG_CONFIG_HOME = join(fakeHome, ".config");
delete process.env.TAWASSUL_V2_STATE_DIR;
delete process.env.TAWASSUL_GLOBAL_DIR;

function quarantineFiles(): string[] {
  const dir = join(stateDir(), "quarantine");
  try {
    return readdirSync(dir)
      .filter((name) => name.startsWith("tampered.json.rejected."))
      .sort();
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  mkdirSync(join(work, "files"), { recursive: true });
  const first = join(work, "tampered.json");
  writeFileSync(first, "unsigned payload first", "utf8");
  await hmacReadFile<Record<string, unknown>>(first);
  assert(quarantineFiles().length === 1, "the first rejected copy is preserved");

  writeFileSync(first, "unsigned payload second", "utf8");
  await hmacReadFile<Record<string, unknown>>(first);
  const two = quarantineFiles();
  assert(two.length === 2, "a later rejected copy is preserved instead of dropped");
  const contents = two.map((name) => readFileSync(join(stateDir(), "quarantine", name), "utf8"));
  assert(contents[0] === "unsigned payload first", "the first copy keeps its own bytes");
  assert(contents[1] === "unsigned payload second", "the later copy keeps its own bytes");

  for (let i = 3; i <= 8; i++) {
    writeFileSync(first, `unsigned payload ${i}`, "utf8");
    await hmacReadFile<Record<string, unknown>>(first);
  }
  const capped = quarantineFiles();
  assert(capped.length === 5, "the rejected copies stay capped at five");
  const keptContents = capped.map((name) => readFileSync(join(stateDir(), "quarantine", name), "utf8"));
  assert(keptContents[keptContents.length - 1] === "unsigned payload 8", "the newest rejected copy is kept");
  assert(keptContents[0] === "unsigned payload 4", "the oldest copies are pruned first");
  assert(
    new Set(keptContents).size === keptContents.length,
    "every kept copy holds a distinct generation",
  );

  const nested = join(work, "nested", "tampered.json");
  mkdirSync(dirname(nested), { recursive: true });
  writeFileSync(nested, "unsigned payload nested", "utf8");
  await hmacReadFile<Record<string, unknown>>(nested);
  assert(quarantineFiles().length === 5, "a same-name file from another directory stays in the same cap");
  const afterNested = quarantineFiles().map((name) => readFileSync(join(stateDir(), "quarantine", name), "utf8"));
  assert(afterNested.includes("unsigned payload nested"), "the newest rejection wins a capped slot");
}

try {
  await main();
  console.log(`PROOF PASS: rejected state copies are preserved and capped (${passed} assertions)`);
} finally {
  for (const key of envKeys) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(work, { recursive: true, force: true });
}
