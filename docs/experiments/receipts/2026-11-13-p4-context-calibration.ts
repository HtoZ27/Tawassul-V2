import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveMaxContextTokens } from "../../../src/hooks/message-updated.ts";

const LEDGER = join(homedir(), ".local", "share", "tawassul-v2", "usage-ledger.jsonl");
const DB = process.env.OPENCODE_DB ?? join(homedir(), ".local", "share", "opencode", "tawassul-v2", "opencode.db");
const MIN_SESSIONS = 30;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? 0;
}

function fail(message: string): never {
  console.error(`P4 CALIBRATION FAIL: ${message}`);
  process.exit(1);
}

if (!existsSync(LEDGER)) fail(`ledger not found at ${LEDGER}`);
if (!existsSync(DB)) fail(`host database not found at ${DB}`);

const ledger = readFileSync(LEDGER, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { kind?: string; sessionID?: string });
const sessions = new Set<string>();
for (const row of ledger) if (row.kind === "usage" && row.sessionID) sessions.add(row.sessionID);

const db = new Database(DB, { readonly: true });
const rows = db.query("select session_id, data from session_message where type='assistant'").all() as Array<{ session_id: string; data: string }>;

type Sample = { session: string; fill: number; tools: number[] };
const samples: Sample[] = [];

for (const row of rows) {
  if (!sessions.has(row.session_id)) continue;
  let message: {
    tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } };
    model?: { providerID?: string; id?: string };
    agent?: string;
    content?: Array<{ type?: string; name?: string; state?: { content?: Array<{ text?: string }> } }>;
  };
  try {
    message = JSON.parse(row.data);
  } catch {
    continue;
  }
  const tokens = message.tokens;
  if (!tokens) continue;
  const measured =
    Number(tokens.input ?? 0) +
    Number(tokens.output ?? 0) +
    Number(tokens.reasoning ?? 0) +
    Number(tokens.cache?.read ?? 0) +
    Number(tokens.cache?.write ?? 0);
  if (!(measured > 0)) continue;
  const max = resolveMaxContextTokens(
    { providerID: message.model?.providerID, modelID: message.model?.id },
    undefined,
    message.agent,
  );
  const tools: number[] = [];
  for (const part of message.content ?? []) {
    if (part?.type !== "tool" || part?.name === "task") continue;
    const content = part.state?.content;
    if (!Array.isArray(content)) continue;
    let length = 0;
    for (const item of content) if (typeof item?.text === "string") length += item.text.length;
    if (length > 0) tools.push(length);
  }
  samples.push({ session: row.session_id, fill: Math.min(1, measured / max), tools });
}

const perSession = new Map<string, number>();
for (const sample of samples) perSession.set(sample.session, Math.max(perSession.get(sample.session) ?? 0, sample.fill));
const sessionFills = [...perSession.values()];
if (sessionFills.length < MIN_SESSIONS) fail(`only ${sessionFills.length} sessions carry assistant tokens; the window needs ${MIN_SESSIONS}`);

const highContextTools = samples.filter((sample) => sample.fill >= 0.7).flatMap((sample) => sample.tools);
const cap = percentile(highContextTools, 99);

console.log(`ledger sessions: ${sessions.size}`);
console.log(`sessions with assistant tokens: ${sessionFills.length}`);
console.log(`assistant messages: ${samples.length}`);
console.log(`session max fill p50: ${(percentile(sessionFills, 50) * 100).toFixed(2)}%`);
console.log(`session max fill p75: ${(percentile(sessionFills, 75) * 100).toFixed(2)}%`);
console.log(`session max fill p85: ${(percentile(sessionFills, 85) * 100).toFixed(2)}%`);
console.log(`session max fill p90: ${(percentile(sessionFills, 90) * 100).toFixed(2)}%`);
console.log(`session max fill p99: ${(percentile(sessionFills, 99) * 100).toFixed(2)}%`);
console.log(`session max fill max: ${(Math.max(...sessionFills) * 100).toFixed(2)}%`);
console.log(`sessions at or above 70/85/95: ${sessionFills.filter((fill) => fill >= 0.7).length}/${sessionFills.filter((fill) => fill >= 0.85).length}/${sessionFills.filter((fill) => fill >= 0.95).length}`);
console.log(`high-context tool outputs: ${highContextTools.length}`);
console.log(`high-context tool p90: ${percentile(highContextTools, 90)} chars`);
console.log(`high-context tool p99: ${cap} chars`);
console.log(`high-context tool max: ${Math.max(...highContextTools)} chars`);
console.log(`high-context tool over 12000: ${highContextTools.filter((length) => length > 12000).length}`);
console.log(`1.5 x p99: ${Math.round(cap * 1.5)} chars`);
console.log("P4 CALIBRATION PASS: the thresholds and the deferral cap are measured against the window");
