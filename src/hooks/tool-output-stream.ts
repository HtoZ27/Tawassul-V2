























import { logger } from "../utils/logger.ts";

import { isIsolationActiveSync as isIsolationActiveFallback } from "../services/isolation.ts";
import { normalizeName } from "../utils/name-utils.ts";

const STREAM_TOOLS = new Set(["bash", "lint", "lint-fix"]);


const MAX_EMIT_LINES = 1000;


const MAX_LINE = 20_000;


const MAP_CAP = 2000;

export function createToolOutputStreamHook(clients?: {
  isIsolationActive?: () => boolean;
  logLine?: (line: string) => void;
}) {
  
  
  const isIsolationActive = clients?.isIsolationActive ?? isIsolationActiveFallback;
  const logLine = clients?.logLine ?? ((line: string) => logger.info(line));
  
  const printed = new Map<string, number>();
  
  const toolOfPart = new Map<string, string>();

  function toolOf(part: unknown): string | null {
    const p = part as { type?: string; tool?: unknown } | null;
    if (!p || p.type !== "tool" || typeof p.tool !== "string") return null;
    return normalizeName(p.tool);
  }

  
  
  
  
  
  function emit(tool: string, text: string): number {
    if (!text) return 0;
    const lines = text.split("\n");
    const capped = lines.length > MAX_EMIT_LINES;
    const visible = capped ? lines.slice(0, MAX_EMIT_LINES) : lines;
    for (const line of visible) {
      if (line.length <= MAX_LINE) {
        logLine(`[${tool}] ${line}`);
      } else {
        logLine(`[${tool}] ${line.slice(0, MAX_LINE)} …(+${line.length - MAX_LINE} chars)`);
      }
    }
    if (capped) {
      logLine(`[${tool}] …(${lines.length - MAX_EMIT_LINES} more lines omitted)`);
    }
    return visible.join("\n").length;
  }

  return async function toolOutputStreamHook(input: { event: unknown }): Promise<void> {
    if (isIsolationActive()) return; 
    const ev = input?.event as
      { type?: string; properties?: Record<string, unknown>; data?: Record<string, unknown> } | undefined;
    if (!ev || typeof ev.type !== "string") return;

    
    if (ev.type === "message.part.delta") {
      const src = (ev.properties ?? ev.data) as { partID?: unknown; field?: unknown; delta?: unknown } | undefined;
      const partID = typeof src?.partID === "string" ? src.partID : undefined;
      if (!partID) return;
      if (typeof src?.field !== "string" || !src.field.endsWith("output")) return;
      const tool = toolOfPart.get(partID);
      if (!tool || !STREAM_TOOLS.has(tool)) return;
      const delta = typeof src?.delta === "string" ? src.delta : "";
      if (!delta) return;
      const emitted = emit(tool, delta);
      printed.set(partID, (printed.get(partID) ?? 0) + emitted);
      return;
    }

    if (ev.type !== "message.part.updated") return;

    
    const src = (ev.properties ?? ev.data) as { part?: unknown; delta?: unknown } | undefined;
    const part = src?.part as
      { id?: string; state?: { status?: string; output?: unknown; error?: unknown } } | undefined;
    if (!part || typeof part.id !== "string") return;

    const tool = toolOf(part);
    if (tool) {
      toolOfPart.set(part.id, tool);
      if (toolOfPart.size > MAP_CAP) {
        const oldest = [...toolOfPart.keys()].slice(0, toolOfPart.size - MAP_CAP);
        for (const k of oldest) {
          toolOfPart.delete(k);
          printed.delete(k);
        }
      }
    }
    if (!tool || !STREAM_TOOLS.has(tool)) return;

    const key = part.id;

    
    const delta = typeof src?.delta === "string" ? src.delta : "";
    if (delta) {
      const emitted = emit(tool, delta);
      printed.set(key, (printed.get(key) ?? 0) + emitted);
    }

    
    if (part.state?.status === "completed" || part.state?.status === "error") {
      const out =
        typeof part.state?.output === "string"
          ? part.state.output
          : typeof part.state?.error === "string"
            ? part.state.error
            : "";
      const already = printed.get(key) ?? 0;
      if (out.length > already) emit(tool, out.slice(already));
      printed.delete(key);
      toolOfPart.delete(key);
    }
  };
}
