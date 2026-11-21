import {
  consentTokensPath,
  customTokenCount,
  isCustomAcceptToken,
  isCustomDenyToken,
  normalizeToken,
} from "./consent-tokens.ts";
import en from "../i18n/en.json" with { type: "json" };
import ar from "../i18n/ar.json" with { type: "json" };
import es from "../i18n/es.json" with { type: "json" };
import fr from "../i18n/fr.json" with { type: "json" };
import de from "../i18n/de.json" with { type: "json" };
import pt from "../i18n/pt.json" with { type: "json" };
import it from "../i18n/it.json" with { type: "json" };
import nl from "../i18n/nl.json" with { type: "json" };
import tr from "../i18n/tr.json" with { type: "json" };
import pl from "../i18n/pl.json" with { type: "json" };
import id from "../i18n/id.json" with { type: "json" };
import vi from "../i18n/vi.json" with { type: "json" };
import ru from "../i18n/ru.json" with { type: "json" };
import uk from "../i18n/uk.json" with { type: "json" };
import el from "../i18n/el.json" with { type: "json" };
import he from "../i18n/he.json" with { type: "json" };
import hi from "../i18n/hi.json" with { type: "json" };
import zh from "../i18n/zh.json" with { type: "json" };
import ja from "../i18n/ja.json" with { type: "json" };
import ko from "../i18n/ko.json" with { type: "json" };
import th from "../i18n/th.json" with { type: "json" };

export type AskKind =
  | { type: "confirm"; default: boolean }
  | { type: "select"; options: string[] }
  | { type: "multiselect"; options: string[] };

export type AskReply = boolean | string | string[];

const YES_RE = /^(yes|y|yep|yeah|sure|ok|okay|aye|fine|go ahead|1|true)$/i;
const NO_RE = /^(no|n|nope|nah|nay|stop|reject|rejected|refuse|refused|forbidden|deny|decline|no thanks|no thank you|not now|0|false)$/i;

const CONSENT_TABLES: Array<Record<string, string>> = [
  en, ar, es, fr, de, pt, it, nl, tr, pl, id, vi, ru, uk, el, he, hi, zh, ja, ko, th,
];

function tableWords(table: Record<string, string>, key: string): string[] {
  const raw = table[key];
  return typeof raw === "string" ? raw.split("|").map(normalizeToken).filter(Boolean) : [];
}

const ACCEPT_WORDS = new Set(CONSENT_TABLES.flatMap((table) => tableWords(table, "consentAcceptWords")));
const REJECT_WORDS = new Set(CONSENT_TABLES.flatMap((table) => tableWords(table, "consentRejectWords")));

function wordsIn(token: string): string[] {
  return token.split(" ").map(normalizeToken).filter(Boolean);
}

const ACCEPT_PHRASES = new Set([
  "yes please",
  "yes, please",
  "yes do it",
  "please proceed",
  "please go ahead",
  "go ahead please",
]);

function matchesWord(token: string, words: Set<string>): boolean {
  return words.has(token) || ACCEPT_PHRASES.has(token);
}

function containsWord(token: string, words: Set<string>): boolean {
  return wordsIn(token).some((word) => words.has(word));
}

function hasRejectWord(token: string): boolean {
  return NO_RE.test(token) || containsWord(token, REJECT_WORDS) || isCustomDenyToken(token);
}

export function isAcceptToken(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const token = normalizeToken(value);
  if (token === "" || hasRejectWord(token)) return false;
  return YES_RE.test(token) || matchesWord(token, ACCEPT_WORDS) || isCustomAcceptToken(token);
}

export function isRejectToken(value: unknown): boolean {
  if (value === false) return true;
  if (typeof value !== "string") return false;
  const token = normalizeToken(value);
  return token !== "" && hasRejectWord(token);
}

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
    if (isAcceptToken(content)) return true;
    if (isRejectToken(content)) return false;
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
    const tokensPath = consentTokensPath();
    const custom = customTokenCount();
    const customLine =
      custom > 0
        ? `👉 Custom words loaded (${custom}): ${tokensPath}`
        : `👉 Add your own accept/reject words to ${tokensPath}`;
    return [
      `⚠️ ${title}`,
      "👉 To accept, reply with any acceptance token: yes, sure, ok, okay, go ahead — or a word in your language",
      "👉 To reject, reply with any rejection token: no, stop, no thanks — or a word in your language",
      customLine,
      "⚠️ I'll treat any acceptance token as immediate consent and execute.",
      `(default ${hint})`,
    ].join("\n");
  }
  const lines = kind.options.map((o, i) => `${i + 1}) ${o}`);
  const instruction =
    kind.type === "multiselect" ? "Reply with comma-separated numbers (e.g., 1,3)" : "Reply with the option number";
  return `❓ ${title}\n${lines.join("\n")}\n${instruction}`;
}