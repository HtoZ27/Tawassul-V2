import { execSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getInitReady } from "../src/bootstrap/plugin-init.ts";
import { TOOL_COUNT, TOOL_NAME_SET_HASH } from "../src/generated/tool-tripwire.ts";
import { SYSTEM_CONCORDANCE_TEXT } from "../src/services/concordance.ts";
import { toolNameSetHash } from "../src/services/tool-tripwire.ts";
import { PILOT_SKILLS } from "../src/skills/pilot.ts";
import type { ToolDefinition } from "../src/tool.ts";
import { collectToolSchemas, measureDescriptionText, measureSchemaPayload } from "../src/v2/adapters.ts";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const date = new Date().toISOString().slice(0, 10);
const outDir = join(repo, "docs", "experiments", "baselines");
const outPath = join(outDir, `${date}-context-baseline.json`);
const force = process.argv.includes("--force");

if (existsSync(outPath) && !force) {
  console.error(`context-baseline: ${outPath} already exists; baselines are immutable. Pass --force only for an uncommitted draft.`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "tawassul-context-baseline-"));
process.env.TAWASSUL_V2_STATE_DIR = join(work, "state");
process.env.TAWASSUL_HMAC_KEY_DIR = join(work, "hmac");
process.env.TAWASSUL_LOG_FILE = join(work, "tawassul.log");
process.env.OPENCODE_DB = join(work, "opencode.db");
process.env.XDG_CONFIG_HOME = join(work, "config");
process.env.XDG_DATA_HOME = join(work, "data");
process.env.XDG_STATE_HOME = join(work, "state-home");
process.env.XDG_CACHE_HOME = join(work, "cache");

try {
  const entry = join(repo, ".opencode", "plugins", "tawassul.js");
  if (!existsSync(entry)) {
    throw new Error(`built entry missing at ${entry}; run npm run build`);
  }
  const mod = (await import(pathToFileURL(entry).href)) as {
    createHooks: (input: { client: Record<string, never>; directory: string; worktree: string }) => Promise<{ tool?: Record<string, ToolDefinition> }>;
  };
  const hooks = await mod.createHooks({ client: {}, directory: work, worktree: work });
  const probe = getInitReady(hooks as never);
  if (!probe) {
    throw new Error("the built plugin does not expose the init readiness probe");
  }
  const status = await probe();
  if (!status.ready) {
    throw new Error(`plugin init did not complete: ${status.error?.message ?? "unknown error"}`);
  }
  const tools = hooks.tool ?? {};
  const names = Object.keys(tools).sort();
  if (names.length !== TOOL_COUNT) {
    throw new Error(`registered ${names.length} tools, generated count is ${TOOL_COUNT}`);
  }
  const placeholder = names.find((name) => (tools[name]?.description ?? "").includes("initializing, retry in a moment"));
  if (placeholder) {
    throw new Error(`tool ${placeholder} still carries the init placeholder description`);
  }
  const hash = toolNameSetHash(names);
  if (hash !== TOOL_NAME_SET_HASH) {
    throw new Error(`registered name-set ${hash} does not match generated ${TOOL_NAME_SET_HASH}`);
  }
  const schemas = await collectToolSchemas(tools);
  const schemaPayload = measureSchemaPayload(schemas);
  const descriptionText = measureDescriptionText(tools);
  const concordance = {
    bytes: Buffer.byteLength(SYSTEM_CONCORDANCE_TEXT, "utf8"),
    lines: SYSTEM_CONCORDANCE_TEXT.split("\n").length,
    estimatedTokens: Math.ceil(Buffer.byteLength(SYSTEM_CONCORDANCE_TEXT, "utf8") / 4),
  };
  const i18nBytes = readFileSync(join(repo, "src", "i18n", "en.json")).byteLength;
  const skillLines = PILOT_SKILLS.map((skill) => {
    const bytes = Buffer.byteLength(skill.description, "utf8");
    return { name: skill.id, bytes, estimatedTokens: Math.ceil(bytes / 4) };
  });
  const skillBytes = skillLines.reduce((total, line) => total + line.bytes, 0);
  const commit = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim();
  const artifact = {
    date,
    commit,
    method: "collectToolSchemas then measureSchemaPayload for whole schemas; measureDescriptionText for description text; buildConcordance output for the concordance",
    toolCount: names.length,
    toolNameSetHash: hash,
    schemaPayload,
    descriptionText,
    concordance,
    sessionDigest: {
      composition: ["goal digest", "top-10 importance-weighted records", "handoffs"],
      emptyStateBytes: 0,
      note: "Grows with live session state; the empty scratch state is the recorded floor, not a published prompt size.",
    },
    i18n: {
      file: "src/i18n/en.json",
      bytes: i18nBytes,
      contextWeightBytes: 0,
      note: "Runtime lookup table compiled into the bundle; never injected into the model prompt.",
    },
    registeredSkills: {
      count: skillLines.length,
      lines: skillLines,
      totalBytes: skillBytes,
      estimatedTokens: Math.ceil(skillBytes / 4),
      note: "One description-text line per plugin-registered skill; a body loads only when the skill is invoked.",
    },
  };
  mkdirSync(outDir, { recursive: true });
  if (existsSync(outPath)) chmodSync(outPath, 0o644);
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  chmodSync(outPath, 0o444);
  console.log(`context-baseline: wrote ${outPath}`);
  console.log(`context-baseline: ${names.length} tools, schema ${schemaPayload.bytes} bytes, descriptions ${descriptionText.bytes} bytes, concordance ${concordance.bytes} bytes`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

process.exit(0);
