import "./proof-log-isolate.ts";
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRunLog } from "../src/services/tool-run-log.ts";

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

function nonEmptyLines(path: string): string[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim() !== "");
}

async function compactRoundTrip(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-b03-"));
  try {
    const log = new ToolRunLog(dir);
    log.record({ tool: "bash", agent: "@a", sessionId: "s1", argsHash: "h1", status: "success" });
    log.record({ tool: "edit", agent: "@a", sessionId: "s1", argsHash: "h2", status: "error", input: { x: 1 }, error: "boom" });
    await log.save();
    const path = join(dir, ".opencode", "tool-run-log.json");
    const lines = nonEmptyLines(path);
    assert(lines.length === 2, "the run log is stored as one JSON object per line");
    assert(
      lines.every((line) => {
        try {
          const parsed = JSON.parse(line) as { tool?: unknown };
          return typeof parsed.tool === "string";
        } catch {
          return false;
        }
      }),
      "every persisted line is a complete run entry instead of a pretty-printed wrapper",
    );
    assert(!readFileSync(path, "utf-8").includes('"runs"'), "the persisted file is not the legacy { runs: [...] } envelope");
    assert(
      !readFileSync(path, "utf-8").includes("\n  "),
      "the persisted file is compact instead of two-space indented",
    );

    const reloaded = new ToolRunLog(dir);
    await reloaded.load();
    assert(reloaded.entries.length === 2, "a compact JSONL file loads back into the log");
    assert(reloaded.entries[0]?.tool === "bash", "the first reloaded entry keeps its tool");
    assert(reloaded.entries[1]?.status === "error", "the second reloaded entry keeps its status");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function rotationCapsTheFile(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-b03-rot-"));
  try {
    const log = new ToolRunLog(dir);
    for (let i = 0; i < 2005; i++) {
      log.record({ tool: "bash", agent: "@a", sessionId: "s", argsHash: `h${i}`, status: "success" });
    }
    await log.save();
    const path = join(dir, ".opencode", "tool-run-log.json");
    const lines = nonEmptyLines(path);
    assert(lines.length <= 2000, "rotation caps the persisted file at the memory limit");
    assert(lines.length >= 1500, "rotation keeps the recent majority instead of emptying the file");

    const reloaded = new ToolRunLog(dir);
    await reloaded.load();
    assert(reloaded.entries.length === lines.length, "a rotated file reloads with the same entry count");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function legacyFormatStillLoads(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tawassul-b03-legacy-"));
  try {
    mkdirSync(join(dir, ".opencode"), { recursive: true });
    const legacy = JSON.stringify(
      {
        runs: [
          {
            id: "tr-legacy",
            tool: "bash",
            agent: "@a",
            sessionId: "s",
            argsHash: "h",
            status: "success",
            timestamp: 1,
            turn: 1,
          },
        ],
      },
      null,
      2,
    );
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(dir, ".opencode", "tool-run-log.json"), legacy, "utf-8");
    const log = new ToolRunLog(dir);
    await log.load();
    assert(log.entries.length === 1, "a legacy pretty-printed file still loads during migration");
    assert(log.entries[0]?.id === "tr-legacy", "the legacy entry keeps its identity");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  await compactRoundTrip();
  await rotationCapsTheFile();
  await legacyFormatStillLoads();
  console.log(`PROOF PASS: the run log is compact JSONL with rotation and backward-compatible load (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
