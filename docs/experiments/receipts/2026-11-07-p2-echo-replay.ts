import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeText, similarity, UsageShadow, type ShadowObservation } from "../../../src/services/usage-shadow.ts";

const SOURCE = process.env.TAWASSUL_ECHO_DB?.trim()
  || join(homedir(), ".local", "share", "opencode", "tawassul-v2", "opencode.db");
const PROJECT = process.env.TAWASSUL_ECHO_PROJECT?.trim() || "Tawassul V2";
const TRIP_TURNS = 12;
const OVERLAP = 0.8;

if (!existsSync(SOURCE)) {
  console.error(`REPLAY ABORT: no database at ${SOURCE}`);
  process.exit(1);
}

interface Message {
  id: string;
  seq: number;
  text: string;
  chars: number;
  normalized: string;
  hasTool: boolean;
}

interface Session {
  id: string;
  messages: Message[];
  textMessages: number;
  toolOnly: number;
  long200: number;
}

interface Variant {
  label: string;
  minChars: number;
  resetToolOnly: boolean;
}

interface Run {
  trips: number;
  bestStreak: number;
  bestSimilarity: number;
  bestLengths: number[];
  tripTurn: number | null;
  toolOnlyInBest: number;
}

interface Aggregate {
  variant: string;
  eligible: number;
  trips: number;
  nearMiss: number;
  medianBestStreak: number;
  p90BestStreak: number;
}

function partsOf(data: string): { text: string; hasTool: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { text: "", hasTool: false };
  }
  const content = (parsed as { content?: unknown }).content;
  if (!Array.isArray(content)) return { text: "", hasTool: false };
  let text = "";
  let hasTool = false;
  for (const part of content) {
    const rec = part as { type?: unknown; text?: unknown };
    if (rec.type === "tool") hasTool = true;
    if (rec.type === "text" && typeof rec.text === "string" && rec.text.trim().length > 0) text = rec.text;
  }
  return { text, hasTool };
}

function runVariant(messages: Message[], variant: Variant): Run {
  let streak = 0;
  let lastText = "";
  let tripped = false;
  let bestStreak = 0;
  let bestScore = 1;
  let bestLengths: number[] = [];
  let tripTurn: number | null = null;
  let toolOnlyInBest = 0;
  let skippedToolOnly = 0;
  let currentLengths: number[] = [];
  let currentScore = 1;
  let trips = 0;

  for (const message of messages) {
    const normalized = message.normalized;
    const hasText = normalized.length > 0;
    if (!hasText) {
      if (variant.resetToolOnly && message.hasTool) {
        streak = 0;
        lastText = "";
        tripped = false;
        currentLengths = [];
        skippedToolOnly = 0;
      } else if (message.hasTool && streak > 0) {
        skippedToolOnly += 1;
      }
      continue;
    }
    if (message.hasTool) {
      streak = 0;
      lastText = normalized;
      tripped = false;
      currentLengths = [message.chars];
      skippedToolOnly = 0;
      continue;
    }
    if (message.chars < variant.minChars) {
      streak = 0;
      lastText = "";
      tripped = false;
      currentLengths = [];
      skippedToolOnly = 0;
      continue;
    }
    if (!lastText) {
      streak = 1;
      lastText = normalized;
      tripped = false;
      currentLengths = [message.chars];
      skippedToolOnly = 0;
    } else {
      const score = similarity(lastText, normalized);
      currentScore = score;
      if (score >= OVERLAP) {
        streak += 1;
        currentLengths = [...currentLengths, message.chars];
        if (streak >= TRIP_TURNS && !tripped) {
          tripped = true;
          trips += 1;
          if (tripTurn === null) tripTurn = streak;
        }
      } else {
        streak = 1;
        tripped = false;
        currentLengths = [message.chars];
        skippedToolOnly = 0;
      }
      lastText = normalized;
    }
    if (streak > bestStreak) {
      bestStreak = streak;
      bestLengths = [...currentLengths];
      toolOnlyInBest = skippedToolOnly;
      bestScore = currentScore;
    }
  }
  return { trips, bestStreak, bestSimilarity: bestScore, bestLengths, tripTurn, toolOnlyInBest };
}

function realTrips(messages: Message[], minChars: number): number {
  const observations: ShadowObservation[] = [];
  const shadow = new UsageShadow({ emit: (row) => observations.push(row), echoMinChars: minChars });
  for (const message of messages) {
    if (message.hasTool) {
      shadow.handleEvent({ type: "session.tool.called", data: { sessionID: "replay", assistantMessageID: message.id } });
    }
    if (message.normalized) {
      shadow.handleEvent({
        type: "session.text.ended",
        data: { sessionID: "replay", assistantMessageID: message.id, text: message.text },
      });
    }
    shadow.handleEvent({ type: "session.usage.updated", data: { sessionID: "replay" } });
  }
  return observations.filter((row) => row.detector === "echo" && row.tripped).length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function main(): void {
  const work = mkdtempSync(join(tmpdir(), "tawassul-echo-replay-"));
  const copy = join(work, "live.db");
  try {
    copyFileSync(SOURCE, copy);
    for (const suffix of ["-wal", "-shm"]) {
      const from = `${SOURCE}${suffix}`;
      if (existsSync(from)) copyFileSync(from, `${copy}${suffix}`);
    }
    const db = new Database(copy, { readonly: true });
    const rows = db
      .query(
        `SELECT m.id, m.session_id, m.seq, m.data
         FROM session_message m
         JOIN session_v2 s ON s.id = m.session_id
         WHERE m.type = 'assistant' AND s.directory LIKE ?
         ORDER BY m.session_id, m.seq`,
      )
      .all(`%${PROJECT}%`) as Array<{ id: string; session_id: string; seq: number; data: string }>;
    db.close();

    const sessions = new Map<string, Session>();
    for (const row of rows) {
      const { text, hasTool } = partsOf(row.data);
      const message: Message = {
        id: row.id,
        seq: row.seq,
        text,
        chars: text.trim().length,
        normalized: normalizeText(text),
        hasTool,
      };
      let session = sessions.get(row.session_id);
      if (!session) {
        session = { id: row.session_id, messages: [], textMessages: 0, toolOnly: 0, long200: 0 };
        sessions.set(row.session_id, session);
      }
      session.messages.push(message);
      if (message.normalized) session.textMessages += 1;
      else if (hasTool) session.toolOnly += 1;
      if (message.chars >= 200 && !hasTool) session.long200 += 1;
    }

    const variants: Variant[] = [
      { label: "current-200", minChars: 200, resetToolOnly: false },
      { label: "fixed-200", minChars: 200, resetToolOnly: true },
      { label: "fixed-120", minChars: 120, resetToolOnly: true },
      { label: "fixed-80", minChars: 80, resetToolOnly: true },
      { label: "fixed-40", minChars: 40, resetToolOnly: true },
      { label: "current-80", minChars: 80, resetToolOnly: false },
      { label: "fixed-1", minChars: 1, resetToolOnly: true },
      { label: "current-1", minChars: 1, resetToolOnly: false },
    ];

    console.log(`source: ${SOURCE}`);
    console.log(`project: ${PROJECT}`);
    console.log(`sessions: ${sessions.size}`);
    console.log(`assistant messages: ${rows.length}`);

    const sorted = [...sessions.values()].sort((left, right) => right.messages.length - left.messages.length);

    console.log("");
    console.log("session | msgs | text | tool-only | long200 | " + variants.map((variant) => variant.label).join(" | "));
    for (const session of sorted) {
      const cells = variants.map((variant) => {
        const run = runVariant(session.messages, variant);
        return `${run.trips > 0 ? "T" : "-"}${run.bestStreak}`;
      });
      console.log(
        `${session.id.slice(0, 14)} | ${session.messages.length} | ${session.textMessages} | ${session.toolOnly} | ${session.long200} | ${cells.join(" | ")}`,
      );
    }

    console.log("");
    const aggregates: Aggregate[] = [];
    for (const variant of variants) {
      const runs = sorted.map((session) => runVariant(session.messages, variant));
      const tripped = runs.filter((run) => run.trips > 0);
      const nearMiss = runs.filter((run) => run.bestStreak >= 6 && run.trips === 0);
      const bestStreaks = runs.map((run) => run.bestStreak);
      aggregates.push({
        variant: variant.label,
        eligible: tripped.length,
        trips: tripped.reduce((sum, run) => sum + run.trips, 0),
        nearMiss: nearMiss.length,
        medianBestStreak: percentile(bestStreaks, 50),
        p90BestStreak: percentile(bestStreaks, 90),
      });
    }
    console.log("variant | tripped sessions | trips | near-miss | median best | p90 best");
    for (const aggregate of aggregates) {
      console.log(
        `${aggregate.variant} | ${aggregate.eligible} | ${aggregate.trips} | ${aggregate.nearMiss} | ${aggregate.medianBestStreak} | ${aggregate.p90BestStreak}`,
      );
    }

    console.log("");
    console.log("model vs shipped detector (fixed reset):");
    for (const minChars of [200, 120, 80, 40, 1]) {
      const model = aggregates.find((aggregate) => aggregate.variant === `fixed-${minChars}`)?.trips ?? 0;
      const shipped = sorted.reduce((sum, session) => sum + realTrips(session.messages, minChars), 0);
      console.log(`  chars=${minChars} model=${model} shipped=${shipped} ${model === shipped ? "match" : "MISMATCH"}`);
    }

    console.log("");
    for (const variant of variants) {
      const tripped = sorted
        .map((session) => ({ session, run: runVariant(session.messages, variant) }))
        .filter((entry) => entry.run.trips > 0);
      if (tripped.length === 0) continue;
      console.log(`${variant.label} tripped sessions:`);
      for (const entry of tripped) {
        console.log(
          `  ${entry.session.id} trips=${entry.run.trips} best=${entry.run.bestStreak} sim=${entry.run.bestSimilarity.toFixed(3)} toolOnly=${entry.run.toolOnlyInBest} lengths=${entry.run.bestLengths.join(",")}`,
        );
      }
    }

    console.log("");
    const nearMisses = sorted
      .map((session) => ({ session, run: runVariant(session.messages, variants[0]) }))
      .filter((entry) => entry.run.bestStreak >= 6 && entry.run.bestStreak < TRIP_TURNS);
    if (nearMisses.length > 0) {
      console.log("current-200 near-miss sessions:");
      for (const entry of nearMisses) {
        console.log(
          `  ${entry.session.id} best=${entry.run.bestStreak} sim=${entry.run.bestSimilarity.toFixed(3)} lengths=${entry.run.bestLengths.join(",")}`,
        );
      }
    }

    const pairs: Array<{ session: string; score: number; left: number; right: number; leftText: string; rightText: string }> = [];
    const textOnlyPairs: Array<{ session: string; score: number; left: number; right: number; leftText: string; rightText: string }> = [];
    for (const session of sorted) {
      const texts = session.messages.filter((message) => message.normalized);
      for (let index = 1; index < texts.length; index += 1) {
        const score = similarity(texts[index - 1].normalized, texts[index].normalized);
        const pair = {
          session: session.id,
          score,
          left: texts[index - 1].chars,
          right: texts[index].chars,
          leftText: texts[index - 1].text.slice(0, 60),
          rightText: texts[index].text.slice(0, 60),
        };
        pairs.push(pair);
        if (!texts[index - 1].hasTool && !texts[index].hasTool) textOnlyPairs.push(pair);
      }
    }
    pairs.sort((left, right) => right.score - left.score);
    textOnlyPairs.sort((left, right) => right.score - left.score);
    console.log("");
    console.log(`consecutive text pairs: ${pairs.length}; max similarity: ${pairs[0]?.score.toFixed(4) ?? "n/a"}`);
    for (const pair of pairs.slice(0, 10)) {
      console.log(`  ${pair.session.slice(0, 14)} score=${pair.score.toFixed(4)} chars=${pair.left}/${pair.right}`);
      console.log(`    left=${JSON.stringify(pair.leftText)}`);
      console.log(`    right=${JSON.stringify(pair.rightText)}`);
    }
    console.log("");
    console.log(
      `consecutive text-only pairs: ${textOnlyPairs.length}; max similarity: ${textOnlyPairs[0]?.score.toFixed(4) ?? "n/a"}`,
    );
    for (const pair of textOnlyPairs.slice(0, 5)) {
      console.log(`  ${pair.session.slice(0, 14)} score=${pair.score.toFixed(4)} chars=${pair.left}/${pair.right}`);
      console.log(`    left=${JSON.stringify(pair.leftText)}`);
      console.log(`    right=${JSON.stringify(pair.rightText)}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
