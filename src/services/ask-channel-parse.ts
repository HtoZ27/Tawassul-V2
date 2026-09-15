export type AskKind =
  | { type: "confirm"; default: boolean }
  | { type: "select"; options: string[] }
  | { type: "multiselect"; options: string[] };

export type AskReply = boolean | string | string[];

const YES_RE = /^(yes|y|yep|yeah|sure|ok|okay|aye|fine|go ahead|1|true)$/i;
const NO_RE = /^(no|n|nope|nah|nay|stop|reject|rejected|refuse|refused|forbidden|deny|decline|0|false)$/i;

export const ASK_MARKER = "\u0002TAWASSUL_ASK\u0002";

export function isAskInjection(message?: {
  role?: string;
  message?: { role?: string };
  parts?: Array<{ type?: string; text?: unknown; [k: string]: unknown }>;
}): boolean {
  if (!message?.parts) return false;
  const role = message.message?.role ?? message.role;
  if (role !== undefined && role !== "user") return false;
  const firstText = message.parts.find((p) => p.type === "text" && typeof p.text === "string");
  return Boolean(firstText && typeof firstText.text === "string" && firstText.text.startsWith(ASK_MARKER));
}

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ").replace(/[.]$/, "");
}

function stripLeadingMarkers(s: string): string {
  return s.replace(/^(?:option|choice|number)\s*[#.:)\] -]+\s*/i, "").trim();
}

export function parseUserReply(content: string, kind: AskKind): AskReply | undefined {
  const text = normalize(content);
  if (!text) return undefined;

  if (kind.type === "confirm") {
    if (YES_RE.test(text)) return true;
    if (NO_RE.test(text)) return false;
    return undefined;
  }

  if (kind.type === "select") {
    const options = kind.options;
    const cleaned = stripLeadingMarkers(text);
    const exact = options.find((o) => normalize(o).toLowerCase() === cleaned.toLowerCase());
    if (exact !== undefined) return exact;
    const numeric = cleaned.match(/^(\d{1,2})$/);
    if (numeric) {
      const idx = parseInt(numeric[1] ?? "", 10) - 1;
      const opt = idx >= 0 && idx < options.length ? options[idx] : undefined;
      if (opt !== undefined) return opt;
    }
    const prefix = options.find((o) => {
      const n = normalize(o).toLowerCase();
      return n.startsWith(cleaned.toLowerCase()) && cleaned.length >= 2;
    });
    if (prefix !== undefined) return prefix;
    return undefined;
  }

  const parts = text
    .split(/[,\n;]+| and /)
    .map(stripLeadingMarkers)
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  const selected: string[] = [];
  for (const part of parts) {
    const cleaned = stripLeadingMarkers(part);
    const exact = kind.options.find((o) => normalize(o).toLowerCase() === cleaned.toLowerCase());
    if (exact !== undefined) {
      if (!selected.includes(exact)) selected.push(exact);
      continue;
    }
    const numeric = cleaned.match(/^(\d{1,2})$/);
    if (numeric) {
      const idx = parseInt(numeric[1] ?? "", 10) - 1;
      const opt = idx >= 0 && idx < kind.options.length ? kind.options[idx] : undefined;
      if (opt !== undefined && !selected.includes(opt)) selected.push(opt);
    }
  }
  return selected.length > 0 ? selected : undefined;
}

export function formatAskPrompt(title: string, kind: AskKind): string {
  if (kind.type === "confirm") {
    const hint = kind.default ? "Yes" : "No";
    return [
      `⚠️ ${title}`,
      "👉 To accept, reply with any acceptance token: yes, sure, ok, okay, go ahead",
      "👉 To reject, reply with any rejection token: no, stop, no thanks",
      "⚠️ I'll treat any acceptance token as immediate consent and execute.",
      `(default ${hint})`,
    ].join("\n");
  }
  const lines = kind.options.map((o, i) => `${i + 1}) ${o}`);
  const instruction =
    kind.type === "multiselect" ? "Reply with comma-separated numbers (e.g., 1,3)" : "Reply with the option number";
  return `❓ ${title}\n${lines.join("\n")}\n${instruction}`;
}