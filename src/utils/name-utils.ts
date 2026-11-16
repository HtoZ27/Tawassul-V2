
import { logger } from "./logger.ts";



const INVISIBLE_CODEPOINTS = [
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2061,
  0x2062, 0x2063, 0x2064, 0x2066, 0x2067, 0x2068, 0x2069, 0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f, 0xfeff,
  0x00ad, 0x034f, 0x061c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180e, 0x202f, 0x205f, 0x3000, 0x3164, 0xffa0, 0xfe00,
  0xfe01, 0xfe02, 0xfe03, 0xfe04, 0xfe05, 0xfe06, 0xfe07, 0xfe08, 0xfe09, 0xfe0a, 0xfe0b, 0xfe0c, 0xfe0d, 0xfe0e,
  0xfe0f,
];
export const INVISIBLE_CHARS_RE = new RegExp(
  `[${INVISIBLE_CODEPOINTS.map((c) => `\\u${c.toString(16).padStart(4, "0")}`).join("")}]`,
  "g",
);

let _normCache: Map<string, string> | undefined;


export function normalizeName(v: unknown): string {
  if (typeof v !== "string") return "";
  if (!_normCache) _normCache = new Map();
  const cached = _normCache.get(v);
  if (cached !== undefined) return cached;
  const result = v
    .replace(INVISIBLE_CHARS_RE, "")
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/^(?:@|tawassul_)+/, "")
    .trim();
  if (_normCache.size >= 500) {
    const first = _normCache.keys().next().value;
    if (first !== undefined) _normCache.delete(first);
  }
  _normCache.set(v, result);
  return result;
}




const TOOL_ALIASES: Record<string, string> = { shell: "bash", subagent: "task" };

export function normalizeToolName(name: string): string {
  const n = normalizeName(name);
  if (!/^[a-z0-9_]{1,64}$/.test(n)) {
    const cleaned = n.replace(/[^a-z0-9_]/g, "_");
    if (!cleaned) {
      logger.warn(`[tawassul] invalid tool name "${name}"`);
      return normalizeName(name);
    }
    return TOOL_ALIASES[cleaned] ?? cleaned;
  }
  return TOOL_ALIASES[n] ?? n;
}
