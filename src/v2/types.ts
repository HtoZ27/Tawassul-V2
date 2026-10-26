export type V2Registration = { dispose: () => Promise<void> };

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

export type V2ToolContext = {
  sessionID: string;
  messageID: string;
  agent: string;
  id: string;
  signal?: AbortSignal;
  progress: (update: Record<string, unknown>) => Promise<void>;
};

export type V2ResultPart = { type?: string; text?: string; [key: string]: unknown };

export type V2ToolResult = {
  content?: string | V2ResultPart[];
  metadata?: Record<string, unknown>;
  output?: unknown;
};

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

export type V2Session = {
  prompt: (input: { sessionID: string; text: string; delivery?: "steer" | "queue" }) => Promise<unknown>;
  synthetic?: (input: { sessionID: string; text: string; description?: string }) => Promise<unknown>;
  interrupt: (input: { sessionID: string; continue?: boolean }) => Promise<unknown>;
  hook: (
    name: string,
    callback: (event: V2SessionEvent) => void | Promise<void>,
  ) => Promise<V2Registration>;
};

export type V2Tool = {
  transform: (callback: (editor: V2ToolEditor) => void) => Promise<V2Registration>;
  reload: () => Promise<void>;
  list: () => Promise<readonly unknown[]>;
  hook: (name: string, callback: (input: unknown) => void | Promise<void>) => Promise<V2Registration>;
};

export type V2Event = {
  subscribe: () => AsyncIterable<Record<string, unknown>>;
};

export type V2Permission = {
  assert: (input: {
    sessionID: string;
    agent?: string;
    action: string;
    resources: string[];
    metadata?: Record<string, unknown>;
    source?: { type: "tool"; messageID: string; id: string };
  }) => Promise<void>;
  hook: (name: string, callback: (input: unknown) => void | Promise<void>) => Promise<V2Registration>;
};

export type V2Context = {
  location?: { directory?: string };
  session: V2Session;
  tool: V2Tool;
  event: V2Event;
  permission?: V2Permission;
};