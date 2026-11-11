import { resolve, basename } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { normalizeName } from "../utils/name-utils.ts";
import { logger } from "../utils/logger.ts";
import type { TawassulContext } from "../context.ts";
import { SCOPE } from "./agent-management.ts";
import { resolveAgentsDir, resolveTawassulConfigPath, resolveActiveConfigPath } from "../utils/path-resolver.ts";
import { resolveSafePath, resolveSafePathSync } from "../utils/path.ts";
import {
  stripJsoncComments,
  spliceAgentSection,
  readTawassulRoster,
  writeTawassulRoster,
} from "../utils/opencode-config.ts";
import { atomicWriteFile } from "../utils/atomic.ts";
import { t } from "../translations.ts";
import type { KickResult } from "./agent-kick-helpers.ts";


export function dropAgentState(ctx: TawassulContext, tag: string): void {
  const normalized = normalizeName(tag);
  const idx = ctx.dynamicAgents.indexOf(normalized);
  if (idx >= 0) ctx.dynamicAgents.splice(idx, 1);
  delete ctx.agentRatings[normalizeName(tag)];
  delete ctx.agentModelMap[normalizeName(tag)];
  delete ctx.errorManager.agentErrors[normalizeName(tag)];
  for (const sessionSet of ctx.seenAgents.values()) {
    sessionSet.delete(tag);
  }
  for (const [, h] of ctx.handoffs) {
    if (
      h.status === "pending" &&
      (normalizeName(h.from) === normalizeName(tag) || normalizeName(h.to) === normalizeName(tag))
    ) {
      h.status = "cancelled";
      logger.debug(`Cancelled handoff ${h.id} (agent ${tag} was removed)`);
    }
  }
}


export function removeAgentMd(ctx: TawassulContext, spec: string): void {
  try {
    const agentsDir = resolveAgentsDir(ctx.stateDir, SCOPE);
    const mdPath = resolve(agentsDir, `${normalizeName(spec)}.md`);
    const safeMdPath = resolveSafePathSync(mdPath, agentsDir);
    if (safeMdPath && existsSync(safeMdPath)) unlinkSync(safeMdPath);
  } catch (e) {
    logger.warn("Failed to delete agent MD file:", e);
  }
}

export async function removeAgentsFromConfig(ctx: TawassulContext, specs: string[]): Promise<void> {
  if (SCOPE === "global") {
    const rosterPath = resolveTawassulConfigPath(ctx.stateDir, "global");
    let rosterData;
    try {
      const { roster } = readTawassulRoster(rosterPath);
      rosterData = roster;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    let changed = false;
    for (const spec of specs) {
      const normalized = normalizeName(spec);
      if (rosterData.agents[spec] !== undefined) {
        delete rosterData.agents[spec];
        changed = true;
        continue;
      }
      if (rosterData.agents[normalized] !== undefined) {
        delete rosterData.agents[normalized];
        changed = true;
        continue;
      }
      const key = Object.keys(rosterData.agents).find((k) => normalizeName(k) === normalized);
      if (key) {
        delete rosterData.agents[key];
        changed = true;
      }
    }
    if (changed) {
      await writeTawassulRoster(rosterPath, rosterData);
    }
    return;
  }
  const cfgPath = resolveActiveConfigPath(ctx.stateDir, SCOPE);
  const cfgName = basename(cfgPath);
  const opencodePath = cfgPath;
  const safeOpencodePath = await resolveSafePath(opencodePath, ctx.stateDir);
  if (!safeOpencodePath) {
    throw new Error("kick: opencode path escapes stateDir — refusing to write");
  }
  let raw: string;
  try {
    raw = await readFile(opencodePath, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("kick: project config is missing — refusing to write");
    }
    throw e;
  }
  const conf = JSON.parse(cfgName.endsWith(".jsonc") ? stripJsoncComments(raw) : raw);
  if (!conf.agent || typeof conf.agent !== "object" || Array.isArray(conf.agent)) {
    throw new Error(`kick: ${cfgName} has no usable "agent" object — refusing to write (config may be corrupted)`);
  }
  let changed = false;
  for (const spec of specs) {
    const normalized = normalizeName(spec);
    if (conf.agent[spec]) {
      delete conf.agent[spec];
      changed = true;
    } else if (conf.agent[normalized]) {
      delete conf.agent[normalized];
      changed = true;
    } else {
      const key = Object.keys(conf.agent).find((k) => normalizeName(k) === normalized);
      if (key) {
        delete conf.agent[key];
        changed = true;
      }
    }
  }
  if (changed) {
    await atomicWriteFile(opencodePath, spliceAgentSection(raw, conf.agent));
  }
}

export function formatKickResult(result: KickResult): string {
  const lines: string[] = [];
  if (result.removed.length > 0) {
    lines.push(t("kickRemoved", { count: String(result.removed.length) }));
    for (const tag of result.removed) {
      lines.push(`   ${tag}`);
    }
  }
  if (result.alreadyDeleted.length > 0) {
    lines.push(t("kickAlreadyDeleted", { list: result.alreadyDeleted.join(", ") }));
  }
  if (result.protected_.length > 0) {
    lines.push(t("kickProtected", { list: result.protected_.join(", ") }));
  }
  if (result.notFound.length > 0) {
    lines.push(t("kickNotFound", { list: result.notFound.join(", ") }));
  }
  if (
    result.removed.length === 0 &&
    result.protected_.length === 0 &&
    result.notFound.length > 0 &&
    result.alreadyDeleted.length === 0
  ) {
    return t("kickNotFound", { list: result.notFound.join(", ") });
  }
  return lines.join("\n");
}
