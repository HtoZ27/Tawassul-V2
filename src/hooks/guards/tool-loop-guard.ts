import { logger } from "../../utils/logger.ts";
import { normalizeName } from "../../utils/name-utils.ts";






export const EXACT_FAILURE_BLOCK_AFTER = 3;
export const SAME_TOOL_FAILURE_HALT_AFTER = 5;
export const NO_PROGRESS_BLOCK_AFTER = 5;
export const REPEAT_RESULT_WARN_AT = 3;
export const REPEAT_RESULT_BLOCK_AT = 4;

export const REPEAT_BLOCK_TOOLS: readonly string[] = ["read", "grep", "glob"];

const _failureCounts = new Map<string, Map<string, number>>();
const _noProgressCounts = new Map<string, number>();
const _repeatResults = new Map<string, { signature: string; result: string; count: number }>();


const _killSwitched = new Map<string, number>();





const KILL_TTL_MS = 30 * 60 * 1000; 

const BYPASS_ALL =
  typeof process !== "undefined" &&
  (process.env?.TAWASSUL_DISABLE_TOOL_GUARD === "1" || process.env?.TAWASSUL_DISABLE_TOOL_GUARD === "true");

export function emergencyKill(agent: string, reason: string): void {
  _killSwitched.set(normalizeName(agent), Date.now());
  logger.audit("TOOL_LOOP_KILL", { agent, reason });
}

export function liftKill(agent: string): void {
  _killSwitched.delete(normalizeName(agent));
  logger.audit("TOOL_LOOP_LIFT", { agent });
}

export function resetToolLoopState(): void {
  _failureCounts.clear();
  _noProgressCounts.clear();
  _repeatResults.clear();
  _killSwitched.clear();
}

const MAX_AGENT_ENTRIES = 200;
const MAX_KILL_SWITCHED = 50;
const MAX_REPEAT_ENTRIES = 400;
let _lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 300_000;

export function sweepStaleEntries(): void {
  const now = Date.now();
  if (now - _lastSweep < SWEEP_INTERVAL_MS) return;
  _lastSweep = now;
  if (_failureCounts.size > MAX_AGENT_ENTRIES) {
    const keys = [..._failureCounts.keys()].slice(0, _failureCounts.size - MAX_AGENT_ENTRIES);
    for (const k of keys) _failureCounts.delete(k);
  }
  if (_noProgressCounts.size > MAX_AGENT_ENTRIES) {
    const keys = [..._noProgressCounts.keys()].slice(0, _noProgressCounts.size - MAX_AGENT_ENTRIES);
    for (const k of keys) _noProgressCounts.delete(k);
  }
  
  if (_killSwitched.size > 0) {
    const now = Date.now();
    for (const [k, at] of _killSwitched) {
      if (now - at >= KILL_TTL_MS) _killSwitched.delete(k);
    }
  }
  if (_killSwitched.size > MAX_KILL_SWITCHED) {
    const excess = _killSwitched.size - MAX_KILL_SWITCHED;
    const oldest = [..._killSwitched.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, excess)
      .map(([k]) => k);
    for (const v of oldest) _killSwitched.delete(v);
    logger.debug(`[tawassul] tool-loop sweep: evicted ${oldest.length} oldest kill-switched entries`);
  }
}

function normalizeAgent(agent: string): string {
  return normalizeName(agent);
}

function getFailureMap(agent: string): Map<string, number> {
  const key = normalizeAgent(agent);
  let m = _failureCounts.get(key);
  if (!m) {
    m = new Map();
    _failureCounts.set(key, m);
  }
  return m;
}

export function recordToolFailure(agent: string, tool: string): void {
  const fm = getFailureMap(agent);
  const exactKey = `${tool}:fail`;
  const exactCount = (fm.get(exactKey) ?? 0) + 1;
  fm.set(exactKey, exactCount);

  const toolCount = (fm.get(tool) ?? 0) + 1;
  fm.set(tool, toolCount);

  logger.debug(`[tawassul] tool-loop: ${agent} ${tool} failure #${toolCount} (exact #${exactCount})`);
}

export function recordToolSuccess(agent: string, tool: string): void {
  const fm = getFailureMap(agent);
  fm.delete(`${tool}:fail`);
  fm.delete(tool);
  if (fm.size === 0) _failureCounts.delete(normalizeAgent(agent));
  _noProgressCounts.delete(normalizeAgent(agent));
}

export function recordNoProgress(agent: string): void {
  const key = normalizeAgent(agent);
  const npCount = (_noProgressCounts.get(key) ?? 0) + 1;
  _noProgressCounts.set(key, npCount);
}

export function resultSignature(output: unknown): string {
  if (typeof output !== "string") return "";
  if (output.length <= 4096) return `${output.length}:${output}`;
  return `${output.length}:${output.slice(0, 2048)}:${output.slice(-2048)}`;
}

export function recordToolResult(
  agent: string,
  tool: string,
  signature: string,
  result: string,
): number {
  if (BYPASS_ALL) return 0;
  const key = `${normalizeAgent(agent)}\u0000${tool}`;
  const previous = _repeatResults.get(key);
  if (!previous || previous.signature !== signature || previous.result !== result) {
    _repeatResults.delete(key);
    _repeatResults.set(key, { signature, result, count: 1 });
    if (_repeatResults.size > MAX_REPEAT_ENTRIES) {
      const oldest = _repeatResults.keys().next().value;
      if (oldest !== undefined) _repeatResults.delete(oldest);
    }
    return 1;
  }
  previous.count += 1;
  _repeatResults.set(key, previous);
  return previous.count;
}

export function repeatResultCount(agent: string, tool: string, signature: string): number {
  const previous = _repeatResults.get(`${normalizeAgent(agent)}\u0000${tool}`);
  if (!previous || previous.signature !== signature) return 0;
  return previous.count;
}

export function resetToolResultRun(agent: string, tool: string): void {
  _repeatResults.delete(`${normalizeAgent(agent)}\u0000${tool}`);
}

export function repeatResultWarning(tool: string, count: number): string {
  return (
    `\n\n[tawassul] loop guard: "${tool}" returned an identical result ${count} consecutive times. ` +
    "Stop repeating this call and change approach: read a different region, refine the query, " +
    "or report the block instead of retrying the same input."
  );
}

export function isRepeatResultBlocked(agent: string, tool: string, signature: string): string | null {
  if (BYPASS_ALL) return null;
  if (!REPEAT_BLOCK_TOOLS.includes(tool)) return null;
  const count = repeatResultCount(agent, tool, signature);
  if (count < REPEAT_RESULT_BLOCK_AT) return null;
  return (
    `🚫 Tool "${tool}" returned an identical result ${count} consecutive times for "${agent}" — ` +
    `refusing the same input again (limit ${REPEAT_RESULT_BLOCK_AT})`
  );
}

export function isToolLoopBlocked(agent: string, tool: string, signature?: string): string | null {
  if (BYPASS_ALL) return null;
  const key = normalizeAgent(agent);
  if (signature !== undefined) {
    const repeat = isRepeatResultBlocked(agent, tool, signature);
    if (repeat) return repeat;
  }
  
  
  const killAt = _killSwitched.get(key);
  if (killAt !== undefined) {
    if (Date.now() - killAt >= KILL_TTL_MS) {
      _killSwitched.delete(key);
    } else {
      return `🚫 [EMERGENCY KILL] agent "${agent}" manually stopped — kill-switch exceeded`;
    }
  }
  const fm = getFailureMap(agent);
  const exactKey = `${tool}:fail`;
  const exactCount = fm.get(exactKey) ?? 0;
  if (exactCount >= EXACT_FAILURE_BLOCK_AFTER) {
    return `🚫 Tool "${tool}" failed ${exactCount} consecutive times for "${agent}" — exceeded limit ${EXACT_FAILURE_BLOCK_AFTER}`;
  }

  const toolCount = fm.get(tool) ?? 0;
  if (toolCount >= SAME_TOOL_FAILURE_HALT_AFTER) {
    return `🚫 Tool "${tool}" failed ${toolCount} times for "${agent}" — exceeded limit ${SAME_TOOL_FAILURE_HALT_AFTER}`;
  }

  const npCount = _noProgressCounts.get(normalizeAgent(agent)) ?? 0;
  if (npCount >= NO_PROGRESS_BLOCK_AFTER) {
    return `🚫 Agent "${agent}" made no progress after ${npCount} attempts — exceeded limit ${NO_PROGRESS_BLOCK_AFTER}`;
  }

  return null;
}
