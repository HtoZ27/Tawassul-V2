import type { Context as HostContext } from "@opencode/plugin/promise/plugin";
import type { CommandDomain } from "@opencode/plugin/promise/command";
import type { PermissionDomain } from "@opencode/plugin/promise/permission";
import type { ModelHooks, Registration } from "@opencode/plugin/promise/registration";
import type { SessionHooks, SessionIdle } from "@opencode/plugin/promise/session";
import type { SkillDomain } from "@opencode/plugin/promise/skill";
import type { ToolContext as HostToolContext, ToolDomain } from "@opencode/plugin/promise/tool";

export type V2Registration = Registration;

export type V2ToolDefinition = {
  name: string;
  description: string;
  input: Record<string, unknown>;
  execute: (input: Record<string, unknown>, context: V2ToolContext) => Promise<unknown>;
  options?: { codemode: false };
};

export type V2ToolEditor = {
  add: (tool: V2ToolDefinition) => void;
};

export type V2ToolContext = HostToolContext;

export type V2ResultPart = { type?: string; text?: string; [key: string]: unknown };

export type V2ToolResult = {
  content?: string | V2ResultPart[];
  metadata?: Record<string, unknown>;
  output?: unknown;
};

export type V2ToolHookName = Parameters<ToolDomain["hook"]>[0];

export type V2ToolHookInput = {
  tool: string;
  sessionID: string;
  agent: string;
  messageID?: string;
  id: string;
  input: unknown;
} & ({
  status: "completed";
  result: V2ToolResult;
} | {
  status: "error";
  error?: { message?: string; metadata?: Record<string, unknown> };
});

export type V2SessionEvent = {
  sessionID?: string;
  messageID?: string;
  agent?: string;
  model?: unknown;
  prompt?: unknown;
  messages?: Array<Record<string, unknown>>;
  system?: Array<Record<string, unknown>>;
  delivery?: unknown;
};

export type V2SessionIdle = SessionIdle;

export type V2SessionFile = {
  uri: string;
  name: string;
};

export type V2SessionCreateInput = {
  title?: string;
  agent?: string;
  model?: { providerID: string; id: string };
  location?: unknown;
  metadata?: Record<string, unknown>;
};

export type V2Session = {
  create: (input: V2SessionCreateInput) => Promise<{ id: string; [key: string]: unknown }>;
  switchModel: (input: {
    sessionID: string;
    model: { id: string; providerID: string; variant?: string };
  }) => Promise<void>;
  prompt: (input: {
    sessionID: string;
    text: string;
    files?: V2SessionFile[];
    delivery?: "steer" | "queue";
    resume?: boolean;
  }) => Promise<unknown>;
  synthetic?: (input: { sessionID: string; text: string; description?: string }) => Promise<unknown>;
  interrupt: (input: { sessionID: string; resume?: boolean }) => Promise<unknown>;
  context: (input: { sessionID: string }) => Promise<Array<Record<string, unknown>>>;
  wait: (input: { sessionID: string }) => Promise<unknown>;
  hook: ModelHooks<SessionHooks>;
};

export type V2ModelListEntry = {
  providerID?: string;
  id?: string;
  limit?: { context?: number };
  [key: string]: unknown;
};

export type V2ModelList = {
  location?: unknown;
  data: V2ModelListEntry[];
};

export type V2Model = {
  list: () => Promise<V2ModelList>;
};

export type V2Tool = {
  transform: (callback: (editor: V2ToolEditor) => void) => Promise<V2Registration>;
  reload: ToolDomain["reload"];
  list: ToolDomain["list"];
  hook: ToolDomain["hook"];
};

export type V2Event = Pick<HostContext["event"], "subscribe">;

export type V2Permission = Pick<PermissionDomain, "assert" | "hook">;

export type V2RpcClient = {
  readonly events: {
    on: (name: string, handler: (event: unknown) => void) => () => void;
  };
} & Record<string, unknown>;

export type V2RpcDomain = <D extends {
  id: string;
  methods: Record<string, unknown>;
  events: Record<string, unknown>;
}>(definition: D) => V2RpcClient;

export type V2Context = {
  app: Pick<HostContext["app"], "version">;
  location: {
    directory: string;
    workspaceID?: string;
    project?: { id?: string; directory?: string; canonical?: string };
  };
  session: V2Session;
  model: V2Model;
  tool: V2Tool;
  event: V2Event;
  rpc: V2RpcDomain;
  permission: V2Permission;
  skill?: Pick<SkillDomain, "transform">;
  command?: Pick<CommandDomain, "transform">;
};
