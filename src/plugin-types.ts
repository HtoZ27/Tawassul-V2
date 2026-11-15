import type { ToolDefinition } from "./tool.ts";
import type { ProjectIdentity } from "./utils/project-identity.ts";

export const INIT_READY = Symbol.for("tawassul.v2.initReady");

export const ROSTER_READY = Symbol.for("tawassul.v2.rosterReady");

export type InitReadiness = { ready: boolean; error?: Error };

export type InitReadyProbe = () => Promise<InitReadiness>;

export type RosterPrewarmResult = {
  populated: boolean;
  complete: boolean;
  count: number;
  elapsedMs: number;
  configPath: string | null;
  timedOut: boolean;
};

export type RosterReadyProbe = (boundMs?: number) => Promise<RosterPrewarmResult>;

export type PluginInput = {
  client: Record<string, unknown>;
  directory: string;
  worktree: string;
  serverUrl?: string;
  hostVersion?: string;
  persistDir?: string;
  projectRoot?: string;
  projectIdentity?: ProjectIdentity;
};

export interface DynamicAgentModel {
  providerID: string;
  modelID: string;
}

export interface AgentPermissionBlock {
  [key: string]: unknown;
}

export interface AgentConfig {
  model?: string;
  mode?: string;
  permission?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Config {
  model?: string;
  agent?: Record<string, AgentConfig>;
  [key: string]: unknown;
}

export type TawassulHooks = {
  [INIT_READY]?: InitReadyProbe;
  [ROSTER_READY]?: RosterReadyProbe;
  dispose?: () => Promise<void>;
  event?: (input: { event: unknown }) => Promise<void>;
  config?: (input: Config) => Promise<void>;
  tool?: { [key: string]: ToolDefinition };
  "chat.message"?: (
    input: {
      sessionID: string;
      agent?: string;
      model?: DynamicAgentModel;
      messageID?: string;
      variant?: string;
    },
    output: {
      message: { role: string; text?: string; [key: string]: unknown };
      parts: { type: string; text?: string; [key: string]: unknown }[];
    },
  ) => Promise<void>;
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>;
  "tool.definition"?: (
    input: { toolID: string },
    output: { description: string; parameters: Record<string, unknown>; jsonSchema?: unknown },
  ) => Promise<void>;
  "tool.execute.before"?: (
    input: { tool: string; agent?: string; sessionID: string; callID: string },
    output: { args: Record<string, unknown>; error?: string },
  ) => Promise<void>;
  "tool.execute.after"?: (
    input: { tool: string; agent?: string; sessionID: string; callID: string; args: Record<string, unknown> },
    output: { title: string; output: string; metadata: Record<string, unknown> },
  ) => Promise<void>;
};

export type Plugin = (input: PluginInput) => TawassulHooks | Promise<TawassulHooks>;