
import { RecordEntrySchema, HandoffEntrySchema, AgentRatingSchema } from "../validation.ts";
import { isFreeOfPrototypePollution } from "../context/migration.ts";
import { FeatureIndex } from "./feature-index.ts";
import { isIsolationActiveSync } from "./isolation.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { logger } from "../utils/logger.ts";

export type WalStateData = {
  records: import("../context/types.ts").RecordEntry[];
  handoffs: import("../context/types.ts").HandoffEntry[];
  recSeq: number;
  hoffSeq: number;
  agentErrors: Record<string, number>;
  agentRatings: Record<string, Record<string, unknown>>;
  dynamicAgents: string[];
  agentModelMap: Record<string, string>;
  pauseState?: import("../tools/index.ts").PauseState | null;
};

export async function walReplay(stateDir: string, stateData: WalStateData): Promise<boolean> {
  if (!stateDir) return false;
  const fp = resolve(stateDir, ".opencode", "state.wal");
  try {
    const raw = await readFile(fp, "utf-8");
    const wal = JSON.parse(raw) as Record<string, unknown>;
    if (!wal || typeof wal !== "object") return false;
    if (!isFreeOfPrototypePollution(wal)) {
      logger.warn("BLOCKED: Prototype pollution detected in WAL file, rejecting");
      
      
      if (!isIsolationActiveSync()) {
        try {
          await unlink(fp);
        } catch {

        }
      }
      return false;
    }
    if (Array.isArray(wal.records)) {
      stateData.records.length = 0;
      for (const r of wal.records) {
        const parsed = RecordEntrySchema.safeParse(r);
        if (parsed.success) stateData.records.push(parsed.data);
        else logger.warn("WAL: skipping invalid record entry (schema mismatch)");
      }
    }
    if (Array.isArray(wal.handoffs)) {
      stateData.handoffs.length = 0;
      for (const h of wal.handoffs) {
        const parsed = HandoffEntrySchema.safeParse(h);
        if (parsed.success) stateData.handoffs.push(parsed.data);
        else logger.warn("WAL: skipping invalid handoff entry (schema mismatch)");
      }
    }
    if (typeof wal.recSeq === "number") stateData.recSeq = wal.recSeq;
    if (typeof wal.hoffSeq === "number") stateData.hoffSeq = wal.hoffSeq;
    if (wal.agentErrors && typeof wal.agentErrors === "object") {
      for (const [k, v] of Object.entries(wal.agentErrors)) {
        stateData.agentErrors[normalizeName(k)] = v as number;
      }
    }
    if (wal.agentRatings && typeof wal.agentRatings === "object") {
      for (const [agent, rating] of Object.entries(wal.agentRatings as Record<string, unknown>)) {
        const parsed = AgentRatingSchema.safeParse(rating);
        if (parsed.success) stateData.agentRatings[normalizeName(agent)] = parsed.data;
        else logger.warn(`WAL: skipping invalid agentRating for ${agent}`);
      }
    }
    if (Array.isArray(wal.dynamicAgents))
      stateData.dynamicAgents = [
        ...new Set(
          wal.dynamicAgents
            .filter((a): a is string => typeof a === "string")
            .map((n) => normalizeName(n))
            .filter(Boolean),
        ),
      ];
    if (wal.agentModelMap && typeof wal.agentModelMap === "object") {
      for (const [k, v] of Object.entries(wal.agentModelMap as Record<string, string>)) {
        stateData.agentModelMap[normalizeName(k)] = v;
      }
    }
    if (wal.pauseState && typeof wal.pauseState === "object")
      stateData.pauseState = wal.pauseState as import("../tools/index.ts").PauseState;
    const recCount = Array.isArray(wal.records) ? wal.records.length : 0;
    const hoffCount = Array.isArray(wal.handoffs) ? wal.handoffs.length : 0;
    logger.debug(`WAL replayed: ${recCount} records, ${hoffCount} handoffs`);
    
    
    if (!isIsolationActiveSync()) {
      try {
        await unlink(fp);
      } catch {

      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function loadFeatureIndex(stateDir: string): Promise<FeatureIndex | null> {
  const fiPath = resolve(stateDir, ".opencode", "feature-index.json");
  try {
    if (!existsSync(fiPath)) return null;
    const raw = await readFile(fiPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!isFreeOfPrototypePollution(data)) {
      logger.warn("BLOCKED: Prototype pollution detected in feature-index, skipping");
      return null;
    }
    if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).entries)) {
      return FeatureIndex.fromJSON(data as Parameters<typeof FeatureIndex.fromJSON>[0]);
    }
    logger.warn("FeatureIndex load skipped: unexpected shape");
    return null;
  } catch (e) {
    logger.warn("FeatureIndex load failed:", e);
    return null;
  }
}
