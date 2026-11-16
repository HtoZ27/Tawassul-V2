
import type { TawassulContext } from "../context-class.ts";
import type { EventHub, TawassulEvent } from "../services/event-hub.ts";

export interface MemoryEventIntegrationDeps {
  tawaCtx: TawassulContext;
  eventHub: EventHub;
  cacheClear: () => Promise<number>;
  codeState: { reset: () => void | Promise<void> };
}

const SYSTEM_PAUSE_PREFIX = "memory pressure";

export function registerMemoryEventIntegrations(deps: MemoryEventIntegrationDeps): { stop: () => void } {
  const { tawaCtx, eventHub, cacheClear, codeState } = deps;

  const runCleanup = async (): Promise<void> => {
    tawaCtx.readCache?.evictAll();
    try {
      await cacheClear();
    } catch {

    }
    try {
      codeState.reset();
    } catch {

    }
  };

  const isSystemMemoryPause = (): boolean =>
    tawaCtx.pauseState?.pausedBy === "system" && (tawaCtx.pauseState?.reason ?? "").startsWith(SYSTEM_PAUSE_PREFIX);

  const setSystemPause = (reason: string): void => {
    tawaCtx.pauseState = {
      active: true,
      reason,
      pausedAt: new Date().toISOString(),
      pausedBy: "system",
      scope: "all",
      affectedHandoffs: [],
    };
  };

  const onCleanupRequested = (e: TawassulEvent): void => {
    if (e.type !== "CACHE_CLEANUP_REQUESTED") return;
    void runCleanup();
    if (tawaCtx.memoryWatchdog.gate.isBlocked() && !tawaCtx.pauseState?.active) {
      setSystemPause(`${SYSTEM_PAUSE_PREFIX} — heavy tools blocked (rss ${Math.round(e.value)}MB)`);
    }
  };

  const onEmergency = (e: TawassulEvent): void => {
    if (e.type !== "MEMORY_EMERGENCY") return;
    
    void (async () => {
      await runCleanup();
      tawaCtx.projectIndex?.evictMemory();
      if (!tawaCtx.pauseState?.active) {
        setSystemPause(`${SYSTEM_PAUSE_PREFIX} — emergency (rss ${Math.round(e.value)}MB)`);
      }
    })();
  };

  const onRecovered = (e: TawassulEvent): void => {
    if (e.type !== "MEMORY_RECOVERED") return;
    if (isSystemMemoryPause() && !tawaCtx.memoryWatchdog.gate.isBlocked()) {
      tawaCtx.pauseState = null;
    }
  };

  eventHub.on("CACHE_CLEANUP_REQUESTED", onCleanupRequested);
  eventHub.on("MEMORY_EMERGENCY", onEmergency);
  eventHub.on("MEMORY_RECOVERED", onRecovered);

  return {
    stop: () => {
      eventHub.off("CACHE_CLEANUP_REQUESTED", onCleanupRequested as (...args: unknown[]) => void);
      eventHub.off("MEMORY_EMERGENCY", onEmergency as (...args: unknown[]) => void);
      eventHub.off("MEMORY_RECOVERED", onRecovered as (...args: unknown[]) => void);
    },
  };
}
