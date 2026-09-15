import { logger } from "../utils/logger.ts";
import { normalizeName } from "../utils/name-utils.ts";

type AgentState = {
  lastToolStart: number;
  lastToolEnd: number;
  lastToolName: string;
  idle: boolean;
};

const IDLE_THRESHOLD_MS = 450_000;
const IN_TOOL_THRESHOLD_MS = 1_200_000;
const SWEEP_TTL_MS = 1_800_000; 

const _states = new Map<string, AgentState>();
let _lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 300_000; 

export function start(agentId: string, toolName: string): void {
  const now = Date.now();
  const key = normalizeName(agentId);
  const existing = _states.get(key);
  
  _states.set(key, {
    lastToolStart: now,
    lastToolEnd: existing?.lastToolEnd ?? now,
    lastToolName: toolName,
    idle: false,
  });
  logger.debug(`[tawassul] heartbeat: ${key} started ${toolName}`);
}

export function check(agentId: string, toolName: string): { stale: boolean; reason?: string } {
  const key = normalizeName(agentId);
  const state = _states.get(key);
  if (!state) return { stale: false };

  const now = Date.now();

  
  const idleTime = now - state.lastToolEnd;
  if (idleTime > IDLE_THRESHOLD_MS) {
    state.idle = true;
    state.lastToolEnd = now;
    state.lastToolName = toolName;
    logger.warn(`[tawassul] heartbeat: ${agentId} stale idle (${idleTime}ms)`);
    return { stale: true, reason: `idle timeout: ${idleTime}ms > ${IDLE_THRESHOLD_MS}ms` };
  }

  
  const inToolTime = now - state.lastToolStart;
  if (inToolTime > IN_TOOL_THRESHOLD_MS) {
    state.idle = true;
    state.lastToolEnd = now;
    state.lastToolName = toolName;
    logger.warn(`[tawassul] heartbeat: ${agentId} stale in-tool (${inToolTime}ms)`);
    return { stale: true, reason: `in-tool timeout: ${inToolTime}ms > ${IN_TOOL_THRESHOLD_MS}ms` };
  }

  
  state.lastToolEnd = now;
  state.lastToolName = toolName;
  state.idle = false;
  return { stale: false };
}

export function stop(agentId: string): void {
  _states.delete(normalizeName(agentId));
  logger.debug(`[tawassul] heartbeat: ${agentId} stopped`);
}

export function sweepStaleStates(): void {
  const now = Date.now();
  if (now - _lastSweep < SWEEP_INTERVAL_MS) return;
  _lastSweep = now;
  if (_states.size === 0) return;
  for (const [id, state] of _states) {
    if (now - state.lastToolStart > SWEEP_TTL_MS) {
      _states.delete(id);
      logger.debug(`[tawassul] heartbeat sweep: removed stale state for ${id}`);
    }
  }
}

export function resetAll(): void {
  _states.clear();
}
