import type { HostUserMessage } from "./types.ts";

type CachedInjection = {
  digest: string;
  sessionID: string;
  message: HostUserMessage;
  alreadyPresent: boolean;
  revoked: boolean;
  delivered: WeakSet<object>;
};

const cache = new Map<string, Map<string, CachedInjection>>();

function bucket(sessionID: string): Map<string, CachedInjection> {
  let entries = cache.get(sessionID);
  if (!entries) {
    entries = new Map();
    cache.set(sessionID, entries);
  }
  return entries;
}

export function warmInjection(input: {
  sessionID: string;
  digest: string;
  message: HostUserMessage;
  alreadyPresent: boolean;
}): void {
  const entries = bucket(input.sessionID);
  const existing = entries.get(input.digest);
  if (existing) {
    existing.alreadyPresent = input.alreadyPresent;
    existing.revoked = false;
    existing.message = input.message;
    return;
  }
  entries.set(input.digest, {
    digest: input.digest,
    sessionID: input.sessionID,
    message: input.message,
    alreadyPresent: input.alreadyPresent,
    revoked: false,
    delivered: new WeakSet(),
  });
}

export function revokeInjection(sessionID: string, digest: string): void {
  const entries = cache.get(sessionID);
  const entry = entries?.get(digest);
  if (entry) entry.revoked = true;
}

export function revokeDigestEverywhere(digest: string): void {
  for (const entries of cache.values()) {
    const entry = entries.get(digest);
    if (entry) entry.revoked = true;
  }
}

export function clearSessionInjection(sessionID: string): void {
  cache.delete(sessionID);
}

export function clearInjectionCache(): void {
  cache.clear();
}

export function isInjectionWarm(sessionID: string, digest: string): boolean {
  return cache.get(sessionID)?.has(digest) === true;
}

export function cachedDigests(sessionID: string): string[] {
  return [...(cache.get(sessionID)?.keys() ?? [])];
}

export function injectionCacheSize(): number {
  let total = 0;
  for (const entries of cache.values()) total += entries.size;
  return total;
}

export function messagesContainDigest(messages: unknown[], digest: string): boolean {
  for (const message of messages) {
    if (JSON.stringify(message ?? "").includes(digest)) return true;
  }
  return false;
}

function endsWithToolResult(messages: unknown[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || typeof last !== "object" || Array.isArray(last)) return false;
  const record = last as Record<string, unknown>;
  if (record.role === "tool") return true;
  const content = record.content;
  if (!Array.isArray(content)) return false;
  for (const part of content) {
    if (!part || typeof part !== "object" || Array.isArray(part)) continue;
    if ((part as Record<string, unknown>).type === "tool-result") return true;
  }
  return false;
}

export function handleContextEvent(event: { sessionID?: unknown; messages?: unknown }): number {
  const sessionID = event.sessionID;
  if (typeof sessionID !== "string" || !sessionID) return 0;
  const entries = cache.get(sessionID);
  if (!entries || entries.size === 0) return 0;
  const messages = event.messages;
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  if (endsWithToolResult(messages)) return 0;
  let appended = 0;
  for (const entry of entries.values()) {
    if (entry.alreadyPresent || entry.revoked) continue;
    if (entry.delivered.has(messages)) continue;
    entry.delivered.add(messages);
    messages.push(entry.message);
    appended += 1;
  }
  return appended;
}
