






const PLAN_MODE_BLOCKED_TOOLS = new Set([
  "write", "edit", "bash",
]);

const MAX_TASK_CALLS_PER_SESSION = 3;
const SESSION_TTL_MS = 30 * 60 * 1000; 
const taskCallCount = new Map<string, { count: number; lastAccess: number }>();

function evictStaleSessions(): void {
  const now = Date.now();
  for (const [key, value] of taskCallCount) {
    if (now - value.lastAccess > SESSION_TTL_MS) {
      taskCallCount.delete(key);
    }
  }
}

export function checkPlanModeAllowed(tool: string): { allowed: boolean; error?: string } {
  if (PLAN_MODE_BLOCKED_TOOLS.has(tool)) {
    return {
      allowed: false,
      error: "🔵 **Plan mode active**: read-only. Switch to **Build** mode (Tab) for file modifications.",
    };
  }
  return { allowed: true };
}

export function canSpawnTask(sessionId: string): boolean {
  evictStaleSessions();
  const entry = taskCallCount.get(sessionId);
  const current = entry?.count ?? 0;
  if (current >= MAX_TASK_CALLS_PER_SESSION) return false;
  taskCallCount.set(sessionId, { count: current + 1, lastAccess: Date.now() });
  return true;
}

export function resetTaskCallCount(sessionId: string): void {
  taskCallCount.delete(sessionId);
}
