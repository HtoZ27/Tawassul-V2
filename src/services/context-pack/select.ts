import { byteLength } from "./accounting.ts";
import type { PackMessage, PackSelection } from "./types.ts";

type Unit = {
  start: number;
  end: number;
  role: string;
  text: string;
  bytes: number;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readName(part: Record<string, unknown>): string {
  const raw =
    part.filename ?? part.name ?? part.title ?? part.path ?? part.url ?? part.uri ?? part.source ?? "attachment";
  return typeof raw === "string" ? raw : "attachment";
}

function renderPart(raw: unknown): string {
  const part = asRecord(raw);
  if (!part) return "";
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  if (type === "text" || type === "reasoning") {
    return typeof part.text === "string" ? part.text : "";
  }
  if (type === "image" || type === "file" || type === "attachment" || type === "document") {
    return `[attachment: ${readName(part)}]`;
  }
  if (type === "tool-call" || type === "tool_call" || type === "tool") {
    const name = typeof part.toolName === "string" ? part.toolName : typeof part.name === "string" ? part.name : "tool";
    const input = part.input ?? (asRecord(part.state)?.input ?? part.args);
    return `[tool-call: ${name}] ${safeJson(input)}`;
  }
  if (type === "tool-result" || type === "tool_result") {
    const output = part.output ?? part.result ?? (asRecord(part.state)?.output ?? part.content);
    return `[tool-result] ${renderUnknown(output)}`;
  }
  if (typeof part.text === "string") return part.text;
  return renderUnknown(part);
}

function safeJson(value: unknown): string {
  try {
    const json = JSON.stringify(value ?? null);
    return json ?? "";
  } catch {
    return "";
  }
}

function renderUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => renderPart(item)).filter(Boolean).join("\n");
  const record = asRecord(value);
  if (record) {
    const nested = record.content ?? record.parts ?? record.text;
    if (nested !== undefined) return renderUnknown(nested);
    return safeJson(record);
  }
  return value === undefined || value === null ? "" : String(value);
}

export function renderPackMessage(raw: unknown): string {
  const message = asRecord(raw);
  if (!message) return "";
  const role = typeof message.role === "string" ? message.role : "unknown";
  const content = message.content;
  let body = "";
  if (typeof content === "string") {
    body = content;
  } else if (Array.isArray(content)) {
    body = content.map((part) => renderPart(part)).filter(Boolean).join("\n");
  } else if (Array.isArray(message.parts)) {
    body = message.parts.map((part) => renderPart(part)).filter(Boolean).join("\n");
  } else if (typeof message.text === "string") {
    body = message.text;
  } else {
    body = renderUnknown(message);
  }
  const trimmed = body.trim();
  return trimmed ? `[${role}]\n${trimmed}` : "";
}

function buildUnits(messages: PackMessage[]): Unit[] {
  const units: Unit[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") continue;
    const role = typeof message.role === "string" ? message.role : "unknown";
    const text = renderPackMessage(message);
    if (!text) continue;
    const previous = units[units.length - 1];
    if (role === "tool" && previous && previous.end === index - 1) {
      previous.end = index;
      previous.text = `${previous.text}\n${text}`;
      previous.bytes = byteLength(previous.text);
      continue;
    }
    units.push({ start: index, end: index, role, text, bytes: byteLength(text) });
  }
  return units;
}

export function selectConversation(messages: PackMessage[], maxBytes: number): PackSelection {
  const budget = Number.isFinite(maxBytes) ? Math.max(0, Math.floor(maxBytes)) : 0;
  const units = buildUnits(messages);
  if (units.length === 0 || budget === 0) {
    return { text: "", bytes: 0, messageCount: 0, dropped: units.length, overflow: units.length > 0 };
  }
  const firstUser = units.findIndex((unit) => unit.role === "user");
  const lastIndex = units.length - 1;
  const lastUnit = units[lastIndex];
  if (!lastUnit) {
    return { text: "", bytes: 0, messageCount: 0, dropped: 0, overflow: false };
  }
  if (lastUnit.bytes > budget) {
    return { text: "", bytes: 0, messageCount: 0, dropped: units.length, overflow: true };
  }
  const included = new Set<number>([lastIndex]);
  let used = lastUnit.bytes;
  for (let index = lastIndex - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (!unit || unit.bytes === 0) continue;
    if (used + unit.bytes + 2 > budget) continue;
    included.add(index);
    used += unit.bytes + 2;
  }
  if (firstUser >= 0 && !included.has(firstUser)) {
    const unit = units[firstUser];
    if (unit && used + unit.bytes + 2 <= budget) {
      included.add(firstUser);
      used += unit.bytes + 2;
    }
  }
  const ordered = [...included].sort((a, b) => a - b);
  const text = ordered
    .map((index) => units[index]?.text ?? "")
    .filter(Boolean)
    .join("\n\n");
  return {
    text,
    bytes: byteLength(text),
    messageCount: ordered.length,
    dropped: units.length - ordered.length,
    overflow: false,
  };
}

export function selectText(messages: PackMessage[], maxBytes: number): string {
  return selectConversation(messages, maxBytes).text;
}
