import type { PluginInput } from "../plugin-types.ts";
import { logger } from "../utils/logger.ts";
import type { V2Context } from "./types.ts";

export function resolveV2Directory(ctx: Pick<V2Context, "location">): string {
  return ctx.location?.directory?.trim() ? ctx.location.directory : process.cwd();
}

type TranscriptPromptInput = {
  path?: { id?: string };
  body?: { parts?: Array<{ type?: string; text?: string }>; noReply?: boolean };
  sessionID?: string;
  text?: string;
};

function readTranscriptId(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const rec = input as TranscriptPromptInput;
  return rec.path?.id ?? rec.sessionID;
}

function readTranscriptText(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const rec = input as TranscriptPromptInput;
  if (typeof rec.text === "string") return rec.text;
  const parts = rec.body?.parts;
  if (!Array.isArray(parts)) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    if (part && typeof part.text === "string") chunks.push(part.text);
  }
  return chunks.join("\n");
}

function isNoReply(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  return (input as TranscriptPromptInput).body?.noReply === true;
}

function deliverWithoutReply(ctx: V2Context, sessionID: string, text: string): Promise<unknown> | undefined {
  if (!ctx.session.synthetic) {
    logger.warn("[tawassul] v2 shim: noReply requested but session.synthetic is unavailable; dropping the message");
    return undefined;
  }
  return ctx.session.synthetic({ sessionID, text });
}

function buildSessionClient(ctx: V2Context) {
  return {
    prompt: async (input: unknown): Promise<unknown> => {
      const sessionID = readTranscriptId(input);
      if (!sessionID) return undefined;
      const text = readTranscriptText(input).trim();
      if (!text) return undefined;
      if (isNoReply(input)) return deliverWithoutReply(ctx, sessionID, text);
      return ctx.session.prompt({ sessionID, text, delivery: "steer" });
    },
    promptAsync: async (input: unknown): Promise<unknown> => {
      const sessionID = readTranscriptId(input);
      if (!sessionID) return undefined;
      const text = readTranscriptText(input).trim();
      if (!text) return undefined;
      const pending = isNoReply(input)
        ? deliverWithoutReply(ctx, sessionID, text)
        : ctx.session.prompt({ sessionID, text, delivery: "steer" });
      pending?.catch(() => undefined);
      return pending;
    },
  };
}

export function resolveV2ServerUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env.OPENCODE_SERVER_PORT ?? env.OPENCODE_PORT;
  if (!raw) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
    logger.debug(`[tawassul] v2 shim: ignoring invalid server port "${raw}"`);
    return undefined;
  }
  return `http://localhost:${port}`;
}

export function buildPluginInput(ctx: V2Context): PluginInput {
  const directory = resolveV2Directory(ctx);
  const client: Record<string, unknown> = {
    session: buildSessionClient(ctx),
  };
  return {
    client,
    directory,
    worktree: directory,
    serverUrl: resolveV2ServerUrl(),
  };
}
