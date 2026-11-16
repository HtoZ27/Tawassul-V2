export interface SessionInfo {
  sessionId: string;
  conversationId?: string;
  mode?: "chat" | "plan" | "build";
  providerId?: string;
  modelId?: string;
}

export interface HookInput {
  sessionID: string;
  messageID?: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
}

export function toSessionInfo(input: HookInput): SessionInfo {
  return {
    sessionId: input.sessionID,
    providerId: input.model?.providerID,
    modelId: input.model?.modelID,
  };
}

export function toHookInput(info: SessionInfo): HookInput {
  return {
    sessionID: info.sessionId,
    messageID: info.conversationId,
    model: info.providerId && info.modelId ? { providerID: info.providerId, modelID: info.modelId } : undefined,
  };
}
