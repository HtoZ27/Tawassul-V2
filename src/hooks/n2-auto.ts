import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { logger } from "../utils/logger.ts";
import { v2DataRoot, v2NamespaceRoot } from "../utils/state-paths.ts";

const MAX_BYTES = 512 * 1024;
const KEEP_LINES = 200;
const PROCESS_START_MS = Date.now();

export function n2AutoLogPath(): string {
  const override = process.env.TAWASSUL_N2_LOG;
  if (override) return override;
  const root = v2DataRoot();
  if (root) return join(root, "n2-auto.jsonl");
  return join(v2NamespaceRoot(join(homedir(), ".local", "share")), "n2-auto.jsonl");
}

export type N2AutoSource =
  | "event:message.part.updated"
  | "event:session.text.started"
  | "event:session.text.delta"
  | "event:session.text.ended";

export interface N2AutoRecord {
  ts_ms: number;
  iso: string;
  session_id: string | null;
  message_id: string | null;
  part_id: string | null;
  len: number;
  process_start_ms: number;
  since_init_ms: number;
  source: N2AutoSource;
  role_gate: true;
}

export function createN2AutoHook() {
  let done = false;
  const assistantMessages = new Set<string>();
  const rememberAssistant = (id: string): void => {
    if (assistantMessages.has(id)) return;
    if (assistantMessages.size >= 512) {
      const first = assistantMessages.values().next().value;
      if (first !== undefined) assistantMessages.delete(first);
    }
    assistantMessages.add(id);
  };

  const persist = (input: {
    sessionId: string | null;
    messageId: string | null;
    partId: string | null;
    len: number;
    source: N2AutoSource;
  }): void => {
    done = true;
    const ts = Date.now();
    const rec: N2AutoRecord = {
      ts_ms: ts,
      iso: new Date(ts).toISOString(),
      session_id: input.sessionId,
      message_id: input.messageId,
      part_id: input.partId,
      len: input.len,
      process_start_ms: PROCESS_START_MS,
      since_init_ms: ts - PROCESS_START_MS,
      source: input.source,
      role_gate: true,
    };
    try {
      const file = n2AutoLogPath();
      mkdirSync(dirname(file), { recursive: true });
      try {
        if (statSync(file).size > MAX_BYTES) {
          const tail = readFileSync(file, "utf8").split("\n").slice(-KEEP_LINES).join("\n");
          writeFileSync(file, tail, { mode: 0o600 });
        }
      } catch (e) {
        logger.debug(`[n2-auto] rotate skipped: ${String(e)}`);
      }
      appendFileSync(file, JSON.stringify(rec) + "\n", { mode: 0o600 });
    } catch (e) {
      logger.debug(`[n2-auto] write failed: ${String(e)}`);
    }
  };

  return async function n2AutoHook(input: { event: unknown }): Promise<void> {
    if (done) return;
    const ev = input?.event as
      | {
          type?: string;
          properties?: { info?: unknown; part?: unknown; sessionID?: string };
          data?: {
            info?: unknown;
            part?: unknown;
            sessionID?: string;
            assistantMessageID?: string;
            ordinal?: number;
            delta?: string;
            text?: string;
          };
        }
      | undefined;
    if (!ev) return;

    if (ev.type === "session.text.started" || ev.type === "session.text.delta" || ev.type === "session.text.ended") {
      const data = ev.data;
      if (!data) return;
      const messageId = typeof data.assistantMessageID === "string" ? data.assistantMessageID : null;
      if (!messageId) return;
      const deltaLen = typeof data.delta === "string" ? data.delta.length : 0;
      const textLen = typeof data.text === "string" ? data.text.length : 0;
      const len = deltaLen > 0 ? deltaLen : textLen > 0 ? textLen : ev.type === "session.text.started" ? 1 : 0;
      if (len <= 0) return;
      const ordinal = typeof data.ordinal === "number" ? data.ordinal : null;
      persist({
        sessionId: typeof data.sessionID === "string" ? data.sessionID : null,
        messageId,
        partId: ordinal === null ? messageId : `${messageId}:text:${ordinal}`,
        len,
        source:
          ev.type === "session.text.started"
            ? "event:session.text.started"
            : ev.type === "session.text.delta"
              ? "event:session.text.delta"
              : "event:session.text.ended",
      });
      return;
    }

    if (ev.type === "message.updated") {
      const info = (ev.properties?.info ?? ev.data?.info) as { id?: unknown; role?: unknown } | undefined;
      if (info && info.role === "assistant" && typeof info.id === "string" && info.id) {
        rememberAssistant(info.id);
      }
      return;
    }
    if (ev.type !== "message.part.updated") return;
    const part = (ev.properties?.part ?? ev.data?.part) as
      | {
          type?: string;
          id?: string;
          sessionID?: string;
          messageID?: string;
          text?: string;
          synthetic?: boolean;
          ignored?: boolean;
        }
      | undefined;
    if (!part || part.type !== "text") return;
    if (part.synthetic === true || part.ignored === true) return;
    if (typeof part.text !== "string" || part.text.length === 0) return;
    if (typeof part.messageID !== "string" || !assistantMessages.has(part.messageID)) return;
    persist({
      sessionId: part.sessionID ?? null,
      messageId: part.messageID,
      partId: part.id ?? null,
      len: part.text.length,
      source: "event:message.part.updated",
    });
  };
}
