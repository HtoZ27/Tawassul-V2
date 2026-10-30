import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, realpath, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { atomicWriteFile } from "../../infra/disk-utils.ts";
import { logger } from "../../utils/logger.ts";
import { safeHomedir } from "../../utils/path-resolver.ts";
import { assertPackFresh, isPackExpired, verifyPackClaim } from "./claim.ts";
import {
  LEDGER_KEEP_LINES,
  LEDGER_MAX_LINES,
  PACK_MAX_BYTES,
  PACK_MAX_COUNT,
  PACK_MAX_TOTAL_BYTES,
  PACK_TTL_DAYS,
} from "./types.ts";
import type { LedgerEntry, PackIndex, PackIndexEntry, PackRecord } from "./types.ts";

export class PackStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackStoreError";
  }
}

export type ListedPack = {
  record: PackRecord;
  path: string;
  mtimeMs: number;
  size: number;
};

export function resolveDataHome(): string {
  const override = process.env.XDG_DATA_HOME?.trim();
  if (override) return resolve(override);
  return resolve(safeHomedir(), ".local", "share");
}

export function workspaceHash(worktree: string): string {
  const resolved = resolve(worktree || ".");
  return createHash("sha256").update(resolved).digest("hex").slice(0, 16);
}

export function resolvePackRoot(worktree: string): string {
  return join(resolveDataHome(), "tawassul", "context-packs", workspaceHash(worktree));
}

export async function resolveWorkspaceHash(worktree: string): Promise<string> {
  let target = resolve(worktree || ".");
  try {
    target = await realpath(target);
  } catch {
    void 0;
  }
  return createHash("sha256").update(target).digest("hex").slice(0, 16);
}

export function packPaths(root: string): {
  root: string;
  packs: string;
  ledger: string;
  index: string;
  lock: string;
} {
  return {
    root,
    packs: join(root, "packs"),
    ledger: join(root, "ledger.jsonl"),
    index: join(root, "sessions.json"),
    lock: join(root, "lock"),
  };
}

export async function ensurePackRoot(root: string): Promise<void> {
  const paths = packPaths(root);
  await mkdir(paths.packs, { recursive: true, mode: 0o700 });
  await mkdir(root, { recursive: true, mode: 0o700 });
}

export function packDigest(id: string, payload: string): string {
  return createHash("sha256").update(`${id}\n${payload}`, "utf-8").digest("hex");
}

export async function writePackRecord(root: string, record: PackRecord): Promise<string> {
  const paths = packPaths(root);
  await ensurePackRoot(root);
  const target = join(paths.packs, `${record.digest}.json`);
  await atomicWriteFile(target, JSON.stringify(record, null, 2));
  return target;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new PackStoreError(`pack field ${key} is missing`);
  }
  return value;
}

function optionalString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function parseRecord(raw: string, digest: string): PackRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PackStoreError(`pack ${digest} is not valid JSON`);
  }
  const record = asRecord(parsed);
  if (!record) throw new PackStoreError(`pack ${digest} is not an object`);
  const message = asRecord(record.message);
  const content = message && Array.isArray(message.content) ? message.content : undefined;
  const first = content && content.length > 0 ? asRecord(content[0]) : undefined;
  if (!message || message.role !== "user" || !first || first.type !== "text" || typeof first.text !== "string") {
    throw new PackStoreError(`pack ${digest} has an invalid message shape`);
  }
  const out: PackRecord = {
    version: typeof record.version === "number" ? record.version : 0,
    id: requireString(record, "id"),
    payload: requireString(record, "payload"),
    text: requireString(record, "text"),
    bytes: typeof record.bytes === "number" ? record.bytes : Buffer.byteLength(String(record.text ?? ""), "utf8"),
    digest: requireString(record, "digest"),
    sessionID: requireString(record, "sessionID"),
    agent: requireString(record, "agent"),
    handoffId: optionalString(record, "handoffId"),
    parentID: optionalString(record, "parentID"),
    worktree: requireString(record, "worktree"),
    issuedAt: requireString(record, "issuedAt"),
    expiresAt: requireString(record, "expiresAt"),
    nonce: requireString(record, "nonce"),
    claim: requireString(record, "claim"),
    message: { role: "user", content: [{ type: "text", text: first.text }] },
    transferredTo: Array.isArray(record.transferredTo)
      ? record.transferredTo.filter((value): value is string => typeof value === "string")
      : [],
  };
  if (out.digest !== digest) throw new PackStoreError(`pack ${digest} digest field does not match its filename`);
  const recomputed = packDigest(out.id, out.payload);
  if (recomputed !== digest) throw new PackStoreError(`pack ${digest} content digest mismatch`);
  if (out.message.content[0]?.text !== out.text) {
    throw new PackStoreError(`pack ${digest} message text does not match its stored text`);
  }
  if (out.bytes > PACK_MAX_BYTES) throw new PackStoreError(`pack ${digest} exceeds ${PACK_MAX_BYTES} bytes`);
  if (!verifyPackClaim(out, out.claim)) throw new PackStoreError(`pack ${digest} claim is invalid`);
  return out;
}

export async function readPackRecord(
  root: string,
  digest: string,
  options: { allowExpired?: boolean; allowRevoked?: boolean } = {},
): Promise<PackRecord> {
  const target = join(packPaths(root).packs, `${digest}.json`);
  let raw: string;
  try {
    raw = await readFile(target, "utf-8");
  } catch {
    throw new PackStoreError(`pack ${digest} is not readable`);
  }
  const record = parseRecord(raw, digest);
  if (!options.allowExpired) assertPackFresh(record);
  if (!options.allowRevoked) {
    const index = await readIndex(root);
    const entry = Object.values(index).find((candidate) => candidate.digest === digest);
    if (entry?.revoked) throw new PackStoreError(`pack ${digest} is revoked`);
  }
  return record;
}

export async function listPackRecords(
  root: string,
  options: { allowExpired?: boolean } = {},
): Promise<ListedPack[]> {
  const paths = packPaths(root);
  let files: string[];
  try {
    files = await readdir(paths.packs);
  } catch {
    return [];
  }
  const out: ListedPack[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const digest = file.slice(0, -5);
    const target = join(paths.packs, file);
    try {
      const record = await readPackRecord(root, digest, { allowExpired: true, allowRevoked: true });
      if (!options.allowExpired && isPackExpired(record)) continue;
      const info = await stat(target);
      out.push({ record, path: target, mtimeMs: info.mtimeMs, size: info.size });
    } catch {
      void 0;
    }
  }
  out.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return out;
}

export async function appendLedger(root: string, entry: LedgerEntry): Promise<void> {
  const paths = packPaths(root);
  await ensurePackRoot(root);
  await appendFile(paths.ledger, `${JSON.stringify(entry)}\n`, "utf-8");
  try {
    const raw = await readFile(paths.ledger, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length > LEDGER_MAX_LINES) {
      const kept = lines.slice(-LEDGER_KEEP_LINES).join("\n");
      await atomicWriteFile(paths.ledger, `${kept}\n`);
    }
  } catch (error) {
    logger.debug(
      `context pack ledger rotation skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function readLedger(root: string): Promise<LedgerEntry[]> {
  try {
    const raw = await readFile(packPaths(root).ledger, "utf-8");
    const out: LedgerEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = asRecord(JSON.parse(line));
        if (parsed && typeof parsed.type === "string" && typeof parsed.at === "string") {
          out.push(parsed as LedgerEntry);
        }
      } catch {
        void 0;
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function readIndex(root: string): Promise<PackIndex> {
  try {
    const raw = await readFile(packPaths(root).index, "utf-8");
    const parsed = asRecord(JSON.parse(raw));
    if (!parsed) return {};
    const out: PackIndex = {};
    for (const [sessionID, value] of Object.entries(parsed)) {
      const entry = asRecord(value);
      if (!entry || typeof entry.digest !== "string") continue;
      out[sessionID] = {
        digest: entry.digest,
        sessionID: typeof entry.sessionID === "string" ? entry.sessionID : sessionID,
        agent: typeof entry.agent === "string" ? entry.agent : undefined,
        handoffId: typeof entry.handoffId === "string" ? entry.handoffId : undefined,
        parentID: typeof entry.parentID === "string" ? entry.parentID : undefined,
        activatedAt: typeof entry.activatedAt === "string" ? entry.activatedAt : new Date(0).toISOString(),
        transferredTo: Array.isArray(entry.transferredTo)
          ? entry.transferredTo.filter((item): item is string => typeof item === "string")
          : undefined,
        warmed: entry.warmed === true,
        revoked: entry.revoked === true,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export async function writeIndex(root: string, index: PackIndex): Promise<void> {
  await ensurePackRoot(root);
  await atomicWriteFile(packPaths(root).index, JSON.stringify(index, null, 2));
}

export async function setIndexEntry(root: string, entry: PackIndexEntry): Promise<PackIndex> {
  const index = await readIndex(root);
  index[entry.sessionID] = entry;
  await writeIndex(root, index);
  return index;
}

export async function revokeIndexDigest(root: string, digest: string): Promise<PackIndex> {
  const index = await readIndex(root);
  for (const entry of Object.values(index)) {
    if (entry.digest === digest) entry.revoked = true;
  }
  await writeIndex(root, index);
  return index;
}

export async function collectGarbage(
  root: string,
  protectedDigests: Iterable<string> = [],
  now: Date = new Date(),
): Promise<{ removed: number; bytes: number }> {
  const index = await readIndex(root);
  const live = new Set(protectedDigests);
  for (const entry of Object.values(index)) {
    if (!entry.revoked) live.add(entry.digest);
  }
  const all = await listPackRecords(root, { allowExpired: true });
  const removed = new Set<string>();
  let freed = 0;
  const drop = async (item: ListedPack, reason: string): Promise<void> => {
    if (removed.has(item.record.digest)) return;
    await appendLedger(root, {
      type: "tombstone",
      digest: item.record.digest,
      sessionID: item.record.sessionID,
      at: now.toISOString(),
      reason,
    });
    await unlink(item.path).catch(() => undefined);
    removed.add(item.record.digest);
    freed += item.size;
  };
  const candidates = all.filter((item) => !live.has(item.record.digest));
  for (const item of candidates) {
    if (isPackExpired(item.record, now)) await drop(item, "age");
  }
  let remaining = candidates.filter((item) => !removed.has(item.record.digest));
  let totalBytes = all
    .filter((item) => !removed.has(item.record.digest))
    .reduce((sum, item) => sum + item.size, 0);
  for (const item of remaining) {
    if (totalBytes <= PACK_MAX_TOTAL_BYTES) break;
    await drop(item, "bytes");
    totalBytes -= item.size;
  }
  remaining = candidates.filter((item) => !removed.has(item.record.digest));
  let count = all.length - removed.size;
  for (const item of remaining) {
    if (count <= PACK_MAX_COUNT) break;
    await drop(item, "count");
    count -= 1;
  }
  if (removed.size > 0) {
    for (const entry of Object.values(index)) {
      if (removed.has(entry.digest)) entry.revoked = true;
    }
    await writeIndex(root, index);
    await appendLedger(root, {
      type: "gc",
      at: now.toISOString(),
      detail: `removed=${removed.size} bytes=${freed}`,
    });
  }
  return { removed: removed.size, bytes: freed };
}

export function packTtlMs(): number {
  return PACK_TTL_DAYS * 24 * 60 * 60 * 1000;
}
