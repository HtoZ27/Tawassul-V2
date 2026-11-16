

import { STATE_VERSION } from "./constants.ts";
import { logger } from "../utils/logger.ts";
import { normalizeName } from "../utils/name-utils.ts";

type MigrationFn = (data: Record<string, unknown>) => Record<string, unknown>;


export const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isFreeOfPrototypePollution(obj: unknown, depth = 0): boolean {
  if (depth > 10 || typeof obj !== "object" || obj === null) return true;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (!isFreeOfPrototypePollution(item, depth + 1)) return false;
    }
    return true;
  }
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) return false;
    if (!isFreeOfPrototypePollution((obj as Record<string, unknown>)[key], depth + 1)) return false;
  }
  return true;
}

export const STATE_MIGRATIONS: Record<number, MigrationFn> = {
  1: (data) => {
    if (!Array.isArray(data.records)) data.records = [];
    if (!Array.isArray(data.handoffs)) data.handoffs = [];
    if (!Array.isArray(data.dynamicAgents)) data.dynamicAgents = [];
    if (typeof data.recSeq !== "number") data.recSeq = 0;
    if (typeof data.hoffSeq !== "number") data.hoffSeq = 0;
    if (!data.agentErrors || typeof data.agentErrors !== "object") data.agentErrors = {};
    if (!data.agentRatings || typeof data.agentRatings !== "object") data.agentRatings = {};
    if (!data.agentModelMap || typeof data.agentModelMap !== "object") data.agentModelMap = {};
    if (!data.sharedMemory || typeof data.sharedMemory !== "object") {
      data.sharedMemory = {
        decisions: [],
        learnings: [],
        warnings: [],
        handoffHistory: [],
        agentContext: {},
        fileContext: {},
      };
    }
    return data;
  },
  2: (data) => {
    if (data.pauseState === undefined) data.pauseState = null;
    if (!data.messages || typeof data.messages !== "object") data.messages = {};
    if (typeof data.msgSeq !== "number") data.msgSeq = 0;
    if (Array.isArray(data.handoffs)) {
      for (const h of data.handoffs) {
        if (h.status === "paused") h.status = "pending";
      }
    }
    return data;
  },
  3: (data) => {
    delete data.messages;
    delete data.msgSeq;
    if (data.sessionData && typeof data.sessionData === "object") {
      for (const sData of Object.values(data.sessionData as Record<string, unknown>)) {
        if (sData && typeof sData === "object") {
          delete (sData as Record<string, unknown>).messages;
          delete (sData as Record<string, unknown>).msgSeq;
        }
      }
    }
    return data;
  },
  4: (data) => {
    
    
    if (Array.isArray(data.records)) {
      for (const r of data.records) {
        if (r && typeof r === "object" && !("provenance" in r)) {
          (r as Record<string, unknown>).provenance = "agent_inferred";
        }
      }
    }
    return data;
  },
  5: (data) => {
    const handoffs = Array.isArray(data.handoffs) ? data.handoffs : [];
    const cancelledBySender = new Map<string, number>();
    for (const entry of handoffs) {
      if (!entry || typeof entry !== "object") continue;
      const handoff = entry as Record<string, unknown>;
      if (handoff.status !== "cancelled") continue;
      const sender = normalizeName(handoff.from);
      if (!sender) continue;
      cancelledBySender.set(sender, (cancelledBySender.get(sender) ?? 0) + 1);
    }
    const ratings = data.agentRatings;
    if (ratings && typeof ratings === "object" && !Array.isArray(ratings)) {
      for (const [agent, value] of Object.entries(ratings as Record<string, unknown>)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const rating = value as Record<string, unknown>;
        const dropped = typeof rating.handoffsDropped === "number" ? rating.handoffsDropped : 0;
        const falseDrops = cancelledBySender.get(normalizeName(agent)) ?? 0;
        if (dropped > 0 && falseDrops > 0) {
          rating.handoffsDropped = Math.max(0, dropped - falseDrops);
        }
      }
    }
    return data;
  },
};

export function migrateStateData(data: Record<string, unknown>): Record<string, unknown> {
  
  if (!isFreeOfPrototypePollution(data)) {
    logger.warn("BLOCKED: Prototype pollution detected during migration, aborting");
    return {
      version: STATE_VERSION,
      records: [],
      handoffs: [],
      recSeq: 0,
      hoffSeq: 0,
      agentErrors: {},
      agentRatings: {},
      dynamicAgents: [],
      agentModelMap: {},
    };
  }

  const currentVersion = (data.version as number) ?? 0;
  if (currentVersion >= STATE_VERSION) return data;

  logger.debug(`Migrating state from v${currentVersion} to v${STATE_VERSION}...`);
  let migrated = { ...data };

  for (let v = currentVersion; v < STATE_VERSION; v++) {
    const migration = STATE_MIGRATIONS[v + 1];
    if (migration) {
      try {
        migrated = migration(migrated);
        migrated.version = v + 1;
        logger.debug(`Migration v${v} → v${v + 1} applied successfully`);
      } catch (e) {
        logger.warn(`Migration v${v} → v${v + 1} failed:`, e);
        return data;
      }
    }
  }

  migrated.version = STATE_VERSION;
  return migrated;
}


export function replaceLegacyEncryptedFields(
  data: Record<string, unknown>,
  fields: Array<{ key: string; fallback: unknown }>,
  label: string,
): void {
  for (const { key, fallback } of fields) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      ((value as Record<string, unknown>).__encrypted__ ||
        (typeof (value as Record<string, unknown>).iv === "string" &&
          typeof (value as Record<string, unknown>).ciphertext === "string" &&
          typeof (value as Record<string, unknown>).tag === "string"))
    ) {
      data[key] = fallback;
      logger.warn(`${label} field '${key}' was encrypted with old AES key — replacing with empty default`);
    }
  }
}
