import type { V2Context, V2ModelList, V2SessionCreateInput, V2SessionFile } from "./types.ts";

export type SessionBridge = {
  create: (input: V2SessionCreateInput) => Promise<{ id: string; [key: string]: unknown }>;
  prompt: (input: {
    sessionID: string;
    text: string;
    files?: V2SessionFile[];
    delivery?: "steer" | "queue";
  }) => Promise<unknown>;
  context: (input: { sessionID: string }) => Promise<Array<Record<string, unknown>>>;
  wait: (input: { sessionID: string }) => Promise<unknown>;
  modelList: () => Promise<V2ModelList>;
};

let active: SessionBridge | null = null;

export function installSessionBridge(ctx: V2Context): SessionBridge {
  const bridge: SessionBridge = {
    create: (input) => ctx.session.create(input),
    prompt: (input) => ctx.session.prompt(input),
    context: (input) => ctx.session.context(input),
    wait: (input) => ctx.session.wait(input),
    modelList: async () => {
      if (!ctx.model || typeof ctx.model.list !== "function") return { data: [] };
      return ctx.model.list();
    },
  };
  active = bridge;
  return bridge;
}

export function getSessionBridge(): SessionBridge | null {
  return active;
}

export function clearSessionBridge(): void {
  active = null;
}
