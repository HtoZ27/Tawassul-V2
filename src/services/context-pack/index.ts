import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Checkpoint } from "../../context/types.ts";
import { logger } from "../../utils/logger.ts";
import { sanitizeOutput } from "../privacy.ts";
import { byteLength } from "./accounting.ts";
import { mintPackClaim, isPackExpired } from "./claim.ts";
import {
  isInjectionWarm,
  messagesContainDigest,
  revokeDigestEverywhere,
  revokeInjection,
  warmInjection,
} from "./hook.ts";
import { withPackLock } from "./lock.ts";
import { buildPackText, previewText, renderPackSource } from "./render.ts";
import { selectConversation } from "./select.ts";
import {
  appendLedger,
  assertPackDigest,
  collectGarbage,
  listPackRecords,
  packDigest,
  packTtlMs,
  readIndex,
  readPackRecord,
  resolvePackRoot,
  setIndexEntry,
  writeIndex,
  writePackRecord,
} from "./store.ts";
import {
  PACK_TEXT_BYTES,
  PACK_VERSION,
} from "./types.ts";
import type {
  HostUserMessage,
  PackClaimFields,
  PackFailureInput,
  PackMessage,
  PackRecord,
  PackSource,
  PackStatus,
  TerminalFailure,
  TransportFile,
} from "./types.ts";

export * from "./types.ts";
export { byteLength, computeBudget, messageRequestBytes, resolveModelWindow, resolveReserve } from "./accounting.ts";
export {
  buildPackText,
  packHeader,
  packTextBudget,
  previewText,
  renderPackSource,
  truncateTextToBytes,
} from "./render.ts";
export { selectConversation, renderPackMessage, selectText } from "./select.ts";
export {
  appendLedger,
  assertPackDigest,
  collectGarbage,
  isPackDigest,
  listPackRecords,
  packDigest,
  readIndex,
  readLedger,
  readPackRecord,
  resolveDataHome,
  resolvePackRoot,
  resolveWorkspaceHash,
  setIndexEntry,
  workspaceHash,
  writeIndex,
  writePackRecord,
} from "./store.ts";
export {
  clearInjectionCache,
  clearSessionInjection,
  handleContextEvent,
  injectionCacheSize,
  isInjectionWarm,
  messagesContainDigest,
  revokeDigestEverywhere,
  revokeInjection,
  warmInjection,
} from "./hook.ts";
export { mintPackClaim, verifyPackClaim, isPackExpired, assertPackFresh } from "./claim.ts";
export { withPackLock, acquirePackLock } from "./lock.ts";

export class PackDisabledError extends Error {
  constructor() {
    super("portable context handoff is disabled");
    this.name = "PackDisabledError";
  }
}

export type KillSwitchConfig = {
  innovations?: Record<string, { enabled?: boolean } | undefined>;
};

let runtimeKillSwitch: KillSwitchConfig | null = null;

export function setContextHandoffConfig(config?: KillSwitchConfig | null): void {
  runtimeKillSwitch = config ?? null;
}

export function isContextHandoffEnabled(config?: KillSwitchConfig | null): boolean {
  const env = process.env.TAWASSUL_CONTEXT_HANDOFF?.trim().toLowerCase();
  if (env === "0" || env === "false" || env === "off" || env === "no") return false;
  const entry = (config ?? runtimeKillSwitch)?.innovations?.contextHandoff;
  return entry?.enabled !== false;
}

export type PackHandoffEntryLike = {
  id: string;
  from: string;
  to: string;
  task: string;
  context: string;
  checkpoint?: Checkpoint;
  files: string[];
  contextPackId?: string;
  contextPackDigest?: string;
  contextPackActivatedAt?: string;
  parentID?: string;
};

export type PackAttachment = {
  digest: string;
  preview: string;
  record: PackRecord;
};

export async function attachPackToHandoff(input: {
  worktree: string;
  sessionID: string;
  agent: string;
  entry: PackHandoffEntryLike;
  config?: KillSwitchConfig | null;
  now?: Date;
}): Promise<PackAttachment | null> {
  if (!isContextHandoffEnabled(input.config)) return null;
  const record = await createPack({
    worktree: input.worktree,
    sessionID: input.sessionID,
    agent: input.agent,
    handoffId: input.entry.id,
    parentID: input.entry.parentID,
    source: {
      task: input.entry.task,
      context: input.entry.context,
      checkpoint: input.entry.checkpoint,
      files: input.entry.files,
      from: input.entry.from,
      to: input.entry.to,
    },
    now: input.now,
  });
  const preview = previewText(record.text);
  input.entry.contextPackId = record.id;
  input.entry.contextPackDigest = record.digest;
  input.entry.contextPackActivatedAt = new Date().toISOString();
  return { digest: record.digest, preview, record };
}

export async function createPack(input: {
  worktree: string;
  sessionID: string;
  agent: string;
  handoffId?: string;
  parentID?: string;
  selection?: string;
  source?: PackSource;
  transferredTo?: string[];
  now?: Date;
}): Promise<PackRecord> {
  if (!isContextHandoffEnabled()) throw new PackDisabledError();
  const worktree = input.worktree;
  const root = resolvePackRoot(worktree);
  const now = input.now ?? new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + packTtlMs()).toISOString();
  const id = `pck_${randomBytes(8).toString("hex")}`;
  const raw = input.selection ?? renderPackSource(input.source ?? {});
  const payload = sanitizeOutput(raw);
  const digest = packDigest(id, payload);
  const fields: PackClaimFields = {
    digest,
    sessionID: input.sessionID,
    agent: input.agent,
    handoffId: input.handoffId ?? "",
    parentID: input.parentID ?? "",
    worktree,
    issuedAt,
    expiresAt,
    nonce: randomBytes(12).toString("hex"),
  };
  const rendered = buildPackText({ ...fields, id }, payload);
  const message: HostUserMessage = {
    role: "user",
    content: [{ type: "text", text: rendered.text }],
  };
  const record: PackRecord = {
    version: PACK_VERSION,
    id,
    payload,
    text: rendered.text,
    bytes: rendered.bytes,
    message,
    claim: mintPackClaim(fields),
    transferredTo: [...(input.transferredTo ?? [])],
    ...fields,
  };
  await withPackLock(root, async () => {
    await writePackRecord(root, record);
    await appendLedger(root, {
      type: "write",
      digest,
      sessionID: input.sessionID,
      handoffId: input.handoffId,
      at: issuedAt,
    });
    await collectGarbage(root, [digest]);
  });
  return record;
}

export async function activatePack(input: {
  worktree: string;
  sessionID: string;
  digest: string;
  readMessages?: () => Promise<unknown[]>;
  transferred?: boolean;
}): Promise<{ ok: boolean; alreadyPresent: boolean; reason?: string; record?: PackRecord }> {
  if (!isContextHandoffEnabled()) return { ok: false, alreadyPresent: false, reason: "disabled" };
  const root = resolvePackRoot(input.worktree);
  let record: PackRecord;
  try {
    record = await readPackRecord(root, input.digest);
  } catch (error) {
    revokeInjection(input.sessionID, input.digest);
    return {
      ok: false,
      alreadyPresent: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  let alreadyPresent = input.transferred === true;
  if (!alreadyPresent) {
    if (input.readMessages) {
      try {
        alreadyPresent = messagesContainDigest(await input.readMessages(), input.digest);
      } catch {
        alreadyPresent = record.transferredTo.includes(input.sessionID);
      }
    } else {
      alreadyPresent = record.transferredTo.includes(input.sessionID);
    }
  }
  await withPackLock(root, async () => {
    const current = (await readIndex(root))[input.sessionID];
    const sameDigest = current?.digest === input.digest;
    await setIndexEntry(root, {
      digest: input.digest,
      sessionID: input.sessionID,
      agent: record.agent,
      handoffId: record.handoffId || undefined,
      parentID: record.parentID || undefined,
      activatedAt: sameDigest && current?.activatedAt ? current.activatedAt : new Date().toISOString(),
      transferredTo: sameDigest ? current?.transferredTo ?? record.transferredTo : record.transferredTo,
      warmed: true,
      revoked: false,
    });
    await appendLedger(root, {
      type: "activate",
      digest: input.digest,
      sessionID: input.sessionID,
      handoffId: record.handoffId || undefined,
      at: new Date().toISOString(),
      reason: alreadyPresent ? "already-present" : "warm",
    });
  });
  warmInjection({
    sessionID: input.sessionID,
    digest: input.digest,
    message: record.message,
    alreadyPresent,
  });
  return { ok: true, alreadyPresent, record };
}

export async function markPackTransferred(input: {
  worktree: string;
  digest: string;
  sessionID: string;
  alreadyPresent?: boolean;
}): Promise<void> {
  assertPackDigest(input.digest);
  const root = resolvePackRoot(input.worktree);
  await withPackLock(root, async () => {
    const index = await readIndex(root);
    const current = index[input.sessionID];
    const sameDigest = current?.digest === input.digest;
    const base = sameDigest
      ? current
      : {
          digest: input.digest,
          sessionID: input.sessionID,
          activatedAt: new Date().toISOString(),
          revoked: false,
        };
    const transferredTo = [...new Set([...(base.transferredTo ?? []), input.sessionID])];
    index[input.sessionID] = { ...base, digest: input.digest, transferredTo, warmed: true };
    await writeIndex(root, index);
    await appendLedger(root, {
      type: "transfer",
      digest: input.digest,
      sessionID: input.sessionID,
      at: new Date().toISOString(),
    });
    try {
      const record = await readPackRecord(root, input.digest, { allowExpired: true, allowRevoked: true });
      if (!record.transferredTo.includes(input.sessionID)) {
        record.transferredTo = [...record.transferredTo, input.sessionID];
        await writePackRecord(root, record);
      }
    } catch (error) {
      logger.debug(
        `context pack transfer marker skipped for ${input.digest}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  try {
    const record = await readPackRecord(root, input.digest);
    warmInjection({
      sessionID: input.sessionID,
      digest: input.digest,
      message: record.message,
      alreadyPresent: input.alreadyPresent ?? true,
    });
  } catch (error) {
    logger.debug(
      `context pack warm-up after transfer skipped for ${input.digest}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function revokePack(input: {
  worktree: string;
  digest: string;
  sessionID?: string;
  reason?: string;
  confirm?: boolean;
}): Promise<{ removed: boolean; revoked: boolean; confirmationRequired?: boolean; error?: string }> {
  assertPackDigest(input.digest);
  const root = resolvePackRoot(input.worktree);
  const index = await readIndex(root);
  const entries = Object.values(index).filter((entry) => entry.digest === input.digest);
  const transferred = entries.some((entry) => (entry.transferredTo ?? []).length > 0);
  const warmed = entries.some((entry) => entry.warmed === true);
  const injected = input.sessionID ? isInjectionWarm(input.sessionID, input.digest) : false;
  const destructive = !warmed && !transferred && !injected;
  if (destructive && input.confirm !== true) {
    return { removed: false, revoked: false, confirmationRequired: true };
  }
  let removed = false;
  let error: string | undefined;
  await withPackLock(root, async () => {
    await appendLedger(root, {
      type: "revoke",
      digest: input.digest,
      sessionID: input.sessionID,
      at: new Date().toISOString(),
      reason: input.reason ?? "manual",
    });
    await appendLedger(root, {
      type: "tombstone",
      digest: input.digest,
      sessionID: input.sessionID,
      at: new Date().toISOString(),
      reason: input.reason ?? "manual",
    });
    if (destructive) {
      try {
        await unlink(join(root, "packs", `${input.digest}.json`));
        removed = true;
      } catch (cause) {
        const code =
          cause && typeof cause === "object" && "code" in cause
            ? (cause as { code?: unknown }).code
            : undefined;
        if (code === "ENOENT") {
          removed = true;
        } else {
          error = cause instanceof Error ? cause.message : String(cause);
        }
      }
    }
    if (!(destructive && removed)) {
      try {
        const record = await readPackRecord(root, input.digest, { allowExpired: true, allowRevoked: true });
        if (!record.revokedAt) {
          record.revokedAt = new Date().toISOString();
          await writePackRecord(root, record);
        }
      } catch (cause) {
        if (!error) error = cause instanceof Error ? cause.message : String(cause);
        logger.debug(
          `context pack revoke marker skipped for ${input.digest}: ${error}`,
        );
      }
    }
    const current = await readIndex(root);
    let changed = false;
    for (const entry of Object.values(current)) {
      if (entry.digest === input.digest && !entry.revoked) {
        entry.revoked = true;
        changed = true;
      }
    }
    if (changed) await writeIndex(root, current);
  });
  revokeDigestEverywhere(input.digest);
  if (input.sessionID) revokeInjection(input.sessionID, input.digest);
  if (destructive) return { removed, revoked: true, ...(error ? { error } : {}) };
  return { removed: false, revoked: true };
}

export async function warmWorkspace(input: {
  worktree: string;
  readMessages?: (sessionID: string) => Promise<unknown[]>;
}): Promise<number> {
  if (!isContextHandoffEnabled()) return 0;
  const root = resolvePackRoot(input.worktree);
  const index = await readIndex(root);
  let warmed = 0;
  for (const [sessionID, entry] of Object.entries(index)) {
    if (entry.revoked) continue;
    try {
      const record = await readPackRecord(root, entry.digest, { allowRevoked: true });
      let alreadyPresent: boolean;
      if (input.readMessages) {
        try {
          alreadyPresent = messagesContainDigest(await input.readMessages(sessionID), entry.digest);
        } catch {
          alreadyPresent = record.transferredTo.includes(sessionID);
        }
      } else {
        alreadyPresent = record.transferredTo.includes(sessionID);
      }
      warmInjection({ sessionID, digest: entry.digest, message: record.message, alreadyPresent });
      warmed += 1;
    } catch {
      void 0;
    }
  }
  return warmed;
}

export async function refreshSessionInjection(input: {
  worktree: string;
  sessionID: string;
  readMessages?: () => Promise<unknown[]>;
}): Promise<boolean> {
  if (!isContextHandoffEnabled()) return false;
  const root = resolvePackRoot(input.worktree);
  const index = await readIndex(root);
  const entry = index[input.sessionID];
  if (!entry || entry.revoked) return false;
  try {
    const record = await readPackRecord(root, entry.digest, { allowRevoked: true });
    let alreadyPresent: boolean;
    if (input.readMessages) {
      try {
        alreadyPresent = messagesContainDigest(await input.readMessages(), entry.digest);
      } catch {
        alreadyPresent = record.transferredTo.includes(input.sessionID);
      }
    } else {
      alreadyPresent = record.transferredTo.includes(input.sessionID);
    }
    warmInjection({
      sessionID: input.sessionID,
      digest: entry.digest,
      message: record.message,
      alreadyPresent,
    });
    await appendLedger(root, {
      type: "compaction",
      digest: entry.digest,
      sessionID: input.sessionID,
      at: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function listPackStatuses(worktree: string): Promise<PackStatus[]> {
  const root = resolvePackRoot(worktree);
  const index = await readIndex(root);
  const revoked = new Set(
    Object.values(index)
      .filter((entry) => entry.revoked)
      .map((entry) => entry.digest),
  );
  const listed = await listPackRecords(root, { allowExpired: true });
  return listed.map(({ record }) => ({
    digest: record.digest,
    id: record.id,
    sessionID: record.sessionID,
    handoffId: record.handoffId || undefined,
    bytes: record.bytes,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    transferredTo: record.transferredTo,
    revoked: revoked.has(record.digest) || Boolean(record.revokedAt),
    expired: isPackExpired(record),
  }));
}

export function packTransportFile(worktree: string, digest: string): TransportFile {
  assertPackDigest(digest);
  const root = resolvePackRoot(worktree);
  const path = `${root}/packs/${digest}.json`;
  return { uri: pathToFileURL(path).href, name: `context-pack-${digest.slice(0, 16)}.json` };
}

export function transportFileFromRecord(worktree: string, record: PackRecord): TransportFile {
  return packTransportFile(worktree, record.digest);
}

const TERMINAL_TYPES = new Set([
  "provider.free-limit",
  "provider.quota",
  "provider.go-limit",
  "provider.chatgpt-limit",
  "provider.budget-limit",
  "provider.model-budget-limit",
  "provider.auth",
  "provider.no-route",
]);

const BILLING_CODES = [
  "insufficient_quota",
  "billing_hard_limit_reached",
  "billing_not_active",
  "account_deactivated",
  "quota failure",
  "quota exceeded",
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function collectErrorTexts(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === undefined || value === null) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  const record = asRecord(value);
  if (!record) return [];
  const out: string[] = [];
  for (const key of ["type", "name", "_tag", "code", "status", "message", "error", "response", "body", "data"]) {
    out.push(...collectErrorTexts(record[key], depth + 1));
  }
  return out;
}

function readRetryAfter(error: unknown): number | undefined {
  const record = asRecord(error);
  if (!record) return undefined;
  const candidates = [record.retryAfterMs, record.retry_after_ms, asRecord(record.data)?.retryAfterMs, asRecord(record.error)?.retryAfterMs];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) return candidate;
  }
  return undefined;
}

export function classifyTerminalFailure(error: unknown): TerminalFailure {
  const texts = collectErrorTexts(error);
  const retryAfterMs = readRetryAfter(error);
  for (const text of texts) {
    const normalized = text.trim().toLowerCase();
    if (!normalized) continue;
    if (TERMINAL_TYPES.has(normalized)) return { terminal: true, reason: normalized, retryAfterMs };
    if (normalized === "402" || normalized === "payment_required" || normalized.includes("http 402")) {
      return { terminal: true, reason: "http-402", retryAfterMs };
    }
    if (BILLING_CODES.some((code) => normalized.includes(code))) {
      return { terminal: true, reason: `billing:${normalized.slice(0, 80)}`, retryAfterMs };
    }
  }
  return { terminal: false, reason: "transient", retryAfterMs };
}

export async function createFailurePack(input: PackFailureInput): Promise<PackRecord | null> {
  if (!isContextHandoffEnabled()) return null;
  const messages = (input.messages ?? []).filter(
    (message): message is PackMessage => !!message && typeof message === "object",
  );
  const failure = classifyTerminalFailure(input.error);
  if (!failure.terminal) return null;
  const selected = selectConversation(messages, PACK_TEXT_BYTES - 1024);
  const errorText = collectErrorTexts(input.error).join("\n");
  const selection =
    selected.text ||
    renderPackSource({
      task: "Terminal provider failure",
      context: errorText || "The provider stopped accepting requests for this session.",
      reason: failure.reason,
    });
  const record = await createPack({
    worktree: input.worktree,
    sessionID: input.sessionID,
    agent: input.agent ?? "unknown",
    selection,
    now: input.now,
  });
  await appendLedger(resolvePackRoot(input.worktree), {
    type: "failure",
    digest: record.digest,
    sessionID: input.sessionID,
    at: new Date().toISOString(),
    reason: failure.reason,
    detail: String(input.retryAfterMs ?? failure.retryAfterMs ?? "none"),
  });
  return record;
}

export function packByteLength(record: PackRecord): number {
  return byteLength(record.text);
}
