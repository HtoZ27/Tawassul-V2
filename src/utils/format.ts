
import { SEVERITY_EMOJIS } from "../context/constants.ts";
export { SEVERITY_EMOJIS };


export function severityEmoji(s?: string): string {
  return s ? (SEVERITY_EMOJIS[s] ?? "") : "";
}


export function recordEmoji(type: string): string {
  return type === "fix" ? "🔧" : type === "incident" ? "🚨" : type === "decision" ? "🎯" : "📝";
}



export function getMessageContent(output: {
  message?: { role: string; text?: string; [key: string]: unknown };
  parts?: { type?: string; text?: string; [key: string]: unknown }[];
}): string {
  const msgText =
    output?.message && typeof output.message === "object"
      ? ((output.message as Record<string, unknown>).text as string)
      : "";
  const partsText = output?.parts?.map((p: { text?: string }) => p.text || "").join(" ") || "";
  return msgText || partsText;
}

export function timeAgo(iso: string): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const prefix = diff > 0 ? "" : "in ";
  const suffix = diff > 0 ? " ago" : "";
  const mins = Math.floor(abs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${prefix}${mins}m${suffix}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${prefix}${hours}h${suffix}`;
  return `${prefix}${Math.floor(hours / 24)}d${suffix}`;
}
