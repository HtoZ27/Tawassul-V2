

import { join } from "node:path";
import { existsSync, statSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { severityEmoji } from "../utils/format.ts";
import { logger } from "../utils/logger.ts";
import { SYSTEM_CONCORDANCE_TEXT } from "../services/concordance.ts";
import type { HandoffEntry, RecordEntry } from "../context.ts";
import type { PriorityIndex } from "../context/priority-index.ts";
import type { ScoredContextEntry } from "../context/priority-types.ts";
import { countTokens } from "../services/context-compressor.ts";
import { lruSet } from "../utils/bounded-map.ts";
import { decayWeight, K8_DETAIL_CAP } from "../services/importance-decay.ts";
import {
  estimateTokensByFactor,
  PRIORITY_TOKEN_FACTOR,
  HANDOFF_CHECKPOINT_FACTOR,
  RECORD_BASE_TOKENS,
} from "../services/token-estimation.ts";






const MAX_COMPACTION_MONITORED_SESSIONS = 200;
export const sessionCompactionCounts = new Map<string, number>();
export const sessionInjectedTokens = new Map<string, number>();









const SOAK_LOG_FILENAME = "s7-soak.jsonl";
const MAX_SOAK_LOG_BYTES = 1_000_000;
const MAX_SOAK_LINES_PER_PROCESS = 5_000;
let soakLinesWritten = 0;

const soakLastSeenBySession = new Map<string, number>();


export function resolveSoakLogPath(): string {
  const override = process.env.TAWASSUL_SOAK_LOG?.trim();
  if (override) return override;
  return join(process.cwd(), SOAK_LOG_FILENAME);
}


function soakLogEnabled(): boolean {
  if (process.env.TAWASSUL_SOAK_LOG?.trim()) return true;
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") return false;
  return true;
}


function soakSegmentPath(base: string): string {
  let i = 0;
  let candidate = base;
  while (existsSync(candidate) && statSync(candidate).size >= MAX_SOAK_LOG_BYTES) {
    i += 1;
    candidate = `${base}.${i}`;
  }
  return candidate;
}


function rememberSoakSeen(sessionId: string, ts: number): number | undefined {
  const prev = soakLastSeenBySession.get(sessionId);
  soakLastSeenBySession.delete(sessionId);
  soakLastSeenBySession.set(sessionId, ts);
  if (soakLastSeenBySession.size > MAX_COMPACTION_MONITORED_SESSIONS) {
    const oldest = soakLastSeenBySession.keys().next().value as string | undefined;
    if (oldest !== undefined && oldest !== sessionId) soakLastSeenBySession.delete(oldest);
  }
  return prev;
}

async function appendSoakLine(entry: {
  session: string;
  compactions: number;
  injectedTokens: number;
  
  baseTokens: number;
  
  pageSize: number;
  
  headroom: number;
  
  records: number;
  handoffs: number;
}): Promise<void> {
  if (!soakLogEnabled() || soakLinesWritten >= MAX_SOAK_LINES_PER_PROCESS || !entry.session) return;
  try {
    const now = Date.now();
    const prevTs = rememberSoakSeen(entry.session, now);
    const line = JSON.stringify({
      ts: new Date(now).toISOString(),
      
      
      sessionMs: prevTs === undefined ? 0 : now - prevTs,
      
      rss: Math.round(process.memoryUsage().rss / 1_048_576),
      ...entry,
    }) + "\n";
    const file = soakSegmentPath(resolveSoakLogPath());
    soakLinesWritten += 1;
    await appendFile(file, line, { encoding: "utf8" });
  } catch {

  }
}

function rememberCompactionCount(sessionId: string): number {
  if (!sessionId) return 0;
  const count = (sessionCompactionCounts.get(sessionId) ?? 0) + 1;
  lruSet(sessionCompactionCounts, sessionId, count, {
    moveToFront: true,
    cap: MAX_COMPACTION_MONITORED_SESSIONS,
    onEvict: (key) => sessionInjectedTokens.delete(key as string),
  });
  return count;
}

function rememberInjectedTokens(sessionId: string, tokens: number): void {
  if (!sessionId) return;
  const total = (sessionInjectedTokens.get(sessionId) ?? 0) + tokens;
  if (sessionInjectedTokens.has(sessionId)) sessionInjectedTokens.delete(sessionId);
  sessionInjectedTokens.set(sessionId, total);
}





export const CHECKPOINT_CAP = { completed: 8, remaining: 12, decisions: 5 } as const;




export const SESSION_INDEX_PAGE_SIZE = 100;
export const SESSION_HARD_CEILING_TOKENS = 90_000;
export const INDEX_PAGE_FLOOR = 5;

export function estimateRecordTokens(record: RecordEntry): number {
  return estimateTokensByFactor(record.title?.length ?? 0, PRIORITY_TOKEN_FACTOR) + RECORD_BASE_TOKENS;
}

export function estimateHandoffTokens(handoff: HandoffEntry): number {
  
  
  let total = handoff.task.length * PRIORITY_TOKEN_FACTOR;
  if (handoff.checkpoint) {
    total += handoff.checkpoint.completed.join(" ").length * HANDOFF_CHECKPOINT_FACTOR;
    total += handoff.checkpoint.remaining.join(" ").length * HANDOFF_CHECKPOINT_FACTOR;
    
    
    total +=
      handoff.checkpoint.decisions.map((d) => `${d.title} ${d.detail}`).join(" ").length * HANDOFF_CHECKPOINT_FACTOR;
  }
  return Math.ceil(total);
}

function timestampOf(dateLike: string): number {
  const t = new Date(dateLike).getTime();
  return Number.isFinite(t) ? t : 0;
}

function newestFirst<T extends { timestamp: string; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const t = timestampOf(b.timestamp) - timestampOf(a.timestamp);
    if (t !== 0) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function sliceRange(ids: string[]): string {
  if (ids.length === 0) return "";
  const first = ids[0]!;
  const last = ids[ids.length - 1]!;
  return first === last ? first : `${first}…${last}`;
}



export interface SessionCompactedContext {
  records: RecordEntry[];
  handoffs: HandoffEntry[];
  agentErrors: Record<string, number>;
  getMaxCompactItems: () => number;
  sessionId: string;
  
  seenAgents?: Map<string, Set<string>>;
  
  priorityIndex?: PriorityIndex;
  
  getGoalDigest?: () => string | Promise<string>;

  concordanceText?: string;
}

function buildPriorityIndex(ctx: SessionCompactedContext): ScoredContextEntry[] {
  const result: ScoredContextEntry[] = [];
  const severityRank: Record<string, number> = { critical: 0.5, severe: 0.3, moderate: 0.2, minor: 0.1 };

  for (const r of ctx.records) {
    const lift = severityRank[r.severity ?? ""] ?? 0;
    result.push({
      id: r.id,
      priority: r.severity === "critical" || r.severity === "severe" ? "high" : "normal",
      score: 0.5 + lift,
      tokens: estimateRecordTokens(r),
      protected: false,
      agent: r.agent,
      timestamp: timestampOf(r.timestamp),
      type: "record",
      dependsOn: [],
    });
  }

  for (const h of ctx.handoffs) {
    const isActive = h.status === "pending" || h.status === "accepted";
    result.push({
      id: h.id,
      priority: isActive ? "critical" : "normal",
      score: isActive ? 1.0 : 0.5,
      tokens: estimateHandoffTokens(h),
      protected: isActive,
      agent: h.to,
      timestamp: timestampOf(h.timestamp),
      type: "handoff",
      dependsOn: [],
    });
  }

  
  
  
  if (ctx.priorityIndex && ctx.priorityIndex.size > 0) {
    try {
      for (const e of ctx.priorityIndex.getTopK(ctx.priorityIndex.tokenBudget)) {
        const entry = result.find((x) => x.id === e.id);
        if (entry) entry.score += 0.25;
      }
    } catch {

    }
  }

  return result;
}



export function createSessionCompactedHook(ctx: SessionCompactedContext) {
  
  
  
  
  
  
  
  const K7_MAX_SESSIONS = 200;
  const K7_MAX_BLOCKS = 16;
  const k7Seen = new Map<string, Set<string>>();
  const k7IsRepeat = (sessionId: string, text: string): boolean =>
    sessionId ? (k7Seen.get(sessionId)?.has(text) ?? false) : false;
  const k7Remember = (sessionId: string, text: string): void => {
    if (!sessionId || text.length === 0) return;
    let blocks = k7Seen.get(sessionId);
    if (!blocks) {
      blocks = new Set<string>();
      const owns = blocks;
      lruSet(k7Seen, sessionId, owns, { moveToFront: true, cap: K7_MAX_SESSIONS, onEvict: () => owns.clear() });
    }
    if (blocks.size >= K7_MAX_BLOCKS) blocks.clear();
    blocks.add(text);
  };

  return async (input: { sessionID: string }, output: { context: string[]; prompt?: string }) => {
    try {
      const context: string[] = [];

      
      
      
      
      
      
      
      
      
      
      
      
      try {
        const digest = (await ctx.getGoalDigest?.()) ?? "";
        if (digest.trim().length > 0 && !k7IsRepeat(input.sessionID, digest)) {
          context.push(digest);
          k7Remember(input.sessionID, digest);
        }
      } catch {

      }
      const concordance = ctx.concordanceText ?? SYSTEM_CONCORDANCE_TEXT;
      if (!context.some((s) => s.includes("System Concordance"))) {
        if (!k7IsRepeat(input.sessionID, concordance)) {
          context.push(concordance);
          k7Remember(input.sessionID, concordance);
        }
      }

      
      if (ctx.seenAgents && input.sessionID) {
        ctx.seenAgents.delete(input.sessionID);
      }

      const scoredEntries = buildPriorityIndex(ctx);
      const now = Date.now();

      
      
      const decayed = scoredEntries
        .map((e) => ({ ...e, score: e.score * decayWeight(e.timestamp, now) }))
        .sort((a, b) => b.score - a.score || (a.id < b.id ? 1 : -1));

      const recordsMap = new Map(ctx.records.map((r) => [r.id, r]));
      const handoffsMap = new Map(ctx.handoffs.map((h) => [h.id, h]));

      if (decayed.length > 0) {
        const recordsSection = decayed.filter((e) => e.type === "record");
        const detailRecords = recordsSection.slice(0, K8_DETAIL_CAP);
        if (detailRecords.length > 0) {
          context.push(`### 📋 Session Records (${detailRecords.length} detail)`);
          for (const e of detailRecords) {
            const record = recordsMap.get(e.id);
            if (record) {
              context.push(
                `${severityEmoji(record.severity)} ${record.id} [${record.type}] ${record.title} (${record.agent})`,
              );
            }
          }
          if (recordsSection.length > detailRecords.length) {
            const hidden = recordsSection.slice(K8_DETAIL_CAP).map((e) => e.id);
            context.push(
              `  • +${hidden.length} more records (see record list) · ids ${sliceRange(hidden)}; fetch via \`record(list: true)\``,
            );
          }
        }

        const handoffSection = decayed.filter((e) => e.type === "handoff");
        if (handoffSection.length > 0) {
          context.push(`### 🤝 Handoffs (${handoffSection.length} priority)`);
          for (const e of handoffSection) {
            const h = handoffsMap.get(e.id);
            if (h) {
              context.push(`- ${h.id}: ${h.from} → ${h.to} [${h.status}]: ${h.task}`);
              if (h.checkpoint && (h.status === "pending" || h.status === "accepted")) {
                const totalDone = h.checkpoint.completed.length;
                const totalRemaining = h.checkpoint.remaining.length;
                const totalDecisions = h.checkpoint.decisions.length;
                
                
                
                
                
                context.push(
                  `  📌 Checkpoint: ${totalDone} done, ${totalRemaining} remaining${totalDecisions > 0 ? `, ${totalDecisions} decisions` : ""}`,
                );
                const clippedCompleted = h.checkpoint.completed.slice(-CHECKPOINT_CAP.completed);
                const clippedRemaining = h.checkpoint.remaining.slice(-CHECKPOINT_CAP.remaining);
                const clippedDecisions = h.checkpoint.decisions.slice(-CHECKPOINT_CAP.decisions);
                for (const c of clippedCompleted) context.push(`    ✅ ${c}`);
                for (const r of clippedRemaining) context.push(`    ⏳ ${r}`);
                for (const d of clippedDecisions) context.push(`    🎯 ${d.title}: ${d.detail}`);
                if (totalDone > clippedCompleted.length) {
                  context.push(`    • +${totalDone - clippedCompleted.length} more done (see record)`);
                }
                if (totalRemaining > clippedRemaining.length) {
                  context.push(`    • +${totalRemaining - clippedRemaining.length} more remaining (see record)`);
                }
                if (totalDecisions > clippedDecisions.length) {
                  context.push(`    • +${totalDecisions - clippedDecisions.length} more decisions (see record)`);
                }
              }
            }
          }
        }
      }

      const errs = Object.entries(ctx.agentErrors).filter(([, c]) => c > 0);
      if (errs.length > 0) {
        context.push("### ⚠️ Agent Errors");
        for (const [a, c] of errs) {
          context.push(`- ${a}: ${c} errors`);
        }
      }

      if (context.length > 0) {
        const combined = context.join("\n");

        
        
        
        const sortedRecords = newestFirst(ctx.records);
        const sortedHandoffs = newestFirst(ctx.handoffs);
        const buildIndex = (pageSize: number): string => {
          if (sortedRecords.length === 0 && sortedHandoffs.length === 0) return "";
          const recInline = sortedRecords.slice(0, pageSize);
          const handInline = sortedHandoffs.slice(0, pageSize);
          const lines: string[] = [];
          lines.push("### 🗂️ Session Index (permanent · newest first · paginated)");
          lines.push(`Records: ${sortedRecords.length} · Handoffs: ${sortedHandoffs.length} · ${pageSize}-per-page`);
          for (const r of recInline) lines.push(`- 📄 ${r.id}: ${r.title}`);
          const recHidden = sortedRecords.length - recInline.length;
          if (recHidden > 0) {
            const hiddenIds = sortedRecords.slice(pageSize).map((r) => r.id);
            lines.push(
              `  • +${recHidden} older records (ids ${sliceRange(hiddenIds)}) — fetch via \`record(list: true)\``,
            );
          }
          for (const h of handInline) lines.push(`- 🤝 ${h.id}: ${h.from} → ${h.to} [${h.status}]`);
          const handHidden = sortedHandoffs.length - handInline.length;
          if (handHidden > 0) {
            const hiddenIds = sortedHandoffs.slice(pageSize).map((h) => h.id);
            lines.push(
              `  • +${handHidden} older handoffs (ids ${sliceRange(hiddenIds)}) — completed/archived; continue via the active handoffs above`,
            );
          }
          return lines.join("\n");
        };

        
        
        
        
        const baseTokens = countTokens(combined);
        let indexText = "";
        
        
        let effectiveIndexPageSize = 0;
        if (baseTokens >= SESSION_HARD_CEILING_TOKENS) {
          indexText =
            "### 🗂️ Session Index (paginated — deferred to tools) — `record(list: true)` returns all records; base context is already at the hard ceiling, nothing was removed";
        } else {
          let pageSize = SESSION_INDEX_PAGE_SIZE;
          while (
            pageSize > INDEX_PAGE_FLOOR &&
            countTokens(combined + "\n" + buildIndex(pageSize)) > SESSION_HARD_CEILING_TOKENS
          ) {
            pageSize = Math.max(INDEX_PAGE_FLOOR, pageSize >> 1);
          }
          indexText = buildIndex(pageSize);
          effectiveIndexPageSize = pageSize;
        }
        const finalText = indexText.length > 0 ? combined + "\n" + indexText : combined;

        
        
        
        const compactCount = rememberCompactionCount(input.sessionID);
        rememberInjectedTokens(input.sessionID, countTokens(finalText));
        if (compactCount === 10 || compactCount === 25 || compactCount === 50) {
          logger.warn(
            `[tawassul] S7 shadow: session ${input.sessionID} compacted ${compactCount}×, ` +
              `~${sessionInjectedTokens.get(input.sessionID) ?? 0} tokens injected cumulatively`,
          );
        }
        
        
        
        await appendSoakLine({
          session: input.sessionID,
          compactions: compactCount,
          injectedTokens: sessionInjectedTokens.get(input.sessionID) ?? 0,
          
          baseTokens,
          pageSize: effectiveIndexPageSize,
          headroom: Math.max(0, SESSION_HARD_CEILING_TOKENS - countTokens(finalText)),
          records: ctx.records.length,
          handoffs: ctx.handoffs.length,
        });
        output.context.push(finalText);
      }

      
      
      
      try {
        const outAny = output as { prompt?: string };
        if (!outAny.prompt) {
          const lastHandoff = [...ctx.handoffs]
            .reverse()
            .find((h) => h.status === "pending" || h.status === "accepted");
          
          
          
          const recentDecisions = ctx.records
            .slice(-3)
            .map((r) => r.title.substring(0, 120))
            .join("; ");
          const swarmPrompt = [
            "## Swarm Context (injected at compaction)",
            lastHandoff ? `Task: ${lastHandoff.task.substring(0, 200)}` : "Task: —",
            lastHandoff?.checkpoint?.filesChanged?.length
              ? `Files: ${lastHandoff.checkpoint.filesChanged.slice(0, 5).join(", ")}`
              : "",
            recentDecisions ? `Decisions: ${recentDecisions}` : "",
            "Next: continue from checkpoint.remaining",
          ]
            .filter(Boolean)
            .join("\n");
          outAny.prompt = swarmPrompt;
          
          
          rememberInjectedTokens(input.sessionID, countTokens(swarmPrompt));
        }
      } catch {

      }
    } catch (e) {
      logger.error("experimental.session.compacting hook error:", e instanceof Error ? e.stack : e);
    }
  };
}
