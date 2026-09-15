
import type { PipelineState } from "../../PipelineState.ts";
import type { Input, StageOutput } from "./types.ts";

import { INVISIBLE_CHARS_RE, normalizeName } from "../../../utils/name-utils.ts";
import { logger } from "../../../utils/logger.ts";

export { INVISIBLE_CHARS_RE, normalizeName };


export function detectTawaCalls(args: Record<string, unknown>): string[] | null {
  const isTawa = (v: unknown) => normalizeName(v) === "tawa";
  const found: string[] = [];
  for (const field of ["subagent", "agent", "desc", "type", "to", "model"] as const) {
    if (isTawa(args[field])) found.push(field);
    if (Array.isArray(args[field]) && (args[field] as unknown[]).some(isTawa)) found.push(`${field}[]`);
  }
  if (typeof args?.parallelCopies === "number" && args.parallelCopies > 0) found.push("parallelCopies");
  for (const key of Object.keys(args)) {
    const val = args[key];
    if (typeof val === "string" && isTawa(val)) {
      if (!found.includes(key)) found.push(`${key}⚠️`);
    }
  }
  return found.length > 0 ? found : null;
}

export const getCurrentAgent = (input: Input) => normalizeName(input.agent);


const ROOT_LIKE_VALUES: ReadonlySet<string> = new Set(["", "undefined", "root", "user"]);
const ROOT_LIKE_CLAIMS_AUDITED: Set<string> = new Set();
const MAX_ROOT_LIKE_AUDITS = 16;

export function isRootLikeAgent(agent?: string): boolean {
  if (agent === undefined) return true;
  const normalized = normalizeName(agent);
  const rootLike = ROOT_LIKE_VALUES.has(normalized);
  if (rootLike && normalized !== "" && normalized !== "undefined") {
    if (!ROOT_LIKE_CLAIMS_AUDITED.has(normalized) && ROOT_LIKE_CLAIMS_AUDITED.size < MAX_ROOT_LIKE_AUDITS) {
      ROOT_LIKE_CLAIMS_AUDITED.add(normalized);
      logger.audit("ROOT_LIKE_AGENT_CLAIMED", { agent: normalized });
    }
  }
  return rootLike;
}

export function isNonRootCycle(sessionId: string, target: string, p: PipelineState): boolean {
  const chain = p.dispatchChain.get(sessionId);
  return !!chain && chain.length > 0 && chain.includes(target) && target !== chain[0];
}

export function getTaskAgents(output: StageOutput): { allRaw: string[]; agents: Set<string> } {
  const allRaw: string[] = [];
  const add = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach(add);
      return;
    }
    const n = normalizeName(v);
    if (n) allRaw.push(n);
  };
  add(output.args?.subagent);
  add(output.args?.agent);
  const d = output.args?.desc;
  if (typeof d === "string" && d.trim()) {
    const words = d.trim().split(/\s+/);
    if (words.length === 1) allRaw.push(normalizeName(words[0]));
  } else if (Array.isArray(d)) {
    for (const item of d) {
      if (typeof item === "string" && item.trim()) {
        const words = item.trim().split(/\s+/);
        if (words.length === 1) allRaw.push(normalizeName(words[0]));
      }
    }
  }
  return { allRaw, agents: new Set(allRaw.filter(Boolean)) };
}


export function extractTaskTargets(args: Record<string, unknown>): string[] {
  const targets: string[] = [];
  const add = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach(add);
      return;
    }
    const n = normalizeName(v);
    if (n) targets.push(n);
  };
  add(args?.subagent);
  add(args?.agent);
  const d = args?.desc;
  if (typeof d === "string" && d.trim()) {
    const words = d.trim().split(/\s+/);
    if (words.length === 1) targets.push(normalizeName(words[0]));
  } else if (Array.isArray(d)) {
    for (const item of d) {
      if (typeof item === "string" && item.trim()) {
        const words = item.trim().split(/\s+/);
        if (words.length === 1) targets.push(normalizeName(words[0]));
      }
    }
  }
  return targets;
}

export function getDispatchTargets(input: Input, output: StageOutput): string[] {
  if (input.tool === "task") return getTaskAgents(output).allRaw;
  if (input.tool === "handoff" || input.tool === "fasttrack") {
    const to = output.args?.to;
    const n = normalizeName(to);
    return n ? [n] : [];
  }
  return [];
}

export function isTawaAgent(agent?: string) {
  return normalizeName(agent) === "tawa";
}


export function targetsAreExploreOrGeneral(targets: string[]): boolean {
  return targets.length > 0 && targets.every((t) => t === "explore" || t === "general");
}
