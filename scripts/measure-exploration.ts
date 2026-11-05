import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type RawEntry = {
  tool: string;
  agent: string;
  sessionId: string;
  argsHash: string;
  status?: string;
  timestamp: number;
  input?: unknown;
};

type ToolAccumulator = {
  tool: string;
  calls: number;
  errors: number;
  sessions: Set<string>;
  agents: Set<string>;
  hashes: Set<string>;
  files: Set<string>;
  inputBytes: number;
};

type HashAccumulator = {
  tool: string;
  calls: number;
  sessions: Set<string>;
};

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MEMORY_CAP = 2000;
const PRUNE_FLOOR = 1500;
const DAY_MS = 86_400_000;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function isRawEntry(value: unknown): value is RawEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.tool === "string" &&
    typeof candidate.agent === "string" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.argsHash === "string" &&
    typeof candidate.timestamp === "number" &&
    Number.isFinite(candidate.timestamp)
  );
}

function parseEntries(raw: string): RawEntry[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    parsed = undefined;
  }
  let values: unknown[] = [];
  if (Array.isArray(parsed)) {
    values = parsed;
  } else if (parsed && typeof parsed === "object") {
    const candidate = parsed as Record<string, unknown>;
    if (Array.isArray(candidate.runs)) values = candidate.runs;
    else if ("tool" in candidate) values = [candidate];
  }
  if (values.length === 0) {
    values = trimmed
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      })
      .filter((value): value is unknown => value !== null);
  }
  return values.filter(isRawEntry);
}

function inputObject(entry: RawEntry): Record<string, unknown> | undefined {
  if (typeof entry.input === "string") {
    try {
      const parsed: unknown = JSON.parse(entry.input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
  if (entry.input && typeof entry.input === "object" && !Array.isArray(entry.input)) {
    return entry.input as Record<string, unknown>;
  }
  return undefined;
}

function fileRefs(input: Record<string, unknown> | undefined): string[] {
  if (!input) return [];
  const refs: string[] = [];
  if (typeof input.path === "string" && input.path.trim() !== "") refs.push(input.path);
  for (const field of ["files", "paths"]) {
    const value = input[field];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string" && item.trim() !== "") refs.push(item);
    }
  }
  return refs;
}

function inputSize(entry: RawEntry): number {
  if (entry.input === undefined) return 0;
  const text = typeof entry.input === "string" ? entry.input : JSON.stringify(entry.input) ?? "";
  return Buffer.byteLength(text, "utf8");
}

function currentCommit(): string {
  try {
    const value = execSync("git rev-parse --short HEAD", {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value || "unknown";
  } catch {
    return "unknown";
  }
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function padEnd(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

function padStart(value: string | number, width: number): string {
  return String(value).padStart(width);
}

const date = new Date().toISOString().slice(0, 10);
const logPath = resolve(argValue("--log") ?? join(REPO, ".opencode", "tool-run-log.json"));
if (!existsSync(logPath)) {
  console.error(`measure-exploration: log not found: ${logPath}`);
  process.exit(1);
}

const raw = readFileSync(logPath, "utf8");
const entries = parseEntries(raw);
const toolStats = new Map<string, ToolAccumulator>();
const hashStats = new Map<string, HashAccumulator>();
const sessionHashCounts = new Map<string, number>();
const sessions = new Set<string>();
const agents = new Set<string>();
const files = new Set<string>();
let inputBytes = 0;
let fileMentions = 0;
let fileInputBytes = 0;

for (const entry of entries) {
  sessions.add(entry.sessionId);
  agents.add(entry.agent);
  const bytes = inputSize(entry);
  inputBytes += bytes;
  let tool = toolStats.get(entry.tool);
  if (!tool) {
    tool = {
      tool: entry.tool,
      calls: 0,
      errors: 0,
      sessions: new Set<string>(),
      agents: new Set<string>(),
      hashes: new Set<string>(),
      files: new Set<string>(),
      inputBytes: 0,
    };
    toolStats.set(entry.tool, tool);
  }
  tool.calls += 1;
  if (entry.status === "error") tool.errors += 1;
  tool.sessions.add(entry.sessionId);
  tool.agents.add(entry.agent);
  tool.hashes.add(entry.argsHash);
  tool.inputBytes += bytes;

  const refs = fileRefs(inputObject(entry));
  if (refs.length > 0) {
    fileInputBytes += bytes;
    fileMentions += refs.length;
    for (const ref of refs) {
      files.add(ref);
      tool.files.add(ref);
    }
  }

  const hash = hashStats.get(entry.argsHash);
  if (hash) {
    hash.calls += 1;
    hash.sessions.add(entry.sessionId);
  } else {
    hashStats.set(entry.argsHash, {
      tool: entry.tool,
      calls: 1,
      sessions: new Set<string>([entry.sessionId]),
    });
  }

  const pair = `${entry.sessionId}\u0000${entry.argsHash}`;
  sessionHashCounts.set(pair, (sessionHashCounts.get(pair) ?? 0) + 1);
}

let withinSessionRepetitions = 0;
for (const count of sessionHashCounts.values()) {
  if (count > 1) withinSessionRepetitions += count - 1;
}

let crossSessionRepetitions = 0;
let repeatedHashes = 0;
for (const hash of hashStats.values()) {
  if (hash.calls > 1) repeatedHashes += 1;
  if (hash.sessions.size > 1) crossSessionRepetitions += hash.sessions.size - 1;
}

const totalRepetitions = withinSessionRepetitions + crossSessionRepetitions;
const repeatRate = entries.length > 0 ? Number((totalRepetitions / entries.length).toFixed(4)) : 0;
const perTool = [...toolStats.values()]
  .map((tool) => ({
    tool: tool.tool,
    calls: tool.calls,
    errors: tool.errors,
    sessions: tool.sessions.size,
    agents: tool.agents.size,
    argsHashes: tool.hashes.size,
    files: tool.files.size,
    inputBytes: tool.inputBytes,
  }))
  .sort((left, right) => right.calls - left.calls || left.tool.localeCompare(right.tool));

const topRepeated = [...hashStats.entries()]
  .filter(([, hash]) => hash.calls > 1)
  .sort((left, right) => right[1].calls - left[1].calls || left[1].tool.localeCompare(right[1].tool))
  .slice(0, 10)
  .map(([argsHash, hash]) => ({
    tool: hash.tool,
    fingerprint: fingerprint(argsHash),
    calls: hash.calls,
    sessions: hash.sessions.size,
  }));

const timestamps = entries.map((entry) => entry.timestamp);
const firstTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : 0;
const lastTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : 0;
const spanDays = timestamps.length > 0 ? Number(((lastTimestamp - firstTimestamp) / DAY_MS).toFixed(2)) : 0;
const truncated = entries.length >= PRUNE_FLOOR;

const receipt = {
  version: 1,
  date,
  commit: currentCommit(),
  phase: "0",
  method:
    "read-only parse of the live tool-run-log; aggregates only, with no raw arguments or file paths in the receipt, and repeated runs identified by a short SHA-256 fingerprint of the recorded repetition key",
  source: {
    file: "tool-run-log.json",
    location: "<stateDir>/.opencode",
    readOnly: true,
    bytes: Buffer.byteLength(raw, "utf8"),
  },
  window: {
    entries: entries.length,
    firstTimestamp,
    lastTimestamp,
    spanDays,
    memoryCap: MEMORY_CAP,
    pruneFloor: PRUNE_FLOOR,
    truncated,
    label: truncated
      ? "at or above the 1500-entry prune floor; earlier runs may be absent"
      : "below the 1500-entry prune floor; the persisted log is complete",
  },
  totals: {
    calls: entries.length,
    errors: entries.reduce((sum, entry) => sum + (entry.status === "error" ? 1 : 0), 0),
    sessions: sessions.size,
    agents: agents.size,
    tools: toolStats.size,
    uniqueArgsHashes: hashStats.size,
    repeatedArgsHashes: repeatedHashes,
    withinSessionRepetitions,
    crossSessionRepetitions,
    repeatRate,
    inputBytes,
  },
  files: {
    unique: files.size,
    mentions: fileMentions,
    inputBytes: fileInputBytes,
  },
  perTool,
  topRepeated,
};

const width = Math.max(12, ...perTool.map((row) => row.tool.length));
console.log("Exploration measurement");
console.log(`log        ${logPath}`);
console.log(
  `window     ${receipt.window.entries} runs, ${receipt.window.spanDays} days, ${receipt.window.label}`,
);
console.log(
  `totals     ${receipt.totals.tools} tools, ${receipt.totals.sessions} sessions, ${receipt.totals.agents} agents, ${receipt.totals.errors} errors`,
);
console.log(
  `repetition ${receipt.totals.withinSessionRepetitions} within-session, ${receipt.totals.crossSessionRepetitions} cross-session, ${receipt.totals.repeatedArgsHashes} repeated hashes, rate ${receipt.totals.repeatRate}`,
);
console.log(
  `files      ${receipt.files.unique} unique from ${receipt.files.mentions} mentions, ${receipt.files.inputBytes} bytes`,
);
console.log(
  `bytes      ${receipt.totals.inputBytes} input bytes across ${receipt.totals.calls} runs`,
);
console.log("");
console.log(
  `${padEnd("tool", width)} ${padStart("calls", 7)} ${padStart("errors", 6)} ${padStart("sessions", 8)} ${padStart("hashes", 7)} ${padStart("files", 6)} ${padStart("bytes", 10)}`,
);
for (const row of perTool) {
  console.log(
    `${padEnd(row.tool, width)} ${padStart(row.calls, 7)} ${padStart(row.errors, 6)} ${padStart(row.sessions, 8)} ${padStart(row.argsHashes, 7)} ${padStart(row.files, 6)} ${padStart(row.inputBytes, 10)}`,
  );
}

const outPath = resolve(
  argValue("--out") ?? join(REPO, "docs", "experiments", "receipts", `${date}-exploration.json`),
);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(`wrote ${outPath}`);
