import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getInitReady, initPlugin } from "../src/bootstrap/plugin-init.ts";
import { TOOL_COUNT, TOOL_NAME_SET_HASH } from "../src/generated/tool-tripwire.ts";
import { toolNameSetHash } from "../src/services/tool-tripwire.ts";
import type { ToolDefinition } from "../src/tool.ts";
import { measureDescriptionText, collectToolSchemas, measureSchemaPayload } from "../src/v2/adapters.ts";

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

type Line = { name: string; bytes: number; estimatedTokens: number };

type Baseline = {
  date: string;
  toolCount: number;
  toolNameSetHash: string;
  descriptionText: { bytes: number; lines: Line[] };
  schemaPayload: { bytes: number };
};

type RetryRow = { tool: string; calls: number; errors: number; retries: number };

type RetryReceipt = {
  version: number;
  baseline: { source: string; tools: RetryRow[] };
  closure: { source: string; tools: RetryRow[] };
};

type PayloadReceipt = {
  toolCount: number;
  toolNameSetHash: string;
  schemaPayload: { bytes: number; estimatedTokens: number };
  archivedBaseline: { file: string; bytes: number };
};

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const BASELINE_FILE = "2026-10-31-context-baseline.json";
const PAYLOAD_RECEIPT = join(repo, "docs", "experiments", "receipts", "2026-11-07-schema-payload.json");
const FROZEN_BASELINE_BYTES = 20267;
const TARGET_BYTES = 16213;
const MIN_CUT = FROZEN_BASELINE_BYTES - TARGET_BYTES;
const RETRY_RECEIPT = join(repo, "docs", "experiments", "receipts", "2026-11-01-wave2-retries.json");

const baselinePath = join(repo, "docs", "experiments", "baselines", BASELINE_FILE);
assert(existsSync(baselinePath), `the frozen pre-diet baseline exists (${BASELINE_FILE})`);
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
assert(baseline.date === BASELINE_FILE.slice(0, 10), "the frozen baseline is the dated E1 measurement");
assert(
  baseline.descriptionText.bytes === FROZEN_BASELINE_BYTES,
  `the frozen baseline records ${FROZEN_BASELINE_BYTES} description bytes (${baseline.descriptionText.bytes})`,
);
assert(
  baseline.descriptionText.lines.reduce((sum, line) => sum + line.bytes, 0) === FROZEN_BASELINE_BYTES,
  "the frozen baseline lines sum to the recorded total",
);

assert(existsSync(PAYLOAD_RECEIPT), "the schema payload receipt exists");
const payloadReceipt = JSON.parse(readFileSync(PAYLOAD_RECEIPT, "utf8")) as PayloadReceipt;
assert(
  payloadReceipt.archivedBaseline.bytes === baseline.schemaPayload.bytes,
  `the receipt pins the archived baseline (${payloadReceipt.archivedBaseline.bytes} === ${baseline.schemaPayload.bytes})`,
);
assert(
  payloadReceipt.archivedBaseline.file === "docs/experiments/baselines/2026-10-31-context-baseline.json",
  "the receipt names the archived baseline it supersedes for the gate",
);
assert(
  payloadReceipt.schemaPayload.bytes > payloadReceipt.archivedBaseline.bytes,
  "the live-method receipt counts the description fields the archived cross-instance measurement missed",
);
assert(
  payloadReceipt.schemaPayload.estimatedTokens === Math.ceil(payloadReceipt.schemaPayload.bytes / 4),
  "the schema-payload receipt token estimate follows its bytes",
);

const work = mkdtempSync(join(tmpdir(), "tawassul-context-diet-"));
const keyDir = join(work, "keys");
mkdirSync(keyDir, { recursive: true });
writeFileSync(join(keyDir, ".tawassul-hmac-key"), randomBytes(32), { mode: 0o600 });
process.env.TAWASSUL_HMAC_KEY_DIR = keyDir;
process.env.XDG_CONFIG_HOME = join(work, "config");
process.env.XDG_DATA_HOME = join(work, "data");
process.env.XDG_STATE_HOME = join(work, "state");
process.env.XDG_CACHE_HOME = join(work, "cache");
process.env.OPENCODE_DB = join(work, "opencode.db");
delete process.env.TAWASSUL_ISOLATED;
delete process.env.TAWASSUL_CONTEXT_HANDOFF;

try {
  const hooks = await initPlugin({ client: {}, directory: work, worktree: work } as never);
  const probe = getInitReady(hooks as never);
  assert(probe !== undefined, "the isolated boot exposes the init readiness probe");
  const status = await probe!();
  assert(status.ready, `the isolated boot completes init (${status.error?.message ?? "ready"})`);

  const tools = (hooks.tool ?? {}) as Record<string, ToolDefinition>;
  const names = Object.keys(tools).sort();
  assert(names.length === TOOL_COUNT, `the boot registers the generated tool count (${names.length}/${TOOL_COUNT})`);
  const hash = toolNameSetHash(names);
  assert(
    hash === TOOL_NAME_SET_HASH,
    `the name-set tripwire is unchanged (${hash.slice(0, 12)}/${TOOL_NAME_SET_HASH.slice(0, 12)})`,
  );
  assert(
    payloadReceipt.toolNameSetHash === hash,
    "the schema-payload receipt records the same tool-name set",
  );

  const measured = measureDescriptionText(tools);
  const liveSchemas = await collectToolSchemas(tools);
  const livePayload = measureSchemaPayload(liveSchemas);
  assert(
    liveSchemas.size === payloadReceipt.toolCount,
    `the live schema collection covers every tool (${liveSchemas.size}/${payloadReceipt.toolCount})`,
  );
  assert(
    livePayload.bytes === payloadReceipt.schemaPayload.bytes,
    `the live schema payload matches the recorded golden (${livePayload.bytes} === ${payloadReceipt.schemaPayload.bytes})`,
  );
  assert(
    livePayload.estimatedTokens === Math.ceil(livePayload.bytes / 4),
    "the live schema payload token estimate follows its bytes",
  );
  assert(
    measured.lines.length === baseline.descriptionText.lines.length,
    `the measurement covers every baseline tool (${measured.lines.length}/${baseline.descriptionText.lines.length})`,
  );
  assert(
    measured.lines.every((line, index) => line.name === baseline.descriptionText.lines[index]?.name),
    "the measurement keeps the baseline tool order",
  );

  const cut = FROZEN_BASELINE_BYTES - measured.bytes;
  assert(
    measured.bytes <= TARGET_BYTES,
    `the description text is at or below the frozen target (${measured.bytes} <= ${TARGET_BYTES})`,
  );
  assert(
    measured.bytes === 16163,
    `the description surface measures the Phase 5 target (${measured.bytes} === 16163)`,
  );
  assert(cut >= MIN_CUT, `the cut reaches the frozen floor (${cut} >= ${MIN_CUT})`);
  assert(
    cut / FROZEN_BASELINE_BYTES >= 0.2,
    `the cut is at least 20 percent of the frozen baseline (${((cut / FROZEN_BASELINE_BYTES) * 100).toFixed(3)}%)`,
  );
  assert(
    measured.estimatedTokens === Math.ceil(measured.bytes / 4),
    "the reported token estimate follows the measured bytes",
  );

  const slimmed = measured.lines.filter((line) => {
    const before = baseline.descriptionText.lines.find((entry) => entry.name === line.name);
    return before !== undefined && line.bytes < before.bytes;
  });
  assert(slimmed.length >= 11, `at least eleven tool descriptions were actually slimmed (${slimmed.length})`);
  const grown = measured.lines.filter((line) => {
    const before = baseline.descriptionText.lines.find((entry) => entry.name === line.name);
    return before !== undefined && line.bytes > before.bytes;
  });
  assert(grown.length === 0, `no description grew against the frozen baseline (${grown.map((line) => line.name).join(", ")})`);

  assert(existsSync(RETRY_RECEIPT), "the hot-tool retry receipt exists");
  const receipt = JSON.parse(readFileSync(RETRY_RECEIPT, "utf8")) as RetryReceipt;
  assert(receipt.version === 1, "the retry receipt uses schema version 1");
  assert(receipt.baseline.tools.length === 8, `the frozen retry baseline carries the top eight tools (${receipt.baseline.tools.length})`);
  assert(
    receipt.baseline.tools.every((row) => row.retries === 0),
    "the frozen retry baseline is the zero-retry E1 table",
  );
  assert(
    receipt.closure.tools.length >= receipt.baseline.tools.length,
    `the closure measurement covers the frozen top eight (${receipt.closure.tools.length})`,
  );
  for (const frozen of receipt.baseline.tools) {
    const now = receipt.closure.tools.find((row) => row.tool === frozen.tool);
    assert(now !== undefined, `${frozen.tool} is present in the closure measurement`);
    assert(
      (now as RetryRow).retries <= frozen.retries,
      `${frozen.tool} retries did not increase (${(now as RetryRow).retries} <= ${frozen.retries})`,
    );
  }

  console.log(
    `INFO  description text ${FROZEN_BASELINE_BYTES} -> ${measured.bytes} bytes, cut ${cut} (${((cut / FROZEN_BASELINE_BYTES) * 100).toFixed(3)}%), schema ${livePayload.bytes} matches the ${payloadReceipt.schemaPayload.bytes} golden`,
  );
  console.log(`PROOF PASS: the description diet meets the frozen target, the schema payload matches its golden, and hot-tool retries do not increase (${passed} assertions)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
