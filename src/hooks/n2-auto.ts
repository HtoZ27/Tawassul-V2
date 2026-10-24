import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { logger } from "../utils/logger.ts";

const MAX_BYTES = 512 * 1024;
const KEEP_LINES = 200;
const PROCESS_START_MS = Date.now();

export function n2AutoLogPath(): string {
  const override = process.env.TAWASSUL_N2_LOG;
  if (override) return override;
  const data = process.env.XDG_DATA_HOME;
  const base = data && data.startsWith("/") ? data : join(homedir(), ".local", "share");
  return join(base, "tawassul", "n2-auto.jsonl");
}

export interface N2AutoRecord {
  ts_ms: number;
  iso: string;
  session_id: string | null;
  message_id: string | null;
  part_id: string | null;
  len: number;
  process_start_ms: number;
  since_init_ms: number;
  source: "event:message.part.updated";
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
  return async function n2AutoHook(input: { event: unknown }): Promise<void> {
    if (done) return;
    const ev = input?.event as
      | {
          type?: string;
          properties?: { info?: unknown; part?: unknown; sessionID?: string };
          data?: { info?: unknown; part?: unknown; sessionID?: string };
        }
      | undefined;
    if (!ev) return;
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
    done = true;

    const ts = Date.now();
    const rec: N2AutoRecord = {
      ts_ms: ts,
      iso: new Date(ts).toISOString(),
      session_id: part.sessionID ?? null,
      message_id: part.messageID ?? null,
      part_id: part.id ?? null,
      len: part.text.length,
      process_start_ms: PROCESS_START_MS,
      since_init_ms: ts - PROCESS_START_MS,
      source: "event:message.part.updated",
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
}
