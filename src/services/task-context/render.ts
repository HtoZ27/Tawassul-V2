import { byteLength } from "../context-pack/accounting.ts";
import type { ContextItem, TaskContextBundle } from "./types.ts";

export const MAX_BUNDLE_BYTES = 16 * 1024;
export const MAX_TASK_BYTES = 1024;
export const MAX_MISSING_LINE_BYTES = 1024;

export type RenderResult = {
  text: string;
  bytes: number;
  items: ContextItem[];
  missing: string[];
  truncated: boolean;
};

function clipUtf8(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  const marker = "…";
  const budget = Math.max(0, maxBytes - byteLength(marker));
  let out = "";
  let used = 0;
  for (const char of text) {
    const size = byteLength(char);
    if (used + size > budget) break;
    out += char;
    used += size;
  }
  return `${out}${marker}`;
}

function itemLine(item: ContextItem): string {
  if (item.kind === "file") {
    return `- file ${item.path} | reason: ${item.reason} | score: ${item.score}`;
  }
  if (item.kind === "symbol") {
    return `- symbol ${item.path}#${item.name} (${item.symbolKind} ${item.startLine}-${item.endLine}) | reason: ${item.reason} | score: ${item.score}`;
  }
  return `- edge ${item.from} -> ${item.to} | reason: ${item.reason} | score: ${item.score}`;
}

function buildMissingLine(missing: string[], maxBytes: number): { line: string; kept: string[]; truncated: boolean } {
  if (missing.length === 0) return { line: "", kept: [], truncated: false };
  const kept: string[] = [];
  let line = "missing:";
  for (const path of missing) {
    const next = `${line} ${path}`;
    if (byteLength(next) > maxBytes) break;
    line = next;
    kept.push(path);
  }
  if (kept.length === 0) return { line: "", kept: [], truncated: true };
  return { line, kept, truncated: kept.length < missing.length };
}

export function renderBundle(bundle: TaskContextBundle, maxBytes?: number): RenderResult {
  const limit = maxBytes ?? MAX_BUNDLE_BYTES;
  const task = clipUtf8(bundle.task, MAX_TASK_BYTES);
  const missing = buildMissingLine(bundle.missing, MAX_MISSING_LINE_BYTES);
  let truncated = bundle.truncated || task !== bundle.task || missing.truncated;
  const headerLead = [
    "## Task Context Bundle",
    `task: ${task}`,
    `task-id: ${bundle.taskId}`,
    `project: ${bundle.projectKey}`,
    `revision: ${bundle.revision}`,
  ];
  const headerBase = headerLead.join("\n");
  const reserve = byteLength(headerBase) + (missing.line ? byteLength(missing.line) + 1 : 0) + 64;
  const items: ContextItem[] = [];
  const itemLines: string[] = [];
  let used = reserve;
  for (const item of bundle.items) {
    const line = itemLine(item);
    const lineBytes = byteLength(line) + 1;
    if (used + lineBytes > limit) {
      truncated = true;
      break;
    }
    used += lineBytes;
    itemLines.push(line);
    items.push(item);
  }
  if (items.length < bundle.items.length) truncated = true;

  const renderHeader = (): string =>
    [...headerLead, `items: ${items.length}`, `truncated: ${truncated ? "true" : "false"}`].join("\n");
  const assemble = (): string => {
    const lines = [renderHeader(), ...itemLines];
    if (missing.line) lines.push(missing.line);
    return lines.join("\n");
  };

  let text = assemble();
  while (byteLength(text) > limit && itemLines.length > 0) {
    itemLines.pop();
    items.pop();
    truncated = true;
    text = assemble();
  }
  if (byteLength(text) > limit) {
    text = clipUtf8(text, limit);
    truncated = true;
  }
  return { text, bytes: byteLength(text), items, missing: missing.kept, truncated };
}
