import { DEFAULT_PRICING_MODELS } from "../cost-transparency/types.ts";
import { MIN_BUDGET_BYTES, MIN_TRUSTED_WINDOW, PACK_MAX_BYTES } from "./types.ts";
import type { PackMessage } from "./types.ts";

const IMAGE_ATTACHMENT_BYTES = 8192;
const OTHER_ATTACHMENT_BYTES = 4096;
const PRICING_CONTEXT = new Map<string, number>();

for (const model of DEFAULT_PRICING_MODELS) {
  PRICING_CONTEXT.set(model.id.toLowerCase(), model.maxContextTokens);
  PRICING_CONTEXT.set(model.model.toLowerCase(), model.maxContextTokens);
  PRICING_CONTEXT.set(`${model.provider}/${model.model}`.toLowerCase(), model.maxContextTokens);
}

export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function pricingWindow(providerID?: string, modelID?: string): number | undefined {
  if (modelID) {
    const direct = PRICING_CONTEXT.get(modelID.toLowerCase());
    if (direct) return direct;
    if (providerID) {
      const qualified = PRICING_CONTEXT.get(`${providerID}/${modelID}`.toLowerCase());
      if (qualified) return qualified;
    }
    for (const [key, value] of PRICING_CONTEXT) {
      if (key.endsWith(`/${modelID.toLowerCase()}`)) return value;
    }
  }
  return undefined;
}

export function resolveModelWindow(input: {
  limitContext?: unknown;
  providerID?: string;
  modelID?: string;
}): number {
  const raw = input.limitContext;
  const host =
    typeof raw === "number" && Number.isInteger(raw) && raw >= MIN_TRUSTED_WINDOW && raw <= 10_000_000
      ? raw
      : undefined;
  const pricedRaw = pricingWindow(input.providerID, input.modelID) ?? MIN_TRUSTED_WINDOW;
  const priced = pricedRaw < MIN_TRUSTED_WINDOW ? MIN_TRUSTED_WINDOW : pricedRaw;
  if (host === undefined) return priced;
  return Math.min(host, priced);
}

export function resolveReserve(window: number): number {
  const safe = Number.isFinite(window) && window > 0 ? Math.floor(window) : MIN_TRUSTED_WINDOW;
  return Math.min(Math.max(16000, Math.floor(safe / 4)), Math.floor(safe / 2));
}

export function computeBudget(window: number, requestBytes: number): {
  room: number;
  budget: number;
  overflow: boolean;
} {
  const reserve = resolveReserve(window);
  const charged = Number.isFinite(requestBytes) && requestBytes > 0 ? Math.ceil(requestBytes) : 0;
  const room = Math.floor(window) - reserve - charged;
  const budget = Math.min(PACK_MAX_BYTES, room);
  return { room, budget, overflow: budget < MIN_BUDGET_BYTES };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isImagePart(part: Record<string, unknown>): boolean {
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  if (type === "image") return true;
  const mime = typeof part.mimeType === "string" ? part.mimeType : typeof part.mediaType === "string" ? part.mediaType : "";
  return mime.toLowerCase().startsWith("image/");
}

function isAttachmentPart(part: Record<string, unknown>): boolean {
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  return type === "file" || type === "image" || type === "attachment" || type === "document";
}

export function messageRequestBytes(messages: PackMessage[]): number {
  let total = 0;
  for (const message of messages) {
    const content = message.content;
    if (typeof content === "string") {
      total += byteLength(content);
      continue;
    }
    if (Array.isArray(content)) {
      for (const raw of content) {
        const part = asRecord(raw);
        if (!part) continue;
        if (isAttachmentPart(part)) {
          total += isImagePart(part) ? IMAGE_ATTACHMENT_BYTES : OTHER_ATTACHMENT_BYTES;
          continue;
        }
        if (typeof part.text === "string") {
          total += byteLength(part.text);
          continue;
        }
        total += byteLength(JSON.stringify(part));
      }
      continue;
    }
    const parts = message.parts;
    if (Array.isArray(parts)) {
      for (const raw of parts) {
        const part = asRecord(raw);
        if (!part) continue;
        if (isAttachmentPart(part)) {
          total += isImagePart(part) ? IMAGE_ATTACHMENT_BYTES : OTHER_ATTACHMENT_BYTES;
          continue;
        }
        if (typeof part.text === "string") total += byteLength(part.text);
      }
      continue;
    }
    if (typeof message.text === "string") total += byteLength(message.text);
  }
  return total;
}

export function isAttachmentCharged(part: unknown): boolean {
  const record = asRecord(part);
  if (!record) return false;
  return isAttachmentPart(record);
}
