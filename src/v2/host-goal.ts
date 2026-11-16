import {
  HostGoalMirror,
  setActiveHostGoalMirror,
  type HostGoalChange,
  type HostGoalSource,
} from "../services/host-goal.ts";
import { logger } from "../utils/logger.ts";
import type { V2Context } from "./types.ts";

const passThroughSchema = {
  "~standard": {
    version: 1 as const,
    vendor: "tawassul",
    validate: (value: unknown) => ({ value }),
  },
};

const GOAL_DEFINITION = {
  id: "opencode.goal",
  methods: {
    get: { input: passThroughSchema, output: passThroughSchema },
  },
  events: {
    changed: { schema: passThroughSchema },
  },
};

type GoalRpcClient = {
  get: (input: { sessionID: string }) => Promise<unknown>;
  events: {
    on: (name: string, handler: (event: unknown) => void) => () => void;
  };
};

function goalClient(ctx: V2Context): GoalRpcClient | null {
  const rpc = ctx.rpc;
  if (typeof rpc !== "function") return null;
  try {
    const client = rpc(GOAL_DEFINITION) as unknown as GoalRpcClient;
    if (!client || typeof client.get !== "function") return null;
    if (!client.events || typeof client.events.on !== "function") return null;
    return client;
  } catch {
    return null;
  }
}

function sourceFrom(client: GoalRpcClient): HostGoalSource {
  return {
    read: (sessionID) => client.get({ sessionID }),
    subscribe: (handler) =>
      client.events.on("changed", (event) => {
        if (!event || typeof event !== "object") return;
        const raw = event as { sessionID?: unknown; goal?: unknown };
        const sessionID = typeof raw.sessionID === "string" ? raw.sessionID.trim() : "";
        if (!sessionID) return;
        const change: HostGoalChange = {
          sessionID,
          goal: raw.goal === null || raw.goal === undefined ? null : (raw.goal as HostGoalChange["goal"]),
        };
        handler(change);
      }),
  };
}

export function installHostGoalMirror(ctx: V2Context): HostGoalMirror | null {
  const client = goalClient(ctx);
  if (!client) {
    logger.debug("[tawassul] host goal RPC unavailable; the host /goal mirror stays disabled");
    return null;
  }
  const mirror = new HostGoalMirror(sourceFrom(client));
  mirror.start();
  setActiveHostGoalMirror(mirror);
  logger.info("[tawassul] host /goal mirror attached (read-only)");
  return mirror;
}

export function uninstallHostGoalMirror(mirror: HostGoalMirror | null): void {
  if (!mirror) return;
  setActiveHostGoalMirror(null);
  mirror.dispose();
}
